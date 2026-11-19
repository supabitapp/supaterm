import { GitCommandError } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import type * as GitVcsDriver from "./GitVcsDriver.ts";

const INDEX_LIST_MAX_BYTES = 64 * 1024 * 1024;

const annexedAdminDir = Effect.fn("WorktreeRemoval.annexedAdminDir")(
  function* (worktreePath: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const adminDir = path.resolve(
      worktreePath,
      yield* fileSystem.readLink(path.join(worktreePath, ".git")),
    );
    const pointsBackTo = path.dirname(
      path.resolve(
        adminDir,
        (yield* fileSystem.readFileString(path.join(adminDir, "gitdir"))).trim(),
      ),
    );
    return (yield* fileSystem.realPath(pointsBackTo)) === (yield* fileSystem.realPath(worktreePath))
      ? Option.some(adminDir)
      : Option.none();
  },
  Effect.orElseSucceed(() => Option.none<string>()),
);

export const isLinkedWorktree = Effect.fn("WorktreeRemoval.isLinkedWorktree")(function* (
  worktreePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return (
    (yield* fileSystem.stat(path.join(worktreePath, ".git"))).type === "File" ||
    Option.isSome(yield* annexedAdminDir(worktreePath))
  );
});

/**
 * Git for Windows before 2.54 follows NTFS junctions; newer Git leaves them behind.
 * On Windows, mirror Git's removal checks, then delete with Node's `rm`, which
 * unlinks junctions without following them. Git then removes the worktree metadata.
 */
export const removeLinkedWorktree = Effect.fn("WorktreeRemoval.removeLinkedWorktree")(function* <
  A,
  E,
  R,
>(input: {
  readonly operation: string;
  readonly cwd: string;
  readonly worktreePath: string;
  readonly force: boolean;
  readonly execute: GitVcsDriver.GitVcsDriver["Service"]["execute"];
  readonly run: (args: ReadonlyArray<string>) => Effect.Effect<A, E, R>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const worktreePath = input.worktreePath;
  const gitFile = path.join(worktreePath, ".git");
  const statusConfig = ["-c", "status.showUntrackedFiles=normal"];
  const refuse = (message: string, cause?: unknown) =>
    new GitCommandError({
      operation: input.operation,
      command: "git worktree remove",
      cwd: input.cwd,
      detail: `fatal: ${message}`,
      ...(cause === undefined ? {} : { cause }),
    });
  const annexed = yield* annexedAdminDir(worktreePath);
  if (Option.isSome(annexed)) {
    const adminDir = annexed.value;
    const writeGitFile = fileSystem.writeFileString(gitFile, `gitdir: ${adminDir}\n`);
    yield* Effect.addFinalizer(() =>
      fileSystem.exists(worktreePath).pipe(
        Effect.flatMap((kept) =>
          kept
            ? fileSystem.remove(gitFile, { force: true }).pipe(
                Effect.andThen(fileSystem.symlink(adminDir, gitFile)),
                Effect.catch(() => writeGitFile),
              )
            : Effect.void,
        ),
        Effect.ignore,
      ),
    );
    yield* fileSystem.remove(gitFile).pipe(
      Effect.andThen(writeGitFile),
      Effect.mapError((cause) => refuse(`failed to replace '${gitFile}'`, cause)),
    );
  }
  const linked =
    (yield* HostProcess.isWindows) &&
    (yield* fileSystem.stat(gitFile).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    ));
  if (!linked) {
    return yield* input.run([
      ...statusConfig,
      "worktree",
      "remove",
      ...(input.force ? ["--force"] : []),
      "--",
      worktreePath,
    ]);
  }

  const gitOutput = (cwd: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
    input
      .execute({
        operation: input.operation,
        cwd,
        args,
        maxOutputBytes: INDEX_LIST_MAX_BYTES,
        ...(env === undefined ? {} : { env }),
      })
      .pipe(Effect.map((result) => result.stdout));
  const samePath = (left: string, right: string) =>
    Effect.all([fileSystem.realPath(left), fileSystem.realPath(right)]).pipe(
      Effect.map(([a, b]) => a.toLowerCase() === b.toLowerCase()),
      Effect.orElseSucceed(() => false),
    );

  const notAWorktree = refuse(`'${worktreePath}' is not a working tree`);
  const adminDir = path.resolve(
    worktreePath,
    (yield* gitOutput(worktreePath, ["rev-parse", "--absolute-git-dir"]).pipe(
      Effect.mapError(() => notAWorktree),
    )).trim(),
  );
  const commonDir = path.resolve(
    input.cwd,
    (yield* gitOutput(input.cwd, ["rev-parse", "--git-common-dir"])).trim(),
  );
  const pointsBack = yield* fileSystem.readFileString(path.join(adminDir, "gitdir")).pipe(
    Effect.flatMap((gitdir) => samePath(path.resolve(adminDir, gitdir.trim()), gitFile)),
    Effect.orElseSucceed(() => false),
  );
  if (!pointsBack || !(yield* samePath(path.dirname(adminDir), path.join(commonDir, "worktrees"))))
    return yield* notAWorktree;
  const lockFile = path.join(adminDir, "locked");
  const locked = yield* fileSystem.stat(lockFile).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      error.reason._tag === "NotFound"
        ? Effect.succeed(false)
        : Effect.fail(refuse(`cannot inspect the lock of '${worktreePath}'`, error)),
    ),
  );
  if (locked) {
    const reason = (yield* fileSystem.readFileString(lockFile).pipe(Effect.option)).pipe(
      Option.map((text) => text.trim()),
      Option.getOrElse(() => ""),
    );
    return yield* refuse(
      reason === ""
        ? "cannot remove a locked working tree;\nuse 'remove -f -f' to override or unlock first"
        : `cannot remove a locked working tree, lock reason: ${reason}\nuse 'remove -f -f' to override or unlock first`,
    );
  }
  if (!input.force) {
    const boundEnv = { GIT_DIR: gitFile, GIT_WORK_TREE: worktreePath };
    const submodules = refuse("working trees containing submodules cannot be moved or removed");
    const present = (target: string) =>
      fileSystem.exists(target).pipe(Effect.orElseSucceed(() => true));
    if (yield* present(path.join(adminDir, "modules"))) return yield* submodules;
    const index = yield* gitOutput(worktreePath, ["ls-files", "--stage", "-z"], boundEnv);
    for (const entry of index.split("\0")) {
      if (!entry.startsWith("160000 ")) continue;
      const submodule = entry.slice(entry.indexOf("\t") + 1);
      if (yield* present(path.join(worktreePath, submodule, ".git"))) return yield* submodules;
    }
    const status = yield* gitOutput(
      worktreePath,
      [...statusConfig, "status", "--porcelain", "--ignore-submodules=none"],
      boundEnv,
    );
    if (status !== "")
      return yield* refuse(
        `'${worktreePath}' contains modified or untracked files, use --force to delete it`,
      );
  }

  const gitFileContents = yield* fileSystem
    .readFileString(gitFile)
    .pipe(Effect.mapError(() => notAWorktree));
  yield* fileSystem.remove(worktreePath, { recursive: true }).pipe(
    Effect.tapError(() => fileSystem.writeFileString(gitFile, gitFileContents).pipe(Effect.ignore)),
    Effect.mapError((cause) => refuse(`failed to delete '${worktreePath}'`, cause)),
  );
  return yield* input.run(["worktree", "remove", "--force", "--force", "--", worktreePath]);
}, Effect.scoped);
