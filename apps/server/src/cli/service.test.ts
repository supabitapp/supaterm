import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as NetService from "@supaterm/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { Command } from "effect/cli";
import { afterEach, vi } from "vite-plus/test";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../service/bootService.ts";
import { formatServiceStatus, reconcileService, serviceCommand } from "./service.ts";

afterEach(() => vi.restoreAllMocks());

const status = {
  supported: true,
  installed: true,
  current: true,
  unitPath: "/home/me/.config/systemd/user/supaterm.service",
  logPath: "/home/me/.supaterm/userdata/logs/boot-service.log",
} as const;

it("reports the installed service version and host paths", () => {
  assert.equal(
    formatServiceStatus(status, "0.0.29"),
    [
      "Supaterm service",
      "  Status: installed · supaterm@0.0.29",
      "  Unit: /home/me/.config/systemd/user/supaterm.service",
      "  Logs: /home/me/.supaterm/userdata/logs/boot-service.log",
    ].join("\n"),
  );
});

it("gives a direct repair command for a stale service", () => {
  assert.include(
    formatServiceStatus({ ...status, current: false }, "0.0.29"),
    "Next: Run `supaterm service install` to repair it.",
  );
});

it("explains an incomplete nightly installation and keeps repair on its installed version", () => {
  const output = formatServiceStatus(
    {
      ...status,
      current: false,
      installedVersion: "0.0.32-nightly.1",
      problems: ["linger-disabled", "service-stopped"],
    },
    "0.0.32-nightly.1",
  );

  expect(output).toContain("[linger-disabled]");
  expect(output).toContain("last login session ends");
  expect(output).toContain('sudo loginctl enable-linger "$(id -un)"');
  expect(output).toContain("[service-stopped]");
  expect(output).toContain("Run `supaterm service install` to repair it.");
  expect(output).not.toContain("npx");
});

it("points an older service at a repair, never at npx", () => {
  const output = formatServiceStatus(
    { ...status, current: false, installedVersion: "0.0.28" },
    "0.0.29",
  );
  expect(output).toContain("Run `supaterm service install` to repair it.");
  expect(output).not.toContain("npx");
});

it("explains where the service is supported", () => {
  assert.include(
    formatServiceStatus({ ...status, supported: false, installed: false }, "0.0.29"),
    "Supported on: Linux with systemd, macOS with launchd",
  );
});

it("reports a newer installed service and tells the CLI to catch up to it", () => {
  const output = formatServiceStatus(
    { ...status, current: false, installedVersion: "0.0.32-nightly.1" },
    "0.0.31",
  );

  assert.include(output, "supaterm@0.0.32-nightly.1 (newer than this supaterm@0.0.31 CLI)");
  assert.include(output, "Run `supaterm update 0.0.32-nightly.1` to match it");
  assert.notInclude(output, "npx");
});

const newerServiceStatus = { ...status, current: false, installedVersion: "999.0.0" };

function makeTestService(
  serviceStatus: BootService.BootServiceStatus,
  restartOutcome: "restarted" | "queued" = "restarted",
) {
  const installOptions: Array<Parameters<BootService.BootService["Service"]["install"]>[0]> = [];
  const restarts: Array<true> = [];
  const service = BootService.BootService.of({
    status: Effect.succeed(serviceStatus),
    withStopped: (operation) => operation,
    restart: Effect.sync(() => {
      restarts.push(true);
      return serviceStatus.installed ? restartOutcome : "skipped";
    }),
    install: (options) =>
      Effect.sync(() => {
        installOptions.push(options);
        return {
          program: ["/test/supaterm/runtime/versions/1.0.0/supaterm", "__service-launcher"],
          baseDir: "/test/supaterm",
          unitPath: serviceStatus.unitPath,
          logPath: serviceStatus.logPath,
        };
      }),
    uninstall: Effect.succeed(false),
  });
  return { service, installOptions, restarts };
}

