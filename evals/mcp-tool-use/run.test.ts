import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";
import { ComposerContextId, EnvironmentId, ThreadId } from "@supaterm/contracts";
import { projectComposerContextForProvider } from "@supaterm/shared/composerContextReferences";
import { buildBase } from "./claude.ts";
import {
  buildMessages,
  makeSample,
  mockOutput,
  shellOutput,
  shellRequest,
  withDevices,
} from "./world.ts";
import { failedEarly, gradeSample } from "./grade.ts";
import { ranCalls } from "./protocol.ts";
import { type McpToolUseCase, type SampleRun } from "./types.ts";
import { supatermSystemAppend, supatermSubagentContext } from "./prompts.ts";
import { taskPrompt } from "../../apps/server/src/mcp/delegatedTaskModes.ts";
import { deviceCases, fleetTrace, failed } from "./test-fixtures.ts";

const template = {
  system: [
    { type: "text", text: "x-anthropic-billing-header: cc_version=1;" },
    { type: "text", text: "You are Claude Code." },
  ],
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\n# currentDate\n</system-reminder>" },
        { type: "text", text: "<system-reminder>\n# gitStatus\nmain\n</system-reminder>" },
        {
          type: "text",
          text: "<system-reminder>\nCodebase and user instructions are shown below.\n</system-reminder>",
        },
        { type: "text", text: "The captured prompt." },
      ],
    },
    {
      role: "system",
      content:
        "Main prompt.\n - Primary working directory: /home/alice/app\n\n<runtime_info>old</runtime_info>\n\n## Supaterm orchestration\nold text",
    },
    {
      role: "system",
      content:
        "You are powered by the model named Opus 5.5. The exact model ID is claude-opus-5-5.\n\nThe following deferred tools are now available via ToolSearch. Load them first:\nMonitor\nmcp__supaterm__retired_tool\n\nAfter the list.",
    },
    { role: "assistant", content: [{ type: "text", text: "A later turn." }] },
  ],
  tools: [
    { name: "mcp__host__term_Bash", input_schema: { type: "object" } },
    { name: "mcp__host__clown_ToolSearch", input_schema: { type: "object" } },
    { name: "mcp__supaterm__retired_tool", input_schema: { type: "object" }, defer_loading: true },
  ],
};

const childCase: McpToolUseCase = {
  id: "child-links-its-pr",
  area: "pull-requests",
  kind: "guard",
  pattern: "delegated child watches PR",
  experience: "A delegated child must link its PR and report back, not watch it.",
  setup: {
    role: "delegated-child",
    delegateRole: "implementation",
    world: { branch: "fix/date-format", files: { "src/date.ts": "export const format = 1;\n" } },
    priorTurns: [
      {
        role: "assistant",
        toolCalls: [{ tool: "Bash", input: { command: "git push" }, result: "pushed" }],
      },
    ],
    shellMocks: [{ match: "^gh pr create", output: "https://github.com/acme/app/pull/124" }],
  },
  prompt: "Push the fix, open a PR against main, and report the PR URL.",
  expect: { calls: [{ tool: "link_pull_request" }], notCalls: ["watch_pull_request"] },
};

