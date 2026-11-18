// @effect-diagnostics-next-line nodeBuiltinImport:off -- Cross-process launcher contention uses real filesystem leases and IPC barriers.
import * as NodeChildProcess from "node:child_process";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { CliError } from "effect/cli";
import { HttpClient } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { vi } from "vite-plus/test";

import * as ProcessRunner from "../processRunner.ts";
import * as BootService from "./bootService.ts";
import { pinnedRuntimePaths } from "./pinnedRuntime.ts";
import {
  parseServiceState,
  SERVICE_ENV_FILE,
  SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_RESTART_PENDING_FILE,
  serviceStateHasPendingUpdate,
  serviceUnitLogPathOf,
} from "./serviceProtocol.ts";

const linuxRuntime = "/home/theo/.supaterm/runtime/versions/1.2.3/supaterm";
const linuxPlan = {
  program: [linuxRuntime, "__service-launcher"],
  baseDir: "/home/theo/.supaterm",
  logPath: "/home/theo/.supaterm/userdata/logs/boot-service.log",
  unitPath: "/home/theo/.config/systemd/user/supaterm.service",
};

const leaseObserver = vi.hoisted(() => ({ contended: (_destination: string) => {} }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      try {
        return actual.renameSync(...args);
      } catch (error) {
        if (["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
          leaseObserver.contended(String(args[1]));
        }
        throw error;
      }
    },
  };
});

it("reads the served Supaterm home and log back out of a rendered unit or plist", () => {
  const plan = (baseDir: string) => ({
    program: [`${baseDir}/runtime/versions/1.2.3/supaterm`, "__service-launcher"],
    baseDir,
    logPath: `${baseDir}/userdata/logs/boot-service.log`,
    unitPath: "/home/theo/.config/systemd/user/supaterm.service",
  });

  expect(
    BootService.bootServiceBaseDirOf(
      BootService.renderBootServiceUnit(plan("/home/theo/.supaterm")),
    ),
  ).toBe("/home/theo/.supaterm");
  expect(
    BootService.bootServiceBaseDirOf(
      BootService.renderBootServiceUnit(plan("/home/theo/supaterm Data/100%")),
    ),
  ).toBe("/home/theo/supaterm Data/100%");
  expect(
    serviceUnitLogPathOf(BootService.renderBootServiceUnit(plan("/home/theo/Supaterm Data/100%"))),
  ).toBe("/home/theo/Supaterm Data/100%/userdata/logs/boot-service.log");
  expect(
    serviceUnitLogPathOf(
      BootService.renderBootServicePlist(plan("/Users/theo/a&b"), {
        homeDir: "/Users/theo",
        environmentPath: "/usr/bin",
      }),
    ),
  ).toBe("/Users/theo/a&b/userdata/logs/boot-service.log");
  expect(
    BootService.bootServiceBaseDirOf(
      BootService.renderBootServicePlist(plan("/Users/theo/a&b"), {
        homeDir: "/Users/theo",
        environmentPath: "/usr/bin",
      }),
    ),
  ).toBe("/Users/theo/a&b");
  expect(BootService.bootServiceBaseDirOf("[Service]\nExecStart=/x\n")).toBeUndefined();
});

it("protects the server unit from agents under CPU and memory pressure", () => {
  const unit = BootService.renderBootServiceUnit({
    program: ["/home/theo/.supaterm/runtime/versions/1.2.3/supaterm", "__service-launcher"],
    baseDir: "/home/theo/.supaterm",
    logPath: "/home/theo/.supaterm/userdata/logs/boot-service.log",
    unitPath: "/home/theo/.config/systemd/user/supaterm.service",
  });
  const service = unit.slice(unit.indexOf("[Service]"), unit.indexOf("[Install]"));
  for (const line of [
    "CPUWeight=1000",
    "IOWeight=1000",
    "MemoryLow=1536M",
    "OOMScoreAdjust=100",
    "OOMPolicy=continue",
  ]) {
    expect(service.split("\n")).toContain(line);
  }
});

it.each([
  ["a unit", "/home/theo/Supaterm Data/100%$x", BootService.renderBootServiceUnit],
  [
    "a plist",
    "/Users/theo/a&b <c>",
    (plan: BootService.BootServicePlan) =>
      BootService.renderBootServicePlist(plan, { homeDir: "/Users/theo", environmentPath: "" }),
  ],
] as const)("reads the launcher back out of %s", (_, baseDir, render) => {
  const program = `${baseDir}/runtime/versions/1.2.3/supaterm`;
  expect(
    BootService.bootServiceProgramOf(
      render({ program: [program, "__service-launcher"], baseDir, logPath: "/log", unitPath: "" }),
    ),
  ).toBe(program);
});

it("outweighs the agents slice for CPU and disk", () => {
  const unit = BootService.renderBootServiceUnit(linuxPlan);

  expect(unit).toContain("CPUWeight=1000");
  expect(unit).toContain("IOWeight=1000");
});

// systemd rejects a unit whose executable has a control character, quote or backslash, even quoted.
it.each([
  ["a double quote", '/home/theo/Supaterm "Data"'],
  ["a single quote", "/home/theo/Theo's Supaterm"],
  ["a backslash", "/home/theo/Supaterm\\Data"],
  ["a newline", "/home/theo/Supaterm\nData"],
])("renders a loadable unit, or refuses, for a Supaterm home with %s", (_, baseDir) => {
  let unit: string;
  try {
    unit = BootService.renderBootServiceUnit({
      program: [`${baseDir}/runtime/versions/1.2.3/supaterm`, "__service-launcher"],
      baseDir,
      logPath: `${baseDir}/userdata/logs/boot-service.log`,
      unitPath: "/home/theo/.config/systemd/user/supaterm.service",
    });
  } catch {
    return;
  }
  for (const line of unit.split("\n")) {
    expect(line === "" || line.startsWith("[") || line.includes("=")).toBe(true);
  }
  const execStart = unit.split("\n").find((line) => line.startsWith("ExecStart="));
  const executable = execStart
    ?.slice("ExecStart=".length)
    .match(/^"((?:\\.|[^"\\])*)"|^(\S+)/)
    ?.slice(1)
    .find((group) => group !== undefined)
    ?.replace(/\\(.)/g, "$1");
  expect(executable).toBeDefined();
  const unsafe = [...(executable ?? "")].filter(
    (char) => char.charCodeAt(0) < 0x20 || `"'\\`.includes(char),
  );
  expect(unsafe).toEqual([]);
});

const macInstallerPath =
  "/opt/homebrew/bin:/Users/theo/.npm-global/bin:/Users/theo/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin";

