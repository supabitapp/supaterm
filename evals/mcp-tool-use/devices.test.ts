// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeZlib from "node:zlib";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AGENT_DEVICE_SHELL,
  agentDeviceSessionError,
  agentDeviceSessions,
  describeSessions,
  deviceFailure,
  type LauncherTarget,
  launcherHelp,
  makeDeviceTools,
  type ShellCall,
} from "./devices.ts";
import { buildBase } from "./claude.ts";
import { buildMessages, cannedOutput, makeSample, shellRequest, withDevices } from "./world.ts";
import { McpToolUseCase } from "./types.ts";
import { supatermSubagentContext, supatermSystemAppend } from "./prompts.ts";
import { DeviceOperationError, LOCAL_DEVICE_HOST_ID } from "@supaterm/contracts";

const MAC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IPHONE = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
const world = {
  devices: [
    {
      hostId: MAC,
      id: IPHONE,
      name: "Acme iPhone",
      platform: "ios",
      version: "iOS 26.0",
      booted: true,
      physical: false,
    },
  ],
  deviceHosts: { [MAC]: "build-mac" },
};
const screenshotFailure = {
  _tag: "DeviceOperationError",
  operation: "screenshot",
  reason: "request_failed",
  cause: null,
};
const decodeCase = Schema.decodeUnknownSync(McpToolUseCase);
const deviceCase = (setup: object) =>
  decodeCase({
    id: "device-case",
    area: "device-manager",
    kind: "guard",
    pattern: "device",
    experience: "A device case.",
    setup: { role: "top", world, ...setup },
    prompt: "Show a fresh screenshot of the iPhone on build-mac.",
    expect: {},
  });
const capture = JSON.parse(
  NodeZlib.gunzipSync(
    NodeFS.readFileSync(new URL("./templates/claude.json.gz", import.meta.url)),
  ).toString(),
).request.provider_native;
const model = "claude-opus-5-5";
const base = buildBase(capture, { model, keepUserInstructions: false });
const json = (text: string) => JSON.parse(text);

