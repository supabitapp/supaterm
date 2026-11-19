import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { CommandAvailability, WindowsShellEnvironment } from "@supaterm/shared/shell";
import * as Effect from "effect/Effect";
import * as NodeOS from "node:os";
import { assert, it } from "vite-plus/test";

import { fixPath, hydratePosixHome, refreshWindowsPath } from "./os-jank.ts";

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

type ExecFileSync = NonNullable<NonNullable<Parameters<typeof fixPath>[0]>["execFileSync"]>;

const recordingShell = (respond: ExecFileSync) => {
  const timeouts: Array<number> = [];
  const execFileSync: ExecFileSync = (file, args, options) => {
    timeouts.push(options.timeout);
    return respond(file, args, options);
  };
  return { execFileSync, timeouts };
};

effectIt.effect("hydrates PATH when the desktop handoff is absent", () =>
  Effect.gen(function* () {
    const shell = recordingShell(
      () => "__SUPATERM_ENV_PATH_START__\n/opt/tools/bin\n__SUPATERM_ENV_PATH_END__\n",
    );
    const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };

    yield* fixPath({ execFileSync: shell.execFileSync }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provide(NodeServices.layer),
    );

    assert.equal(shell.timeouts.length, 1);
    assert.equal(env.PATH, "/opt/tools/bin:/usr/bin");
  }),
);

const timedOut = (file: string) =>
  Object.assign(new Error(`spawnSync ${file} ETIMEDOUT`), { code: "ETIMEDOUT" });

effectIt.effect("waits longer for a login shell that times out at startup", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };

    yield* fixPath({
      execFileSync: (file, _args, options) => {
        if (options.timeout < 8_000) throw timedOut(file);
        return "__SUPATERM_ENV_PATH_START__\n/opt/tools/bin\n__SUPATERM_ENV_PATH_END__\n";
      },
    }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provide(NodeServices.layer),
    );

    assert.equal(env.PATH, "/opt/tools/bin:/usr/bin");
  }),
);

effectIt.effect("waits longer for only one hung login shell", () =>
  Effect.gen(function* () {
    const shell = recordingShell((file) => {
      throw timedOut(file);
    });
    const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };

    yield* fixPath({ execFileSync: shell.execFileSync }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provide(NodeServices.layer),
    );

    assert.equal(shell.timeouts.filter((timeout) => timeout > 5_000).length, 1);
    assert.equal(env.PATH, "/usr/bin");
  }),
);

effectIt.effect("keeps mise's PATH record with the login shell PATH", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };

    yield* fixPath({
      execFileSync: () =>
        [
          "__SUPATERM_ENV_PATH_START__",
          "/home/me/.local/bin:/mise/installs/claude/latest:/mise/shims",
          "__SUPATERM_ENV_PATH_END__",
          "__SUPATERM_ENV___MISE_DIFF_START__",
          "mise-diff",
          "__SUPATERM_ENV___MISE_DIFF_END__",
        ].join("\n"),
    }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provide(NodeServices.layer),
    );

    assert.equal(env.__MISE_DIFF, "mise-diff");
  }),
);

effectIt.effect("hydrates a missing JAVA_HOME from the login shell and keeps an explicit one", () =>
  Effect.gen(function* () {
    const missing: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };
    const explicit: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
      JAVA_HOME: "/custom/jdk",
    };

    for (const env of [missing, explicit]) {
      yield* fixPath({
        execFileSync: () =>
          [
            "__SUPATERM_ENV_PATH_START__",
            "/opt/homebrew/bin",
            "__SUPATERM_ENV_PATH_END__",
            "__SUPATERM_ENV_JAVA_HOME_START__",
            "/opt/homebrew/opt/openjdk@17",
            "__SUPATERM_ENV_JAVA_HOME_END__",
          ].join("\n"),
      }).pipe(
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, env),
        Effect.provide(NodeServices.layer),
      );
    }

    assert.equal(missing.JAVA_HOME, "/opt/homebrew/opt/openjdk@17");
    assert.equal(explicit.JAVA_HOME, "/custom/jdk");
  }),
);

effectIt.effect("replaces a Path-spelled Windows PATH instead of adding a second key", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { Path: "C:\\Windows" };

    yield* fixPath().pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(WindowsShellEnvironment, () => Effect.succeed({ PATH: "C:\\Tools" })),
      Effect.provideService(CommandAvailability, () => Effect.succeed(true)),
      Effect.provide(NodeServices.layer),
    );

    assert.deepEqual(env, { PATH: "C:\\Tools;C:\\Windows" });
  }),
);

effectIt.effect("adds a directory an installer wrote to the registry after launch", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { Path: "C:\\Tools;C:\\Windows" };
    const installed = "C:\\Users\\me\\AppData\\Local\\cursor-agent";

    yield* refreshWindowsPath().pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(WindowsShellEnvironment, () =>
        Effect.succeed({ PATH: `C:\\Windows;${installed}` }),
      ),
    );

    assert.deepEqual(env, { PATH: `C:\\Tools;C:\\Windows;${installed}` });
  }),
);
