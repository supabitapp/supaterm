// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import type * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { acquireServiceSelectionLock } from "./service/serviceSelectionLock.ts";
import { isNoCopyOnWrite, markNoCopyOnWrite } from "./noCopyOnWrite.ts";

import type {
  PendingServiceUpdate,
  ServiceLauncherChildMessage,
  ServiceLauncherContext,
  ServiceLauncherParentMessage,
  ServiceState,
  ServiceUpdateRecord,
} from "./service/serviceProtocol.ts";
import {
  compareExactServiceVersions,
  decodeServiceLauncherChildMessage,
  isExactServiceVersion,
  parseLegacyServiceState,
  parseServiceState,
  serviceUnitBaseDirOf,
  serviceUnitLogPathOf,
  SERVICE_ENV_FILE,
  SERVICE_SERVING_LOCK_FILE,
  SERVICE_LAUNCHER_CONTEXT_ENV,
  SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_STATE_FILE,
  SERVICE_RESTART_PENDING_FILE,
  SERVICE_UNIT_ENV,
  systemdUnitDirectoryOf,
} from "./service/serviceProtocol.ts";
import {
  legacyOwnerStartedBeforeRecord,
  legacyOwnerStartTimeCommand,
} from "./legacyServerOwner.ts";

const HANDOFF_DELAY_MS = 2_000;
const PREPARED_TIMEOUT_MS = 30 * 60_000;
const TERMINATE_GRACE_MS = 5_000;
const MIN_SERVICE_START_FREE_BYTES = 64 * 1024 ** 2;
const DISK_SPACE_RETRY_MS = 30_000;
const STATE_DIR_OWNED_EXIT_CODE = 78;
const STATE_DIR_OWNER_POLL_MS = 30_000;

type TerminalStatus = "committed" | "rolled-back" | "failed";
type ChildRole = "active" | "trial";

interface ManagedChild {
  readonly version: string;
  role: ChildRole;
  readonly process: NodeChildProcess.ChildProcess;
}

const runtimePaths = (baseDir: string, version: string) => {
  const versionDir = NodePath.join(baseDir, "runtime", "versions", version);
  // oxlint-disable-next-line supaterm/no-global-process-runtime -- Standalone launcher has no Effect runtime.
  const executableName = process.platform === "win32" ? "supaterm.exe" : "supaterm";
  return {
    versionDir,
    entryPath: NodePath.join(versionDir, executableName),
    sentinelPath: NodePath.join(versionDir, ".install-complete"),
  };
};

const runtimeSpawnArguments = (paths: ReturnType<typeof runtimePaths>) => ({
  command: paths.entryPath,
  args: ["serve"],
});

/**
 * The unit or launch agent that `supaterm service install` wrote. Its program names
 * the runtime that ran the install, and a remote update never replaces it, so
 * after a commit the launcher points it at the committed runtime. Otherwise the
 * next start lands on a runtime that nothing in the service state records.
 */
export interface ServiceUnit {
  readonly path: string;
  /** systemd keeps a loaded copy of the unit; launchd re-reads the plist at bootstrap. */
  readonly reload: () => Promise<void>;
}

async function readSystemdUnitDirectory(): Promise<string | undefined> {
  try {
    const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)(
      "busctl",
      [
        "--user",
        "--json=short",
        "get-property",
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
        "UnitPath",
      ],
      { timeout: 5_000 },
    );
    const { data } = JSON.parse(stdout) as { readonly data?: unknown };
    return Array.isArray(data) && data.every((entry) => typeof entry === "string")
      ? systemdUnitDirectoryOf(data)
      : undefined;
  } catch {
    return undefined;
  }
}

async function serviceUnitFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ServiceUnit | undefined> {
  const unitName = env[SERVICE_UNIT_ENV]?.trim();
  const home = env.HOME?.trim();
  if (!unitName || !home) return undefined;
  if (unitName.endsWith(".plist")) {
    return {
      path: NodePath.join(home, "Library", "LaunchAgents", unitName),
      reload: () => Promise.resolve(),
    };
  }
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  const unitDir =
    (await readSystemdUnitDirectory()) ??
    NodePath.join(
      xdgConfigHome && NodePath.isAbsolute(xdgConfigHome)
        ? xdgConfigHome
        : NodePath.join(home, ".config"),
      "systemd",
      "user",
    );
  return {
    path: NodePath.join(unitDir, unitName),
    reload: () =>
      new Promise((resolve, reject) => {
        NodeChildProcess.spawn("systemctl", ["--user", "daemon-reload"], {
          stdio: "ignore",
          timeout: 30_000,
        })
          .once("error", reject)
          .once("exit", (code, signal) =>
            code === 0
              ? resolve()
              : reject(new Error(`systemctl --user daemon-reload exited with ${code ?? signal}`)),
          );
      }),
  };
}

const SERVICE_UNIT_PROGRAMS = [
  /^(ExecStart=.*?[\\/]runtime[\\/]versions[\\/])([^\\/\s"]+)([\\/]supaterm)(?=["\s])/m,
  /(<string>[^<]*?[\\/]runtime[\\/]versions[\\/])([^\\/<]+)([\\/]supaterm<\/string>\s*<string>__service-launcher<\/string>)/,
] as const;

function repointServiceUnit(contents: string, version: string): string {
  for (const program of SERVICE_UNIT_PROGRAMS) {
    const match = program.exec(contents);
    if (match === null) continue;
    const [, prefix = "", current = "", suffix = ""] = match;
    if (isExactServiceVersion(current) && compareExactServiceVersions(current, version) >= 0) {
      return contents;
    }
    return contents.replace(program, () => `${prefix}${version}${suffix}`);
  }
  return contents;
}

const SERVICE_LOG_MAX_BYTES = 10 * 1024 * 1024;
const SERVICE_LOG_CHECK_INTERVAL_MS = 10 * 60_000;

