import { assert, it } from "@effect/vitest";
import { failedEarly, gradeSample } from "./grade.ts";
import { normalizeToolInput, normalizeToolName } from "./protocol.ts";
import { type SampleRun } from "./types.ts";
import { failed } from "./test-fixtures.ts";

it("grades Codex shell and subagent calls with the shared rules", () => {
  const calls = [
    { name: "exec_command", input: { cmd: "sleep 60" } },
    { name: "collaboration.spawn_agent", input: { task: "review" } },
    { name: "mcp__supaterm__delegate_task", input: {} },
  ].map(({ name, input }) => ({
    step: 0,
    tool: normalizeToolName(name),
    input: normalizeToolInput(name, input),
  }));
  assert.deepEqual(
    calls.map((c) => c.tool),
    ["Bash", "Agent", "delegate_task"],
  );
  assert.deepEqual(
    failed(
      {
        calls: [{ tool: "Bash", args: { command: "~sleep" } }],
        notCalls: ["Agent"],
        shellMustNot: ["sleep"],
      },
      { calls, text: "", stopReason: "end_turn" },
    ),
    ["notCalls Agent", "shellMustNot /sleep/"],
  );
});

it("accepts any tool listed as an alternative", () => {
  const expect = { calls: [{ tool: "link_pull_request|watch_pull_request" }] };
  const run = (tool: string): SampleRun => ({
    calls: [{ step: 0, tool, input: {} }],
    text: "",
    stopReason: "end_turn",
  });
  assert.deepEqual(failed(expect, run("watch_pull_request")), []);
  assert.deepEqual(failed(expect, run("list_thread_pull_requests")), [
    "calls link_pull_request|watch_pull_request",
  ]);
});

it("passes a good run and names every rule a bad run breaks", () => {
  const expect = {
    calls: [{ tool: "delegate_task", args: { task: "~FINDING", "target.options": "~max" } }],
    callsMustNot: [{ tool: "delegate_task", args: { runtimeMode: "approval-required" } }],
    notCalls: ["supaterm_thread_send"],
    order: ["orchestrator_capabilities", "delegate_task"],
    minCalls: { orchestrator_capabilities: 1 },
    maxCalls: { task_status: 0 },
    endsTurnAfter: "delegate_task",
    shellMustNot: ["\\bsleep\\b"],
    textMust: ["supaterm-thread://v2/"],
    textMustNot: ["Paste .*token"],
    linked: ["~/pull/124"],
  };
  const good: SampleRun = {
    calls: [
      { step: 0, tool: "orchestrator_capabilities", input: {} },
      {
        step: 1,
        tool: "delegate_task",
        input: { task: "Prior findings: ...", target: { options: { reasoningEffort: "max" } } },
      },
    ],
    text: "Started <supaterm-thread://v2/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/11111111-1111-4111-8111-111111111111>. Do not paste a token.",
    stopReason: "end_turn",
    linked: ["https://github.com/acme/app/pull/124"],
  };
  assert.deepEqual(failed(expect, good), []);

  const bad: SampleRun = {
    calls: [
      {
        step: 0,
        tool: "delegate_task",
        input: { task: "Review again", runtimeMode: "approval-required" },
      },
      { step: 1, tool: "supaterm_thread_send", input: {} },
      { step: 2, tool: "Monitor", input: { command: "sleep 60" } },
      { step: 3, tool: "task_status", input: { taskId: "task-1" } },
    ],
    text: "Paste your token here.",
    stopReason: "max_steps",
  };
  assert.deepEqual(failed(expect, bad), [
    'calls delegate_task {"task":"~FINDING","target.options":"~max"}',
    'callsMustNot delegate_task {"runtimeMode":"approval-required"}',
    "notCalls supaterm_thread_send",
    "order orchestrator_capabilities > delegate_task",
    "minCalls orchestrator_capabilities >= 1",
    "maxCalls task_status <= 0",
    "endsTurnAfter delegate_task",
    "shellMustNot /\\bsleep\\b/",
    "textMust /supaterm-thread://v2//",
    "textMustNot /Paste .*token/",
    "linked ~/pull/124",
  ]);
});

