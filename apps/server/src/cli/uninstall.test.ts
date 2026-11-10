import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@supaterm/shared/HostProcess";

import { findOwnedLauncher, findRecordedLaunchers, spawnWindowsRemoval } from "./uninstall.ts";

it.layer(NodeServices.layer)("supaterm uninstall launcher", (it) => {
  it.effect("claims only a launcher that points into this home's runtime tree", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // macOS spells the temp folder /var but resolves it to /private/var.
      const root = yield* fs
        .makeTempDirectoryScoped({ prefix: "supaterm-uninstall-" })
        .pipe(Effect.flatMap(fs.realPath));
      const versionsDir = path.join(root, "runtime/versions");
      const exe = path.join(versionsDir, "1.0.0/supaterm");
      const otherExe = path.join(root, "other/runtime/versions/1.0.0/supaterm");
      const copy = path.join(root, "copy/supaterm");
      for (const file of [exe, otherExe, copy]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      const ours = path.join(root, "bin/supaterm");
      const theirs = path.join(root, "other/bin/supaterm");
      yield* fs.makeDirectory(path.dirname(ours), { recursive: true });
      yield* fs.makeDirectory(path.dirname(theirs), { recursive: true });
      yield* fs.symlink(exe, ours);
      yield* fs.symlink(otherExe, theirs);

      assert.equal(yield* findOwnedLauncher({ launchedAs: ours, versionsDir }), ours);
      assert.isUndefined(yield* findOwnedLauncher({ launchedAs: theirs, versionsDir }));
      assert.isUndefined(yield* findOwnedLauncher({ launchedAs: copy, versionsDir }));
      assert.isUndefined(yield* findOwnedLauncher({ launchedAs: undefined, versionsDir }));

      // On Windows, only the shim exactly as written is ours; a user's wrapper stays.
      const shimDir = path.join(root, "win-bin");
      const shim = path.join(shimDir, "supaterm.cmd");
      yield* fs.makeDirectory(shimDir);
      const windowsOwner = (contents: string) =>
        fs
          .writeFileString(shim, contents)
          .pipe(
            Effect.andThen(findOwnedLauncher({ launchedAs: exe, versionsDir })),
            Effect.provideService(HostProcess.Platform, "win32"),
            Effect.provideService(HostProcess.Environment, { PATH: shimDir }),
          );
      assert.equal(yield* windowsOwner(`@echo off\r\n"${exe}" %*`), shim);
      assert.isUndefined(yield* windowsOwner(`@echo off\r\nset FOO=1\r\n"${exe}" %*`));

      // npx can run another version than the installed one, so uninstall also reads the
      // recorded launchers: through a symlinked home, and dangling after a prune.
      const throughAlias = path.join(root, "bin/supaterm-alias");
      const pruned = path.join(root, "bin/supaterm-pruned");
      yield* fs.symlink(root, path.join(root, "alias"));
      yield* fs.symlink(path.join(root, "alias/runtime/versions/1.0.0/supaterm"), throughAlias);
      yield* fs.symlink(path.join(versionsDir, "0.9.0/supaterm"), pruned);
      // Another program inside a version is not a launcher.
      const sibling = path.join(root, "bin/supaterm-sibling");
      yield* fs.symlink(path.join(versionsDir, "1.0.0/node"), sibling);
      yield* fs.writeFileString(
        path.join(root, "runtime/launchers"),
        [ours, theirs, copy, throughAlias, pruned, sibling, path.join(root, "missing")].join("\n") +
          "\n",
      );
      for (const dir of [versionsDir, path.join(root, "alias/runtime/versions")]) {
        assert.deepStrictEqual(yield* findRecordedLaunchers(dir), [ours, throughAlias, pruned]);
      }

      // On Windows only an unedited supaterm.cmd is ours; a hand-edited wrapper belongs to the user.
      const cmd = path.join(root, "bin/supaterm.cmd");
      const edited = path.join(root, "bin/edited.cmd");
      yield* fs.writeFileString(cmd, `@echo off\r\n"${exe}" %*`);
      yield* fs.writeFileString(
        edited,
        `@echo off\r\nset "SUPATERM_HOME=D:\\other"\r\n"${exe}" %*`,
      );
      yield* fs.writeFileString(path.join(root, "runtime/launchers"), `${cmd}\r\n${edited}\r\n`);
      assert.deepStrictEqual(
        yield* findRecordedLaunchers(versionsDir).pipe(
          Effect.provideService(HostProcess.Platform, "win32"),
        ),
        [cmd],
      );
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );
});

it.live.runIf(HostProcess.Platform.defaultValue() === "win32")(
  "supaterm uninstall has cmd.exe remove the runtime directory, preserving spaces and literal environment-variable syntax",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-uninstall-" });
      const runtimeDir = path.join(root, "supaterm home %COMSPEC% !COMSPEC! & data", "runtime");
      yield* fs.makeDirectory(path.join(runtimeDir, "versions", "1.0.0"), { recursive: true });
      yield* fs.writeFileString(path.join(runtimeDir, "versions", "1.0.0", "supaterm.exe"), "");

      const child = spawnWindowsRemoval(process.env.ComSpec ?? "cmd.exe", runtimeDir);
      yield* Effect.callback<void, Error>((resume) => {
        child.once("error", (error) => resume(Effect.fail(error)));
        child.once("exit", (code) =>
          resume(code === 0 ? Effect.void : Effect.die(`cmd.exe exited with ${code}`)),
        );
      });

      assert.isFalse(yield* fs.exists(runtimeDir));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