async function boundServiceLog(logPath: string): Promise<void> {
  const size = await NodeFSP.stat(logPath).then(
    (stats) => stats.size,
    () => 0,
  );
  if (size <= SERVICE_LOG_MAX_BYTES) return;
  const archivePath = `${logPath}.1`;
  const pendingArchivePath = `${archivePath}.tmp`;
  await NodeFSP.copyFile(logPath, pendingArchivePath)
    .then(() => NodeFSP.rename(pendingArchivePath, archivePath))
    .catch(() => NodeFSP.rm(pendingArchivePath, { force: true }).catch(() => undefined));
  await NodeFSP.truncate(logPath, 0).catch(() => undefined);
}

async function serviceLogPath(serviceUnit: ServiceUnit | undefined): Promise<string | undefined> {
  if (serviceUnit === undefined) return undefined;
  const contents = await NodeFSP.readFile(serviceUnit.path, "utf8").catch(() => undefined);
  return contents === undefined ? undefined : serviceUnitLogPathOf(contents);
}

const DB_FILE_SUFFIXES = ["", "-wal", "-shm"] as const;
const RESTORE_MARKER = ".restore-pending";

const databaseBackupDir = (baseDir: string, updateId: string) =>
  NodePath.join(baseDir, "runtime", "db-backup", updateId);

const databaseBackupFile = (backupDir: string, suffix: (typeof DB_FILE_SUFFIXES)[number]) =>
  NodePath.join(backupDir, suffix === "" ? "database" : `database${suffix}`);

async function pathExists(target: string): Promise<boolean> {
  try {
    await NodeFSP.access(target);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
}

const MANAGED_SERVICE_ENV_NAMES = new Set([
  "PATH",
  "SUPATERM_HOME",
  "SUPATERM_BOOT_SERVICE_UNIT",
  SERVICE_LAUNCHER_CONTEXT_ENV,
]);

export async function readServiceEnvironment(
  baseDir: string,
  inherited: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const environment = { ...inherited };
  let contents: string;
  try {
    contents = await NodeFSP.readFile(NodePath.join(baseDir, SERVICE_ENV_FILE), "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return environment;
    throw cause;
  }
  for (const [name, value] of Object.entries(NodeUtil.parseEnv(contents))) {
    if (
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
      !MANAGED_SERVICE_ENV_NAMES.has(name.toUpperCase())
    ) {
      environment[name] = value;
    }
  }
  return environment;
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await NodeFSP.open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await NodeFSP.open(directory, "r");
  try {
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  } finally {
    await handle.close();
  }
}

function runCp(args: ReadonlyArray<string>, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    NodeChildProcess.execFile("cp", args, { signal }, (error) => resolve(error === null));
  });
}

async function copyDatabaseFile(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  // oxlint-disable-next-line supaterm/no-global-process-runtime -- Standalone launcher has no Effect runtime.
  const platform = process.platform;
  const hardLinked =
    platform === "darwin" &&
    ((await NodeFSP.stat(destination).catch(() => undefined))?.nlink ?? 1) > 1;
  const args =
    platform === "darwin" && !hardLinked
      ? ["-c", source, destination]
      : platform === "linux"
        ? ["--reflink=auto", source, destination]
        : undefined;
  if (args !== undefined && (await runCp(args, signal))) return;
  signal?.throwIfAborted();
  await NodeFSP.copyFile(source, destination);
}

const GIB = 1024 ** 3;
const CLONED_BACKUP_MIN_HEADROOM_BYTES = GIB;
const CLONED_BACKUP_HEADROOM_FRACTION = 0.1;
const ONLINE_BACKUP_WAL_HEADROOM_BYTES = 2 * 128 * 1024 ** 2;

