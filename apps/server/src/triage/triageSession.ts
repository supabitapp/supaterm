// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";

import { TRIAGE_PROMPT_FILE_NAME } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as BootService from "../service/bootService.ts";
import type * as ServerConfig from "../config.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import {
  buildTriageContext,
  buildTriageSeedPrompt,
  type TriageEntry,
  type TriageSourceClone,
} from "./triagePrompt.ts";

export const describeServerProcess = Effect.fn("triage.describeServerProcess")(function* (
  serverRuntimeStatePath: string,
) {
  const state = yield* readPersistedServerRuntimeState(serverRuntimeStatePath);
  if (Option.isNone(state)) {
    return "not running (no server-runtime.json; the server may never have started here)";
  }
  const version =
    state.value.serverVersion === undefined
      ? "version not recorded"
      : `version ${state.value.serverVersion}`;
  if (!isProcessAlive(state.value.pid)) {
    return `not running (state file is stale: pid ${String(state.value.pid)} is dead; last origin ${state.value.origin}, ${version})`;
  }
  return `running (pid ${String(state.value.pid)}, ${state.value.origin}, ${version})`;
});

/** The source cache the playbook clones into, one subdirectory per commit. */
export const triageSourceCacheDir = (baseDir: string, path: Path.Path) =>
  path.join(baseDir, "source");

interface TriageSessionInput {
  readonly baseDir: string;
  readonly paths: ServerConfig.ServerDerivedPaths;
  readonly entry: TriageEntry;
  readonly server: string;
  readonly sourceClone?: TriageSourceClone | undefined;
}

/** The context file's text; `supaterm triage --print` shows it without writing anything. */
export const describeTriageContext = Effect.fn("triage.describeTriageContext")(function* (
  input: TriageSessionInput & { readonly now: DateTime.Utc },
) {
  const path = yield* Path.Path;
  const { paths } = input;
  return buildTriageContext({
    generatedAt: DateTime.formatIso(input.now),
    entry: input.entry,
    os: `${yield* HostProcess.Platform} ${yield* HostProcess.Architecture} (${NodeOS.release()})`,
    nodeVersion: process.version,
    server: input.server,
    sourceClone: input.sourceClone,
    paths: {
      stateDir: paths.stateDir,
      dbPath: paths.dbPath,
      settingsPath: paths.settingsPath,
      logsDir: paths.logsDir,
      serviceLogPath: path.join(paths.logsDir, BootService.BOOT_SERVICE_LOG_FILE),
      desktopBackendLogGlob: path.join(paths.logsDir, "server-child*.log*"),
      serverTracePath: paths.serverTracePath,
      providerEventLogPath: paths.providerEventLogPath,
      terminalLogsDir: paths.terminalLogsDir,
      providerStatusCacheDir: paths.providerStatusCacheDir,
      secretsDir: paths.secretsDir,
      sourceCacheDir: triageSourceCacheDir(input.baseDir, path),
    },
  });
});

/**
 * Writes `context.md` and the playbook prompt into a fresh `<stateDir>/triage/<time>`
 * folder. Both `supaterm triage` and the in-app entry point start from these files.
 */
export const writeTriageSession = Effect.fn("triage.writeTriageSession")(function* (
  input: TriageSessionInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const now = yield* DateTime.now;
  const sessionDir = path.join(
    input.paths.stateDir,
    "triage",
    DateTime.formatIso(now).replaceAll(":", "-").replace(".", "-"),
  );
  yield* fs.makeDirectory(sessionDir, { recursive: true });

  const contextFilePath = path.join(sessionDir, "context.md");
  yield* fs.writeFileString(contextFilePath, yield* describeTriageContext({ ...input, now }));

  const promptFilePath = path.join(sessionDir, TRIAGE_PROMPT_FILE_NAME);
  yield* fs.writeFileString(
    promptFilePath,
    buildTriageSeedPrompt({ contextFilePath, entry: input.entry }),
  );

  return { sessionDir, contextFilePath, promptFilePath };
});