it.effect("answers device calls with Supaterm's handlers over the case's world", () =>
  Effect.gen(function* () {
    const { devices, deviceHosts } = deviceCase({}).setup.world ?? {};
    const tools = yield* makeDeviceTools({ devices: devices ?? [], deviceHosts }, base.environment);
    const listed = json((yield* tools.call("device_list", {})).text);
    assert.deepEqual(listed.devices, world.devices);
    assert.deepEqual(
      listed.hosts.map((host: { label: string }) => host.label),
      ["This machine", "build-mac"],
    );
    const opened = json((yield* tools.call("device_open", { hostId: MAC, deviceId: IPHONE })).text);
    const { command } = opened.agentDevice;
    assert.match(command, /^\/home\/user\/\.supaterm\/userdata\/device\/.+\/agent-device$/);
    assert.include(opened.quickStart, command);
    assert.deepEqual(tools.launchers, [command]);

    assert.deepEqual(json((yield* tools.call("device_screenshot", {})).text).screenshot, {
      mimeType: "image/png",
      width: 1206,
      height: 2622,
    });
    const failed = yield* tools.call("device_screenshot", {}, deviceFailure(screenshotFailure));
    assert.isTrue(failed.isError);
    assert.include(failed.text, "screenshot failed");
    const elsewhere = yield* tools.call("device_open", { hostId: "local", deviceId: IPHONE });
    assert.isTrue(elsewhere.isError);
    assert.include(elsewhere.text, IPHONE);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("lists the boot state Supaterm left a device in", () =>
  Effect.gen(function* () {
    const { devices, deviceHosts } = deviceCase({}).setup.world ?? {};
    const stopped = (devices ?? []).map((device) => ({ ...device, booted: false }));
    const tools = yield* makeDeviceTools({ devices: stopped, deviceHosts }, base.environment);
    const before = json((yield* tools.call("device_list", {})).text);
    assert.isFalse(before.devices.find((d: { id: string }) => d.id === IPHONE).booted);
    yield* tools.call("device_open", { hostId: MAC, deviceId: IPHONE });
    const after = json((yield* tools.call("device_list", {})).text);
    assert.isTrue(after.devices.find((d: { id: string }) => d.id === IPHONE).booted);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("decodes only Supaterm device errors as injected failures", () => {
  assert.isDefined(deviceFailure(screenshotFailure));
  assert.isUndefined(deviceFailure({ error: "Synthetic hub is unavailable", isError: true }));
  assert.isUndefined(deviceFailure("default"));
});

it.effect(
  "rebuilds prior device results with Supaterm, whose sessions reach the measured turn",
  () =>
    Effect.gen(function* () {
      const testCase = deviceCase({
        priorTurns: [
          { role: "user", text: "Show me Settings on the iPhone on build-mac." },
          {
            role: "assistant",
            toolCalls: [
              { tool: "device_list", input: {}, result: "default" },
              { tool: "device_open", input: { hostId: MAC, deviceId: IPHONE }, result: "default" },
            ],
          },
        ],
        mocks: { device_screenshot: screenshotFailure },
      });
      const sample = makeSample(testCase, base);
      assert.throws(() => buildMessages(sample), /run withDevices/);
      yield* withDevices(sample);
      const shown = JSON.stringify(buildMessages(sample));
      const [launcher = ""] = sample.devices?.launchers ?? [];
      assert.include(shown, launcher);
      assert.notInclude(shown, `"content":"default"`);
      const tools = sample.devices!;
      assert.isFalse((yield* tools.call("device_screenshot", {})).isError);
      const mock = deviceFailure(testCase.setup.mocks?.device_screenshot);
      assert.isTrue((yield* tools.call("device_screenshot", {}, mock)).isError);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "gives a native subagent Supaterm's SubagentStart context instead of Supaterm's append",
  () =>
    Effect.gen(function* () {
      const subagentContext = yield* Effect.promise(() => supatermSubagentContext(model));
      const native = {
        ...buildBase(capture, { model, keepUserInstructions: false, nativeSubagent: true }),
        subagentContext,
      };
      const system = (blocks: typeof base.system) =>
        blocks.map((block) => String(block.text)).join("");
      assert.include(system(base.system), supatermSystemAppend(model));
      assert.notInclude(system(native.system), supatermSystemAppend(model));
      const testCase = deviceCase({ role: "native-subagent" });
      const shown = (sample: typeof native) =>
        buildMessages(makeSample(testCase, sample))[0]?.content.map((block) => String(block.text));
      const reminders = shown(native)?.join("\n") ?? "";

      assert.equal(
        reminders.includes("SubagentStart hook additional context"),
        subagentContext !== "",
      );
      assert.include(reminders, subagentContext);

      const blocks = shown({ ...native, subagentContext: "## Supaterm devices" }) ?? [];
      assert.equal(blocks.at(-2), testCase.prompt);
      assert.equal(
        blocks.at(-1),
        "<system-reminder>\nSubagentStart hook additional context: ## Supaterm devices\n</system-reminder>",
      );
    }),
);

it.effect(
  "tells the shell simulator the launchers Supaterm returned and agent-device's real CLI",
  () =>
    Effect.gen(function* () {
      const sample = makeSample(deviceCase({}), base);
      yield* withDevices(sample);
      const call = { tool: "Bash", input: { command: "ls /tmp" } };
      const told = (request: ReturnType<typeof shellRequest>) => JSON.stringify(request.messages);
      assert.notInclude(
        told(shellRequest(sample, call, "claude-haiku-5-5")),
        "launchers Supaterm's",
      );
      const opened = yield* sample.devices!.call("device_open", { hostId: MAC, deviceId: IPHONE });
      const { command } = json(opened.text).agentDevice;
      const request = shellRequest(sample, call, "claude-haiku-5-5");
      assert.include(
        told(request),
        `agent-device launchers Supaterm's device_open returned: ${command}`,
      );

      assert.include(request.system, AGENT_DEVICE_SHELL);
      assert.include(
        request.system,
        "agent-device record start [path] [--scope <app|device|system>]",
      );
      assert.include(request.system, "| record stop |");
      assert.include(request.system, "Unknown flag: --stop. Did you mean --scope?");

      const plain = makeSample(deviceCase({ world: {} }), base);
      assert.notInclude(shellRequest(plain, call, "claude-haiku-5-5").system, "agent-device");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("prints agent-device's own help for a lone help command on a returned launcher", () => {
  const help = (topic: string) =>
    AGENT_DEVICE_SHELL.split(`$ agent-device help${topic ? ` ${topic}` : ""}\n`)[1]
      ?.split("\n$ agent-device help")[0]
      ?.trimEnd();

  const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
  const target = `--platform ios --udid ${IPHONE} --config /home/user/.supaterm/userdata/device/hosts/303617b9730210ef3c86c52d.json --session supaterm-4c43aa31e607633b85e9ff2f`;
  const asked = (command: string) => launcherHelp([launcher], command);
  assert.match(help("") ?? "", /^agent-device <command> \[args\] \[--json\]\n/);
  assert.equal(asked(`${launcher} help ${target}`), help(""));
  assert.equal(asked(`${launcher} record --help ${target}`), help("record"));
  assert.equal(asked(`${launcher} help open ${target}`), help("open"));
  assert.equal(asked(`${launcher} --help 2>&1`), help(""));
  assert.equal(asked(`${launcher} help settings --session=supaterm-1`), help("settings"));

  assert.isUndefined(asked(`${launcher} metro --help ${target}`));
  assert.isUndefined(asked(`${launcher} help record 2>&1 | head -40`));
  assert.isUndefined(asked(`AD=${launcher}; $AD help record`));
  assert.isUndefined(asked(`${launcher} snapshot -i ${target}`));
  assert.isUndefined(asked(`/usr/local/bin/agent-device help`));
});

it("pins agent-device's help to the version Supaterm installs", () => {
  const versions = JSON.parse(
    NodeFS.readFileSync(
      new URL("../../apps/server/src/device/deviceToolVersions.json", import.meta.url),
      "utf8",
    ),
  );
  assert.include(AGENT_DEVICE_SHELL, `agent-device ${versions["agent-device"]} prints this help`);
});

const NO_SESSION =
  "Error (SESSION_NOT_FOUND): No active session. Run open first.\nHint: Run open first or pass an explicit device selector.";
const APP_RECORDING_BEFORE_OPEN =
  "Error (INVALID_ARGS): record start with app scope and an explicit session requires an active app session; run open <app> first, or use --scope device to record the full screen\nHint: Check command arguments and run --help for usage examples.";

const iosSnapshotRefused = (session: string) =>
  `Error (SESSION_NOT_FOUND): iOS snapshot requires an active app session on the target device. Run open first (for example: open --session ${session} --platform ios --device "<name>" <app>).\nHint: Run open first or pass an explicit device selector.`;
const APP_RECORDING_WITHOUT_APP =
  "Error (UNKNOWN): App-scoped recording requires an active app session; open the app under test before recording.\nHint: Unexpected internal error. Retry with --debug and report the diagnostics log if it persists.";

it.effect("answers the returned launcher as agent-device does before and after open", () =>
  Effect.gen(function* () {
    const { devices = [], deviceHosts } = deviceCase({}).setup.world ?? {};
    const tools = yield* makeDeviceTools({ devices, deviceHosts }, base.environment);
    const opened = json((yield* tools.call("device_open", { hostId: MAC, deviceId: IPHONE })).text);
    const { command, targetArgs, session: bound } = opened.agentDevice;

    const session: string = bound ?? targetArgs[targetArgs.indexOf("--session") + 1];
    const line = (args: string) =>
      bound === undefined ? `${command} ${args} ${targetArgs.join(" ")}` : `${command} ${args}`;
    const history: Array<ShellCall> = [];
    const answer = (args: string) => tools.sessionError(history, line(args));
    const ran = (args: string, output: string) =>
      history.push({ tool: "Bash", input: { command: line(args) }, output });

    const shot = answer("screenshot /tmp/shot.png") ?? "";
    assert.isTrue(shot.startsWith(`Exit code 1\n${NO_SESSION}\nDiagnostic ID: `));
    assert.match(
      shot,
      new RegExp(
        `\\nDiagnostics Log: /home/user/\\.agent-device/remote-diagnostics/${session}/requests/[\\da-f]{16}\\.ndjson$`,
      ),
    );
    for (const args of ["press @e3 --settle", 'fill @e5 "hello world"', "scroll down", "home"]) {
      assert.include(answer(args), NO_SESSION, args);
    }
    assert.include(answer("record start /tmp/run.mp4"), APP_RECORDING_BEFORE_OPEN);

    assert.include(answer("snapshot -i"), iosSnapshotRefused("sim"));

    for (const args of [
      "open",
      "devices",
      "apps",
      "settings appearance dark",
      "alert accept",
      "install com.acme.app /tmp/Acme.app",
      "record start --scope device /tmp/run.mp4",
    ]) {
      assert.isUndefined(answer(args), args);
    }

    assert.isUndefined(answer("screenshot --bogus /tmp/shot.png"));
    assert.isUndefined(answer("screenshot --json /tmp/shot.png"));
    assert.isUndefined(tools.sessionError(history, `${line("screenshot /tmp/a.png")} && echo ok`));
    assert.deepEqual([...tools.sessions(history)], [[session, undefined]]);

    ran("open com.acme.missing", "Exit code 1\nError (APP_NOT_INSTALLED): App not installed");
    assert.include(answer("screenshot /tmp/shot.png"), NO_SESSION);
    ran("open", `Opened: ${session}`);
    assert.isUndefined(answer("screenshot /tmp/shot.png"));
    assert.isUndefined(answer("press @e3"));
    assert.include(answer("record start /tmp/run.mp4"), APP_RECORDING_WITHOUT_APP);
    assert.isUndefined(answer("record start --scope device /tmp/run.mp4"));
    assert.include(answer("snapshot -i"), iosSnapshotRefused(session));
    ran("open com.acme.app", "Opened: com.acme.app");
    assert.isUndefined(answer("record start /tmp/run.mp4"));
    assert.isUndefined(answer("snapshot -i"));
    assert.deepEqual([...tools.sessions(history)], [[session, { app: true }]]);
    ran("close", "Closed");
    assert.include(
      tools.sessionError(history, `${line("screenshot /tmp/a.png")} 2>&1`),
      NO_SESSION,
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const shared = (session: string): LauncherTarget => ({
  command: "/home/user/.supaterm/userdata/device/bin/agent-device",
  session,
  bound: false,
  deviceId: IPHONE,
  ios: true,
  iosSimulator: true,
});
const boundTarget: LauncherTarget = {
  command: "/home/user/.supaterm/userdata/device/targets/supaterm-bound/agent-device",
  session: "supaterm-bound",
  bound: true,
  deviceId: IPHONE,
  ios: true,
  iosSimulator: true,
};
const bash = (command: string, output = "OK"): ShellCall => ({
  tool: "Bash",
  input: { command },
  output,
});
const errorCode = (
  targets: ReadonlyArray<LauncherTarget>,
  history: ReadonlyArray<ShellCall>,
  command: string,
) => agentDeviceSessionError(targets, agentDeviceSessions(targets, {}, history), command)?.code;

it("names the session on either ref: the bound launcher's own, or the shared one's --session", () => {
  const flags = `--platform ios --udid ${IPHONE} --config /home/user/.supaterm/userdata/device/hosts/x.json`;
  const sharedTargets = [shared("supaterm-a"), shared("supaterm-b")];

  const opened = [
    bash(`${sharedTargets[0]!.command} open com.acme.app ${flags} --session supaterm-a`),
  ];
  assert.isUndefined(
    errorCode(
      sharedTargets,
      opened,
      `${sharedTargets[0]!.command} screenshot ${flags} --session supaterm-a`,
    ),
  );
  assert.equal(
    errorCode(
      sharedTargets,
      opened,
      `${sharedTargets[0]!.command} screenshot ${flags} --session=supaterm-b`,
    ),
    "SESSION_NOT_FOUND",
  );
  assert.isUndefined(errorCode(sharedTargets, [], `${sharedTargets[0]!.command} screenshot`));

  assert.equal(
    errorCode([boundTarget], [], `${boundTarget.command} screenshot`),
    "SESSION_NOT_FOUND",
  );
  assert.equal(errorCode([boundTarget], [], `${boundTarget.command} record start`), "INVALID_ARGS");
  const boundOpen = [bash(`${boundTarget.command} open`)];
  assert.isUndefined(errorCode([boundTarget], boundOpen, `${boundTarget.command} screenshot`));
  assert.equal(
    errorCode([boundTarget], boundOpen, `${boundTarget.command} record start /tmp/r.mp4`),
    "UNKNOWN",
  );
  assert.equal(
    errorCode([boundTarget], boundOpen, `${boundTarget.command} screenshot --session other`),
    "SESSION_NOT_FOUND",
  );

  assert.isUndefined(
    errorCode(sharedTargets, [], `${sharedTargets[0]!.command} record start --session supaterm-a`),
  );
});

it("follows the session through aliases, compound calls, snapshots and whole-screen recordings", () => {
  const launcher = boundTarget.command;
  const after = (...history: ReadonlyArray<ShellCall>) =>
    agentDeviceSessions([boundTarget], {}, history).get("supaterm-bound");
  assert.deepEqual(after(bash(`AD=${launcher}; "$AD" open com.acme.app`)), { app: true });

  assert.isUndefined(after(bash(`${launcher} open com.acme.app`, "Exit code 1\nError (X): no")));
  assert.deepEqual(
    after(bash(`${launcher} open com.acme.app && ${launcher} press @e9`, "Exit code 1\nboom")),
    { app: true },
  );

  assert.isUndefined(after(bash(`false && ${launcher} open`, "Exit code 1")));
  assert.isUndefined(after(bash("ssh build-mac agent-device open com.acme.app")));
  assert.isUndefined(after(bash(`${launcher} help open`)));

  assert.isUndefined(after(bash(`${launcher} snapshot -i`)));
  const android = { ...boundTarget, ios: false, iosSimulator: false };
  assert.deepEqual(
    agentDeviceSessions([android], {}, [bash(`${launcher} snapshot -i`)]).get("supaterm-bound"),
    { app: false },
  );

  const recording = bash(`${launcher} record start --scope device /tmp/r.mp4`);
  assert.deepEqual(after(recording), { app: false, recordingOnly: true });
  assert.isUndefined(errorCode([boundTarget], [recording], `${launcher} screenshot`));
  assert.isUndefined(after(recording, bash(`${launcher} record stop`)));
  assert.equal(
    errorCode(
      [boundTarget],
      [recording, bash(`${launcher} record stop`)],
      `${launcher} screenshot`,
    ),
    "SESSION_NOT_FOUND",
  );
  assert.deepEqual(after(bash(`${launcher} open`), bash(`${launcher} close`)), undefined);
});

it("follows the shared launcher's session through flags held in a variable or an array", () => {
  const target = shared("supaterm-a");
  const flags = `--platform ios --udid ${IPHONE} --config /home/user/.supaterm/userdata/device/hosts/x.json --session supaterm-a`;
  const after = (history: ShellCall, targets = [target]) =>
    agentDeviceSessions(targets, {}, [history]).get("supaterm-a");
  const opened = bash(
    `AD=${target.command}; A="${flags}"; $AD open com.acme.app $A 2>&1 | tail -5; sleep 5; $AD snapshot -i $A 2>&1 | head -60`,
    "Opened: com.acme.app",
  );
  assert.deepEqual(after(opened), { app: true });
  const array = bash(`A=(${flags}); ${target.command} open "\${A[@]}" 2>&1 | head -60`);
  assert.deepEqual(after(array), { app: false });

  assert.isUndefined(after(array, [target, shared("supaterm-b")]));

  const failed = bash(
    `AD=${target.command}; A="${flags}"; $AD open $A`,
    "Exit code 1\nError (X): no",
  );
  assert.equal(
    errorCode([target], [failed], `${target.command} screenshot ${flags}`),
    "SESSION_NOT_FOUND",
  );
});

it.effect("starts sessions the world says prior turns opened, and rejects unknown devices", () =>
  Effect.gen(function* () {
    const testCase = deviceCase({
      world: { ...world, agentDeviceSessions: { [IPHONE]: { app: "com.acme.app" } } },
      priorTurns: [
        { role: "user", text: "Show me Settings on the iPhone on build-mac." },
        {
          role: "assistant",
          toolCalls: [
            { tool: "device_open", input: { hostId: MAC, deviceId: IPHONE }, result: "default" },
          ],
        },
      ],
    });
    const sample = makeSample(testCase, base);
    yield* withDevices(sample);
    const tools = sample.devices!;
    const [launcher = ""] = tools.launchers;
    assert.deepEqual([...tools.sessions(sample.shell).values()], [{ app: true }]);
    const call = { tool: "Bash", input: { command: "ls" } };
    assert.include(
      JSON.stringify(shellRequest(sample, call, "claude-haiku-5-5").messages),
      "is open with an app",
    );
    assert.isUndefined(tools.sessionError(sample.shell, `${launcher} record start /tmp/r.mp4`));
    const { devices = [], deviceHosts } = testCase.setup.world ?? {};
    const unknown = { devices, deviceHosts, agentDeviceSessions: { "not-a-device": {} } };
    const exit = yield* Effect.exit(makeDeviceTools(unknown, base.environment));
    assert.isTrue(exit._tag === "Failure");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "answers a shell mock first, then help, then the session error, before the simulator",
  () =>
    Effect.gen(function* () {
      const sample = makeSample(deviceCase({}), base);
      yield* withDevices(sample);
      const opened = yield* sample.devices!.call("device_open", { hostId: MAC, deviceId: IPHONE });
      const { command, targetArgs, session } = json(opened.text).agentDevice;
      const flags = session === undefined ? ` ${targetArgs.join(" ")}` : "";
      const told = () =>
        JSON.stringify(
          shellRequest(sample, { tool: "Bash", input: {} }, "claude-haiku-5-5").messages,
        );
      assert.include(told(), "has not started");
      assert.include(cannedOutput(sample, `${command} screenshot /tmp/a.png${flags}`), NO_SESSION);
      assert.match(cannedOutput(sample, `${command} help record`) ?? "", /^Usage:/);
      assert.isUndefined(cannedOutput(sample, `${command} open com.acme.app${flags}`));
      const outage = makeSample(
        deviceCase({
          shellMocks: [
            { match: "\\bagent-device\\b", output: "Exit code 1\nError (COMMAND_FAILED): down" },
          ],
        }),
        base,
      );
      yield* withDevices(outage);
      yield* outage.devices!.call("device_open", { hostId: MAC, deviceId: IPHONE });
      assert.include(cannedOutput(outage, `${command} screenshot /tmp/a.png${flags}`), "down");
      sample.shell.push({
        tool: "Bash",
        input: { command: `${command} open com.acme.app${flags}` },
        output: "Opened: com.acme.app",
      });
      assert.isUndefined(cannedOutput(sample, `${command} screenshot /tmp/a.png${flags}`));
      assert.include(told(), "is open with an app");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("keeps a redirection's descriptor out of the app an open names, on either launcher", () => {
  const flags = `--platform ios --udid ${IPHONE} --config /home/user/.supaterm/userdata/device/hosts/x.json --session supaterm-a`;
  for (const [target, args] of [
    [shared("supaterm-a"), ` ${flags}`],
    [boundTarget, ""],
  ] as const) {
    for (const redirect of ["2>&1", "2>&1 | tail -5", "2>/dev/null"]) {
      const opened = [
        bash(`${target.command} open${args} ${redirect}`, `Opened: ${target.session}`),
      ];
      assert.deepEqual(
        agentDeviceSessions([target], {}, opened).get(target.session),
        { app: false },
        redirect,
      );
      assert.equal(
        errorCode([target], opened, `${target.command} record start /tmp/run.mp4${args}`),
        "UNKNOWN",
        redirect,
      );
    }
  }
});

it("follows opens the parser cannot prove ran, in calls that did not fail", () => {
  const launcher = boundTarget.command;
  const after = (command: string, output = "Opened: com.acme.app") =>
    agentDeviceSessions([boundTarget], {}, [bash(command, output)]).get("supaterm-bound");
  assert.deepEqual(
    after(`mkdir -p /tmp/p && ${launcher} open com.acme.app 2>&1 | tail -3; echo done`),
    { app: true },
  );
  assert.deepEqual(after(`cd /tmp && ${launcher} open com.acme.app; ${launcher} snapshot -i`), {
    app: true,
  });

  assert.deepEqual(after(`mkdir -p /tmp/p && AD=${launcher}; $AD open com.acme.app`), {
    app: true,
  });
  assert.deepEqual(after(`mkdir -p /tmp/p && AD="${launcher}"; "\${AD}" open com.acme.app`), {
    app: true,
  });
  assert.deepEqual(
    agentDeviceSessions([boundTarget], {}, [
      bash(`cd /tmp && AD=${launcher}; echo ready`),
      bash("$AD open com.acme.app"),
    ]).get("supaterm-bound"),
    { app: true },
  );

  assert.isUndefined(
    after(`mkdir -p /tmp/p && ${launcher} open com.acme.app; echo done`, "Exit code 1\nno"),
  );
  assert.isUndefined(
    after(`mkdir -p /tmp/p && AD=${launcher}; $AD open com.acme.app`, "Exit code 1\nno"),
  );
});

const SPARE_MAC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SPARE_PHONE = "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD";
const twoMacs = {
  devices: [
    ...world.devices,
    { ...world.devices[0]!, hostId: SPARE_MAC, id: SPARE_PHONE, name: "Acme Spare iPhone" },
  ],
  deviceHosts: { ...world.deviceHosts, [SPARE_MAC]: "spare-mac" },
};
const deviceTools = (extra: object) =>
  makeDeviceTools(
    { ...twoMacs, ...extra } as Parameters<typeof makeDeviceTools>[0],
    base.environment,
  );

it.effect(
  "lists a host whose discovery fails as Supaterm does: failed, with none of its devices",
  () =>
    Effect.gen(function* () {
      const failure = new DeviceOperationError({
        operation: "list",
        reason: "request_failed",
        cause: null,
      });
      const tools = yield* deviceTools({ deviceDiscoveryFailures: { [MAC]: failure } });
      const listed = json((yield* tools.call("device_list", {})).text);
      assert.deepEqual(listed.hostStatuses[MAC], {
        status: "failed",
        detail:
          "Device list failed: Could not communicate with device support. Try refreshing devices.",
      });
      assert.equal(listed.hostStatuses[SPARE_MAC].status, "ready");
      assert.deepEqual(
        listed.devices.map((device: { id: string }) => device.id),
        [SPARE_PHONE],
      );
      const opened = yield* tools.call("device_open", { hostId: MAC, deviceId: IPHONE });
      assert.isTrue(opened.isError);
      assert.include(opened.text, IPHONE);
      assert.isFalse(
        (yield* tools.call("device_open", { hostId: SPARE_MAC, deviceId: SPARE_PHONE })).isError,
      );

      const unlabeled = yield* Effect.exit(
        deviceTools({
          deviceDiscoveryFailures: { "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": failure },
        }),
      );
      assert.isTrue(unlabeled._tag === "Failure");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "denies every device tool with Supaterm's own error when agent device access is off",
  () =>
    Effect.gen(function* () {
      const tools = yield* deviceTools({ deviceAgentAccess: false });
      for (const [name, input] of [
        ["device_list", {}],
        ["device_open", { hostId: MAC, deviceId: IPHONE }],
        ["device_screenshot", {}],
        ["device_close", {}],
      ] as const) {
        const result = yield* tools.call(name, input);
        assert.isTrue(result.isError, name);

        const denied = result.text.startsWith(
          "Agent device access is turned off for this environment.",
        );
        assert.isTrue(
          denied || (name === "device_screenshot" && result.text === "Device screenshot failed."),
          `${name}: ${result.text}`,
        );
      }

      assert.notInclude(supatermSystemAppend(model, false), "## Supaterm devices");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reports an unreadable capture as Supaterm does: a successful 0×0 screenshot", () =>
  Effect.gen(function* () {
    const tools = yield* deviceTools({ deviceInvalidCapture: true });
    yield* tools.call("device_open", { hostId: MAC, deviceId: IPHONE });
    const shot = yield* tools.call("device_screenshot", {});
    assert.isFalse(shot.isError);
    assert.deepEqual(json(shot.text).screenshot, { mimeType: "image/png", width: 0, height: 0 });
    const sample = makeSample(
      deviceCase({ world: { ...world, deviceInvalidCapture: true } }),
      base,
    );
    yield* withDevices(sample);
    const told = JSON.stringify(shellRequest(sample, { tool: "Bash", input: {} }, model).messages);
    assert.include(told, "agent-device's own screenshot finds the PNG and is unaffected");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refuses an open on a device another thread's agent-device session holds", () =>
  Effect.gen(function* () {
    const tools = yield* deviceTools({ deviceOwners: { [IPHONE]: "acme-design-review" } });

    const owner = "supaterm-a062c547ef0b6bf8ee839b67";
    assert.deepEqual(tools.owners, [
      { deviceId: IPHONE, threadId: "acme-design-review", session: owner },
    ]);

    const opened = json((yield* tools.call("device_open", { hostId: MAC, deviceId: IPHONE })).text);
    assert.deepEqual(json((yield* tools.call("device_list", {})).text).open, [
      { hostId: MAC, deviceId: IPHONE },
    ]);
    const { command, targetArgs, session: bound } = opened.agentDevice;
    const own: string = bound ?? targetArgs[targetArgs.indexOf("--session") + 1];
    const target = (session = own) =>
      bound === undefined
        ? targetArgs.map((arg: string) => (arg === own ? session : arg)).join(" ")
        : session === own
          ? ""
          : `--session ${session}`;
    const line = (args: string, session?: string) => `${command} ${args} ${target(session)}`.trim();
    const history: Array<ShellCall> = [];
    const answer = (args: string, session?: string) =>
      tools.sessionError(history, line(args, session)) ?? "";
    const inUse = `Error (DEVICE_IN_USE): Device is already in use by session "${owner}".\nHint: Run agent-device session list to inspect active sessions. To reuse this device, rerun the command with --session ${owner}. To open a new session on this device, first run agent-device close --session ${owner}.`;
    assert.include(
      answer("open com.acme.app"),
      `${inUse} To wait for the device to free up, run the same open with --wait <ms>.\nDiagnostic ID: `,
    );
    assert.include(
      answer("open --wait 5000"),
      `Error (DEVICE_IN_USE): Device is already in use by session "${owner}".\nHint: Waited 5000ms for this device and it stayed busy. Run agent-device session list`,
    );
    assert.notInclude(answer("open --wait 5000"), "--wait <ms>");

    assert.equal(answer("screenshot /tmp/a.png", owner), "");
    assert.equal(answer("open com.acme.app", owner), "");

    history.push({
      tool: "Bash",
      input: { command: `${line("open com.acme.app")} && ${line("screenshot /tmp/a.png")}` },
      output: "Exit code 1\nError (DEVICE_IN_USE): Device is already in use",
    });
    assert.deepEqual(
      [...tools.sessions(history)],
      [
        [own, undefined],
        [owner, { app: true }],
      ],
    );
    const sample = makeSample(
      deviceCase({ world: { ...twoMacs, deviceOwners: { [IPHONE]: "acme-design-review" } } }),
      base,
    );
    yield* withDevices(sample);
    const told = JSON.stringify(shellRequest(sample, { tool: "Bash", input: {} }, model).messages);
    assert.include(
      told,
      `${owner} (Acme iPhone, ${IPHONE}, on build-mac) belongs to another Supaterm thread (acme-design-review)`,
    );

    history.push({ tool: "Bash", input: { command: line("close", owner) }, output: "Closed" });
    assert.equal(answer("open com.acme.app"), "");
    assert.include(describeSessions(tools.sessions(history), tools.owners), "was closed");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("leaves a free device free when another thread holds a different one", () =>
  Effect.gen(function* () {
    const tools = yield* deviceTools({ deviceOwners: { [IPHONE]: "acme-design-review" } });
    const opened = json(
      (yield* tools.call("device_open", { hostId: SPARE_MAC, deviceId: SPARE_PHONE })).text,
    );
    const { command, targetArgs, session } = opened.agentDevice;
    const flags = session === undefined ? ` ${targetArgs.join(" ")}` : "";
    assert.isUndefined(tools.sessionError([], `${command} open com.acme.app${flags}`));
    assert.include(
      tools.sessionError([], `${command} screenshot /tmp/a.png${flags}`) ?? "",
      "SESSION_NOT_FOUND",
    );

    assert.isFalse(
      (yield* tools.call("device_list", {})).text.includes(`"hostId":"${LOCAL_DEVICE_HOST_ID}"`),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

type Opened = { command: string; targetArgs: Array<string>; session?: string };

const commandLine = (opened: Opened, args: string, session?: string) => {
  const own = opened.session ?? opened.targetArgs[opened.targetArgs.indexOf("--session") + 1];
  if (opened.session !== undefined)
    return `${opened.command} ${args}${session === undefined ? "" : ` --session ${session}`}`;
  const flags = opened.targetArgs.map((arg) => (arg === own && session ? session : arg));
  return `${opened.command} ${args} ${flags.join(" ")}`;
};

it.effect(
  "tells the simulator each launcher's device, and routes DEVICE_IN_USE to the held one",
  () =>
    Effect.gen(function* () {
      const owner = "supaterm-a062c547ef0b6bf8ee839b67";
      const sample = makeSample(
        deviceCase({ world: { ...twoMacs, deviceOwners: { [IPHONE]: "acme-design-review" } } }),
        base,
      );
      yield* withDevices(sample);
      const tools = sample.devices!;
      const open = (hostId: string, deviceId: string) =>
        Effect.map(
          tools.call("device_open", { hostId, deviceId }),
          (result): Opened => json(result.text).agentDevice,
        );
      const held = yield* open(MAC, IPHONE);
      const spare = yield* open(SPARE_MAC, SPARE_PHONE);
      const session = (opened: Opened) =>
        opened.session ?? opened.targetArgs[opened.targetArgs.indexOf("--session") + 1];
      const told = (command: string) =>
        String(
          shellRequest(sample, { tool: "Bash", input: { command } }, model).messages[0]?.content[0]
            ?.text,
        );

      const heldOpen = commandLine(held, "open com.acme.app --metro-port 8095");
      const refused = cannedOutput(sample, heldOpen) ?? "";
      assert.include(
        refused,
        `Error (DEVICE_IN_USE): Device is already in use by session "${owner}".`,
      );
      sample.shell.push({ tool: "Bash", input: { command: heldOpen }, output: refused });

      const spareOpen = commandLine(spare, "open com.acme.app --metro-port 8095");
      assert.isUndefined(cannedOutput(sample, spareOpen));
      const free = told(spareOpen);
      assert.include(
        free,
        `agent-device launchers Supaterm's device_open returned: ${
          held.session === undefined
            ? `${held.command} (shared: each command's --udid or --serial and --session name its device and session)`
            : `${held.command} (drives Acme iPhone, ${IPHONE}, on build-mac, in session ${held.session}); ${spare.command} (drives Acme Spare iPhone, ${SPARE_PHONE}, on spare-mac, in session ${spare.session})`
        }`,
      );
      assert.include(
        free,
        `${session(held)} (Acme iPhone, ${IPHONE}, on build-mac) has not started; ${session(spare)} (Acme Spare iPhone, ${SPARE_PHONE}, on spare-mac) has not started; ${owner} (Acme iPhone, ${IPHONE}, on build-mac) belongs to another Supaterm thread (acme-design-review) and holds its device with an app open.`,
      );
      assert.include(
        free,
        `In the new call, \`${spareOpen}\` drives Acme Spare iPhone, ${SPARE_PHONE}, on spare-mac, which no other session holds: it prints no DEVICE_IN_USE.`,
      );
      assert.notInclude(free, "Error (DEVICE_IN_USE)");

      const piped = commandLine(held, "open com.acme.app");
      const refusal = told(`${piped} 2>&1 | tail -5`);
      assert.include(
        refusal,
        `In the new call, \`${piped}\` drives Acme iPhone, ${IPHONE}, on build-mac, which session ${owner} holds: it fails with exit code 1, printing "Error (DEVICE_IN_USE): Device is already in use by session "${owner}"." and "Hint: Run agent-device session list to inspect active sessions. To reuse this device,`,
      );
      assert.notInclude(refusal, "no other session holds");

      const alias =
        spare.session === undefined
          ? `A=${spare.command}; "$A" open com.acme.app ${spare.targetArgs.join(" ")}`
          : `A=${spare.command}; "$A" open com.acme.app`;
      const both = told(`${piped} || echo busy; ${alias}`);
      assert.include(both, `which session ${owner} holds: it fails with exit code 1`);
      assert.include(
        both,
        `on spare-mac, which no other session holds: it prints no DEVICE_IN_USE`,
      );

      assert.notInclude(told(commandLine(held, "open com.acme.app", owner)), "In the new call");

      const reopen = told(`${commandLine(held, "close", owner)}; ${piped}`);
      assert.include(
        reopen,
        `\`${piped}\` drives Acme iPhone, ${IPHONE}, on build-mac, which no other session holds: it prints no DEVICE_IN_USE`,
      );
      assert.notInclude(reopen, `which session ${owner} holds`);

      assert.notInclude(
        told(`${commandLine(spare, "screenshot /tmp/a.png")} && echo ok`),
        "In the new call",
      );

      const alone = makeSample(deviceCase({}), base);
      yield* withDevices(alone);
      const own: Opened = json(
        (yield* alone.devices!.call("device_open", { hostId: MAC, deviceId: IPHONE })).text,
      ).agentDevice;
      const request = shellRequest(
        alone,
        { tool: "Bash", input: { command: `${commandLine(own, "open com.acme.app")} | tail -3` } },
        model,
      );
      assert.notInclude(JSON.stringify(request.messages), "In the new call");
      assert.include(
        JSON.stringify(request.messages),
        `${session(own)} (Acme iPhone, ${IPHONE}, on build-mac) has not started`,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("tells the simulator 0.21.31's --foreground and session list behaviour", () => {
  assert.include(
    AGENT_DEVICE_SHELL,
    "open --foreground with no app or URL fails with exit code 1 when the command passes --udid or --device",
  );
  assert.include(AGENT_DEVICE_SHELL, "open <app> --foreground works.");

  assert.include(
    AGENT_DEVICE_SHELL,
    "session list prints, as JSON, the started sessions on the launcher's host, other threads' too",
  );

  for (const args of ["open com.acme.app --foreground", "session list"]) {
    assert.isUndefined(
      agentDeviceSessionError(
        [boundTarget],
        new Map([["supaterm-bound", undefined]]),
        `${boundTarget.command} ${args}`,
      ),
      args,
    );
  }
});