const makeHarness = Effect.fn("test.make_boot_service_harness")(function* (
  platform: NodeJS.Platform = "linux",
  installerPath = macInstallerPath,
  xdgConfigHome?: string,
  managerXdgConfigHome = xdgConfigHome,
  installBinDir?: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-boot-service-test-" });
  const managerUnitDir = path.join(
    managerXdgConfigHome !== undefined && path.isAbsolute(managerXdgConfigHome)
      ? managerXdgConfigHome
      : path.join(home, ".config"),
    "systemd",
    "user",
  );
  const baseDir = path.join(home, ".supaterm");
  const statePath = path.join(baseDir, "runtime", "service-state.json");
  const runtime = pinnedRuntimePaths(path, baseDir, "1.2.3", platform);
  yield* fs.makeDirectory(path.dirname(runtime.entryPath), { recursive: true });
  yield* fs.writeFileString(runtime.entryPath, "#!/bin/sh\n");
  yield* fs.writeFileString(runtime.sentinelPath, "1.2.3\n");

  const commands: string[] = [];
  const invocations: ProcessRunner.ProcessRunInput[] = [];
  const timeouts = new Map<string, unknown>();
  const control: {
    failCommand: string | undefined;
    stateAfterStop?: string;
    /** `undefined` makes `loginctl show-user` fail, as when logind does not know the user. */
    linger: string | undefined;
    managerReachable: boolean;
    /** The user bus is found only through `XDG_RUNTIME_DIR`, as without a login session. */
    busNeedsRuntimeDir: boolean;
    lingerStartsManager: boolean;
    enabled: boolean;
    active: boolean;
    /** systemd refuses starts until `reset-failed`, as after `StartLimitBurst` trips. */
    startLimitHit: boolean;
  } = {
    failCommand: undefined,
    linger: "yes",
    managerReachable: true,
    busNeedsRuntimeDir: false,
    lingerStartsManager: true,
    enabled: true,
    active: true,
    startLimitHit: false,
  };
  const runner = ProcessRunner.ProcessRunner.of({
    run: Effect.fn("test.run_boot_service_command")(function* (
      input: ProcessRunner.ProcessRunInput,
    ) {
      const command = `${input.command} ${input.args.join(" ")}`;
      commands.push(command);
      invocations.push(input);
      timeouts.set(command, input.timeout);
      if (command === "systemctl --user reset-failed supaterm.service")
        control.startLimitHit = false;
      const refusedStart = control.startLimitHit && command.startsWith("systemctl --user restart ");
      // `--no-block` only queues the job, so systemd reports success even when it refuses it.
      const failed =
        command === control.failCommand ||
        (refusedStart && command === "systemctl --user restart supaterm.service");
      if (!failed && command.startsWith("loginctl enable-linger --no-ask-password ")) {
        control.linger = "yes";
        control.managerReachable ||= control.lingerStartsManager;
      }
      if (!failed && command === "systemctl --user enable supaterm.service") control.enabled = true;
      if (!refusedStart && !failed && command.startsWith("systemctl --user restart "))
        control.active = true;
      // The manager loads units only from its own unit directory.
      const unitOutsideManager =
        command === "systemctl --user enable supaterm.service" &&
        !(yield* fs.exists(path.join(managerUnitDir, "supaterm.service")));
      // A stop that fails (a timeout, say) has still stopped the service.
      if (command === "systemctl --user stop supaterm.service") control.active = false;
      if (
        control.stateAfterStop !== undefined &&
        (command === "systemctl --user stop supaterm.service" ||
          command.startsWith("launchctl bootout --wait "))
      ) {
        yield* fs.writeFileString(statePath, control.stateAfterStop);
      }
      return {
        stdout:
          input.command === "busctl"
            ? JSON.stringify({
                type: "as",
                data: [
                  "/usr/lib/systemd/user",
                  `${managerUnitDir}.control`,
                  "/run/user/501/systemd/transient",
                  managerUnitDir,
                  "/etc/systemd/user",
                ],
              })
            : input.args[0] === "--version"
              ? `supaterm v${/versions\/([^/]+)\//.exec(input.command)?.[1] ?? "1.2.3"}\n`
              : input.command === "loginctl" && input.args[0] === "show-user"
                ? `${control.linger ?? ""}\n`
                : input.args[1] === "is-enabled"
                  ? control.enabled
                    ? "enabled\n"
                    : "disabled\n"
                  : "",
        stderr: "",
        code: ChildProcessSpawner.ExitCode(
          failed ||
            unitOutsideManager ||
            ((command === "systemctl --user show-environment" || input.command === "busctl") &&
              (!control.managerReachable ||
                (control.busNeedsRuntimeDir && input.env?.XDG_RUNTIME_DIR === undefined))) ||
            (input.command === "loginctl" &&
              input.args[0] === "show-user" &&
              control.linger === undefined) ||
            (input.args[1] === "is-active" && !control.active) ||
            (input.args[1] === "is-enabled" && !control.enabled)
            ? 1
            : 0,
        ),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      };
    }, Effect.orDie),
  });
  const makeService = (
    environmentPath: string | undefined = installerPath,
    cliVersion = "1.2.3",
    serviceBaseDir = baseDir,
    insideService = false,
    hostExecPath = "/usr/bin/supaterm",
    underSudo = false,
    serviceInstallBinDir: string | null | undefined = installBinDir,
  ) =>
    Effect.gen(function* () {
      const paths = pinnedRuntimePaths(path, serviceBaseDir, cliVersion, platform);
      yield* fs.makeDirectory(path.dirname(paths.entryPath), { recursive: true });
      yield* fs.writeFileString(paths.entryPath, "#!/bin/sh\n");
      yield* fs.writeFileString(paths.sentinelPath, `${cliVersion}\n`);
      return yield* BootService.make({
        baseDir: serviceBaseDir,
        logsDir: path.join(serviceBaseDir, "userdata", "logs"),
        cliVersion,
        host: { execPath: hostExecPath },
      });
    }).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(HostProcess.Platform, platform),
          Layer.succeed(HostProcess.UserId, underSudo ? 0 : 501),
          Layer.succeed(HostProcess.ExecutablePath, hostExecPath),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("no release download expected")),
          ),
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                HOME: home,
                ...(serviceInstallBinDir === undefined || serviceInstallBinDir === null
                  ? {}
                  : { SUPATERM_INSTALL_BIN_DIR: serviceInstallBinDir }),
                ...(xdgConfigHome === undefined ? {} : { XDG_CONFIG_HOME: xdgConfigHome }),
                ...(environmentPath === undefined || environmentPath === ""
                  ? {}
                  : { PATH: environmentPath }),
                ...(insideService ? { SUPATERM_BOOT_SERVICE_UNIT: "supaterm.service" } : {}),
                ...(underSudo ? { SUDO_USER: "julius" } : {}),
              },
            }),
          ),
        ),
      ),
    );
  const service = yield* makeService();
  return {
    service,
    makeService,
    fs,
    home,
    baseDir,
    statePath,
    commands,
    invocations,
    timeouts,
    control,
    runtime,
  };
});