async function statDatabaseFiles(dbPath: string): Promise<ReadonlyArray<NodeFS.Stats>> {
  const stats: Array<NodeFS.Stats> = [];
  for (const suffix of DB_FILE_SUFFIXES) {
    const stat = await NodeFSP.stat(`${dbPath}${suffix}`).catch((cause: unknown) => {
      if (suffix !== "" && (cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    });
    if (stat !== undefined) stats.push(stat);
  }
  return stats;
}

async function backupCanClone(dbPath: string, backupRoot: string): Promise<boolean> {
  // oxlint-disable-next-line supaterm/no-global-process-runtime -- Standalone launcher has no Effect runtime.
  const platform = process.platform;
  if (platform === "darwin") {
    const [backupDirectory, backupFs, systemFs] = await Promise.all([
      NodeFSP.stat(backupRoot),
      NodeFSP.statfs(backupRoot),
      NodeFSP.statfs("/"),
    ]);
    if (backupFs.type !== systemFs.type) return false;
    return (await statDatabaseFiles(dbPath)).every(
      (source) => source.dev === backupDirectory.dev && source.nlink === 1,
    );
  }
  if (platform !== "linux") return false;
  const probe = NodePath.join(backupRoot, `.clone-probe-${NodeCrypto.randomUUID()}`);
  try {
    for (const suffix of DB_FILE_SUFFIXES) {
      const source = `${dbPath}${suffix}`;
      if (suffix !== "" && !(await pathExists(source))) continue;
      if (!(await runCp(["--reflink=always", source, `${probe}${suffix}`]))) return false;
    }
    return true;
  } finally {
    for (const suffix of DB_FILE_SUFFIXES) {
      await NodeFSP.rm(`${probe}${suffix}`, { force: true }).catch(() => undefined);
    }
  }
}

export interface BackupSpaceProbe {
  readonly readFreeBytes: (directory: string) => Promise<number>;
  readonly canClone: (dbPath: string, backupRoot: string) => Promise<boolean>;
}

const filesystemBackupSpaceProbe: BackupSpaceProbe = {
  readFreeBytes: async (directory) => {
    const stats = await NodeFSP.statfs(directory);
    return stats.bavail * stats.bsize;
  },
  canClone: backupCanClone,
};

async function removeAbandonedBackupCopies(backupRoot: string): Promise<void> {
  for (const entry of await NodeFSP.readdir(backupRoot)) {
    if (!entry.endsWith(".staging")) continue;
    await NodeFSP.rm(NodePath.join(backupRoot, entry), { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

/**
 * Runs before the server is stopped so a full disk refuses the update instead of causing an
 * outage and a cold restart.
 */
export async function databaseBackupBlocker(
  baseDir: string,
  dbPath: string,
  probe: Partial<BackupSpaceProbe> = {},
): Promise<string | undefined> {
  const { readFreeBytes, canClone } = { ...filesystemBackupSpaceProbe, ...probe };
  const backupRoot = NodePath.join(baseDir, "runtime", "db-backup");
  await NodeFSP.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  if (await isNoCopyOnWrite(dbPath)) await markNoCopyOnWrite(backupRoot);
  await removeAbandonedBackupCopies(backupRoot);
  const [files, free] = await Promise.all([statDatabaseFiles(dbPath), readFreeBytes(backupRoot)]);
  const size = files.reduce((total, file) => total + file.size, 0);
  const fullCopyBytes = size * 1.05 + ONLINE_BACKUP_WAL_HEADROOM_BYTES;
  if (free >= fullCopyBytes) return undefined;
  const clonedBytes = Math.max(
    CLONED_BACKUP_MIN_HEADROOM_BYTES,
    size * CLONED_BACKUP_HEADROOM_FRACTION,
  );
  const needed = (await canClone(dbPath, backupRoot)) ? clonedBytes : fullCopyBytes;
  if (free >= needed) return undefined;
  const gb = (bytes: number) => (bytes / GIB).toFixed(1);
  return `Not enough free disk space to back up the database before updating: ${gb(needed)} GB needed, ${gb(free)} GB free. Free up disk space and try again. The server was not stopped.`;
}

async function copyWithoutOpening(source: string, destination: string): Promise<void> {
  // oxlint-disable-next-line supaterm/no-global-process-runtime -- Standalone launcher has no Effect runtime.
  if (process.platform === "win32") return NodeFSP.copyFile(source, destination);
  if (!(await runCp([source, destination]))) throw new Error(`cp ${source} failed.`);
}

async function startOnlineDatabaseBackup(
  baseDir: string,
  pending: PendingServiceUpdate,
  probe: Partial<BackupSpaceProbe> = {},
): Promise<(() => Promise<void>) | undefined> {
  const backupDir = databaseBackupDir(baseDir, pending.id);
  if (await pathExists(backupDir)) return undefined;
  const { canClone } = { ...filesystemBackupSpaceProbe, ...probe };
  if (await canClone(pending.dbPath, NodePath.dirname(backupDir)).catch(() => true))
    return undefined;
  const NodeSqlite = await import("node:sqlite").catch(() => undefined);
  if (NodeSqlite === undefined) return undefined;

  const stagingDir = `${backupDir}.staging`;
  const discardStaging = () =>
    NodeFSP.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  const fallBack = async (cause: unknown) => {
    await discardStaging();
    process.stderr.write(
      `[service-launcher] Copying the database while the server runs failed; backing it up offline: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return undefined;
  };
  let snapshot: InstanceType<typeof NodeSqlite.DatabaseSync> | undefined;
  let dbPath = pending.dbPath;
  const release = () => {
    try {
      snapshot?.close();
    } catch {}
    snapshot = undefined;
  };
  try {
    await discardStaging();
    await NodeFSP.mkdir(stagingDir, { recursive: true, mode: 0o700 });
    dbPath = await NodeFSP.realpath(pending.dbPath);
    snapshot = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    const mode = String(snapshot.prepare("PRAGMA journal_mode").get()?.journal_mode);
    if (mode.toLowerCase() !== "wal") throw new Error(`journal_mode is ${mode}, not wal.`);
    snapshot.exec("BEGIN");
    snapshot.prepare("SELECT count(*) FROM sqlite_schema").get();
    const mainCopy = databaseBackupFile(stagingDir, "");
    await copyWithoutOpening(dbPath, mainCopy);
    await syncFile(mainCopy);
  } catch (cause) {
    release();
    return fallBack(cause);
  }
  return async () => {
    try {
      const wal = `${dbPath}-wal`;
      if (!(await pathExists(wal)))
        throw new Error("the WAL disappeared while the snapshot was open.");
      const walCopy = databaseBackupFile(stagingDir, "-wal");
      await copyWithoutOpening(wal, walCopy);
      await syncFile(walCopy);
      release();
      await NodeFSP.rename(stagingDir, backupDir);
      await syncDirectory(NodePath.dirname(backupDir));
    } catch (cause) {
      release();
      await fallBack(cause);
    }
  };
}

async function backupDatabaseOnce(
  baseDir: string,
  pending: PendingServiceUpdate,
  signal: AbortSignal,
): Promise<void> {
  const backupDir = databaseBackupDir(baseDir, pending.id);
  if (await pathExists(backupDir)) return;

  const stagingDir = `${backupDir}.staging`;
  await NodeFSP.rm(stagingDir, { recursive: true, force: true });
  await NodeFSP.mkdir(stagingDir, { recursive: true, mode: 0o700 });
  try {
    for (const suffix of DB_FILE_SUFFIXES) {
      signal.throwIfAborted();
      const source = `${pending.dbPath}${suffix}`;
      if (suffix !== "" && !(await pathExists(source))) continue;
      const destination = databaseBackupFile(stagingDir, suffix);
      await copyDatabaseFile(source, destination, signal);
      await syncFile(destination);
    }
    await NodeFSP.rename(stagingDir, backupDir);
    await syncDirectory(NodePath.dirname(backupDir));
  } catch (cause) {
    await NodeFSP.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw cause;
  }
}

const restoreMarkerPath = (baseDir: string, updateId: string) =>
  NodePath.join(databaseBackupDir(baseDir, updateId), RESTORE_MARKER);

const databaseRestorePending = (baseDir: string, pending: PendingServiceUpdate) =>
  pathExists(restoreMarkerPath(baseDir, pending.id));

async function markDatabaseRestorePending(backupDir: string): Promise<void> {
  const markerPath = NodePath.join(backupDir, RESTORE_MARKER);
  if (!(await pathExists(markerPath))) {
    const handle = await NodeFSP.open(markerPath, "wx", 0o600);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(backupDir);
  }
}

async function restoreTarget(path: string): Promise<string> {
  let current = path;
  for (let hops = 0; hops < 40; hops++) {
    try {
      return await NodeFSP.realpath(current);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    const link = await NodeFSP.readlink(current).catch((cause: unknown) => {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EINVAL") return undefined;
      throw cause;
    });
    if (link === undefined) return current;
    current = NodePath.isAbsolute(link)
      ? link
      : `${await NodeFSP.realpath(NodePath.dirname(current))}${NodePath.sep}${link}`;
  }
  throw new Error(`Too many symbolic links resolving ${path}.`);
}

async function restoreDatabaseBackup(
  baseDir: string,
  pending: PendingServiceUpdate,
): Promise<void> {
  const backupDir = databaseBackupDir(baseDir, pending.id);
  if (!(await pathExists(backupDir))) return;

  await markDatabaseRestorePending(backupDir);
  const directories = new Set([NodePath.dirname(pending.dbPath)]);
  const mainTarget = await restoreTarget(pending.dbPath);
  for (const suffix of DB_FILE_SUFFIXES) {
    const livePath = suffix === "" ? pending.dbPath : `${mainTarget}${suffix}`;
    if (livePath !== `${pending.dbPath}${suffix}`) {
      await NodeFSP.rm(`${pending.dbPath}${suffix}`, { force: true });
    }
    const source = databaseBackupFile(backupDir, suffix);
    if (await pathExists(source)) {
      const target = await restoreTarget(livePath);
      await copyDatabaseFile(source, target);
      await syncFile(target);
      directories.add(NodePath.dirname(target));
    } else {
      await NodeFSP.rm(livePath, { force: true });
    }
  }
  for (const directory of directories) await syncDirectory(directory);
}

async function discardDatabaseBackup(baseDir: string, updateId: string): Promise<void> {
  const backupDir = databaseBackupDir(baseDir, updateId);
  if (!(await pathExists(backupDir))) return;
  await NodeFSP.rm(backupDir, { recursive: true, force: true });
  await syncDirectory(NodePath.dirname(backupDir));
}

export async function readServiceState(filePath: string): Promise<ServiceState> {
  const contents = await NodeFSP.readFile(filePath, "utf8");
  const state = parseServiceState(contents) ?? adoptLegacyServiceState(contents);
  if (state === undefined) throw new Error("Service state is invalid or unsupported.");
  return state;
}

function adoptLegacyServiceState(contents: string): ServiceState | undefined {
  const legacy = parseLegacyServiceState(contents);
  return legacy && { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: legacy.activeVersion };
}

export async function writeServiceState(filePath: string, state: ServiceState): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceFileDurably(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function replaceFileDurably(filePath: string, contents: string): Promise<void> {
  const directory = NodePath.dirname(filePath);
  const tempPath = NodePath.join(
    directory,
    `.${NodePath.basename(filePath)}.${process.pid}.${NodeCrypto.randomUUID()}`,
  );
  let handle: NodeFSP.FileHandle | undefined;
  try {
    handle = await NodeFSP.open(tempPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await NodeFSP.rename(tempPath, filePath);
    await syncDirectory(directory);
  } finally {
    await handle?.close().catch(() => undefined);
    await NodeFSP.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function runtimeExists(baseDir: string, version: string): Promise<boolean> {
  const paths = runtimePaths(baseDir, version);
  try {
    const [entry, sentinel] = await Promise.all([
      NodeFSP.stat(paths.entryPath),
      NodeFSP.readFile(paths.sentinelPath, "utf8"),
    ]);
    return entry.isFile() && sentinel.trim() === version;
  } catch {
    return false;
  }
}

function terminalUpdate<S extends TerminalStatus>(input: {
  readonly pending: PendingServiceUpdate;
  readonly status: S;
  readonly reason?: string;
}): Exclude<ServiceUpdateRecord, PendingServiceUpdate> & { readonly status: S } {
  return {
    id: input.pending.id,
    fromVersion: input.pending.fromVersion,
    targetVersion: input.pending.targetVersion,
    status: input.status,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
}

function sendMessage(
  child: NodeChildProcess.ChildProcess,
  message: ServiceLauncherParentMessage,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!child.connected || child.send === undefined) {
      reject(new Error("service child IPC is disconnected."));
      return;
    }
    child.send(message, (error) => (error === null ? resolve() : reject(error)));
  });
}

function waitForExit(child: NodeChildProcess.ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

async function terminateChild(
  child: NodeChildProcess.ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  const force = setTimeout(() => child.kill("SIGKILL"), TERMINATE_GRACE_MS);
  try {
    await waitForExit(child);
  } finally {
    clearTimeout(force);
  }
}

async function tryAcquireSqliteLock(
  lockPath: string,
  busyTimeoutMs = 0,
): Promise<{ readonly close: () => void } | undefined> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(lockPath);
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}; BEGIN EXCLUSIVE;`);
    return db;
  } catch (cause) {
    db.close();
    if (cause instanceof Error && "errcode" in cause && cause.errcode === 5) return undefined;
    throw cause;
  }
}

async function sqliteLockHeld(lockPath: string): Promise<boolean> {
  if (
    !(await NodeFSP.access(lockPath).then(
      () => true,
      () => false,
    ))
  )
    return false;
  const lock = await tryAcquireSqliteLock(lockPath);
  lock?.close();
  return lock === undefined;
}

const servingLockPath = (baseDir: string) =>
  NodePath.join(baseDir, "runtime", SERVICE_SERVING_LOCK_FILE);

/** Whether a launcher has, or is about to start, a server for this home. An idle one does not. */
export const serviceLauncherIsServing = (baseDir: string): Promise<boolean> =>
  sqliteLockHeld(servingLockPath(baseDir)).catch(() => false);

export async function stateDirOwned(baseDir: string): Promise<boolean> {
  const stateDir = NodePath.join(baseDir, "userdata");
  const lock = await tryAcquireSqliteLock(NodePath.join(stateDir, "server-owner.sqlite")).catch(
    () => null,
  );
  if (lock === null) return false;
  if (lock === undefined) return true;
  lock.close();
  let record: unknown;
  try {
    record = JSON.parse(
      await NodeFSP.readFile(NodePath.join(stateDir, "server-runtime.json"), "utf8"),
    );
  } catch {
    return false;
  }
  if (typeof record !== "object" || record === null || "ownerId" in record) return false;
  const pid = "pid" in record ? record.pid : undefined;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) return false;
  }
  const recordedAt = Date.parse(
    "startedAt" in record && typeof record.startedAt === "string" ? record.startedAt : "",
  );
  if (!Number.isFinite(recordedAt)) return true;
  // oxlint-disable-next-line supaterm/no-global-process-runtime -- Standalone launcher has no Effect runtime.
  const platform = process.platform;
  const { command, args, env } = legacyOwnerStartTimeCommand(pid, platform);
  const output = await new Promise<string | undefined>((resolve) =>
    NodeChildProcess.execFile(
      command,
      args,
      { env: { ...process.env, ...env }, timeout: 2_000, maxBuffer: 16_384 },
      (error, stdout) => resolve(error === null ? stdout : undefined),
    ),
  );
  return legacyOwnerStartedBeforeRecord(output, recordedAt, platform);
}

const restartPendingPath = (baseDir: string) =>
  NodePath.join(baseDir, "runtime", SERVICE_RESTART_PENDING_FILE);

export class Launcher {
  readonly #baseDir: string;
  readonly #statePath: string;
  #state: ServiceState;
  #child: ManagedChild | null = null;
  #timer: NodeJS.Timeout | undefined;
  #transitions: Promise<void> = Promise.resolve();
  #stopRequested = false;
  readonly #stopSignal = new AbortController();
  #stopping = false;
  #done = false;
  readonly #completion = Promise.withResolvers<void>();
  readonly #backupSpaceProbe: Partial<BackupSpaceProbe> | undefined;
  readonly #serviceUnit: ServiceUnit | undefined;
  readonly #environment: Readonly<NodeJS.ProcessEnv>;
  readonly #stateDirOwnerPollMs: number;
  readonly #readStartFreeBytes: (directory: string) => Promise<number>;
  readonly #writeLog: (line: string) => void;
  #stateDirFreeProbes = 0;
  #servingLock: { readonly close: () => void } | undefined;

  constructor(
    baseDir: string,
    state: ServiceState,
    options: {
      readonly backupSpaceProbe?: Partial<BackupSpaceProbe>;
      readonly serviceUnit?: ServiceUnit;
      readonly environment?: Readonly<NodeJS.ProcessEnv>;
      readonly stateDirOwnerPollMs?: number;
      readonly readStartFreeBytes?: (directory: string) => Promise<number>;
      readonly writeLog?: (line: string) => void;
    } = {},
  ) {
    this.#baseDir = baseDir;
    this.#readStartFreeBytes =
      options.readStartFreeBytes ?? filesystemBackupSpaceProbe.readFreeBytes;
    this.#writeLog =
      options.writeLog ??
      ((line) => {
        process.stderr.write(line);
      });
    this.#stateDirOwnerPollMs = options.stateDirOwnerPollMs ?? STATE_DIR_OWNER_POLL_MS;
    this.#backupSpaceProbe = options.backupSpaceProbe;
    this.#serviceUnit = options.serviceUnit;
    this.#environment = { ...(options.environment ?? process.env) };
    this.#statePath = NodePath.join(baseDir, "runtime", SERVICE_STATE_FILE);
    this.#state = state;
  }

  async run(): Promise<void> {
    const onSigterm = () => void this.stop("SIGTERM");
    const onSigint = () => void this.stop("SIGINT");
    process.once("SIGTERM", onSigterm);
    process.once("SIGINT", onSigint);
    try {
      this.#enqueue(() => this.#recover());
      await this.#completion.promise;
    } finally {
      this.#releaseServing();
      process.off("SIGTERM", onSigterm);
      process.off("SIGINT", onSigint);
    }
  }

  async #claimServing(): Promise<void> {
    this.#servingLock ??= await tryAcquireSqliteLock(servingLockPath(this.#baseDir), 250).catch(
      () => undefined,
    );
  }

  #releaseServing(): void {
    this.#servingLock?.close();
    this.#servingLock = undefined;
  }

  #enqueue(transition: () => Promise<void>): void {
    this.#transitions = this.#transitions
      .then(transition, transition)
      .catch((cause: unknown) =>
        this.#fatal(cause instanceof Error ? cause : new Error(String(cause))),
      );
  }

  async #fatal(error: Error): Promise<void> {
    if (this.#done) return;
    this.#done = true;
    this.#stopping = true;
    this.#clearTimer();
    const child = this.#child?.process;
    this.#child = null;
    if (child !== undefined) await terminateChild(child);
    this.#completion.reject(error);
  }

  async stop(signal: NodeJS.Signals): Promise<void> {
    if (this.#stopRequested || this.#stopping) {
      await this.#completion.promise.catch(() => undefined);
      return;
    }
    this.#stopRequested = true;
    this.#stopSignal.abort();
    this.#clearTimer();
    this.#enqueue(async () => {
      this.#stopping = true;
      this.#clearTimer();
      const child = this.#child?.process;
      this.#child = null;
      if (child !== undefined) await terminateChild(child, signal);
      this.#done = true;
      this.#completion.resolve();
    });
    await this.#completion.promise.catch(() => undefined);
  }

  #clearTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #serviceStartDiskSpaceBlocker(): Promise<string | undefined> {
    const databasePath =
      this.#state.update?.status === "pending"
        ? this.#state.update.dbPath
        : NodePath.join(this.#baseDir, "userdata", "statev2.sqlite");
    const resolvedDatabasePath = await restoreTarget(databasePath).catch(() => databasePath);
    const freeBytes = async (directory: string): Promise<number> => {
      try {
        return await this.#readStartFreeBytes(directory);
      } catch (cause) {
        const parent = NodePath.dirname(directory);
        if ((cause as NodeJS.ErrnoException).code === "ENOENT" && parent !== directory) {
          return freeBytes(parent);
        }
        return Number.POSITIVE_INFINITY;
      }
    };
    const available = await Promise.all([
      freeBytes(this.#baseDir),
      freeBytes(NodePath.dirname(resolvedDatabasePath)),
    ]);
    const free = Math.min(...available);
    return free < MIN_SERVICE_START_FREE_BYTES
      ? `Supaterm needs at least ${MIN_SERVICE_START_FREE_BYTES} bytes free before starting the server; ${free} bytes available.`
      : undefined;
  }

  async #deferForDiskSpace(retry: () => Promise<void>): Promise<boolean> {
    const reason = await this.#serviceStartDiskSpaceBlocker();
    if (reason === undefined) return false;
    if (this.#stopRequested) return true;
    this.#clearTimer();
    this.#releaseServing();
    try {
      this.#writeLog(`[service-launcher] ${reason} Waiting for free space before retrying.\n`);
    } catch {}
    this.#timer = setInterval(
      () =>
        this.#enqueue(async () => {
          if (this.#child !== null || this.#stopping) return;
          if ((await this.#serviceStartDiskSpaceBlocker()) !== undefined) return;
          this.#clearTimer();
          await this.#claimServing();
          await retry();
        }),
      DISK_SPACE_RETRY_MS,
    );
    return true;
  }

  async #selectState(next: ServiceState): Promise<void> {
    const release = await acquireServiceSelectionLock(this.#statePath);
    try {
      const selected = await readServiceState(this.#statePath);
      if (
        selected.activeVersion !== this.#state.activeVersion ||
        selected.update?.id !== this.#state.update?.id ||
        selected.update?.status !== this.#state.update?.status
      ) {
        throw new Error("Service selection changed. Restart the service before updating.");
      }
      await writeServiceState(this.#statePath, next);
      this.#state = next;
    } finally {
      release();
    }
  }

  async #recover(): Promise<void> {
    await this.#claimServing();
    const restartPending = restartPendingPath(this.#baseDir);
    try {
      const release = await acquireServiceSelectionLock(this.#statePath);
      try {
        const selected = await readServiceState(this.#statePath);
        const awaitedVersion = await NodeFSP.readFile(restartPending, "utf8").catch(
          () => undefined,
        );
        const awaited = awaitedVersion?.trim();
        if (
          selected.activeVersion === this.#state.activeVersion &&
          selected.update?.id === this.#state.update?.id &&
          selected.update?.status === this.#state.update?.status &&
          awaited !== undefined &&
          isExactServiceVersion(awaited) &&
          compareExactServiceVersions(awaited, this.#state.activeVersion) <= 0
        ) {
          await NodeFSP.rm(restartPending, { force: true });
        }
      } finally {
        release();
      }
    } catch (error) {
      this.#writeLog(
        `[service-launcher] Could not clear ${restartPending}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    const update = this.#state.update;
    if (update?.status !== "pending") {
      if (update !== undefined) {
        await discardDatabaseBackup(this.#baseDir, update.id).catch(() => undefined);
      }
      try {
        await this.#startChild(this.#state.activeVersion, "active", update);
      } finally {
        if (update !== undefined) await this.#repointServiceUnit(this.#state.activeVersion);
      }
      return;
    }
    if (await databaseRestorePending(this.#baseDir, update)) {
      await this.#returnToPrevious(update, "failed", "rollback-interrupted");
      return;
    }
    if (!(await runtimeExists(this.#baseDir, update.targetVersion))) {
      await this.#returnToPrevious(update, "failed", "target-runtime-missing");
      return;
    }
    await this.#startTrial(update);
  }

  async #startTrial(pending: PendingServiceUpdate): Promise<void> {
    if (await this.#deferForDiskSpace(() => this.#startTrial(pending))) return;
    try {
      await backupDatabaseOnce(this.#baseDir, pending, this.#stopSignal.signal);
    } catch {
      if (this.#stopRequested) return;
      await this.#returnToPrevious(pending, "failed", "db-backup-failed");
      return;
    }
    if (this.#stopRequested) return;
    try {
      await this.#startChild(pending.targetVersion, "trial", pending);
    } catch {
      await this.#returnToPrevious(pending, "failed", "candidate-start-failed");
    }
  }

  async #startChild(version: string, role: ChildRole, update?: ServiceUpdateRecord): Promise<void> {
    if (this.#stopping) return;
    if (
      await this.#deferForDiskSpace(() =>
        role === "trial" && update?.status === "pending"
          ? this.#startTrial(update)
          : this.#startChild(version, role, update),
      )
    )
      return;
    if (!(await runtimeExists(this.#baseDir, version))) {
      throw new Error(`Selected supaterm@${version} runtime is missing or incomplete.`);
    }
    if (this.#stopping) return;
    const paths = runtimePaths(this.#baseDir, version);
    const context: ServiceLauncherContext = {
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      childVersion: version,
      ...(update === undefined ? {} : { update }),
    };
    const spawnArguments = runtimeSpawnArguments(paths);
    const child = NodeChildProcess.spawn(spawnArguments.command, spawnArguments.args, {
      env: { ...this.#environment, [SERVICE_LAUNCHER_CONTEXT_ENV]: JSON.stringify(context) },
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      child.once("error", onError);
      child.once("spawn", () => {
        child.removeListener("error", onError);
        child.on("error", (error) => this.#enqueue(() => Promise.reject(error)));
        resolve();
      });
    });
    if (this.#stopping) {
      await terminateChild(child);
      return;
    }

    const managed: ManagedChild = {
      version,
      role,
      process: child,
    };
    this.#child = managed;
    child.on("message", (value) => {
      const message = decodeServiceLauncherChildMessage(value);
      if (message !== undefined) this.#enqueue(() => this.#handleMessage(managed, message));
    });
    child.once("exit", (code, signal) =>
      this.#enqueue(() => this.#handleExit(managed, code, signal)),
    );

    if (role === "trial") {
      this.#timer = setTimeout(
        () => this.#enqueue(() => this.#handlePreparedTimeout(managed)),
        PREPARED_TIMEOUT_MS,
      );
    }
  }

  async #handleMessage(child: ManagedChild, message: ServiceLauncherChildMessage): Promise<void> {
    if (this.#child !== child || this.#stopping) return;
    if (message.type === "request-update") {
      await this.#handleUpdateRequest(child, message);
      return;
    }
    await this.#handlePrepared(child, message.updateId);
  }

  async #handleUpdateRequest(
    child: ManagedChild,
    message: Extract<ServiceLauncherChildMessage, { readonly type: "request-update" }>,
  ): Promise<void> {
    const reject = (reason: string) =>
      sendMessage(child.process, { type: "update-rejected", reason });
    if (child.role !== "active") {
      await reject("Only the active server can request an update.");
      return;
    }
    if (child.version !== this.#state.activeVersion) {
      await reject("The requesting server is not the selected active version.");
      return;
    }
    if (this.#state.update?.status === "pending") {
      await reject("Another server update is already pending.");
      return;
    }
    if (!isExactServiceVersion(message.targetVersion)) {
      await reject("The requested target is not an exact version.");
      return;
    }
    if (compareExactServiceVersions(message.targetVersion, child.version) <= 0) {
      await reject("Remote updates must select a newer server version.");
      return;
    }
    if (!NodePath.isAbsolute(message.dbPath)) {
      await reject("The requested database path is not absolute.");
      return;
    }
    if (!(await runtimeExists(this.#baseDir, message.targetVersion))) {
      await reject("The requested target runtime is missing or incomplete.");
      return;
    }
    const backupBlocker = await databaseBackupBlocker(
      this.#baseDir,
      message.dbPath,
      this.#backupSpaceProbe,
    ).catch(
      (error: unknown) =>
        `Could not check that the database backup fits before updating: ${error instanceof Error ? error.message : String(error)}. The server was not stopped.`,
    );
    if (!child.process.connected) return;
    if (backupBlocker !== undefined) {
      await reject(backupBlocker);
      return;
    }

    const pending: PendingServiceUpdate = {
      id: NodeCrypto.randomUUID(),
      fromVersion: child.version,
      targetVersion: message.targetVersion,
      dbPath: message.dbPath,
      status: "pending",
    };
    const next: ServiceState = { ...this.#state, update: pending };
    try {
      await this.#selectState(next);
    } catch (error) {
      await reject(error instanceof Error ? error.message : String(error));
      return;
    }
    await sendMessage(child.process, { type: "update-accepted", updateId: pending.id });
    this.#timer = setTimeout(() => this.#enqueue(() => this.#beginTrial(child)), HANDOFF_DELAY_MS);
  }

  async #beginTrial(child: ManagedChild): Promise<void> {
    const pending = this.#state.update;
    if (this.#child !== child || child.role !== "active" || pending?.status !== "pending") {
      return;
    }
    this.#timer = undefined;
    const finishOnlineBackup = await startOnlineDatabaseBackup(
      this.#baseDir,
      pending,
      this.#backupSpaceProbe,
    ).catch(() => undefined);
    this.#child = null;
    await terminateChild(child.process);
    await finishOnlineBackup?.();
    await this.#startTrial(pending);
  }

  async #handlePrepared(child: ManagedChild, updateId: string): Promise<void> {
    const pending = this.#state.update;
    if (
      child.role !== "trial" ||
      pending?.status !== "pending" ||
      pending.id !== updateId ||
      pending.targetVersion !== child.version
    ) {
      if (child.role === "trial" && pending?.status === "pending") {
        await this.#returnToPrevious(pending, "rolled-back", "invalid-prepared", child);
        return;
      }
      throw new Error("Trial child reported prepared for an unexpected update.");
    }
    this.#clearTimer();
    const committed = terminalUpdate({ pending, status: "committed" });
    const next: ServiceState = {
      ...this.#state,
      activeVersion: pending.targetVersion,
      update: committed,
    };
    await this.#selectState(next);
    child.role = "active";
    await discardDatabaseBackup(this.#baseDir, committed.id).catch(() => undefined);
    try {
      await sendMessage(child.process, { type: "committed", updateId: committed.id });
    } finally {
      await this.#repointServiceUnit(committed.targetVersion);
    }
  }

  async #repointServiceUnit(version: string): Promise<void> {
    const unit = this.#serviceUnit;
    if (unit === undefined) return;
    try {
      const release = await acquireServiceSelectionLock(unit.path);
      try {
        const selected = await readServiceState(this.#statePath);
        if (
          selected.activeVersion !== this.#state.activeVersion ||
          selected.update?.id !== this.#state.update?.id ||
          selected.update?.status !== this.#state.update?.status
        ) {
          return;
        }
        const contents = await NodeFSP.readFile(unit.path, "utf8");
        const installedBaseDir = serviceUnitBaseDirOf(contents);
        if (
          installedBaseDir === undefined ||
          NodePath.resolve(installedBaseDir) !== NodePath.resolve(this.#baseDir)
        ) {
          return;
        }
        const repointed = repointServiceUnit(contents, version);
        if (repointed !== contents) await replaceFileDurably(unit.path, repointed);
        await unit.reload();
      } finally {
        release();
      }
    } catch (error) {
      this.#writeLog(
        `[service-launcher] Could not point ${unit.path} at supaterm@${version}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  async #handlePreparedTimeout(child: ManagedChild): Promise<void> {
    const pending = this.#state.update;
    if (this.#child !== child || child.role !== "trial" || pending?.status !== "pending") {
      return;
    }
    this.#timer = undefined;
    await this.#returnToPrevious(pending, "rolled-back", "prepared-timeout", child);
  }

  async #handleExit(
    child: ManagedChild,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    if (this.#child !== child || this.#stopping) return;
    this.#child = null;
    if (code === STATE_DIR_OWNED_EXIT_CODE) {
      await this.#idleWhileStateDirOwned();
      return;
    }
    if (child.role === "trial") {
      this.#clearTimer();
      const pending = this.#state.update;
      if (pending?.status !== "pending") {
        throw new Error("Trial child exited without matching pending state.");
      }
      await this.#returnToPrevious(
        pending,
        "rolled-back",
        `candidate-exited:${String(code ?? signal ?? "unknown")}`,
      );
      return;
    }

    this.#clearTimer();
    const pending = this.#state.update;
    if (pending?.status === "pending") {
      await this.#startTrial(pending);
      return;
    }
    if (
      await this.#deferForDiskSpace(() =>
        this.#startChild(child.version, "active", this.#state.update),
      )
    )
      return;
    throw new Error(`Active child exited unexpectedly (${String(code ?? signal ?? "unknown")}).`);
  }

  async #idleWhileStateDirOwned(): Promise<void> {
    this.#clearTimer();
    const pending = this.#state.update;
    if (pending?.status === "pending") {
      const discarded = await discardDatabaseBackup(this.#baseDir, pending.id).then(
        () => true,
        () => false,
      );
      if (!discarded) {
        const next: ServiceState = {
          ...this.#state,
          activeVersion: pending.fromVersion,
          update: terminalUpdate({ pending, status: "failed", reason: "state-dir-owned" }),
        };
        await this.#selectState(next);
        await this.#repointServiceUnit(next.activeVersion);
      }
    }
    this.#releaseServing();
    this.#writeLog(
      "[service-launcher] Another Supaterm server owns this Supaterm home. This service starts again once it stops.\n",
    );
    this.#stateDirFreeProbes = 0;
    this.#timer = setInterval(
      () => this.#enqueue(() => this.#reclaimStateDir()),
      this.#stateDirOwnerPollMs,
    );
  }

  async #reclaimStateDir(): Promise<void> {
    if (this.#stopRequested) {
      this.#clearTimer();
      return;
    }
    if (this.#timer === undefined || this.#child !== null) return;
    const owned = await stateDirOwned(this.#baseDir);
    if (this.#timer === undefined) return;
    this.#stateDirFreeProbes = owned ? 0 : this.#stateDirFreeProbes + 1;
    if (this.#stateDirFreeProbes < 2) return;
    this.#clearTimer();
    await this.#claimServing();
    this.#writeLog("[service-launcher] The Supaterm home is free again. Starting the server.\n");
    const update = this.#state.update;
    if (update?.status === "pending") await this.#startTrial(update);
    else await this.#startChild(this.#state.activeVersion, "active", update);
  }

  async #returnToPrevious(
    pending: PendingServiceUpdate,
    status: "rolled-back" | "failed",
    reason: string,
    child?: ManagedChild,
  ): Promise<void> {
    if (child !== undefined) {
      this.#child = null;
      await terminateChild(child.process);
    }
    if (await this.#deferForDiskSpace(() => this.#returnToPrevious(pending, status, reason)))
      return;
    await restoreDatabaseBackup(this.#baseDir, pending);
    const outcome = terminalUpdate({ pending, status, reason });
    const next: ServiceState = {
      ...this.#state,
      activeVersion: pending.fromVersion,
      update: outcome,
    };
    await this.#selectState(next);
    await discardDatabaseBackup(this.#baseDir, pending.id).catch(() => undefined);
    try {
      await this.#startChild(next.activeVersion, "active", outcome);
    } finally {
      await this.#repointServiceUnit(next.activeVersion);
    }
  }
}

export async function main(): Promise<void> {
  const baseDir = process.env.SUPATERM_HOME;
  if (baseDir === undefined || baseDir.trim() === "") {
    throw new Error("SUPATERM_HOME is required by the Supaterm service launcher.");
  }
  const environment = await readServiceEnvironment(baseDir);
  const statePath = NodePath.join(baseDir, "runtime", SERVICE_STATE_FILE);
  const contents = await NodeFSP.readFile(statePath, "utf8");
  let state = parseServiceState(contents);
  if (state === undefined) {
    state = adoptLegacyServiceState(contents);
    if (state === undefined) throw new Error("Service state is invalid or unsupported.");
    if (!(await runtimeExists(baseDir, state.activeVersion))) {
      throw new Error(`Selected supaterm@${state.activeVersion} runtime is missing or incomplete.`);
    }
  }
  const serviceUnit = await serviceUnitFromEnvironment();
  let logTimer: NodeJS.Timeout | undefined;
  process.stderr.on("error", () => undefined);
  try {
    const logPath = await serviceLogPath(serviceUnit);
    if (logPath !== undefined) {
      await boundServiceLog(logPath);
      logTimer = setInterval(
        () => void boundServiceLog(logPath),
        SERVICE_LOG_CHECK_INTERVAL_MS,
      ).unref();
    }
    await new Launcher(
      baseDir,
      state,
      serviceUnit === undefined ? { environment } : { environment, serviceUnit },
    ).run();
  } finally {
    clearInterval(logTimer);
  }
}
