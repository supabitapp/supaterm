// @effect-diagnostics nodeBuiltinImport:off - Git index stat data needs bigint lstat, which FileSystem lacks.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import { GitCommandError } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as CheckoutCloner from "./CheckoutCloner.ts";
import type * as GitVcsDriver from "./GitVcsDriver.ts";
import { indexEntryStat, parseIndex, restatIndex, type IndexEntryStat } from "./gitIndexStat.ts";

const KEEP_PER_REPOSITORY = 3;
const REBUILD_AFTER_CHANGED_FILES = 500;
const UNUSED_REPOSITORY_MS = 30 * 24 * 60 * 60 * 1000;
const ABANDONED_STAGING_MS = 24 * 60 * 60 * 1000;
const ABANDONED_TRASH_MS = 10 * 60 * 1000;
const STAT_BATCH = 512;
const TREE_ID = /^[0-9a-f]{40}$/;
const ENTRY_NAME = /^([0-9a-f]{40})-([0-9a-f]{16})$/;
const GIT_FALSE = new Set(["false", "no", "off", "0"]);
const MAX_LIST_BYTES = 256 * 1024 * 1024;
const NULL_OID = "0".repeat(40);
const MIN_GIT = [2, 42] as const;
const CHECKOUT_CONFIG =
  "^(core\\.(autocrlf|eol|symlinks|safecrlf|checkroundtripencoding|precomposeunicode|ignorecase|filemode|attributesfile|sparsecheckout)|filter\\.|lfs\\.|extensions\\.)";
const CACHE_INDEX_CONFIG = [
  "index.version=2",
  "index.skipHash=false",
  "core.splitIndex=false",
  "core.untrackedCache=false",
  "core.fsmonitor=false",
  "core.sparseCheckout=false",
  "core.hooksPath=/dev/null",
  "checkout.workers=0",
].flatMap((setting) => ["-c", setting]);

const foldCase = (file: string) => file.normalize("NFC").toLowerCase();

function namesFilter(output: string): boolean {
  const fields = output.split("\0");
  for (let index = 1; index < fields.length; index += 3) {
    if (fields[index] === "filter") return true;
  }
  return false;
}

function parentDirectories(paths: Iterable<string>): Set<string> {
  const directories = new Set([""]);
  for (const entryPath of paths) {
    for (let slash = entryPath.lastIndexOf("/"); slash > 0;) {
      const directory = entryPath.slice(0, slash);
      if (directories.has(directory)) break;
      directories.add(directory);
      slash = directory.lastIndexOf("/");
    }
  }
  return directories;
}