it.layer(NodeServices.layer)("boot service install", (it) => {
  it.effect(
    "fails before installing files or validating a runtime when lingering needs an administrator",
    () =>
      Effect.gen(function* () {
        const { service, fs, statePath, commands, control, runtime } = yield* makeHarness();
        const before = yield* service.status;
        control.linger = "no";
        control.failCommand = "loginctl enable-linger --no-ask-password 501";
        yield* fs.remove(runtime.sentinelPath);

        const error = yield* service.install().pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "BootServicePrerequisiteError",
          problem: "linger-disabled",
        });
        expect(error.message).toContain('sudo loginctl enable-linger "$(id -un)"');
        expect(error.message).toContain("last login session ends");
        expect(yield* fs.exists(before.unitPath)).toBe(false);
        expect(yield* fs.exists(statePath)).toBe(false);
        expect(commands.some((command) => command.includes("--version"))).toBe(false);
        expect(
          commands.some(
            (command) => command.includes("daemon-reload") || command.includes("restart"),
          ),
        ).toBe(false);
        expect(yield* fs.readFileString(before.logPath)).toContain("[linger-disabled]");
      }),
  );

  it.effect(
    "detects a partial install and preserves the running service when repair lacks permission",
    () =>
      Effect.gen(function* () {
        const { service, fs, statePath, commands, control } = yield* makeHarness();
        const plan = yield* service.install();
        const before = yield* fs.readFileString(statePath);
        const unit = yield* fs.readFileString(plan.unitPath);
        control.linger = "no";
        control.failCommand = "loginctl enable-linger --no-ask-password 501";

        expect(yield* service.status).toMatchObject({
          current: false,
          problems: ["linger-disabled"],
        });
        commands.length = 0;
        expect((yield* service.install().pipe(Effect.flip))._tag).toBe(
          "BootServicePrerequisiteError",
        );
        expect(yield* fs.readFileString(statePath)).toBe(before);
        expect(yield* fs.readFileString(plan.unitPath)).toBe(unit);
        expect(commands).not.toContain("systemctl --user stop supaterm.service");
      }),
  );

  it.effect("enables lingering before installing and repairs stopped or disabled services", () =>
    Effect.gen(function* () {
      const { service, commands, control } = yield* makeHarness();
      control.linger = "no";
      yield* service.install();
      expect(control.linger).toBe("yes");
      expect(commands.indexOf("loginctl enable-linger --no-ask-password 501")).toBeLessThan(
        commands.indexOf("systemctl --user daemon-reload"),
      );

      control.enabled = false;
      control.active = false;
      expect(yield* service.status).toMatchObject({
        current: false,
        problems: ["service-disabled", "service-stopped"],
      });
      yield* service.install();
      expect((yield* service.status).current).toBe(true);
    }),
  );

  // regression: #29881
  it.effect.each([
    { logind: "has lingering disabled", linger: "no" },
    { logind: "does not know the user", linger: undefined },
  ])(
    "enables lingering to bring up an unreachable user manager when logind $logind",
    ({ linger }) =>
      Effect.gen(function* () {
        const { service, commands, control } = yield* makeHarness();
        control.linger = linger;
        control.managerReachable = false;

        yield* service.install();

        expect(commands).toContain("loginctl enable-linger --no-ask-password 501");
        expect((yield* service.status).current).toBe(true);
      }),
  );

  it.effect("does not reach a running root user manager under sudo", () =>
    Effect.gen(function* () {
      const { makeService, commands, control } = yield* makeHarness();
      control.busNeedsRuntimeDir = true;
      const service = yield* makeService(undefined, "1.2.3", undefined, false, undefined, true);

      expect(yield* service.install().pipe(Effect.flip)).toMatchObject({
        _tag: "BootServicePrerequisiteError",
        problem: "user-manager-unavailable",
      });
      expect(commands).not.toContain("systemctl --user enable supaterm.service");
    }),
  );

  it.effect("does not enable lingering for root under sudo", () =>
    Effect.gen(function* () {
      const { makeService, commands, control } = yield* makeHarness();
      control.linger = undefined;
      control.managerReachable = false;
      const service = yield* makeService(undefined, "1.2.3", undefined, false, undefined, true);

      expect(yield* service.install().pipe(Effect.flip)).toMatchObject({
        _tag: "BootServicePrerequisiteError",
        problem: "user-manager-unavailable",
      });
      expect(commands.filter((command) => command.includes("enable-linger"))).toEqual([]);
    }),
  );

  // regression: #29881
  it.effect("installs into the unit directory of the user manager that lingering starts", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const shellConfigHome = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-xdg-config-" });
      const { makeService, home, control } = yield* makeHarness(
        "linux",
        undefined,
        shellConfigHome,
        "",
      );
      control.linger = "no";
      control.managerReachable = false;
      const service = yield* makeService();

      const plan = yield* service.install();

      const unitPath = path.join(home, ".config", "systemd", "user", "supaterm.service");
      expect(plan.unitPath).toBe(unitPath);
      expect(yield* service.status).toMatchObject({ current: true, unitPath });
    }),
  );

  // regression: #29881
  it.effect.each([
    { manager: "starts after three probes", upAfterPauses: 3, pauses: 3 },
    { manager: "never starts", upAfterPauses: undefined, pauses: 10 },
  ])(
    "waits a bounded time for the user manager lingering starts when it $manager",
    ({ upAfterPauses, pauses }) =>
      Effect.gen(function* () {
        const { service, fs, control } = yield* makeHarness();
        const { unitPath } = yield* service.status;
        control.linger = "no";
        control.managerReachable = false;
        control.lingerStartsManager = false;
        const clock = yield* Clock.Clock;
        const waited: number[] = [];

        const result = yield* service.install().pipe(
          Effect.provideService(Clock.Clock, {
            ...clock,
            sleep: (duration) =>
              Effect.sync(() => {
                if (waited.push(Duration.toMillis(duration)) === upAfterPauses) {
                  control.managerReachable = true;
                }
              }),
          }),
          Effect.result,
        );

        expect(waited).toEqual(Array.from({ length: pauses }, () => 500));
        if (upAfterPauses === undefined) {
          expect(result).toMatchObject({
            failure: { _tag: "BootServicePrerequisiteError", problem: "user-manager-unavailable" },
          });
          expect(yield* fs.exists(unitPath)).toBe(false);
        } else {
          expect(result._tag).toBe("Success");
          expect((yield* service.status).current).toBe(true);
        }
      }),
  );

  // regression: #29881
  it.effect("points systemd user commands at the user's runtime directory when none is set", () =>
    Effect.gen(function* () {
      const { service, invocations, makeService } = yield* makeHarness();
      yield* service.install();
      const inside = yield* makeService(undefined, "1.2.4", undefined, true);
      yield* inside.install({ allowDowngrade: true });

      const systemdCalls = invocations.filter(({ command }) =>
        ["systemctl", "busctl", "systemd-run", "loginctl"].includes(command),
      );
      expect(new Set(systemdCalls.map(({ command }) => command)).size).toBe(4);
      expect(
        systemdCalls
          .filter(({ env }) => env?.XDG_RUNTIME_DIR !== "/run/user/501")
          .map(({ command, args }) => `${command} ${args.join(" ")}`),
      ).toEqual([]);
    }),
  );

  it.effect.each([
    { command: "systemctl --user show-environment", problem: "user-manager-unavailable" },
    { command: "loginctl show-user 501 --property=Linger --value", problem: "linger-unavailable" },
  ])("reports failed prerequisite probes without installing: $command", ({ command, problem }) =>
    Effect.gen(function* () {
      const { service, fs, statePath, control } = yield* makeHarness();
      control.failCommand = command;
      expect(yield* service.install().pipe(Effect.flip)).toMatchObject({
        _tag: "BootServicePrerequisiteError",
        problem,
      });
      expect(yield* fs.exists(statePath)).toBe(false);
    }),
  );

  it.effect.each(["linux", "darwin"] as const)(
    "preserves the custom install bin directory in the installed service on %s",
    (platform) =>
      Effect.gen(function* () {
        const installBinDir = '/custom/Supaterm\t& <100%>/"quoted"\\bin';
        const { service, makeService, fs } = yield* makeHarness(
          platform,
          "",
          undefined,
          undefined,
          installBinDir,
        );
        const plan = yield* service.install();
        const unit = yield* fs.readFileString(plan.unitPath);
        expect(unit).toContain(
          platform === "linux"
            ? 'Environment=SUPATERM_INSTALL_BIN_DIR="/custom/Supaterm\t& <100%%>/\\"quoted\\"\\\\bin"'
            : '<key>SUPATERM_INSTALL_BIN_DIR</key>\n    <string>/custom/Supaterm\t&amp; &lt;100%&gt;/"quoted"\\bin</string>',
        );
        expect((yield* service.status).current).toBe(true);

        const ordinaryCli = yield* makeService(
          "",
          "1.2.3",
          undefined,
          false,
          undefined,
          false,
          null,
        );
        expect((yield* ordinaryCli.status).current).toBe(true);
        expect((yield* ordinaryCli.install()).installBinDir).toBe(installBinDir);
        expect(yield* fs.readFileString(plan.unitPath)).toBe(unit);

        const updatedCli = yield* makeService(
          "",
          "1.2.4",
          undefined,
          false,
          undefined,
          false,
          null,
        );
        expect((yield* updatedCli.install({ start: false })).installBinDir).toBe(installBinDir);
        expect(yield* fs.readFileString(plan.unitPath)).toBe(unit.replaceAll("1.2.3", "1.2.4"));

        const replacementCli = yield* makeService(
          "",
          "1.2.4",
          undefined,
          false,
          undefined,
          false,
          "/replacement/bin",
        );
        expect((yield* replacementCli.status).current).toBe(false);
        expect((yield* replacementCli.install()).installBinDir).toBe("/replacement/bin");
        const laterCli = yield* makeService("", "1.2.4", undefined, false, undefined, false, "");
        expect((yield* laterCli.status).current).toBe(true);
        expect((yield* laterCli.install()).installBinDir).toBe("/replacement/bin");
      }),
  );

  it.effect.each([
    "unset",
    "empty",
    "relative",
    "relocated",
    "shell-only",
    "manager-only",
    "manager-unavailable",
  ] as const)("installs, discovers, restarts, and uninstalls with $XDG_CONFIG_HOME %s", (setting) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const configRoot = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-xdg-config-" });
      const xdgConfigHome = {
        unset: undefined,
        empty: "",
        relative: "relative-config",
        relocated: path.join(configRoot, "config root"),
        "shell-only": path.join(configRoot, "config root"),
        "manager-only": undefined,
        "manager-unavailable": path.join(configRoot, "config root"),
      }[setting];
      const managerXdgConfigHome =
        setting === "shell-only"
          ? ""
          : setting === "manager-only"
            ? path.join(configRoot, "config root")
            : undefined;
      const { service, makeService, home, statePath, timeouts, runtime, control } =
        yield* makeHarness("linux", undefined, xdgConfigHome, managerXdgConfigHome);
      const unitPath = path.join(
        setting === "relocated" || setting === "manager-only" || setting === "manager-unavailable"
          ? path.join(configRoot, "config root")
          : path.join(home, ".config"),
        "systemd",
        "user",
        "supaterm.service",
      );
      expect(yield* service.status).toMatchObject({ installed: false, unitPath });
      const plan = yield* service.install();
      expect(plan.unitPath).toBe(unitPath);
      if (setting === "manager-unavailable") {
        control.failCommand =
          "busctl --user --json=short get-property org.freedesktop.systemd1 /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager UnitPath";
      }
      const discoveredService = yield* makeService();

      expect(parseServiceState(yield* fs.readFileString(statePath))).toEqual({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.2.3",
      });
      expect(plan.program).toEqual([runtime.entryPath, "__service-launcher"]);
      expect(yield* fs.readFileString(plan.unitPath)).not.toContain("SUPATERM_INSTALL_BIN_DIR");
      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        `ExecStart=${runtime.entryPath} __service-launcher`,
      );
      expect(yield* service.status).toMatchObject({
        current: true,
        installedVersion: "1.2.3",
      });
      expect(yield* discoveredService.status).toMatchObject({
        installed: true,
        current: true,
        unitPath,
      });
      expect(yield* discoveredService.restart).toBe("restarted");
      const pendingState = JSON.stringify({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.2.3",
        update: {
          id: "u",
          fromVersion: "1.2.3",
          targetVersion: "1.2.4",
          dbPath: "/tmp/state.sqlite",
          status: "pending",
        },
      });
      yield* fs.writeFileString(statePath, pendingState);
      expect((yield* service.status).current).toBe(false);
      expect(yield* discoveredService.uninstall).toBe(true);
      expect(yield* fs.exists(unitPath)).toBe(false);
      expect((yield* discoveredService.status).installed).toBe(false);
      // The stop can block up to systemd's 90s TimeoutStopSec; the runner's
      // 60s default would cancel it mid-shutdown.
      expect(timeouts.get("systemctl --user disable --now supaterm.service")).toEqual(
        Duration.seconds(120),
      );
    }),
  );

  it.effect.each(["linux", "darwin"] as const)(
    "reports the installed version across launcher protocols on %s",
    (platform) =>
      Effect.gen(function* () {
        const { service, fs, statePath } = yield* makeHarness(platform);
        yield* service.install();

        for (const protocol of [SERVICE_LAUNCHER_PROTOCOL - 1, SERVICE_LAUNCHER_PROTOCOL + 1]) {
          yield* fs.writeFileString(
            statePath,
            `{"protocol":${protocol},"activeVersion":"1.2.4-nightly.1","update":{"status":"unknown"}}`,
          );
          expect(yield* service.status).toMatchObject({
            current: false,
            installedVersion: "1.2.4-nightly.1",
          });
          yield* service.install({ allowDowngrade: true });
          expect(parseServiceState(yield* fs.readFileString(statePath))).toEqual({
            protocol: SERVICE_LAUNCHER_PROTOCOL,
            activeVersion: "1.2.3",
          });
        }
      }),
  );

  it.effect("reports an unknown version for invalid service state", () =>
    Effect.gen(function* () {
      const { service, fs, statePath } = yield* makeHarness();
      yield* service.install();

      for (const stateText of [
        "{",
        '{"activeVersion":"latest"}',
        '{"activeVersion":"1.2"}',
        '{"activeVersion":123}',
      ]) {
        yield* fs.writeFileString(statePath, stateText);
        const status = yield* service.status;
        expect(status.current).toBe(false);
        expect(status.installedVersion).toBeUndefined();
      }
    }),
  );

  it.effect.each(["linux", "darwin"] as const)(
    "preserves a newer version that finishes updating during stop on %s",
    (platform) =>
      Effect.gen(function* () {
        const { service, fs, statePath, commands, control } = yield* makeHarness(platform);
        const plan = yield* service.install();
        const unit = yield* fs.readFileString(plan.unitPath);
        control.stateAfterStop = `{"protocol":${SERVICE_LAUNCHER_PROTOCOL + 1},"activeVersion":"1.2.4"}`;
        commands.length = 0;

        const error = yield* service.install().pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "BootServiceDowngradeRefusedError",
          installedVersion: "1.2.4",
          targetVersion: "1.2.3",
        });
        expect(yield* fs.readFileString(statePath)).toBe(control.stateAfterStop);
        expect(yield* fs.readFileString(plan.unitPath)).toBe(unit);
        expect(
          commands.filter(
            (command) =>
              command.startsWith(platform === "linux" ? "systemctl " : "launchctl ") &&
              !command.includes("show-environment"),
          ),
        ).toEqual(
          platform === "linux"
            ? [
                "systemctl --user stop supaterm.service",
                "systemctl --user reset-failed supaterm.service",
                "systemctl --user restart supaterm.service",
              ]
            : [
                "launchctl bootout --wait gui/501/com.supaterm.desktop.service",
                `launchctl bootstrap gui/501 ${plan.unitPath}`,
              ],
        );
      }),
  );

  it.effect("allows an explicit downgrade", () =>
    Effect.gen(function* () {
      const { service, fs, statePath } = yield* makeHarness();
      yield* service.install();
      yield* fs.writeFileString(
        statePath,
        `{"protocol":${SERVICE_LAUNCHER_PROTOCOL},"activeVersion":"1.2.4"}`,
      );

      yield* service.install({ allowDowngrade: true });

      expect(parseServiceState(yield* fs.readFileString(statePath))?.activeVersion).toBe("1.2.3");
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("repairs versions with equal SemVer precedence without an override", () =>
    Effect.gen(function* () {
      const { service, fs, statePath } = yield* makeHarness();
      yield* service.install();
      yield* fs.writeFileString(
        statePath,
        `{"protocol":${SERVICE_LAUNCHER_PROTOCOL},"activeVersion":"1.2.3+previous-build"}`,
      );

      yield* service.install();

      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect.each(["linux", "darwin"] as const)(
    "install with start=false rewrites files, preserves service.env, and marks a restart pending on %s",
    (platform) =>
      Effect.gen(function* () {
        const { service, fs, baseDir, statePath, commands, makeService } =
          yield* makeHarness(platform);
        const path = yield* Path.Path;
        const envPath = path.join(baseDir, SERVICE_ENV_FILE);
        const envBytes = new TextEncoder().encode(
          '# user configuration\r\nSUPATERM_TOKEN="literal $HOME # token"',
        );
        yield* fs.writeFile(envPath, envBytes);
        yield* service.install();
        expect(new Uint8Array(yield* fs.readFile(envPath))).toEqual(envBytes);
        yield* service.install();
        expect(new Uint8Array(yield* fs.readFile(envPath))).toEqual(envBytes);
        commands.length = 0;

        const newer = yield* makeService(undefined, "1.2.4");
        const plan = yield* newer.install({ start: false });
        expect(new Uint8Array(yield* fs.readFile(envPath))).toEqual(envBytes);

        expect(parseServiceState(yield* fs.readFileString(statePath))).toEqual({
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.2.4",
        });
        expect(yield* fs.readFileString(plan.unitPath)).toContain("versions/1.2.4/supaterm");
        expect(
          commands.filter(
            (command) =>
              /^(systemctl|launchctl) /.test(command) && !command.includes("show-environment"),
          ),
        ).toEqual([]);
        const status = yield* newer.status;
        expect(status.current).toBe(false);
        expect(status.problems).toContain("restart-pending");

        commands.length = 0;
        expect(yield* newer.restart).toBe("restarted");
        expect((yield* newer.status).problems).not.toContain("restart-pending");
        expect((yield* newer.status).current).toBe(true);

        const latest = yield* makeService(undefined, "1.2.5");
        yield* latest.install({ start: true });
        expect(parseServiceState(yield* fs.readFileString(statePath))).toEqual({
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.2.5",
        });
        expect(yield* fs.readFileString(plan.unitPath)).toContain("versions/1.2.5/supaterm");
        expect((yield* latest.status).current).toBe(true);
        expect(
          yield* fs.exists(path.join(path.dirname(statePath), SERVICE_RESTART_PENDING_FILE)),
        ).toBe(false);
      }),
  );

  it.effect(
    "serializes a local install with another process reconciling an older unit snapshot",
    () =>
      Effect.gen(function* () {
        const { service, fs, statePath, makeService, runtime } = yield* makeHarness();
        const path = yield* Path.Path;
        const plan = yield* service.install();
        const unit = yield* fs.readFileString(plan.unitPath);
        yield* fs.writeFileString(
          plan.unitPath,
          unit.replace("versions/1.2.3/supaterm", "versions/1.2.2/supaterm"),
        );
        yield* fs.writeFileString(
          statePath,
          JSON.stringify({
            protocol: SERVICE_LAUNCHER_PROTOCOL,
            activeVersion: "1.2.3",
            update: {
              id: "committed",
              fromVersion: "1.2.2",
              targetVersion: "1.2.3",
              status: "committed",
            },
          }),
        );
        const rejection = path.join(plan.baseDir, "rejected-update");
        const databasePath = path.join(plan.baseDir, "state.sqlite");
        yield* fs.writeFileString(databasePath, "database");
        yield* fs.writeFileString(
          runtime.entryPath,
          `#!${process.execPath}
import { writeFileSync } from "node:fs";
process.on("message", message => {
  if (message === "request-update") process.send({ type: "request-update", targetVersion: "1.2.5", dbPath: ${JSON.stringify(databasePath)} });
  if (message.type === "update-rejected") {
    writeFileSync(${JSON.stringify(rejection)}, message.reason);
    process.exit(0);
  }
});
`,
        );
        yield* fs.chmod(runtime.entryPath, 0o755);
        const newer = yield* makeService(undefined, "1.2.4");
        yield* makeService(undefined, "1.2.5");
        const snapshot = Promise.withResolvers<void>();
        const milestone = Promise.withResolvers<void>();
        const script = path.join(plan.baseDir, "launcher-contention.mjs");
        yield* fs.writeFileString(
          script,
          `
import fs from "node:fs/promises";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const server = Promise.withResolvers();
const originalSpawn = cp.spawn;
cp.spawn = (...args) => { const child = originalSpawn(...args); server.resolve(child); return child; };
process.on("message", async message => {
  if (message === "installed") (await server.promise).send("request-update");
});
const originalRead = fs.readFile;
fs.readFile = async (...args) => {
  const contents = await originalRead(...args);
  if (args[0] === ${JSON.stringify(plan.unitPath)}) {
    fs.readFile = originalRead;
    syncBuiltinESMExports();
    const resume = new Promise(resolve => process.once("message", resolve));
    process.send("snapshot");
    await resume;
  }
  return contents;
};
syncBuiltinESMExports();
const { Launcher, readServiceState } = await import(${JSON.stringify(import.meta.resolve("../serviceLauncher.ts"))});
const launcher = new Launcher(${JSON.stringify(plan.baseDir)}, await readServiceState(${JSON.stringify(statePath)}), {
  serviceUnit: { path: ${JSON.stringify(plan.unitPath)}, reload: async () => {} },
});
try { await launcher.run(); throw Error("unexpected completion"); }
catch (error) {
  if (!error.message.includes("Active child exited unexpectedly (0)")) throw error;
}
const { acquireServiceSelectionLock } = await import(${JSON.stringify(import.meta.resolve("./serviceSelectionLock.ts"))});
// Exit owning the real lease, as a crashed process would.
await acquireServiceSelectionLock(${JSON.stringify(plan.unitPath)});
process.disconnect();
`,
        );
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            NodeChildProcess.fork(script, [], {
              execArgv: [],
              stdio: ["ignore", "inherit", "inherit", "ipc"],
            }),
          ),
          (child) =>
            Effect.sync(() => {
              if (child.exitCode === null && child.signalCode === null) child.kill();
            }),
        );
        const exited = new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code) =>
            code === 0 ? resolve() : reject(new Error(`launcher exited ${code}`)),
          );
        });
        child.on("message", (message) => {
          if (message === "snapshot") snapshot.resolve();
        });
        yield* Effect.promise(() =>
          Promise.race([
            snapshot.promise,
            exited.then(() => {
              throw new Error("launcher exited before snapshot");
            }),
          ]),
        );
        leaseObserver.contended = (destination) => {
          if (destination === plan.unitPath + ".selection-lock") milestone.resolve();
        };
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            leaseObserver.contended = () => {};
          }),
        );
        const installing = yield* newer
          .install({ start: false })
          .pipe(Effect.ensuring(Effect.sync(() => milestone.resolve())), Effect.forkChild);
        // Resume the launcher once the installer contends for the unit lease, or once an
        // uncoordinated installer has finished, which makes the stale snapshot win.
        yield* Effect.promise(() => milestone.promise);
        child.send("resume");
        yield* Fiber.join(installing);
        child.send("installed");
        yield* Effect.promise(() => exited);
        expect(yield* fs.readFileString(rejection)).toContain("Service selection changed");
        expect(parseServiceState(yield* fs.readFileString(statePath))).toEqual({
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.2.4",
        });
        expect(yield* fs.readFileString(plan.unitPath)).toContain("versions/1.2.4/supaterm");
        expect(
          yield* fs.readFileString(
            path.join(path.dirname(statePath), SERVICE_RESTART_PENDING_FILE),
          ),
        ).toBe("1.2.4\n");
        // The next installer reclaims the dead owner and releases its own lease.
        yield* newer.install({ start: false });
        expect(yield* fs.exists(plan.unitPath + ".selection-lock")).toBe(false);
      }),
  );

  it.effect("install with start=false keeps the marker when a later write fails", () =>
    Effect.gen(function* () {
      const { service, fs, statePath, makeService } = yield* makeHarness();
      const path = yield* Path.Path;
      yield* service.install();
      const newer = yield* makeService(undefined, "1.2.4");
      const unitPath = (yield* service.status).unitPath;
      yield* fs.remove(unitPath);
      yield* fs.makeDirectory(unitPath);
      yield* fs.writeFileString(path.join(unitPath, "occupied"), "");

      const error = yield* newer.install({ start: false }).pipe(Effect.flip);
      expect(error._tag).toBe("BootServiceInstallError");
      expect(
        yield* fs.exists(path.join(path.dirname(statePath), SERVICE_RESTART_PENDING_FILE)),
      ).toBe(true);
    }),
  );

  it.effect("install with start=false refuses while a remote update is pending", () =>
    Effect.gen(function* () {
      const { service, fs, statePath } = yield* makeHarness();
      yield* service.install();
      const pendingState = JSON.stringify({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.2.3",
        update: {
          id: "u",
          fromVersion: "1.2.3",
          targetVersion: "1.2.4",
          dbPath: "/tmp/state.sqlite",
          status: "pending",
        },
      });
      yield* fs.writeFileString(statePath, pendingState);

      const error = yield* service.install({ start: false }).pipe(Effect.flip);
      expect(error._tag).toBe("BootServiceUpdatePendingError");
      expect(yield* fs.readFileString(statePath)).toBe(pendingState);
      yield* fs.remove((yield* service.status).unitPath);
      expect((yield* service.install({ start: false }).pipe(Effect.flip))._tag).toBe(
        "BootServiceUpdatePendingError",
      );
      expect(yield* fs.readFileString(statePath)).toBe(pendingState);
    }),
  );

  it.effect("pauses only this home's running service for maintenance, even when it fails", () =>
    Effect.gen(function* () {
      const { service, commands, control, makeService } = yield* makeHarness();
      yield* service.install();
      const failure = yield* service
        .withStopped(
          Effect.suspend(() => Effect.fail(control.active ? "running" : "repair failed")),
        )
        .pipe(Effect.flip);
      expect(failure).toBe("repair failed");
      expect(control.active).toBe(true);

      // A failed stop skips the operation but still starts the service again.
      control.failCommand = "systemctl --user stop supaterm.service";
      let ran = false;
      const stopFailure = yield* service
        .withStopped(
          Effect.sync(() => {
            ran = true;
          }),
        )
        .pipe(Effect.flip);
      expect(stopFailure).toMatchObject({
        _tag: "BootServiceCommandError",
        step: "stopping the installed service",
      });
      expect(ran).toBe(false);
      expect(control.active).toBe(true);
      control.failCommand = undefined;

      // An enabled unit that is not active (crash-looping in auto-restart, say)
      // is still stopped for the repair and started again afterwards.
      control.active = false;
      commands.length = 0;
      yield* service.withStopped(Effect.sync(() => commands.push("repair")));
      expect(commands).toEqual([
        "systemctl --user is-enabled supaterm.service",
        "systemctl --user is-active supaterm.service",
        "systemctl --user stop supaterm.service",
        "repair",
        "systemctl --user reset-failed supaterm.service",
        "systemctl --user restart supaterm.service",
      ]);
      expect(control.active).toBe(true);
      // A running unit the user disabled is started again but stays disabled.
      control.enabled = false;
      yield* service.withStopped(Effect.void);
      expect(control).toMatchObject({ active: true, enabled: false });
      // A unit that was neither enabled nor active stays stopped.
      control.active = false;
      control.enabled = false;
      commands.length = 0;
      yield* service.withStopped(Effect.sync(() => commands.push("repair")));
      expect(commands).toContain("systemctl --user stop supaterm.service");
      expect(commands).not.toContain("systemctl --user restart supaterm.service");
      expect(control.active).toBe(false);
      control.enabled = true;
      control.active = true;

      const fs = yield* FileSystem.FileSystem;
      const otherHome = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-doctor-other-" });
      const other = yield* makeService(undefined, "1.2.3", otherHome);
      commands.length = 0;
      expect(yield* other.withStopped(Effect.sync(() => control.active))).toBe(true);
      expect(commands).toEqual([]);
    }),
  );

  it.effect("restart and install leave a service that serves another Supaterm home alone", () =>
    Effect.gen(function* () {
      const { service, fs, baseDir, commands, makeService } = yield* makeHarness();
      const plan = yield* service.install();
      const unit = yield* fs.readFileString(plan.unitPath);
      const path = yield* Path.Path;
      const otherHome = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-other-home-" });

      const other = yield* makeService(undefined, "1.2.3", path.join(otherHome, ".supaterm"));
      commands.length = 0;
      expect(yield* other.restart).toBe("skipped");
      const refused = yield* other.install().pipe(Effect.flip);
      expect(refused._tag).toBe("BootServiceOtherBaseDirError");
      // The CLI prints a user message without a stack trace.
      expect(CliError.getUserMessage(refused)).toBe(refused.message);
      expect(yield* fs.readFileString(plan.unitPath)).toBe(unit);
      expect(commands).toEqual([]);
      expect((yield* other.status).otherBaseDir).toBe(baseDir);

      const quoted = yield* makeService(
        undefined,
        "1.2.3",
        path.join(otherHome, 'Supaterm "Data"'),
      );
      commands.length = 0;
      const unloadable = yield* quoted.install().pipe(Effect.flip);
      expect(unloadable._tag).toBe("BootServiceBaseDirUnsupportedError");
      expect(CliError.getUserMessage(unloadable)).toBe(unloadable.message);
      expect(yield* fs.readFileString(plan.unitPath)).toBe(unit);
      expect(commands).toEqual([]);
    }),
  );

  it.effect("hands the whole install to systemd without changing the running service", () =>
    Effect.gen(function* () {
      const { fs, commands, invocations, control, makeService } = yield* makeHarness();
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-handoff-" });
      const baseDir = path.join(home, "Supaterm Data 100%", "${UNSET}", "$literal");
      const outside = yield* makeService(undefined, "1.2.3", baseDir);
      const plan = yield* outside.install();
      const statePath = path.join(baseDir, "runtime", "service-state.json");
      const state = yield* fs.readFileString(statePath);
      const unit = yield* fs.readFileString(plan.unitPath);
      const inside = yield* makeService(undefined, "1.2.4", baseDir, true);
      commands.length = 0;
      invocations.length = 0;

      const result = yield* inside.install({ allowDowngrade: true });

      expect(yield* fs.readFileString(statePath)).toBe(state);
      expect(yield* fs.readFileString(plan.unitPath)).toBe(unit);
      expect(commands).not.toContain("systemctl --user stop supaterm.service");
      expect(result).toMatchObject({ handedOff: true, logPath: plan.logPath });
      const handoffs = invocations.filter(({ command }) => command === "systemd-run");
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0]?.args).toEqual([
        "--user",
        "--collect",
        "--quiet",
        `--property=StandardOutput=append:${plan.logPath}`,
        `--property=StandardError=append:${plan.logPath}`,
        "--setenv=SUPATERM_BOOT_SERVICE_UNIT=",
        pinnedRuntimePaths(path, baseDir, "1.2.4", "linux").entryPath,
        "service",
        "install",
        "--base-dir",
        path.join(home, "Supaterm Data 100%", "$${UNSET}", "$$literal"),
        "--allow-downgrade",
      ]);

      const handoff = handoffs[0]!;
      control.failCommand = `${handoff.command} ${handoff.args.join(" ")}`;
      const error = yield* inside.install({ allowDowngrade: true }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "BootServiceCommandError", exitCode: 1 });
      expect(yield* fs.readFileString(statePath)).toBe(state);
      expect(yield* fs.readFileString(plan.unitPath)).toBe(unit);
      expect(control.active).toBe(true);
      expect(commands).not.toContain("systemctl --user stop supaterm.service");
    }),
  );

  it.effect(
    "queues an in-service restart without stopping the caller, even on handoff failure",
    () =>
      Effect.gen(function* () {
        const { service, fs, statePath, commands, control, makeService } = yield* makeHarness();
        const plan = yield* service.install();
        const state = yield* fs.readFileString(statePath);
        const marker = `${plan.baseDir}/runtime/${SERVICE_RESTART_PENDING_FILE}`;
        yield* fs.writeFileString(marker, "1.2.3\n");
        const inside = yield* makeService(undefined, "1.2.3", undefined, true);
        commands.length = 0;
        control.failCommand = "systemctl --user daemon-reload";

        const error = yield* inside.restart.pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "BootServiceCommandError", exitCode: 1 });
        expect(commands).toEqual(["systemctl --user daemon-reload"]);
        expect(control.active).toBe(true);

        control.failCommand = undefined;
        commands.length = 0;
        const outcome = yield* inside.restart;
        expect(commands).toEqual([
          "systemctl --user daemon-reload",
          "systemctl --user enable supaterm.service",
          "systemctl --user reset-failed supaterm.service",
          "systemctl --user restart --no-block supaterm.service",
        ]);
        expect(outcome).toBe("queued");
        expect(yield* fs.readFileString(statePath)).toBe(state);
        expect(yield* fs.readFileString(marker)).toBe("1.2.3\n");
      }),
  );

  // regression: #36319
  it.effect("starts a service whose systemd start limit tripped after repairing it", () =>
    Effect.gen(function* () {
      const { service, control, makeService } = yield* makeHarness();
      yield* service.install();
      control.active = false;
      control.startLimitHit = true;

      yield* service.install();
      expect(control.active).toBe(true);

      control.active = false;
      control.startLimitHit = true;
      const inside = yield* makeService(undefined, "1.2.3", undefined, true);
      expect(yield* inside.restart).toBe("queued");
      expect(control.active).toBe(true);
    }),
  );

  it.effect("restarts an installed service when repair fails", () =>
    Effect.gen(function* () {
      const { service, commands, control } = yield* makeHarness();
      yield* service.install();
      commands.length = 0;
      control.failCommand = "systemctl --user daemon-reload";

      const error = yield* service.install().pipe(Effect.flip);
      expect(error._tag).toBe("BootServiceCommandError");
      expect(
        commands.filter(
          (command) => command.startsWith("systemctl ") && !command.includes("show-environment"),
        ),
      ).toEqual([
        "systemctl --user stop supaterm.service",
        "systemctl --user daemon-reload",
        "systemctl --user reset-failed supaterm.service",
        "systemctl --user restart supaterm.service",
      ]);
    }),
  );

  it.effect("restarts without overwriting a pending remote update", () =>
    Effect.gen(function* () {
      const { service, fs, statePath, commands } = yield* makeHarness();
      yield* service.install();
      const pendingState = JSON.stringify({
        protocol: SERVICE_LAUNCHER_PROTOCOL - 1,
        activeVersion: "1.2.3",
        update: {
          id: "remote-update",
          fromVersion: "1.2.3",
          targetVersion: "1.2.4",
          status: "pending",
        },
      });
      yield* fs.writeFileString(statePath, pendingState);
      for (const allowDowngrade of [false, true]) {
        commands.length = 0;

        expect((yield* service.install({ allowDowngrade }).pipe(Effect.flip))._tag).toBe(
          "BootServiceUpdatePendingError",
        );
        expect(serviceStateHasPendingUpdate(yield* fs.readFileString(statePath))).toBe(true);
        expect(
          commands.filter(
            (command) => command.startsWith("systemctl ") && !command.includes("show-environment"),
          ),
        ).toEqual([
          "systemctl --user stop supaterm.service",
          "systemctl --user reset-failed supaterm.service",
          "systemctl --user restart supaterm.service",
        ]);
      }
    }),
  );

  it.effect("installs, reports current state, and uninstalls on macOS", () =>
    Effect.gen(function* () {
      const { service, fs, statePath, commands, timeouts, runtime } = yield* makeHarness("darwin");
      const path = yield* Path.Path;
      const plan = yield* service.install();

      expect(
        plan.unitPath.endsWith(
          path.join("Library", "LaunchAgents", "com.supaterm.desktop.service.plist"),
        ),
      ).toBe(true);
      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        `    <key>PATH</key>\n    <string>${macInstallerPath}:/usr/local/bin:/usr/sbin:/sbin</string>`,
      );
      expect(parseServiceState(yield* fs.readFileString(statePath))).toEqual({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.2.3",
      });
      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        `    <string>${runtime.entryPath}</string>\n    <string>__service-launcher</string>`,
      );
      expect(yield* service.status).toMatchObject({
        current: true,
        installedVersion: "1.2.3",
      });
      expect(yield* service.uninstall).toBe(true);
      expect((yield* service.status).installed).toBe(false);
      expect(commands.some((command) => command.startsWith("systemctl "))).toBe(false);
      // A bootout can block up to the plist's 90s ExitTimeOut; the runner's
      // 60s default would cancel it and let bootstrap race a loaded job.
      expect(timeouts.get("launchctl bootout --wait gui/501/com.supaterm.desktop.service")).toEqual(
        Duration.seconds(120),
      );
    }),
  );

  it.effect("reconstructs a launch agent search path when the installer has no PATH", () =>
    Effect.gen(function* () {
      const { service, fs } = yield* makeHarness("darwin", "");
      const plan = yield* service.install();

      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        "    <key>PATH</key>\n    <string>/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/sbin:/sbin</string>",
      );
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("adds missing provider directories to a minimal installer PATH", () =>
    Effect.gen(function* () {
      const { service, fs } = yield* makeHarness("darwin", "/usr/bin:/bin");
      const plan = yield* service.install();

      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        "    <key>PATH</key>\n    <string>/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/sbin</string>",
      );
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("keeps an installed launch agent current when the process PATH changes", () =>
    Effect.gen(function* () {
      const { service, makeService } = yield* makeHarness("darwin");
      yield* service.install();

      const restartedService = yield* makeService("/usr/local/bin:/usr/bin:/bin");
      expect((yield* restartedService.status).current).toBe(true);
    }),
  );

  // regression: #17532
  it.effect("puts the runtime an update installs on the launch agent PATH", () =>
    Effect.gen(function* () {
      const { makeService, fs, baseDir, runtime } = yield* makeHarness("darwin");
      const path = yield* Path.Path;
      const previous = runtime.versionDir;
      const installed = pinnedRuntimePaths(path, baseDir, "1.2.4", "darwin").versionDir;
      // The 1.2.3 CLI, or the 1.2.3 service's own PATH, installs 1.2.4.
      const updated = yield* makeService(
        `/usr/bin:${previous}:/bin`,
        "1.2.4",
        undefined,
        false,
        runtime.entryPath,
      );
      const plan = yield* updated.install();

      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        `    <key>PATH</key>\n    <string>/usr/bin:${installed}:/bin:/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/sbin</string>`,
      );
    }),
  );

  it.effect("drops PATH directories that cannot be represented in a launch agent plist", () =>
    Effect.gen(function* () {
      const { service, fs } = yield* makeHarness(
        "darwin",
        "/opt/homebrew/bin:/Users/theo/\u0001invalid:/usr/bin",
      );
      const plan = yield* service.install();
      const plist = yield* fs.readFileString(plan.unitPath);

      expect(plist).toContain(
        "    <key>PATH</key>\n    <string>/opt/homebrew/bin:/usr/bin:/usr/local/bin:/bin:/usr/sbin:/sbin</string>",
      );
      expect(plist).not.toContain("\u0001");
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("ignores a bootout for an agent that is not loaded", () =>
    Effect.gen(function* () {
      const { service, control } = yield* makeHarness("darwin");
      yield* service.install();
      control.failCommand = "launchctl bootout --wait gui/501/com.supaterm.desktop.service";

      yield* service.install();
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("keeps failed launch agent installs pending until activation succeeds", () =>
    Effect.gen(function* () {
      const { service, fs, statePath, commands, control } = yield* makeHarness("darwin");
      const path = yield* Path.Path;
      const plan = yield* service.install();
      const markerPath = path.join(path.dirname(statePath), SERVICE_RESTART_PENDING_FILE);
      const bootstrap = `launchctl bootstrap gui/501 ${plan.unitPath}`;
      control.failCommand = bootstrap;

      expect((yield* service.install().pipe(Effect.flip))._tag).toBe("BootServiceCommandError");
      expect(yield* service.status).toMatchObject({
        current: false,
        problems: ["restart-pending"],
      });
      expect(yield* fs.readFileString(markerPath)).toBe("1.2.3\n");

      control.failCommand = undefined;
      commands.length = 0;
      yield* service.install();

      expect(commands).toContain(bootstrap);
      expect(yield* fs.exists(markerPath)).toBe(false);
      expect((yield* service.status).current).toBe(true);
    }),
  );
});
