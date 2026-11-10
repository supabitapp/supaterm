import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as SidePulseEjectGuard from "./SidePulseEjectGuard.ts";

const BUNDLED = "/Applications/Kh'oi's Supaterm.app/Contents/Resources/sd-eject-guard/guard";

const PLIST = "/Library/LaunchDaemons/com.supaterm.sidepulse-eject-guard.plist";
const INSTALLED = "/Library/Application Support/Supaterm/sidepulse-eject-guard";

const run = (input: { readonly exitCode: number; readonly stderr?: string }) => {
  const files = new Set<string>();
  const commands: Array<ReadonlyArray<string>> = [];
  const spawner = ChildProcessSpawner.make((command) => {
    const { args } = command as unknown as { readonly args: ReadonlyArray<string> };
    commands.push(args);
    const script = args.at(-2) ?? "";
    if (input.exitCode === 0 && script.includes(`launchctl bootstrap system ${PLIST}`)) {
      files.add(PLIST).add(INSTALLED);
    } else if (input.exitCode === 0 && script.includes(`rm -f ${PLIST}`)) {
      files.clear();
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
      assert.strictEqual(install?.at(-1), SidePulseEjectGuard.INSTALL_PROMPT);
      const installScript = install?.at(-2) ?? "";
      assert.include(
        installScript,
        `/usr/bin/install -m 755 -o root -g wheel '/Applications/Kh'\\''oi'\\''s Supaterm.app/Contents/Resources/sd-eject-guard/guard' '${INSTALLED}'`,
      );
      assert.include(installScript, `<array><string>${INSTALLED}</string></array>`);
      assert.include(installScript, "<key>KeepAlive</key><true/>");
      assert.include(installScript, `> ${PLIST}\n/usr/sbin/chown root:wheel ${PLIST}`);
      assert.include(installScript, `/bin/launchctl bootstrap system ${PLIST} || {`);

      assert.strictEqual(uninstall?.at(-1), SidePulseEjectGuard.UNINSTALL_PROMPT);
      assert.include(
        uninstall?.at(-2),
        "/bin/launchctl bootout system/com.supaterm.sidepulse-eject-guard",
      );
      assert.include(uninstall?.at(-2), `/bin/rm -f ${PLIST} '${INSTALLED}'`);
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
