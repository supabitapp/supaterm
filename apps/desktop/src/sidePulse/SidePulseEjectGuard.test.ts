import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as SidePulseEjectGuard from "./SidePulseEjectGuard.ts";

const BUNDLED = "/Applications/Kh'oi's Supaterm.app/Contents/Resources/sd-eject-guard/guard";

const run = (input: { readonly exitCode: number; readonly stderr?: string }) => {
  const files = new Set<string>();
  const commands: Array<ReadonlyArray<string>> = [];
  const spawner = ChildProcessSpawner.make((command) => {
    const { args } = command as unknown as { readonly args: ReadonlyArray<string> };
    commands.push(args);
    if (input.exitCode === 0) {
      if (args.at(-1) === SidePulseEjectGuard.INSTALL_PROMPT)
        files.add(SidePulseEjectGuard.DAEMON_PLIST);
      else files.delete(SidePulseEjectGuard.DAEMON_PLIST);
    }
    const stderr = new TextEncoder().encode(input.stderr ?? "");
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(input.exitCode)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.make(stderr),
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });
  return {
    commands,
    guard: SidePulseEjectGuard.make(BUNDLED).pipe(
      Effect.provide(
        FileSystem.layerNoop({
          exists: (path) => Effect.succeed(files.has(path)),
          makeTempDirectoryScoped: () => Effect.succeed("/tmp/stage"),
          writeFileString: () => Effect.void,
        }),
      ),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    ),
  };
};

describe("SidePulseEjectGuard", () => {
  it.effect("installs and removes the daemon through the administrator prompt", () =>
    Effect.gen(function* () {
      const { guard, commands } = run({ exitCode: 0 });
      const service = yield* guard;
      assert.strictEqual(yield* service.status, "not-installed");
      assert.strictEqual(yield* service.setInstalled(true), "installed");
      assert.strictEqual(yield* service.setInstalled(false), "not-installed");
      const [install, uninstall] = commands;
      assert.include(install?.join("\n"), "with administrator privileges");
      assert.deepStrictEqual(install?.slice(-2), [
        SidePulseEjectGuard.installScript(BUNDLED, `/tmp/stage/${SidePulseEjectGuard.LABEL}.plist`),
        SidePulseEjectGuard.INSTALL_PROMPT,
      ]);
      assert.include(install?.at(-2), `'/Applications/Kh'\\''oi'\\''s Supaterm.app/`);
      assert.deepStrictEqual(uninstall?.slice(-2), [
        SidePulseEjectGuard.uninstallScript,
        SidePulseEjectGuard.UNINSTALL_PROMPT,
      ]);
    }),
  );

  it.effect("treats a cancelled password prompt as no change", () =>
    Effect.gen(function* () {
      const service = yield* run({
        exitCode: 1,
        stderr: "0:110: execution error: User canceled. (-128)\n",
      }).guard;
      assert.strictEqual(yield* service.setInstalled(true), "not-installed");
    }),
  );

  it.effect("fails when the privileged script fails", () =>
    Effect.gen(function* () {
      const service = yield* run({ exitCode: 1, stderr: "launchctl: Bootstrap failed: 5" }).guard;
      const exit = yield* Effect.exit(service.setInstalled(true));
      assert.isTrue(Exit.isFailure(exit));
    }),
  );
});