it("bounds numbers and reads target.options in either schema form", () => {
  const expect = {
    calls: [
      { tool: "supaterm_thread_read", args: { limit: "<=20" } },
      { tool: "delegate_task", args: { "target.options.effort": "max", timeoutMs: ">=60000" } },
    ],
  };
  const run = (limit: unknown, options: unknown, timeoutMs: number): SampleRun => ({
    calls: [
      { step: 0, tool: "supaterm_thread_read", input: { limit } },
      { step: 0, tool: "delegate_task", input: { target: { options }, timeoutMs } },
    ],
    text: "",
    stopReason: "end_turn",
  });
  assert.deepEqual(failed(expect, run(20, [{ id: "effort", value: "max" }], 60_000)), []);
  assert.deepEqual(failed(expect, run(5, { effort: "max" }, 90_000)), []);
  assert.lengthOf(failed(expect, run(21, [{ id: "effort", value: "high" }], 59_999)), 2);
  assert.lengthOf(failed(expect, run("10", {}, 60_000)), 2);
});

it("stops a sample only once a must-not check has failed", () => {
  const run = (tool: string, text = ""): SampleRun => ({
    calls: [{ step: 0, tool, input: {} }],
    text,
    stopReason: "tool_use",
  });
  const expect = { calls: [{ tool: "link_pull_request" }], notCalls: ["watch_pull_request"] };
  assert.isFalse(failedEarly(expect, run("Bash")));
  assert.isTrue(failedEarly(expect, run("watch_pull_request")));
  assert.isTrue(failedEarly({ textMustNot: ["paste"] }, run("Bash", "paste it here")));
});

it.each([
  ["recording", ["start", "stop"], false, true],
  ["missing stop", ["start"], false, false],
  ["reversed", ["stop", "start"], false, false],
  ["failed stop", ["start", "stop"], true, false],
  ["ceremonial launcher", ["echo start", "echo stop"], false, false],
  ["launcher prefix", ["suffix start", "suffix stop"], false, false],

  ["launcher variable", ["var start", "var stop"], false, true],
  ["other variable", ["other start", "other stop"], false, false],
] as const)(
  "requires executed managed recording start and stop: %s",
  (_, operations, failed, pass) => {
    const launcher = "/home/user/.supaterm/device/bin/agent-device";
    const command = (operation: string) => {
      const [form, step] = operation.split(" ");
      if (form === "echo") return `echo '${launcher} record ${step}'`;
      if (form === "suffix") return `${launcher}-unbound record ${step}`;
      if (form === "var") return `AD=${launcher}; "$AD" record ${step} /tmp/demo/voice.mp4`;
      if (form === "other") return `AD=${launcher}-unbound; $AD record ${step} /tmp/demo/voice.mp4`;
      return `${launcher} record ${operation} /tmp/demo/voice.mp4 --session supaterm-eval`;
    };
    const calls = operations.map((operation, step) => ({
      step,
      tool: "Bash",
      failed: failed && step === 1,
      input: { command: command(operation) },
    }));
    const run = {
      calls,
      launchers: [launcher],
      text: "",
      finalText: "Saved /tmp/demo/voice.mp4",
      stopReason: "end_turn",
    };
    const checks = gradeSample({ device: { recording: "/tmp/demo/voice.mp4" } }, run);
    assert.equal(checks.find((check) => check.check.startsWith("device recording"))?.pass, pass);
  },
);

it.each([
  ["env -i", ""],
  ["sudo -n", ""],
  ["caffeinate -i", ""],
  ["timeout -s INT 30", ""],
  ["/usr/bin/nohup", " &"],
  ["", ""],
])("shares wrapped literal aliases across recording calls: %s", (wrapper, suffix) => {
  const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
  const calls = [
    `AD='${launcher}'; DRIVER=$AD`,
    `${wrapper} "\${DRIVER}" record start /tmp/raw.mp4${suffix}`,
    `${wrapper} "$AD" record stop${suffix}`,
  ].map((command, step) => ({
    step,
    tool: "Bash",
    input: { command },
    failed: false,
    output: step === 1 ? "Recording started" : "Recording stopped",
  }));
  const run = {
    calls,
    launchers: [launcher],
    text: "",
    finalText: "Saved /tmp/demo/voice.mp4",
    stopReason: "end_turn",
  };
  assert.isTrue(
    gradeSample({ device: { recording: "/tmp/demo/voice.mp4" } }, run).every((c) => c.pass),
  );
});