it("rebuilds the template from this checkout and sends a child Supaterm's task prompt", () => {
  const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
  const system = base.system.map((block) => String(block.text));
  assert.deepEqual(system.slice(0, 2), [
    "You are Claude Code.",
    `Main prompt.\n - Primary working directory: /home/user/app\n\n${supatermSystemAppend("claude-sonnet-5-5")}`,
  ]);

  assert.include(supatermSystemAppend("claude-sonnet-5-5"), "## Supaterm devices");
  assert.equal(base.environment.cwd, "/home/user/app");
  assert.include(system[2], "model named Sonnet 5.5. The exact model ID is claude-sonnet-5-5.");
  const deferred = system[2]?.split("Load them first:\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
  assert.includeMembers(deferred, ["Monitor", "mcp__supaterm__delegate_task"]);
  assert.notInclude(deferred, "mcp__supaterm__retired_tool");

  assert.include(deferred, "mcp__supaterm__watch_pull_request");
  const child = buildBase(template, {
    model: "claude-sonnet-5-5",
    keepUserInstructions: false,
    subagent: true,
  });
  assert.notInclude(String(child.system[2]?.text), "mcp__supaterm__watch_pull_request");
  assert.notInclude(
    child.supaterm.map((tool) => tool.name),
    "mcp__supaterm__unwatch_pull_request",
  );
  const reminders = buildMessages(makeSample(childCase, base))[0]?.content.map((b) => b.text);
  assert.equal(reminders?.[0], "<system-reminder>\n# currentDate\n</system-reminder>");
  assert.include(reminders?.[1], "Current branch: fix/date-format");
  assert.notInclude(reminders?.join(), "Codebase and user instructions");

  const prompt = buildMessages(makeSample(childCase, base)).at(-1)?.content.at(-1);
  assert.equal(prompt?.text, taskPrompt({ task: childCase.prompt, role: "implementation" }));
  assert.notEqual(prompt?.text, childCase.prompt);
});

it("lists link tools only while a case turns the beta on, and sends chips as Supaterm projects them", () => {
  const off = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
  const on = buildBase(template, {
    model: "claude-sonnet-5-5",
    keepUserInstructions: false,
    links: true,
  });
  assert.notInclude(
    off.supaterm.map((tool) => tool.name),
    "mcp__supaterm__supaterm_environment_link",
  );
  assert.include(
    on.supaterm.map((tool) => tool.name),
    "mcp__supaterm__supaterm_environment_link",
  );

  const testCase: McpToolUseCase = {
    ...childCase,
    setup: { role: "top", linkedEnvironments: true },
    prompt: "Continue [Deploy](supaterm-context://v1/thread/thread_deploy)",
    promptContext: {
      records: [
        {
          version: 1,
          kind: "thread",
          contextId: ComposerContextId.make("thread_deploy"),
          label: "Deploy",
          environmentId: EnvironmentId.make("environment-vps"),
          threadId: ThreadId.make("thread-deploy"),
          title: "Deploy",
        },
      ],
    },
  };
  const prompt = buildMessages(makeSample(testCase, on)).at(-1)?.content.at(-1);
  assert.equal(
    prompt?.text,
    projectComposerContextForProvider({ text: testCase.prompt, ...testCase.promptContext! }),
  );
  assert.include(prompt?.text, "environmentId: environment-vps");
});

it("replays earlier capability results with the model under test as the caller", () => {
  const base = buildBase(template, { model: "claude-opus-5-5", keepUserInstructions: false });
  const capabilities = {
    inheritedProviderInstanceId: "claudeAgent",
    inheritedModel: "claude-sonnet-5-5",
  };
  const testCase: McpToolUseCase = {
    ...childCase,
    setup: {
      role: "top",
      priorTurns: [
        {
          role: "assistant",
          toolCalls: [{ tool: "orchestrator_capabilities", input: {}, result: capabilities }],
        },
      ],
    },
  };
  const replayed = buildMessages(makeSample(testCase, base))
    .flatMap((message) => message.content)
    .find((block) => block.type === "tool_result" && String(block.content).includes("inherited"));
  assert.include(String(replayed?.content), '"inheritedModel":"claude-opus-5-5"');
});

it("does not record a deferred tool called before it was loaded", () => {
  const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
  const sample = makeSample(childCase, base);
  const use = (name: string) => ({ type: "tool_use" as const, id: name, name, input: {} });
  const ran = ranCalls(sample, 0, [
    use("mcp__supaterm__link_pull_request"),
    use("mcp__host__term_Bash"),
  ]);
  assert.deepEqual(
    ran.map((call) => call.tool),
    ["Bash"],
  );
});

it("answers simple mocked commands itself and gives the simulator the sample's history", () => {
  const sample = makeSample(
    childCase,
    buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false }),
  );
  assert.equal(mockOutput(sample, "gh pr create --fill"), "https://github.com/acme/app/pull/124");
  assert.isUndefined(mockOutput(sample, "git push && gh pr create --fill"));
  assert.isUndefined(mockOutput(sample, "git status"));

  const call = { tool: "Bash", input: { command: "git push && gh pr create --fill" } };
  const [machine, history] =
    shellRequest(sample, call, "claude-haiku-5-5").messages[0]?.content ?? [];
  assert.include(machine?.text, "Working directory: /home/user/app");
  assert.include(machine?.text, '"src/date.ts":"export const format = 1;\\n"');
  assert.include(machine?.text, "^gh pr create");
  assert.include(machine?.text, childCase.prompt);
  assert.equal(
    history?.text,
    '<call>Bash {"command":"git push"}</call>\n<output>\npushed\n</output>\n\nNew call:\n<call>Bash {"command":"git push && gh pr create --fill"}</call>',
  );
});

