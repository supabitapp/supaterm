// @effect-diagnostics nodeBuiltinImport:off - realpathSync.native resolves Windows 8.3 short names, which the Effect realPath does not.
import * as NodeFS from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

const normalizePathSeparators = (value: string) => value.replaceAll("\\", "/");
const normalizeResolvedPath = (value: string) => normalizePathSeparators(value);

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    return yield* processRunner.run({
      command: "git",
      args: ["-C", cwd, ...args],
    });
  }).pipe(Effect.provide(ProcessRunner.layer));

it.layer(NodeServices.layer)("RepositoryIdentityResolverLive", (it) => {
  it.effect("resolves a remote annotated by Git partial-clone metadata", () => {
    const layerProcessRunner = Layer.succeed(ProcessRunner.ProcessRunner, {
      run: (input) =>
        Effect.succeed({
          stdout: input.args.includes("rev-parse")
            ? "/repo\n"
            : "origin\thttps://github.com/acme/repo.git (fetch) [blob:none]\n",
          stderr: "",
          code: ChildProcessSpawner.ExitCode(0),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        }),
    });
    const layerResolver = Layer.effect(
      RepositoryIdentityResolver.RepositoryIdentityResolver,
      RepositoryIdentityResolver.make(),
    ).pipe(Layer.provide(layerProcessRunner));

    return Effect.gen(function* () {
      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve("/repo");

      expect(identity?.canonicalKey).toBe("github.com/acme/repo");
      expect(identity?.locator.remoteName).toBe("origin");
    }).pipe(Effect.provide(layerResolver));
  });

  it.effect("normalizes equivalent GitHub remotes into a stable repository identity", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:SupabitApp/supaterm.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);
      const resolvedIdentityRoot =
        identity?.rootPath === undefined ? "" : NodeFS.realpathSync.native(identity.rootPath);
      const resolvedCwd = NodeFS.realpathSync.native(cwd);

      expect(identity).not.toBeNull();
      expect(identity?.canonicalKey).toBe("github.com/supabitapp/supaterm");
      expect(normalizeResolvedPath(resolvedIdentityRoot)).toBe(normalizeResolvedPath(resolvedCwd));
      expect(identity?.displayName).toBe("SupabitApp/supaterm");
      expect(identity?.provider).toBe("github");
      expect(identity?.owner).toBe("SupabitApp");
      expect(identity?.name).toBe("supaterm");
      expect(yield* resolver.resolve(path.join(cwd, ".git"))).toBeNull();
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("resolves the fetch remote of a partial clone", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-partial-clone-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:Supabitapp/supaterm.git"]);
      yield* git(cwd, [
        "remote",
        "set-url",
        "--push",
        "origin",
        "git@github.com:Supabitapp/push.git",
      ]);
      yield* git(cwd, ["config", "remote.origin.promisor", "true"]);
      yield* git(cwd, ["config", "remote.origin.partialclonefilter", "blob:none"]);

      const remotes = yield* git(cwd, ["remote", "-v"]);
      expect(remotes.stdout).toContain("(fetch) [blob:none]");

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);
      expect(identity?.canonicalKey).toBe("github.com/supabitapp/supaterm");
      expect(identity?.locator.remoteUrl).toBe("git@github.com:Supabitapp/supaterm.git");
      expect(identity?.locator.remoteName).toBe("origin");
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("returns the git top-level root path when resolving from a nested workspace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-nested-root-test-",
      });
      const nestedWorkspace = path.join(repoRoot, "packages", "web");

      yield* fileSystem.makeDirectory(nestedWorkspace, { recursive: true });
      yield* git(repoRoot, ["init"]);
      yield* git(repoRoot, ["remote", "add", "origin", "git@github.com:SupabitApp/supaterm.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(nestedWorkspace);
      const resolvedIdentityRoot =
        identity?.rootPath === undefined ? "" : NodeFS.realpathSync.native(identity.rootPath);
      const resolvedRepoRoot = NodeFS.realpathSync.native(repoRoot);

      expect(identity).not.toBeNull();
      expect(identity?.canonicalKey).toBe("github.com/supabitapp/supaterm");
      expect(normalizeResolvedPath(resolvedIdentityRoot)).toBe(
        normalizeResolvedPath(resolvedRepoRoot),
      );
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect.each(["bare clone", "dot-bare"] as const)(
    "resolves a %s to its Git directory and the same identity as a checkout",
    (layout) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const checkout = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "supaterm-repository-identity-checkout-",
        });
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "supaterm-repository-identity-bare-",
        });
        const bareGitDir = layout === "dot-bare" ? path.join(root, ".bare") : root;

        yield* git(checkout, ["init"]);
        yield* git(checkout, ["remote", "add", "origin", "git@github.com:Supabitapp/supaterm.git"]);
        yield* git(root, ["init", "--bare", bareGitDir]);
        if (layout === "dot-bare") {
          yield* fileSystem.writeFileString(path.join(root, ".git"), "gitdir: ./.bare\n");
        }
        yield* git(root, [
          "--git-dir",
          bareGitDir,
          "remote",
          "add",
          "origin",
          "https://github.com/Supabitapp/supaterm.git",
        ]);

        const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
        const checkoutIdentity = yield* resolver.resolve(checkout);
        expect(checkoutIdentity?.canonicalKey).toBe("github.com/supabitapp/supaterm");
        const resolvedBareGitDir = NodeFS.realpathSync.native(bareGitDir);
        const projectRoots = layout === "dot-bare" ? [root, bareGitDir] : [root];

        for (const projectRoot of projectRoots) {
          const identity = yield* resolver.resolve(projectRoot);
          const resolvedIdentityRoot =
            identity?.rootPath === undefined ? "" : NodeFS.realpathSync.native(identity.rootPath);

          expect(identity).not.toBeNull();
          expect(identity?.canonicalKey).toBe(checkoutIdentity?.canonicalKey);
          expect(normalizeResolvedPath(resolvedIdentityRoot)).toBe(
            normalizeResolvedPath(resolvedBareGitDir),
          );
        }

        yield* git(root, ["--git-dir", bareGitDir, "remote", "remove", "origin"]);
        for (const projectRoot of projectRoots) {
          expect(yield* resolver.resolve(projectRoot, { refresh: true })).toBeNull();
        }
      }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("returns null for non-git folders and repos without remotes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const nonGitDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-non-git-",
      });
      const gitDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-no-remote-",
      });

      yield* git(gitDir, ["init"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const nonGitIdentity = yield* resolver.resolve(nonGitDir);
      const noRemoteIdentity = yield* resolver.resolve(gitDir);

      expect(nonGitIdentity).toBeNull();
      expect(noRemoteIdentity).toBeNull();
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("ignores local-path remotes such as a tool-generated gb-local", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const localOnlyDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-local-remote-",
      });
      const mixedDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-mixed-remote-",
      });

      yield* git(localOnlyDir, ["init"]);
      yield* git(localOnlyDir, ["remote", "add", "gb-local", "."]);
      yield* git(localOnlyDir, ["remote", "add", "backup", "/srv/git/repo.git"]);
      yield* git(localOnlyDir, ["remote", "add", "archive", "file:///srv/git/repo.git"]);
      yield* git(mixedDir, ["init"]);
      yield* git(mixedDir, ["remote", "add", "gb-local", "."]);
      yield* git(mixedDir, ["remote", "add", "mirror", "git@github.com:SupabitApp/supaterm.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      expect(yield* resolver.resolve(localOnlyDir)).toBeNull();

      const mixedIdentity = yield* resolver.resolve(mixedDir);
      expect(mixedIdentity?.locator.remoteName).toBe("mirror");
      expect(mixedIdentity?.canonicalKey).toBe("github.com/supabitapp/supaterm");
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect.each(["add", "replace"] as const)(
    "refreshes the primary upstream after %s before cache expiry",
    (change) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const cwd = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "supaterm-repository-identity-upstream-test-",
        });

        yield* git(cwd, ["init"]);
        yield* git(cwd, ["remote", "add", "origin", "git@github.com:julius/supaterm.git"]);
        if (change === "replace") {
          yield* git(cwd, ["remote", "add", "upstream", "git@github.com:SupabitApp/previous.git"]);
        }

        const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
        const initialIdentity = yield* resolver.resolve(cwd);
        expect(initialIdentity?.canonicalKey).toBe(
          change === "add" ? "github.com/julius/supaterm" : "github.com/supabitapp/previous",
        );

        yield* git(cwd, [
          "remote",
          change === "add" ? "add" : "set-url",
          "upstream",
          "git@github.com:SupabitApp/supaterm.git",
        ]);
        expect(yield* resolver.resolve(cwd)).toEqual(initialIdentity);
        const identity = yield* resolver.resolve(cwd, { refresh: true });

        expect(identity).not.toBeNull();
        expect(identity?.locator.remoteName).toBe("upstream");
        expect(identity?.canonicalKey).toBe("github.com/supabitapp/supaterm");
        expect(identity?.displayName).toBe("SupabitApp/supaterm");
        expect(yield* resolver.resolve(cwd)).toEqual(identity);
      }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("reports a fork's own remote as origin next to the upstream identity", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-fork-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:julius/supaterm-fork.git"]);
      yield* git(cwd, ["remote", "add", "upstream", "git@github.com:supabitapp/supaterm.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);

      expect(identity?.canonicalKey).toBe("github.com/supabitapp/supaterm");
      expect(identity?.displayName).toBe("supabitapp/supaterm");
      expect(identity?.origin).toEqual({
        canonicalKey: "github.com/julius/supaterm-fork",
        remoteUrl: "git@github.com:julius/supaterm-fork.git",
        displayName: "julius/supaterm-fork",
      });
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("follows the remote gh repo set-default made the base", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-gh-base-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:julius/supaterm-fork.git"]);
      yield* git(cwd, ["remote", "add", "upstream", "git@github.com:supabitapp/supaterm.git"]);
      yield* git(cwd, ["config", "remote.origin.gh-resolved", "base"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);

      expect(identity?.canonicalKey).toBe("github.com/julius/supaterm-fork");
      expect(identity?.locator.remoteName).toBe("origin");
      expect(identity?.origin).toBeUndefined();
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect.each([
    ["names another repository", [["origin", "acme/other"]]],
    [
      "marks several remotes",
      [
        ["origin", "base"],
        ["upstream", "base"],
      ],
    ],
  ] as const)("keeps upstream when gh repo set-default %s", ([, marks]) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-gh-fallback-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:julius/supaterm-fork.git"]);
      yield* git(cwd, ["remote", "add", "upstream", "git@github.com:supabitapp/supaterm.git"]);
      for (const [remote, resolution] of marks)
        yield* git(cwd, ["config", `remote.${remote}.gh-resolved`, resolution]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);

      expect(identity?.canonicalKey).toBe("github.com/supabitapp/supaterm");
      expect(identity?.locator.remoteName).toBe("upstream");
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("uses the last remote path segment as the repository name for nested groups", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "supaterm-repository-identity-nested-group-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@gitlab.com:Supaterm/platform/supaterm.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);

      expect(identity).not.toBeNull();
      expect(identity?.canonicalKey).toBe("gitlab.com/supaterm/platform/supaterm");
      expect(identity?.displayName).toBe("Supaterm/platform/supaterm");
      expect(identity?.owner).toBe("Supaterm");
      expect(identity?.name).toBe("supaterm");
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );
});