it.each([
  [
    "quoted heredoc",
    "cat <<'EOF'\nLAUNCHER record start /tmp/raw.mp4\nLAUNCHER record stop\nEOF",
    "end_turn",
    false,
  ],
  [
    "signal does not stop daemon recording",
    "LAUNCHER record start /tmp/raw.mp4 & kill -INT $!",
    "end_turn",
    false,
  ],
  [
    "invented stop flag",
    "LAUNCHER record start /tmp/raw.mp4; LAUNCHER record --stop",
    "end_turn",
    false,
  ],
  ["max steps", "LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop", "max_steps", false],
  ["non-shell tool", "LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop", "end_turn", false],
] as const)("rejects recording over-acceptance: %s", (name, command, stopReason, pass) => {
  const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
  const run = {
    calls: [
      {
        step: 0,
        tool: name === "non-shell tool" ? "Read" : "Bash",
        input: { command: command.replaceAll("LAUNCHER", launcher) },
        failed: false,
      },
    ],
    launchers: [launcher],
    text: "",
    finalText: "Saved /tmp/demo/voice.mp4",
    stopReason,
  };
  assert.equal(
    gradeSample({ device: { recording: "/tmp/demo/voice.mp4" } }, run).every((c) => c.pass),
    pass,
  );
});

it("requires the recording path in the terminal assistant response", () => {
  const launcher = "/home/user/.supaterm/device/bin/agent-device";
  const calls = ["start /tmp/raw.mp4", "stop"].map((op, step) => ({
    step,
    tool: "Bash",
    input: { command: `${launcher} record ${op}` },
    failed: false,
  }));
  const run = {
    calls,
    launchers: [launcher],
    text: "Plan: save /tmp/demo/voice.mp4\nBlocked",
    stopReason: "end_turn",
    transcript: [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Plan: save /tmp/demo/voice.mp4" },
          { type: "tool_use", name: "Bash" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Blocked" }] },
    ],
  };
  assert.isFalse(
    gradeSample({ device: { recording: "/tmp/demo/voice.mp4" } }, run).every((c) => c.pass),
  );
});

it.each([
  [
    "a later `;` command hides an agent-device error",
    "record start /tmp/demo/voice.mp4; echo done",
    "Error (COMMAND_FAILED): Remote daemon is unavailable\ndone",
    false,
  ],
  [
    "a later `;` command with clean output",
    "record start /tmp/demo/voice.mp4; echo done",
    "Recording started\ndone",
    true,
  ],
  [
    "a pipe into `cat` hides an agent-device error",
    "record start /tmp/demo/voice.mp4 | cat",
    "Error (COMMAND_FAILED): Remote daemon is unavailable",
    false,
  ],
  [
    "a pipe into `cat` with clean output",
    "record start /tmp/demo/voice.mp4 | cat",
    "Recording started",
    true,
  ],
  [
    "`&&` makes the start part of the call's success",
    "record start /tmp/demo/voice.mp4 && echo done",
    "done",
    true,
  ],
  [
    "a standalone start whose output is an agent-device error",
    "record start /tmp/demo/voice.mp4",
    'Error (COMMAND_FAILED): Remote daemon is unavailable\n{"success":false}',
    false,
  ],
] as const)(
  "credits a recording start only when the call's status covers it: %s",
  (_, start, output, pass) => {
    const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
    const calls = [
      { step: 0, tool: "Bash", failed: false, output, input: { command: `${launcher} ${start}` } },
      { step: 1, tool: "Bash", failed: false, input: { command: `${launcher} record stop` } },
    ];
    const run = {
      calls,
      launchers: [launcher],
      text: "",
      finalText: "Saved /tmp/demo/voice.mp4",
      stopReason: "end_turn",
    };
    const checks = gradeSample({ device: { recording: "/tmp/demo/voice.mp4" } }, run);
    assert.equal(checks.find((check) => check.check.startsWith("device recording"))?.pass, pass);
  },
);

it.each([
  ["clean output", "Recording started", true],
  [
    "an agent-device error the script ignored",
    "Error (COMMAND_FAILED): Remote daemon is unavailable",
    false,
  ],
] as const)(
  "credits a recording a Python script started only with an attributable result: %s",
  (_, output, pass) => {
    const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
    const script = `python3 -c "import subprocess; subprocess.run(['${launcher}', 'record', 'start', '/tmp/demo/voice.mp4'])"`;
    const calls = [
      { step: 0, tool: "Bash", failed: false, output, input: { command: script } },
      { step: 1, tool: "Bash", failed: false, input: { command: `${launcher} record stop` } },
    ];
    const run = {
      calls,
      launchers: [launcher],
      text: "",
      finalText: "Saved /tmp/demo/voice.mp4",
      stopReason: "end_turn",
    };
    const checks = gradeSample({ device: { recording: "/tmp/demo/voice.mp4" } }, run);
    assert.equal(checks.find((check) => check.check.startsWith("device recording"))?.pass, pass);
  },
);

it.each([
  [
    "an if whose condition list fails",
    "if true && false; then LAUNCHER record start /tmp/demo/voice.mp4; LAUNCHER record stop; fi",
    false,
  ],
  [
    "an if whose condition list succeeds",
    "if false || true; then LAUNCHER record start /tmp/demo/voice.mp4; LAUNCHER record stop; fi",
    true,
  ],
  [
    "an exit inside a called function",
    "demo() { LAUNCHER record start /tmp/demo/voice.mp4; exit 0; }; demo; LAUNCHER record stop",
    false,
  ],
  [
    "a return inside a called function",
    "demo() { LAUNCHER record start /tmp/demo/voice.mp4; return 0; }; demo; LAUNCHER record stop",
    true,
  ],
  [
    "a certain exit before it",
    "exit 0; LAUNCHER record start /tmp/demo/voice.mp4; LAUNCHER record stop",
    false,
  ],
  [
    "an exit confined to a subshell",
    "(exit 0); LAUNCHER record start /tmp/demo/voice.mp4; LAUNCHER record stop",
    true,
  ],
] as const)("credits a recording only when its commands are reachable: %s", (_, command, pass) => {
  const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
  const calls = [
    {
      step: 0,
      tool: "Bash",
      failed: false,
      output: "Recording started\nRecording stopped",
      input: { command: command.replaceAll("LAUNCHER", launcher) },
    },
  ];
  const run = {
    calls,
    launchers: [launcher],
    text: "",
    finalText: "Saved /tmp/demo/voice.mp4",
    stopReason: "end_turn",
  };
  const checks = gradeSample({ device: { recording: "/tmp/demo/voice.mp4" } }, run);
  assert.equal(checks.find((check) => check.check.startsWith("device recording"))?.pass, pass);
});

it.each([
  [
    "a called JS function",
    "run(['record', 'start', '/tmp/demo/voice.mp4']); run(['record', 'stop'])",
    true,
  ],
  [
    "an uncalled JS arrow function whose body starts on the next line",
    "const rec = () =>\n  run(['record', 'start', '/tmp/demo/voice.mp4']); run(['record', 'stop'])",
    false,
  ],
  [
    "an uncalled JS arrow function",
    "const rec = () => run(['record', 'start', '/tmp/demo/voice.mp4']); run(['record', 'stop'])",
    false,
  ],
] as const)("credits recordings from scripts only for calls that run: %s", (_, body, pass) => {
  const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";

  const script = `${body.replaceAll("run(", `require('child_process').execFileSync('${launcher}', `)};`;
  const calls = [
    {
      step: 0,
      tool: "Bash",
      failed: false,
      output: "Recording started\nRecording stopped",
      input: { command: `node -e "${script}"` },
    },
  ];
  const run = {
    calls,
    launchers: [launcher],
    text: "",
    finalText: "Saved /tmp/demo/voice.mp4",
    stopReason: "end_turn",
  };
  const checks = gradeSample({ device: { recording: "/tmp/demo/voice.mp4" } }, run);
  assert.equal(checks.find((check) => check.check.startsWith("device recording"))?.pass, pass);
});

it("credits a recording whose result lines carry a symbol prefix", () => {
  const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
  const calls = [
    {
      step: 0,
      tool: "Bash",
      failed: false,
      output: "✓ Recording started /tmp/demo/voice.mp4",
      input: { command: `${launcher} record start /tmp/demo/voice.mp4 2>&1 | tail -3; sleep 2` },
    },
    {
      step: 1,
      tool: "Bash",
      failed: false,
      output: "✓ Recording stopped /tmp/demo/voice.mp4",
      input: { command: `${launcher} record stop 2>&1 | tail -8; ls /tmp/demo` },
    },
  ];
  const run = {
    calls,
    launchers: [launcher],
    text: "Saved /tmp/demo/voice.mp4",
    finalText: "Saved /tmp/demo/voice.mp4",
    stopReason: "end_turn",
  };
  const checks = gradeSample({ device: { recording: "/tmp/demo/voice.mp4" } }, run);
  assert.isTrue(checks.find((check) => check.check.startsWith("device recording"))?.pass);
});