it.layer(Layer.mergeAll(NodeServices.layer, NetService.layer))("service commands", (it) => {
  it.effect("restart restarts the installed service", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-service-cli-test-" });
      const { service, installOptions, restarts } = makeTestService(status);
      vi.spyOn(BootService, "layer").mockReturnValue(
        Layer.succeed(BootService.BootService, service),
      );

      yield* Command.runWith(serviceCommand, { version: packageJson.version })([
        "restart",
        "--base-dir",
        baseDir,
      ]).pipe(
        Effect.provideService(HostProcess.Environment, {}),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
      );

      expect(restarts).toEqual([true]);
      expect(installOptions).toEqual([]);
    }),
  );

  it.effect("restart from inside the service says the restart is only queued", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-service-cli-test-" });
      const { service } = makeTestService({ ...status, installedVersion: "0.0.30" }, "queued");
      vi.spyOn(BootService, "layer").mockReturnValue(
        Layer.succeed(BootService.BootService, service),
      );
      const lines: Array<string> = [];
      const testConsole = {
        ...globalThis.console,
        log: (...args: ReadonlyArray<unknown>) => {
          lines.push(args.map(String).join(" "));
        },
      } satisfies Console.Console;

      yield* Command.runWith(serviceCommand, { version: packageJson.version })([
        "restart",
        "--base-dir",
        baseDir,
      ]).pipe(
        Effect.provideService(HostProcess.Environment, {}),
        Effect.provideService(Console.Console, testConsole),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
      );

      const output = lines.join("\n");
      expect(output).not.toContain("Restarted");
      expect(output).toContain("Queued a restart of the Supaterm service on supaterm@0.0.30");
      expect(output).toContain(`Logs: ${status.logPath}`);
    }),
  );

  it.effect("install reports a handed-off switch as pending", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-service-cli-test-" });
      const { service } = makeTestService({ ...status, current: false });
      vi.spyOn(BootService, "layer").mockReturnValue(
        Layer.succeed(BootService.BootService, {
          ...service,
          install: (options) =>
            service.install(options).pipe(Effect.map((plan) => ({ ...plan, handedOff: true }))),
        }),
      );
      const lines: string[] = [];
      yield* Command.runWith(serviceCommand, { version: packageJson.version })([
        "install",
        "--base-dir",
        baseDir,
      ]).pipe(
        Effect.provideService(HostProcess.Environment, {}),
        Effect.provideService(Console.Console, {
          ...globalThis.console,
          log: (...args) => {
            lines.push(args.map(String).join(" "));
          },
        }),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
      );

      const output = lines.join("\n");
      expect(output).not.toMatch(/(?:Installed|Updated) Supaterm service/);
      expect(output).toContain("separate systemd unit");
      expect(output).toContain(status.logPath);
    }),
  );

  it.effect.each(["install"] as const)(
    "%s refuses a downgrade before changing the service",
    (command) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-service-cli-test-" });
        const { service, installOptions } = makeTestService(newerServiceStatus);
        vi.spyOn(BootService, "layer").mockReturnValue(
          Layer.succeed(BootService.BootService, service),
        );

        const error = yield* Command.runWith(serviceCommand, { version: packageJson.version })([
          command,
          "--base-dir",
          baseDir,
        ]).pipe(
          Effect.provideService(HostProcess.Environment, {}),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
          Effect.flip,
        );

        expect(error).toMatchObject({
          _tag: "BootServiceDowngradeRefusedError",
          installedVersion: "999.0.0",
          targetVersion: packageJson.version,
        });
        expect(installOptions).toEqual([]);
      }),
  );

  it.effect.each(["install"] as const)("%s allows an explicit downgrade", (command) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-service-cli-test-" });
      const { service, installOptions } = makeTestService(newerServiceStatus);
      vi.spyOn(BootService, "layer").mockReturnValue(
        Layer.succeed(BootService.BootService, service),
      );

      yield* Command.runWith(serviceCommand, { version: packageJson.version })([
        command,
        "--base-dir",
        baseDir,
        "--allow-downgrade",
      ]).pipe(
        Effect.provideService(HostProcess.Environment, {}),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
      );

      expect(installOptions).toEqual([{ allowDowngrade: true }]);
    }),
  );
});

it.effect.each([
  { name: "a new service", state: { ...status, installed: false, current: false } },
  { name: "an older service", state: { ...status, current: false, installedVersion: "0.0.0" } },
  {
    name: "the same version",
    state: { ...status, current: false, installedVersion: packageJson.version },
  },
  {
    name: "an incomplete install of the same version",
    state: {
      ...status,
      current: false,
      installedVersion: packageJson.version,
      problems: ["linger-disabled"] as const,
    },
  },
  { name: "an unknown version", state: { ...status, current: false } },
])("installs or repairs $name without an override", ({ state }) =>
  Effect.gen(function* () {
    const { service, installOptions } = makeTestService(state);

    const result = yield* reconcileService().pipe(
      Effect.provideService(BootService.BootService, service),
    );

    expect(result.changed).toBe(true);
    expect(installOptions).toEqual([undefined]);
  }),
);