it("links a PR a shell command created, as Supaterm does, but not one it only read", () => {
  const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
  const bash = (command: string, result: string) => ({ tool: "Bash", input: { command }, result });
  const sample = makeSample(
    {
      ...childCase,
      setup: {
        ...childCase.setup,
        priorTurns: [
          {
            role: "assistant",
            toolCalls: [
              bash("gh pr create --fill", "https://github.com/acme/app/pull/124"),
              bash("gh pr view 123 --json url -q .url", "https://github.com/acme/app/pull/123"),
            ],
          },
        ],
      },
    },
    base,
  );
  assert.deepEqual([...sample.linked], ["https://github.com/acme/app/pull/124"]);
});

it("reads the tool output from the simulator's JSON reply", () => {
  const reply = (value: string) => [{ type: "thinking" }, { type: "text", text: value }];
  assert.equal(
    shellOutput(reply('{"facts":"PR 124 is new","output":"https://x/pull/124\\n"}')),
    "https://x/pull/124",
  );
  assert.equal(shellOutput(reply("plain output\n")), "plain output");
});

it.effect("builds device cases from product-backed worlds and synthetic prior turns", () =>
  Effect.gen(function* () {
    const cases = deviceCases();
    assert.equal(new Set(cases.map((c) => c.id)).size, 16);
    const base = buildBase(
      {
        ...template,
        tools: [...template.tools, { name: "Read", input_schema: { type: "object" } }],
      },
      { model: "claude-sonnet-5-5", keepUserInstructions: false },
    );
    for (const testCase of cases) {
      const sample = makeSample(testCase, base);
      yield* withDevices(sample);
      assert.doesNotThrow(() => buildMessages(sample));
      assert.isDefined(testCase.setup.world?.devices);
      assert.isUndefined(testCase.source?.openOn);

      assert.deepEqual(
        [...(sample.devices?.sessions(sample.shell).values() ?? [])],
        ["FAIL-AFTER-hub", "OWN-01", "OWN-02", "OWN-03"].includes(testCase.id)
          ? [{ app: true }]
          : [],
        testCase.id,
      );
    }
    const native = cases.find((c) => c.id === "NAT-01")!;
    assert.equal(native.kind, "bad");
    assert.equal(native.setup.harness, "claude");
    assert.isNotEmpty(cases.find((c) => c.id === "SEED-01")!.setup.priorTurns!);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("gives native children hook context while excluding the parent's Supaterm append and history", async () => {
  const testCase = deviceCases().find((c) => c.id === "NAT-01")!;
  assert.isEmpty(testCase.setup.priorTurns ?? []);
  const child = buildBase(template, {
    model: "claude-sonnet-5-5",
    keepUserInstructions: false,
    nativeSubagent: true,
  });
  assert.notInclude(
    child.system.map((block) => block.text).join("\n"),
    supatermSystemAppend("claude-sonnet-5-5"),
  );
  const subagentContext = await supatermSubagentContext("claude-sonnet-5-5");
  const messages = buildMessages(makeSample(testCase, { ...child, subagentContext }));
  const shown = messages
    .flatMap((message) => message.content)
    .map((block) => block.text ?? "")
    .join("\n");
  if (subagentContext) assert.include(shown, subagentContext);
  else assert.notInclude(shown, "SubagentStart hook additional context:");
  assert.include(shown, testCase.prompt);
});

it.effect("accepts a successful exact-host recovery after a real device_open error", () =>
  Effect.gen(function* () {
    const c = deviceCases().find((c) => c.id === "HOST-01a")!;
    const base = buildBase(template, { model: "claude-opus-5-5", keepUserInstructions: false });
    const sample = makeSample(c, base);
    yield* withDevices(sample);
    const input = {
      hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    };
    const wrong = { ...input, hostId: "build-mac" };
    const error = yield* sample.devices!.call("device_open", wrong);
    assert.isTrue(error.isError);
    const opened = yield* sample.devices!.call("device_open", input);
    assert.isFalse(opened.isError);
    const capture = yield* sample.devices!.call("device_screenshot", input);
    const calls = [
      { step: 0, tool: "device_open", input: wrong, failed: true, output: error.text },
      { step: 1, tool: "device_open", input, failed: false, output: opened.text },
      { step: 2, tool: "device_screenshot", input, failed: capture.isError, output: capture.text },
    ];
    assert.isTrue(
      gradeSample(c.expect, {
        calls,
        launchers: sample.devices!.launchers,
        text: "",
        finalText: "/tmp/proof/settings.png",
        stopReason: "end_turn",
      }).every((c) => c.pass),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("fleet case worlds survive decoding and reach the product-backed runner", () =>
  Effect.gen(function* () {
    const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
    for (const id of ["DISC-01", "SESS-01", "ACC-01", "CAP-01", "OWN-01", "OWN-02", "OWN-03"]) {
      const c = deviceCases().find((c) => c.id === id)!;
      const sample = makeSample(c, base);
      yield* withDevices(sample);
      const tools = sample.devices!;
      const first = c.setup.world!.devices![0]!;
      const target = { hostId: first.hostId, deviceId: first.id };
      if (id === "DISC-01") {
        const listed = JSON.parse((yield* tools.call("device_list", {})).text);
        assert.equal(listed.hostStatuses[first.hostId].status, "failed");
        assert.include(listed.hostStatuses[first.hostId].detail, "Device list failed:");
        assert.equal(listed.devices.length, 1);
        assert.equal(listed.devices[0].name, "Acme Spare iPhone");
        continue;
      }
      const opened = yield* tools.call("device_open", target);
      if (id === "ACC-01") {
        assert.isTrue(opened.isError);
        assert.include(opened.text, "Agent device access is turned off for this environment.");
        continue;
      }
      assert.isFalse(opened.isError);
      if (id === "CAP-01") {
        const result = JSON.parse((yield* tools.call("device_screenshot", target)).text);
        assert.equal(result.screenshot.width, 0);
        assert.equal(result.screenshot.height, 0);
        continue;
      }
      const agent = JSON.parse(opened.text).agentDevice;
      const ownership = id.startsWith("OWN-");
      const command = [
        agent.command,
        ownership ? "open com.acme.app" : "screenshot /tmp/acme.png",
        ...(agent.targetArgs ?? []),
      ].join(" ");
      const error = tools.sessionError(sample.shell, command) ?? "";
      assert.include(error, ownership ? "DEVICE_IN_USE" : "SESSION_NOT_FOUND");
      if (ownership) {
        const owner = tools.owners[0]!.session;
        for (const action of ["open com.acme.app", "screenshot /tmp/a.png", "close"]) {
          const checks = gradeSample(c.expect, {
            calls: [
              {
                step: 0,
                tool: "Bash",
                input: { command: `${agent.command} ${action} --session ${owner}` },
                failed: false,
              },
            ],
            text: "",
            stopReason: "end_turn",
          });
          assert.isTrue(
            checks.some((check) => check.check.startsWith("shellMustNot /") && !check.pass),
            `${id}: ${action}`,
          );
        }
      }
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("R12 OWN-01 protects occupied panel sessions from selected and wildcard shutdowns", () =>
  Effect.gen(function* () {
    const c = deviceCases().find((c) => c.id === "OWN-01")!;
    const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
    const primary = c.setup.world!.devices![0]!;
    const target = { hostId: primary.hostId, deviceId: primary.id };
    const spare = c.expect.device!.capture!;
    for (const selectors of [
      target,
      { hostId: target.hostId },
      { deviceId: target.deviceId },
      {},
    ]) {
      for (const shutdown of [true, false, undefined]) {
        const sample = makeSample(c, base);
        yield* withDevices(sample);
        const tools = sample.devices!;
        const calls: Array<SampleRun["calls"][number]> = [];
        const invoke = (tool: string, input: unknown) =>
          Effect.gen(function* () {
            const result = yield* tools.call(tool, input);
            calls.push({
              step: calls.length,
              tool,
              input,
              failed: result.isError,
              output: result.text,
            });
            return result;
          });
        yield* invoke("device_list", {});
        const opened = yield* invoke("device_open", target);
        const agent = JSON.parse(opened.text).agentDevice;
        const command = [agent.command, "open com.acme.app", ...(agent.targetArgs ?? [])].join(" ");
        const error = tools.sessionError([], command)!;
        assert.include(error, "DEVICE_IN_USE");
        calls.push({
          step: calls.length,
          tool: "Bash",
          input: { command },
          failed: true,
          output: error,
        });
        yield* invoke("device_open", spare);
        yield* invoke("device_close", {
          ...selectors,
          ...(shutdown === undefined ? {} : { shutdown }),
        });
        const inventory = JSON.parse((yield* tools.call("device_list", {})).text);
        assert.equal(
          inventory.devices.find((d: { id: string }) => d.id === primary.id).booted,
          shutdown !== true,
        );
        yield* invoke("device_open", spare);
        yield* invoke("device_screenshot", spare);
        const trace = { ...fleetTrace(c.id), calls, launchers: [...tools.launchers] };
        assert.equal(failed(c.expect, trace).length === 0, shutdown !== true);
        assert.equal(failedEarly(c.expect, trace), shutdown === true);
      }
    }
    const good = fleetTrace(c.id);
    assert.deepEqual(
      failed(c.expect, {
        ...good,
        calls: [
          ...good.calls,
          { step: 4, tool: "device_close", input: { ...spare, shutdown: true }, failed: false },
        ],
      }),
      [],
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "R12 DISC-01 allows the retained label/all-host/refresh route and bounds failed discovery",
  () =>
    Effect.gen(function* () {
      const c = deviceCases().find((c) => c.id === "DISC-01")!;
      const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
      const sample = makeSample(c, base);
      yield* withDevices(sample);
      const tools = sample.devices!;
      const calls: Array<SampleRun["calls"][number]> = [];
      for (const input of [
        { hostId: "build-mac" },
        {},
        { hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      ]) {
        const result = yield* tools.call("device_list", input);
        calls.push({
          step: calls.length,
          tool: "device_list",
          input,
          failed: result.isError,
          output: result.text,
        });
        assert.isFalse(failedEarly(c.expect, { calls, text: "", stopReason: "end_turn" }));
      }
      const good = fleetTrace(c.id);
      assert.deepEqual(
        failed(c.expect, { ...good, calls: [...calls, ...good.calls.slice(1)] }),
        [],
      );
      assert.isTrue(
        failedEarly(c.expect, {
          ...good,
          calls: [...calls, calls.at(-1)!, ...good.calls.slice(1)],
        }),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