class WorktreeCheckoutCacheError extends Schema.TaggedError<WorktreeCheckoutCacheError>()(
  "WorktreeCheckoutCacheError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

interface CacheEntry {
  readonly directory: string;
  readonly tree: string;
  readonly fingerprint: string;
  readonly mtimeMs: number;
}

/**
 * Clones a private, Git-written checkout with APFS copy-on-write, then rewrites the index's stat
 * data so Git trusts the clones without re-reading them. An older cached checkout is moved to the
 * requested tree with `read-tree -m -u`. Undefined where the platform cannot clone a folder.
 */
export const makeWorktreeCheckoutCache = Effect.fn("WorktreeCheckoutCache.make")(function* (input: {
  readonly cacheDir: string;
  readonly execute: GitVcsDriver.GitVcsDriver["Service"]["execute"];
}) {
  const clone = yield* CheckoutCloner.CheckoutCloner;
  if (clone === undefined) return undefined;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  const environment = yield* HostProcess.Environment;
  const builds = yield* Semaphore.make(1);
  const pendingBuilds = new Set<string>();
  let generation = 0;
  const { cacheDir, execute } = input;

  const git = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    env?: NodeJS.ProcessEnv,
  ) =>
    execute({
      operation: `WorktreeCheckoutCache.git.${operation}`,
      cwd,
      args,
      allowNonZeroExit: true,
      timeoutMs: null,
      ...(env ? { env } : {}),
    }).pipe(
      Effect.map((result) => (result.exitCode === 0 ? result.stdout : null)),
      Effect.orElseSucceed(() => null),
    );

  const gitSupported = yield* Effect.cached(
    git("version", homeDirectory, ["version"]).pipe(
      Effect.map((stdout) => {
        const match = stdout?.match(/git version (\d+)\.(\d+)/);
        if (!match) return false;
        const [major, minor] = [Number(match[1]), Number(match[2])];
        return major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1]);
      }),
    ),
  );

  const describe = Effect.fn("WorktreeCheckoutCache.describe")(function* (
    cwd: string,
    rev: string,
  ) {
    const stdout = yield* git("describe", cwd, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
      "--show-object-format",
      "--git-path",
      "hooks/post-index-change",
      `${rev}^{commit}`,
      `${rev}^{tree}`,
    ]);
    const [commonDir, objectFormat, indexHook, commit, tree] = stdout?.trim().split("\n") ?? [];
    if (
      !commonDir ||
      objectFormat !== "sha1" ||
      !indexHook ||
      !commit ||
      !tree ||
      !TREE_ID.test(tree)
    ) {
      return null;
    }
    const realCommonDir = yield* fileSystem
      .realPath(commonDir)
      .pipe(Effect.orElseSucceed(() => commonDir));
    const repositoryKey = NodeCrypto.createHash("sha256")
      .update(realCommonDir)
      .digest("hex")
      .slice(0, 16);
    return {
      commonDir,
      commit,
      tree,
      indexHook: path.resolve(cwd, indexHook),
      bucket: path.join(cacheDir, repositoryKey),
    };
  });

  const systemAttributePaths = yield* Effect.cached(
    git("systemAttributes", homeDirectory, ["var", "GIT_ATTR_SYSTEM"]).pipe(
      Effect.map((stdout) => (stdout?.trim() ? [stdout.trim()] : [])),
    ),
  );

  const fingerprint = Effect.fn("WorktreeCheckoutCache.fingerprint")(function* (
    cwd: string,
    commonDir: string,
  ) {
    const config =
      (yield* git("fingerprint", cwd, ["config", "--null", "--get-regexp", CHECKOUT_CONFIG])) ?? "";
    const pairs = config
      .split("\0")
      .filter(Boolean)
      .map((pair) => {
        const newline = pair.indexOf("\n");
        return newline < 0
          ? ([pair, ""] as const)
          : ([pair.slice(0, newline), pair.slice(newline + 1)] as const);
      });
    const sparse = pairs.findLast(([key]) => key === "core.sparsecheckout")?.[1];
    if (sparse !== undefined && !GIT_FALSE.has(sparse.toLowerCase())) return null;
    const attributesFile = pairs
      .findLast(([key]) => key === "core.attributesfile")?.[1]
      ?.replace(/^~(?=$|\/)/, homeDirectory);
    if (attributesFile !== undefined && !path.isAbsolute(attributesFile)) return null;
    const attributePaths = [
      ...(yield* systemAttributePaths),
      path.join(commonDir, "info", "attributes"),
      attributesFile ??
        path.join(
          environment.XDG_CONFIG_HOME || path.join(homeDirectory, ".config"),
          "git",
          "attributes",
        ),
    ];
    const attributes = yield* Effect.forEach(attributePaths, (file) =>
      fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => "")),
    );
    const hash = NodeCrypto.createHash("sha256").update(config);
    for (const contents of attributes) hash.update("\0").update(contents);
    return hash.digest("hex").slice(0, 16);
  });

  const listEntries = Effect.fn("WorktreeCheckoutCache.listEntries")(function* (bucket: string) {
    const names = yield* fileSystem.readDirectory(bucket).pipe(Effect.orElseSucceed(() => []));
    const entries = yield* Effect.forEach(
      names.flatMap((name) => {
        const match = ENTRY_NAME.exec(name);
        return match ? [{ name, tree: match[1]!, fingerprint: match[2]! }] : [];
      }),
      ({ name, tree, fingerprint: entryFingerprint }) => {
        const directory = path.join(bucket, name);
        return fileSystem.stat(directory).pipe(
          Effect.map((info): CacheEntry => ({
            directory,
            tree,
            fingerprint: entryFingerprint,
            mtimeMs: Option.match(info.mtime, {
              onNone: () => 0,
              onSome: (date) => date.getTime(),
            }),
          })),
          Effect.option,
        );
      },
      { concurrency: 8 },
    );
    return entries
      .flatMap((entry) => (entry._tag === "Some" ? [entry.value] : []))
      .toSorted((left, right) => right.mtimeMs - left.mtimeMs);
  });

  const touch = (target: string) =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        Effect.tryPromise({
          try: () => NodeFSP.utimes(target, now / 1000, now / 1000),
          catch: (cause) =>
            new WorktreeCheckoutCacheError({ detail: `could not touch ${target}: ${cause}` }),
        }),
      ),
      Effect.ignore,
    );

  const statEntries = Effect.fnUntraced(function* (root: string, paths: ReadonlyArray<string>) {
    return yield* Effect.tryPromise({
      try: async () => {
        const stats: Array<IndexEntryStat | undefined> = [];
        for (let start = 0; start < paths.length; start += STAT_BATCH) {
          const batch = await Promise.all(
            paths.slice(start, start + STAT_BATCH).map((entryPath) =>
              NodeFSP.lstat(`${root}/${entryPath}`, { bigint: true }).then(
                indexEntryStat,
                (error) => {
                  if (error?.code === "ENOENT") return undefined;
                  throw error;
                },
              ),
            ),
          );
          stats.push(...batch);
        }
        return stats;
      },
      catch: (cause) =>
        new WorktreeCheckoutCacheError({ detail: `could not stat ${root}: ${cause}` }),
    });
  });

  const restate = Effect.fn("WorktreeCheckoutCache.restate")(function* (input: {
    readonly source: string;
    readonly target: string;
    readonly root: string;
    readonly verify: boolean;
  }) {
    const parsed = parseIndex(yield* fileSystem.readFile(input.source));
    if (parsed === null) return null;
    const paths = parsed.entries.map((entry) => entry.path);
    const stats = yield* statEntries(input.root, paths);
    const restated = restatIndex(parsed, stats, { verify: input.verify });
    if (restated === null) return null;
    const temporary = `${input.target}.supaterm-${NodeCrypto.randomUUID()}`;
    yield* Effect.uninterruptible(
      fileSystem
        .writeFile(temporary, restated)
        .pipe(Effect.andThen(fileSystem.rename(temporary, input.target))),
    );
    return { paths, stats };
  });

  const directoryTimes = Effect.fnUntraced(function* (
    root: string,
    directories: ReadonlyArray<string>,
  ) {
    return yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          directories.map((directory) =>
            NodeFSP.lstat(directory === "" ? root : `${root}/${directory}`, { bigint: true }).then(
              (stat) => String(stat.mtimeNs),
              () => "missing",
            ),
          ),
        ),
      catch: (cause) =>
        new WorktreeCheckoutCacheError({ detail: `could not stat folders in ${root}: ${cause}` }),
    });
  });

  const recordDirectories = Effect.fn("WorktreeCheckoutCache.recordDirectories")(function* (
    entryDirectory: string,
    recorded: {
      readonly paths: ReadonlyArray<string>;
      readonly stats: ReadonlyArray<IndexEntryStat | undefined>;
    },
  ) {
    const directories = parentDirectories(recorded.paths);
    for (const [index, entryPath] of recorded.paths.entries()) {
      if (recorded.stats[index]?.kind === "directory") directories.add(entryPath);
    }
    const folded = new Set([...directories].map((directory) => foldCase(directory)));
    if (folded.size !== directories.size) {
      return yield* new WorktreeCheckoutCacheError({ detail: "folder names differ only in case" });
    }
    const list = [...directories];
    const root = path.join(entryDirectory, "files");
    yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          list.map((directory) =>
            NodeFSP.utimes(directory === "" ? root : `${root}/${directory}`, 1_000_000, 1_000_000),
          ),
        ),
      catch: (cause) =>
        new WorktreeCheckoutCacheError({ detail: `could not backdate cached folders: ${cause}` }),
    });
    const times = yield* directoryTimes(root, list);
    yield* fileSystem.writeFileString(
      path.join(entryDirectory, "directories"),
      list.map((directory, index) => `${times[index]}\0${directory}\0`).join(""),
    );
  });

  const directoriesUnchanged = Effect.fn("WorktreeCheckoutCache.directoriesUnchanged")(
    function* (entry: CacheEntry) {
      const recorded = (yield* fileSystem.readFileString(path.join(entry.directory, "directories")))
        .split("\0")
        .slice(0, -1);
      const times = recorded.filter((_, index) => index % 2 === 0);
      const directories = recorded.filter((_, index) => index % 2 === 1);
      const current = yield* directoryTimes(path.join(entry.directory, "files"), directories);
      return directories.length > 0 && current.every((time, index) => time === times[index]);
    },
    (effect) => Effect.orElseSucceed(effect, () => false),
  );

  const changedPaths = Effect.fn("WorktreeCheckoutCache.changedPaths")(function* (
    cwd: string,
    from: string,
    to: string,
  ) {
    const stdout = yield* git("changes", cwd, [
      "diff-tree",
      "-r",
      "-z",
      "--name-status",
      "--no-renames",
      from,
      to,
    ]);
    if (stdout === null) return null;
    const fields = stdout.split("\0");
    const added: Array<string> = [];
    const deleted: Array<string> = [];
    const written: Array<string> = [];
    let count = 0;
    let attributes = false;
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const [status, file] = [fields[index]!, fields[index + 1]!];
      count++;
      if (file === ".gitattributes" || file.endsWith("/.gitattributes")) attributes = true;
      if (status === "A") added.push(file);
      if (status === "D") deleted.push(file);
      else written.push(file);
    }
    return { count, attributes, added, deleted, written };
  });

  const usesFilter = Effect.fn("WorktreeCheckoutCache.usesFilter")(function* (
    cwd: string,
    bucket: string,
    tree: string,
  ) {
    const index = path.join(bucket, `.attributes-${NodeCrypto.randomUUID()}`);
    const env = { GIT_INDEX_FILE: index };
    const run = (args: ReadonlyArray<string>, stdin?: string) =>
      execute({
        operation: "WorktreeCheckoutCache.git.filters",
        cwd,
        args,
        env,
        allowNonZeroExit: true,
        maxOutputBytes: MAX_LIST_BYTES,
        ...(stdin === undefined ? {} : { stdin }),
      }).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout : null)));
    return yield* Effect.gen(function* () {
      if ((yield* run([...CACHE_INDEX_CONFIG, "read-tree", tree])) === null) return true;
      const files = yield* run(["ls-files", "-z"]);
      if (files === null) return true;
      const output = yield* run(["check-attr", "--cached", "--all", "-z", "--stdin"], files);
      return output === null || namesFilter(output);
    }).pipe(
      Effect.orElseSucceed(() => true),
      Effect.ensuring(fileSystem.remove(index).pipe(Effect.ignore)),
    );
  });

  const writesWithFilter = Effect.fn("WorktreeCheckoutCache.writesWithFilter")(function* (
    cwd: string,
    files: ReadonlyArray<string>,
  ) {
    if (files.length === 0) return false;
    const output = yield* execute({
      operation: "WorktreeCheckoutCache.git.filters",
      cwd,
      args: ["check-attr", "--all", "-z", "--stdin"],
      stdin: files.map((file) => `${file}\0`).join(""),
      allowNonZeroExit: true,
      maxOutputBytes: MAX_LIST_BYTES,
    }).pipe(
      Effect.map((result) => (result.exitCode === 0 ? result.stdout : null)),
      Effect.orElseSucceed(() => null),
    );
    return output === null || namesFilter(output);
  });

  const discard = Effect.fn("WorktreeCheckoutCache.discard")(
    function* (target: string) {
      const trashed = `${target}.trash-${NodeCrypto.randomUUID()}`;
      yield* fileSystem.rename(target, trashed);
      yield* fileSystem.remove(trashed, { recursive: true });
    },
    (effect) => Effect.ignore(Effect.uninterruptible(effect)),
  );

  const gitDirOf = Effect.fn("WorktreeCheckoutCache.gitDirOf")(function* (worktreePath: string) {
    const contents = yield* fileSystem.readFileString(path.join(worktreePath, ".git"));
    const gitDir = contents.match(/^gitdir: (.+)$/m)?.[1];
    if (gitDir === undefined) {
      return yield* new WorktreeCheckoutCacheError({
        detail: `${worktreePath} is not a linked worktree`,
      });
    }
    return path.resolve(worktreePath, gitDir.trim());
  });

  const create = Effect.fn("WorktreeCheckoutCache.create")(function* (input: {
    readonly cwd: string;
    readonly worktreePath: string;
    readonly refName: string;
    readonly checkoutWorkers: string;
    readonly lockReason?: string | undefined;
  }) {
    if (!(yield* gitSupported)) return false;
    const worktreePath = path.resolve(input.cwd, input.worktreePath);
    const requested = yield* describe(input.cwd, input.refName);
    if (requested === null) return false;
    const entries = yield* listEntries(requested.bucket);
    if (entries.length === 0) return false;
    const parent = path.dirname(worktreePath);
    yield* fileSystem.makeDirectory(parent, { recursive: true }).pipe(Effect.ignore);
    const [bucketInfo, parentInfo] = yield* Effect.all([
      fileSystem.stat(requested.bucket),
      fileSystem.stat(parent),
    ]).pipe(Effect.orElseSucceed(() => [null, null] as const));
    if (bucketInfo === null || parentInfo === null || bucketInfo.dev !== parentInfo.dev) {
      return false;
    }

    const populate = Effect.gen(function* () {
      const target = yield* describe(worktreePath, "HEAD");
      if (target === null || (yield* fileSystem.exists(target.indexHook))) return null;
      const worktreeFingerprint = yield* fingerprint(worktreePath, target.commonDir);
      if (worktreeFingerprint === null) return null;
      const compatible = entries.filter((entry) => entry.fingerprint === worktreeFingerprint);
      let base = compatible.find((entry) => entry.tree === target.tree);
      let changes: Effect.Success<ReturnType<typeof changedPaths>> = null;
      for (const entry of base === undefined ? compatible : []) {
        changes = yield* changedPaths(worktreePath, entry.tree, target.tree);
        if (changes !== null && !changes.attributes) {
          base = entry;
          break;
        }
      }
      if (base === undefined) return null;
      const reject = (entry: CacheEntry) =>
        Effect.logWarning("worktree checkout cache entry changed; discarding it", {
          directory: entry.directory,
        }).pipe(Effect.andThen(discard(entry.directory)), Effect.as(null));
      if (!(yield* directoriesUnchanged(base))) return yield* reject(base);
      yield* Effect.all([touch(base.directory), touch(requested.bucket)], { discard: true });

      const files = path.join(base.directory, "files");
      yield* Effect.forEach(
        yield* fileSystem.readDirectory(files),
        (name) => clone(path.join(files, name), path.join(worktreePath, name)),
        { discard: true },
      );
      if (!(yield* directoriesUnchanged(base))) return yield* reject(base);
      if (yield* fileSystem.exists(target.indexHook)) return null;
      const restated = yield* restate({
        source: path.join(base.directory, "index"),
        target: path.join(yield* gitDirOf(worktreePath), "index"),
        root: worktreePath,
        verify: true,
      });
      if (restated === null) return yield* reject(base);
      if (base.tree === target.tree || changes === null) return target;
      const deleted = new Set(changes.deleted);
      const kept = restated.paths.filter((file) => !deleted.has(file));
      const names = new Set(kept.map((file) => foldCase(file)));
      const keptFolders = parentDirectories(kept);
      for (const [index, file] of restated.paths.entries()) {
        if (restated.stats[index]?.kind === "directory" && !deleted.has(file))
          keptFolders.add(file);
      }
      const spellings = new Map(
        [...keptFolders].map((directory) => [foldCase(directory), directory]),
      );
      for (const file of changes.added) {
        if (names.has(foldCase(file))) return null;
        names.add(foldCase(file));
        for (const directory of parentDirectories([file])) {
          const existing = spellings.get(foldCase(directory));
          if (existing !== undefined && existing !== directory) return null;
          spellings.set(foldCase(directory), directory);
        }
      }
      if (yield* writesWithFilter(worktreePath, changes.written)) return null;
      const moved = yield* git("update", worktreePath, [
        "-c",
        `checkout.workers=${input.checkoutWorkers}`,
        "-c",
        "core.hooksPath=/dev/null",
        "read-tree",
        "-m",
        "-u",
        base.tree,
        target.tree,
      ]);
      if (moved === null || (yield* fileSystem.exists(target.indexHook))) return null;
      return target;
    });
    const rollback = (
      input.lockReason
        ? git("unlockRollback", input.cwd, ["worktree", "unlock", "--", worktreePath])
        : Effect.void
    ).pipe(
      Effect.andThen(
        git("rollback", input.cwd, ["worktree", "remove", "--force", "--", worktreePath]),
      ),
      Effect.flatMap((removed) =>
        removed === null
          ? Effect.logWarning("could not remove a partially created worktree", { worktreePath })
          : Effect.void,
      ),
    );
    const target = yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const registered = yield* git("register", input.cwd, [
          "worktree",
          "add",
          "--no-checkout",
          ...(input.lockReason ? ["--lock", "--reason", input.lockReason] : []),
          "--",
          worktreePath,
          input.refName,
        ]);
        if (registered === null) return null;
        return yield* restore(populate).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("worktree checkout cache failed; using git worktree add", {
              cause,
            }).pipe(Effect.as(null)),
          ),
          Effect.onExit((exit) =>
            Exit.isSuccess(exit) && exit.value !== null ? Effect.void : rollback,
          ),
        );
      }),
    );
    if (target === null) return false;

    const hook = yield* execute({
      operation: "GitVcsDriver.createWorktree.postCheckout",
      cwd: worktreePath,
      args: [
        "hook",
        "run",
        "--ignore-missing",
        "post-checkout",
        "--",
        NULL_OID,
        target.commit,
        "1",
      ],
      env: { LANGUAGE: "C" },
      allowNonZeroExit: true,
      timeoutMs: null,
    });
    if (hook.exitCode !== 0) {
      return yield* new GitCommandError({
        operation: "GitVcsDriver.createWorktree",
        command: "git worktree add",
        cwd: input.cwd,
        detail: "git worktree add failed: the post-checkout hook failed",
        exitCode: hook.exitCode,
        stderrLength: hook.stderr.length,
      });
    }
    return true;
  });

  const removeIfAbandoned = Effect.fn("WorktreeCheckoutCache.removeIfAbandoned")(
    function* (target: string, maxAgeMs: number) {
      const info = yield* fileSystem.stat(target);
      const modified = Option.getOrUndefined(info.mtime)?.getTime() ?? 0;
      if ((yield* Clock.currentTimeMillis) - modified > maxAgeMs) {
        yield* fileSystem.remove(target, { recursive: true });
      }
    },
    (effect) => Effect.ignore(effect),
  );

  const build = Effect.fn("WorktreeCheckoutCache.build")(function* (
    worktreePath: string,
    generationAtStart: number,
  ) {
    if (!(yield* gitSupported)) return;
    const target = yield* describe(worktreePath, "HEAD");
    if (target === null) return;
    const entryFingerprint = yield* fingerprint(worktreePath, target.commonDir);
    if (entryFingerprint === null) return;
    const entryName = `${target.tree}-${entryFingerprint}`;
    yield* fileSystem.makeDirectory(target.bucket, { recursive: true });
    const entries = yield* listEntries(target.bucket);
    const compatible = entries.filter((entry) => entry.fingerprint === entryFingerprint);
    if (compatible.some((entry) => entry.tree === target.tree)) return;
    let base: CacheEntry | undefined;
    for (const entry of compatible) {
      const changes = yield* changedPaths(worktreePath, entry.tree, target.tree);
      if (changes === null || changes.attributes) continue;
      if (changes.count < REBUILD_AFTER_CHANGED_FILES) return;
      base ??= entry;
    }
    if (yield* usesFilter(worktreePath, target.bucket, target.tree)) return;

    for (const name of yield* fileSystem.readDirectory(target.bucket)) {
      if (!ENTRY_NAME.test(name)) {
        const leftover = path.join(target.bucket, name);
        yield* removeIfAbandoned(
          leftover,
          name.includes(".trash-") ? ABANDONED_TRASH_MS : ABANDONED_STAGING_MS,
        );
      }
    }
    const staging = path.join(target.bucket, `.staging-${NodeCrypto.randomUUID()}`);
    const stagingFiles = path.join(staging, "files");
    const stagingIndex = path.join(staging, "index");
    yield* fileSystem.makeDirectory(staging);
    const withIndex = (args: ReadonlyArray<string>) =>
      git("build", worktreePath, [...CACHE_INDEX_CONFIG, `--work-tree=${stagingFiles}`, ...args], {
        GIT_INDEX_FILE: stagingIndex,
      });

    yield* Effect.gen(function* () {
      let built = false;
      if (base !== undefined && (yield* directoriesUnchanged(base))) {
        const from = base;
        built = yield* Effect.gen(function* () {
          yield* Effect.uninterruptible(clone(path.join(from.directory, "files"), stagingFiles));
          if (!(yield* directoriesUnchanged(from))) return false;
          const restated = yield* restate({
            source: path.join(from.directory, "index"),
            target: stagingIndex,
            root: stagingFiles,
            verify: true,
          });
          if (restated === null) return false;
          return (yield* withIndex(["read-tree", "-m", "-u", from.tree, target.tree])) !== null;
        }).pipe(Effect.orElseSucceed(() => false));
        if (!built) {
          yield* fileSystem.remove(stagingFiles, { recursive: true }).pipe(Effect.ignore);
          yield* fileSystem.remove(stagingIndex).pipe(Effect.ignore);
        }
      }
      if (!built) {
        yield* fileSystem.makeDirectory(stagingFiles);
        if ((yield* withIndex(["read-tree", "--reset", "-u", target.tree])) === null) {
          return yield* new WorktreeCheckoutCacheError({ detail: "git read-tree failed" });
        }
      }
      const recorded = yield* restate({
        source: stagingIndex,
        target: stagingIndex,
        root: stagingFiles,
        verify: false,
      });
      if (recorded === null) {
        return yield* new WorktreeCheckoutCacheError({
          detail: "the cache index has an unsupported format or colliding paths",
        });
      }
      yield* recordDirectories(staging, recorded);
      if (generation !== generationAtStart) {
        return yield* new WorktreeCheckoutCacheError({ detail: "the cache was cleared" });
      }
      yield* Effect.uninterruptible(
        fileSystem.rename(staging, path.join(target.bucket, entryName)),
      );
    }).pipe(Effect.onError(() => discard(staging)));

    yield* touch(target.bucket);
    yield* Effect.forEach(
      (yield* listEntries(target.bucket)).slice(KEEP_PER_REPOSITORY),
      (entry) => discard(entry.directory),
      { discard: true },
    );
    const now = yield* Clock.currentTimeMillis;
    for (const name of yield* fileSystem.readDirectory(cacheDir)) {
      const bucket = path.join(cacheDir, name);
      if (bucket === target.bucket) continue;
      if (name.includes(".trash-")) {
        yield* removeIfAbandoned(bucket, ABANDONED_TRASH_MS);
        continue;
      }
      const info = yield* fileSystem.stat(bucket).pipe(Effect.option);
      const used = info.pipe(
        Option.flatMap((value) => value.mtime),
        Option.map((date) => date.getTime()),
      );
      if (Option.isSome(used) && now - used.value > UNUSED_REPOSITORY_MS) {
        yield* discard(bucket);
      }
    }
  });

  const schedule = (worktreePath: string, generationAtStart: number) =>
    Effect.suspend(() => {
      if (pendingBuilds.has(worktreePath)) return Effect.void;
      pendingBuilds.add(worktreePath);
      return build(worktreePath, generationAtStart).pipe(
        builds.withPermits(1),
        Effect.ignoreCause({ log: true }),
        Effect.ensuring(Effect.sync(() => pendingBuilds.delete(worktreePath))),
        Effect.forkIn(scope),
        Effect.asVoid,
      );
    });

  const clear = Effect.suspend(() => {
    generation++;
    return fileSystem.exists(cacheDir);
  }).pipe(
    Effect.flatMap((exists) =>
      exists
        ? discard(cacheDir).pipe(builds.withPermits(1), Effect.forkIn(scope), Effect.asVoid)
        : Effect.void,
    ),
    Effect.ignore,
  );

  const currentGeneration = Effect.sync(() => generation);

  return { create, build, schedule, clear, currentGeneration };
});
