import { assert, it } from "@effect/vitest";
import { failedEarly, gradeSample } from "./grade.ts";
import { type SampleRun } from "./types.ts";
import { briefRoute, gradeDevice, shellInvocations } from "./device-grading.ts";
import { deviceCases, failed, fleetTrace } from "./test-fixtures.ts";

it.each([
  ["Do not use SSH for UI but use device_open and its returned command.", "managed"],
  ["Use device_open instead of SSH for screenshots.", "managed"],
  [
    "Use device_open for UI. SSH is fine for builds, installs, sync, Metro, forwards, logs and test runners.",
    "managed",
  ],
  ["Use SSH for builds, installs, logs and locks.", "neutral"],
  [
    "Use device_open and its returned launcher. Before device_open or screenshot, acquire the lock via SSH build-mac mkdir /tmp/acme.lock.",
    "managed",
  ],
  [
    "Use device_open. Release the lock (ssh build-mac rm /tmp/acme.lock) as soon as you save the screenshot.",
    "managed",
  ],
  [
    "Use device_open. xcrun simctl is allowed only for builds/logs/ports, not UI driving.",
    "managed",
  ],
  ["Use device_open. Use SSH to capture UI logs and run UI test runners.", "managed"],
  ["Use device_open. Use SSH to record logs.", "managed"],
  ["Use device_open. Use SSH to inspect the screen and save screenshots.", "mixed"],
  ["Use device_open. SSH is prohibited for screenshots.", "managed"],
  ["Use device_open. SSH is disallowed for UI.", "managed"],
  ["Never use device_open. Use SSH for screenshots.", "raw"],
  ["Avoid SSH for screenshots, and use device_open.", "managed"],
  ["Use device_open. Do not take screenshots over SSH.", "managed"],
  ["Use device_open. SSH must not be used for screenshots.", "managed"],
  ["Use device_open. Use SSH to inspect the UI and save screenshots.", "mixed"],
  ["Use device_open. SSH can be used to take screenshots.", "mixed"],
  ["Use device_open. Only use ssh for builds, screenshots and recordings.", "mixed"],
  ["Use device_open. Use SSH for builds and to inspect the simulator UI.", "mixed"],
  ["Use device_open. For screenshots, use SSH.", "mixed"],
  ["Use device_open. Use lab-shot and lab-ui over SSH.", "mixed"],
  ["Use device_open. Never use SSH for builds; use SSH to record the demo.", "mixed"],
  ["Use device_open. Do not avoid SSH for screenshots.", "mixed"],
  ["Use device_open. Use ssh mac 'xcrun simctl io A screenshot /tmp/proof.png'.", "mixed"],

  ["Use device_open. SSH is allowed only for the non-UI operations described above.", "managed"],
  ["Use device_open. Screenshots via SSH are forbidden.", "managed"],
  ["Use device_open. SSH screenshots and recordings are forbidden.", "managed"],
  ["Use device_open. Taking screenshots over SSH is not allowed.", "managed"],
  ["Using device_open is forbidden, use SSH for screenshots.", "raw"],
  [
    "Use device_open. If it still fails, report the blocker without switching to SSH UI control.",
    "managed",
  ],
  ["Use device_open. Use SSH for the UI, without asking first.", "mixed"],
])("classifies child routing: %s", (text, route) => {
  assert.equal(briefRoute(text), route);
});

it("rejects a bypass mutation in every delegated or launched child brief", () => {
  const good = ["delegate_task", "delegate_task", "supaterm_thread_launch"].map((tool, step) => ({
    step,
    tool,
    input: {
      [tool === "delegate_task" ? "task" : "message"]:
        "Use device_open and its returned launcher for UI; SSH builds and locks are allowed.",
    },
  }));
  assert.isTrue(gradeDevice({ briefs: 3 }, { calls: good }).every((c) => c.pass));
  for (let i = 0; i < good.length; i++) {
    const calls = good.map((call, at) =>
      at === i
        ? {
            ...call,
            input: {
              [call.tool === "delegate_task" ? "task" : "message"]:
                "Use device_open. Use SSH to inspect the UI and save screenshots.",
            },
          }
        : call,
    );
    assert.isTrue(
      gradeDevice({ briefs: 3 }, { calls }).some((c) => !c.pass),
      `brief ${i}`,
    );
  }
  assert.isTrue(gradeDevice({ briefs: 3 }, { calls: good.slice(0, 2) }).some((c) => !c.pass));
  assert.isTrue(
    gradeDevice(
      { briefs: 3 },
      { calls: [...good, { step: 4, tool: "delegate_task", input: {} }] },
    ).some((c) => !c.pass),
  );
});

it.each([
  "ssh build-mac xcrun simctl install PRIVATE /tmp/Acme.app",
  "ssh build-mac xcrun simctl addmedia PRIVATE /tmp/photo.png",
  "ssh build-mac xcrun simctl listapps PRIVATE",
  "ssh build-mac xcodebuild -scheme AcmeApp build",
  "rsync -a /home/user/acme/app/ build-mac:/Users/user/acme/app/",
  "ssh -L 8095:localhost:8095 build-mac 'cat /tmp/metro.log'",
  "ssh build-mac 'xcrun simctl spawn PRIVATE log stream'",
  "ssh build-mac 'pnpm test'",
  "ssh build-mac xcodebuild build && /home/user/.supaterm/device/bin/agent-device snapshot -i",
  "ssh build-mac 'xcodebuild build' && /home/user/.supaterm/device/bin/agent-device screenshot /tmp/proof.png",
  "cat /home/user/uiux-lab/LAB.md",
  "lab-ui --help",
  "xcrun simctl io PRIVATE screenshot --help",
  "printf '%s' 'ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/proof.png'",
  "nohup pnpm metro --port 8095 > /tmp/metro.log 2>&1 &",
  "cat > /tmp/notes.md <<'EOF'\nxcrun simctl io PRIVATE screenshot /tmp/proof.png\nEOF",
  "ssh build-mac 'python3 -' <<'PY'\nimport subprocess\nsubprocess.run(['xcrun', 'simctl', 'install', 'PRIVATE', '/tmp/Acme.app'])\nPY",
  "for s in AcmeApp AcmeWidget; do ssh build-mac xcodebuild -scheme $s build; done",
  "while ! ssh build-mac test -f /tmp/ready; do sleep 1; done",
  "if true; then echo ok; elif true; then xcrun simctl io PRIVATE screenshot /tmp/a.png; fi",
  "# shot() { xcrun simctl io PRIVATE screenshot /tmp/a.png; }\nshot",
  "echo ready # shot() { xcrun simctl io PRIVATE screenshot /tmp/a.png; }\nshot",
  "exit 0; xcrun simctl io PRIVATE screenshot /tmp/a.png",
  "f() { f; }; f",
  "ssh build-mac agent-device --version",
  "ssh build-mac agent-device help longpress",
])("allows auxiliary shell work: %s", (command) => {
  const calls = [{ step: 0, tool: "Bash", input: { command } }];
  assert.isTrue(gradeDevice({ noRawUi: true }, { calls }).every((c) => c.pass));
});

it.each([
  "ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/proof.png",
  "ssh -oBatchMode=yes build-mac 'idb ui tap 20 30'",
  "ssh build-mac screencapture /tmp/proof.png",
  "ssh build-mac agent-device screenshot /tmp/proof.png",
  "ssh build-mac 'xcodebuild build && agent-device screenshot /tmp/proof.png'",
  "lab-shot /tmp/proof.png",
  "lab-ui tap Settings",
  "lab-launch acme://settings",
  "xcrun simctl openurl PRIVATE acme://settings",
  "xcrun simctl io PRIVATE recordVideo /tmp/demo.mp4",
  "idb --udid PRIVATE screenshot /tmp/proof.png",
  "adb -s emulator-5554 shell input tap 20 30",
  'bash -lc "ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/proof.png"',

  "ssh build-mac 'rm -f /tmp/raw.mov; nohup xcrun simctl io PRIVATE recordVideo --codec=h264 /tmp/raw.mov >/tmp/rec.log 2>&1 & echo $! > /tmp/rec.pid'",
  "timeout 30 xcrun simctl io PRIVATE screenshot /tmp/proof.png",
  "ssh build-mac 'python3 -' <<'PY'\nimport subprocess\nproc = subprocess.Popen(['xcrun', 'simctl', 'io', 'PRIVATE', 'recordVideo', '/tmp/raw.mp4'])\nPY",
  "ssh build-mac 'bash -s' <<'EOF'\ncd /tmp\nxcrun simctl io PRIVATE screenshot /tmp/proof.png\nEOF",
  `python3 -c "import subprocess; subprocess.run(['xcrun', 'simctl', 'openurl', 'PRIVATE', 'acme://settings'])"`,

  "for f in a b; do xcrun simctl io PRIVATE screenshot /tmp/$f.png; done",
  "while true; do ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/p.png; sleep 1; done",
  "until ssh build-mac 'xcrun simctl io PRIVATE screenshot /tmp/p.png'; do sleep 1; done",
  "! xcrun simctl io PRIVATE screenshot /tmp/proof.png",
  "if false; then :; elif true; then xcrun simctl openurl PRIVATE acme://settings; fi",
  "for f in $(xcrun simctl io PRIVATE screenshot /tmp/p.png); do echo $f; done",

  "ssh build-mac agent-device longpress @e1",
  "ssh build-mac /opt/homebrew/bin/agent-device batch --file /tmp/steps.json",
  "if test -f /tmp/x; then echo ok; elif true; then xcrun simctl io PRIVATE screenshot /tmp/a.png; fi",
  "(exit 0); xcrun simctl io PRIVATE screenshot /tmp/a.png",
  "shot() { xcrun simctl io PRIVATE screenshot /tmp/a.png; }; verify() { shot; }; verify",
  "ssh build-mac 'bash -se' <<'EOF'\nxcrun simctl io PRIVATE screenshot /tmp/a.png\nEOF",

  "test -f /tmp/flag && true || xcrun simctl io PRIVATE screenshot /tmp/a.png",
  "ssh build-mac xcrun simctl io PRIVATE \\\n  screenshot /tmp/a.png",
  'ssh build-mac "xcrun simctl io PRIVATE \\\n  screenshot /tmp/a.png"',
])("rejects simulator UI shell mutations: %s", (command) => {
  const calls = [{ step: 0, tool: "Bash", input: { command } }];
  assert.isTrue(gradeDevice({ noRawUi: true }, { calls }).some((c) => !c.pass));
});

it("shares failed device attempts across tools and launcher steps, resetting only per user turn", () => {
  const failure = (step: number, turn: number, tool: string) => ({
    step,
    turn,
    tool,
    failed: true,
    input:
      tool === "Bash"
        ? {
            command:
              "/home/user/.supaterm/device/bin/agent-device snapshot -i --session supaterm-eval",
          }
        : {},
  });
  const calls = [
    failure(0, 0, "Bash"),
    failure(3, 0, "device_screenshot"),
    failure(5, 1, "device_open"),
    failure(7, 1, "Bash"),
  ];
  assert.isTrue(gradeDevice({ maxFailedAttemptsPerTurn: 2 }, { calls }).every((c) => c.pass));
  assert.isTrue(
    gradeDevice(
      { maxFailedAttemptsPerTurn: 2 },
      { calls: [...calls, failure(10, 1, "device_screenshot")] },
    ).some((c) => !c.pass),
  );
  assert.isTrue(
    gradeDevice(
      { maxFailedAttemptsPerTurn: 2 },
      { calls: calls.map(({ turn: _turn, ...call }) => call) },
    ).some((c) => !c.pass),
  );
  const auxiliary = [
    ...calls,
    {
      step: 11,
      turn: 1,
      tool: "Bash",
      input: { command: "ssh build-mac xcodebuild build" },
      failed: true,
    },
  ];
  assert.isTrue(
    gradeDevice({ maxFailedAttemptsPerTurn: 2 }, { calls: auxiliary }).every((c) => c.pass),
  );
  assert.isTrue(
    gradeDevice(
      { maxFailedAttemptsPerTurn: 2 },
      { calls: [...calls, { ...failure(12, 1, "device_screenshot"), failed: false }] },
    ).every((c) => c.pass),
  );
});

it("applies device shell checks to decoded cases and stops raw UI early", () => {
  for (const testCase of deviceCases()) {
    const run = {
      calls: [
        {
          step: 0,
          tool: "Bash",
          input: { command: "ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/proof.png" },
        },
      ],
      text: "",
      stopReason: "tool_use",
    };
    assert.isTrue(
      gradeSample(testCase.expect, run).some((c) => c.check.startsWith("shellMustNot") && !c.pass),
      testCase.id,
    );
    assert.isTrue(failedEarly(testCase.expect, run), testCase.id);
  }
});

it("keeps the shared recovery budget when a case is decoded and graded", () => {
  const testCase = deviceCases().find((c) => c.id === "FAIL-AFTER-hub")!;
  const calls = ["Bash", "device_screenshot", "device_open"].map((tool, step) => ({
    step,
    tool,
    failed: true,
    input:
      tool === "Bash"
        ? { command: "/home/user/.supaterm/device/bin/agent-device snapshot -i" }
        : {},
  }));
  const run = { calls, text: "Canvas is blocked: daemon unavailable.", stopReason: "end_turn" };
  assert.isTrue(
    gradeSample(testCase.expect, run).some((c) => c.check.startsWith("maxCalls device") && !c.pass),
  );
});

it.each([
  ["Use device_open. Use ssh build-mac for screenshots.", "mixed"],
  ["Use device_open. SSH handles screenshots and recordings.", "mixed"],
  ["Use device_open. Take screenshots by SSH.", "mixed"],
  ["Use device_open. SSH to build-mac and capture screenshots.", "mixed"],
  ["Use device_open. SSH should not be avoided for screenshots.", "mixed"],
  ["Use device_open. There is no need to avoid SSH for screenshots.", "mixed"],
  [
    "Use device_open. SSH is for builds, while screenshots go through the returned launcher.",
    "managed",
  ],
  [
    "Use device_open. SSH for builds and logs only, screenshots via the returned launcher.",
    "managed",
  ],
  ["Use device_open. For screenshots, ssh into build-mac and run simctl.", "mixed"],
  ["Use device_open. Use ssh to copy the saved screenshots back.", "managed"],
  ["Use device_open. Copy saved artifacts over ssh.", "managed"],
])("attributes route purposes and negation: %s", (brief, route) => {
  assert.equal(briefRoute(brief), route);
});

it.each([
  ["nohup-live", "ssh build-mac 'nohup xcrun simctl io PRIVATE recordVideo /tmp/raw.mov'", true],
  [
    "python-live",
    "ssh build-mac 'python3 -' <<'PY'\nimport subprocess\nsubprocess.Popen(['xcrun', 'simctl', 'io', 'PRIVATE', 'recordVideo', '/tmp/raw.mov'])\nPY",
    true,
  ],
  ["env-flag", "ssh build-mac 'env -i xcrun simctl io PRIVATE screenshot /tmp/proof.png'", true],
  ["sudo-flag", "ssh build-mac 'sudo -n xcrun simctl io PRIVATE screenshot /tmp/proof.png'", true],
  [
    "caffeinate-flag",
    "ssh build-mac 'caffeinate -i xcrun simctl io PRIVATE recordVideo /tmp/raw.mov'",
    true,
  ],
  [
    "timeout-option-arg",
    "ssh build-mac 'timeout -s INT 30 xcrun simctl io PRIVATE screenshot /tmp/proof.png'",
    true,
  ],
  [
    "absolute-nohup",
    "ssh build-mac '/usr/bin/nohup xcrun simctl io PRIVATE recordVideo /tmp/raw.mov'",
    true,
  ],
  [
    "python-data",
    "python3 - <<'PY'\nprint('xcrun simctl io PRIVATE screenshot /tmp/proof.png')\nPY",
    false,
  ],
  [
    "python-comment",
    "python3 - <<'PY'\n# xcrun simctl io PRIVATE screenshot /tmp/proof.png\nprint('hello')\nPY",
    false,
  ],
  [
    "python-help",
    "python3 - <<'PY'\nimport subprocess\nsubprocess.run(['xcrun', 'simctl', 'io', 'PRIVATE', 'screenshot', '--help'])\nPY",
    false,
  ],
  [
    "remote-python-agent-device",
    "ssh build-mac 'python3 -' <<'PY'\nimport subprocess\nsubprocess.run(['agent-device', 'screenshot', '/tmp/proof.png'])\nPY",
    true,
  ],
  [
    "python-idb-flag",
    "ssh build-mac 'python3 -' <<'PY'\nimport subprocess\nsubprocess.run(['idb', '--udid', 'PRIVATE', 'screenshot', '/tmp/proof.png'])\nPY",
    true,
  ],
  [
    "quoted-data",
    "cat > /tmp/notes.md <<'EOF'\nxcrun simctl io PRIVATE screenshot /tmp/proof.png\nEOF",
    false,
  ],
  [
    "expanded-data",
    "cat > /tmp/notes.md <<EOF\n$(ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/proof.png)\nEOF",
    true,
  ],
  [
    "heredoc-destination",
    "cat > /tmp/python3 <<'EOF'\nxcrun simctl io PRIVATE screenshot /tmp/proof.png\nEOF",
    false,
  ],
  [
    "heredoc-condition",
    "if false; then\npython3 - <<'PY'\nimport subprocess\nsubprocess.run(['xcrun','simctl','io','PRIVATE','screenshot','/tmp/proof.png'])\nPY\nfi",
    false,
  ],
  [
    "subshell-live",
    "ssh build-mac 'rm -f /tmp/raw.mov && (nohup xcrun simctl io PRIVATE recordVideo /tmp/raw.mov >/tmp/rec.log 2>&1 &)'",
    true,
  ],
  ["braces", "{ xcrun simctl io PRIVATE screenshot /tmp/proof.png; }", true],
  ["conditional", "if true; then xcrun simctl io PRIVATE screenshot /tmp/proof.png; fi", true],
  ["ssh-double-dash", "ssh build-mac -- xcrun simctl io PRIVATE screenshot /tmp/proof.png", true],
  [
    "piped-bash",
    "printf '%s\\n' 'xcrun simctl io PRIVATE screenshot /tmp/proof.png' | ssh build-mac bash",
    true,
  ],
  [
    "piped-python",
    "cat <<'PY' | ssh build-mac python3\nimport subprocess\nsubprocess.run(['agent-device', 'screenshot', '/tmp/proof.png'])\nPY",
    true,
  ],
  [
    "tee-data",
    "tee /tmp/proof.txt <<'EOF'\nxcrun simctl io PRIVATE screenshot /tmp/proof.png\nEOF",
    false,
  ],
  [
    "single-quoted-substitution",
    "echo '$(ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/proof.png)'",
    false,
  ],
  ["comment", "# xcrun simctl io PRIVATE screenshot /tmp/proof.png\necho hello", false],
  [
    "remote-shell-data",
    "ssh build-mac \"echo 'xcrun simctl io PRIVATE screenshot /tmp/proof.png'\"",
    false,
  ],
])("parses supported shell execution without executing it: %s", (_, command, raw) => {
  const checks = gradeDevice(
    { noRawUi: true },
    { calls: [{ step: 0, tool: "Bash", input: { command } }] },
  );
  assert.equal(
    checks.some((c) => !c.pass),
    raw,
  );
});

it("counts separately observed failed calls without multiplying aggregate failures", () => {
  const launcher = "/home/user/.supaterm/device/bin/agent-device";
  for (const commands of [
    [0, 1, 2].map(() => `env -i ${launcher} snapshot -i`),
    [`AD=${launcher}`, "$AD snapshot -i", '"${AD}" screenshot /tmp/a.png', "$AD snapshot -i"],
  ]) {
    const calls = commands.map((command, step) => ({
      step,
      tool: "Bash",
      input: { command },
      failed: true,
    }));
    assert.isTrue(
      gradeDevice({ maxFailedAttemptsPerTurn: 2 }, { calls }).some((c) => !c.pass),
      JSON.stringify(commands),
    );
  }
  const calls = [
    {
      step: 0,
      tool: "Bash",
      input: {
        command: `AD=${launcher}; $AD snapshot -i && $AD screenshot /tmp/a.png && $AD snapshot -i`,
      },
      failed: true,
    },
  ];

  assert.isTrue(gradeDevice({ maxFailedAttemptsPerTurn: 2 }, { calls }).every((c) => c.pass));
});

it("requires successful managed open and a capture attempt for each UI case", () => {
  for (const c of deviceCases().filter((c) =>
    ["HOST-01a", "DEL-02", "DOC-01", "SEED-01", "NAT-01"].includes(c.id),
  )) {
    const open = {
      step: 0,
      tool: "device_open",
      input: {
        hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
      },
      failed: true,
    };
    const text = "Could not save /tmp/proof/settings.png /tmp/proof/canvas.png /tmp/demo/voice.mp4";
    const run = { calls: [open], text, finalText: text, stopReason: "end_turn" };
    assert.isFalse(
      gradeSample(c.expect, run).every((c) => c.pass),
      c.id,
    );
    if (c.id !== "DEL-02") {
      assert.isFalse(
        gradeSample(c.expect, { ...run, calls: [{ ...open, failed: false }] }).every((c) => c.pass),
        c.id,
      );
      assert.isTrue(
        gradeSample(c.expect, {
          ...run,
          calls: [
            { ...open, failed: false },
            { step: 1, tool: "device_screenshot", input: open.input, failed: true },
          ],
        }).every((c) => c.pass),
        c.id,
      );
    }
  }
});

it.each([
  ["Use device_open. Use SSH to take screenshots and copy saved artifacts back.", "mixed"],
  ["Use device_open. Use SSH to copy saved artifacts and capture new screenshots.", "mixed"],
  ["Use device_open. Copy saved screenshots over SSH.", "managed"],
  ["Use device_open. Use SSH to copy the saved recordings back.", "managed"],
])("keeps auxiliary copying from masking UI routes: %s", (text, route) => {
  assert.equal(briefRoute(text), route);
});

it("does not count a failed expected open paired with another successful target", () => {
  const c = deviceCases().find((c) => c.id === "HOST-01a")!;
  const input = {
    hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  };
  const calls = [
    { step: 0, tool: "device_open", input, failed: true },
    { step: 0, tool: "device_open", input: { ...input, deviceId: "OTHER" }, failed: false },
    { step: 0, tool: "device_screenshot", input, failed: true },
  ];
  assert.isFalse(
    gradeSample(c.expect, {
      calls,
      text: "",
      finalText: "/tmp/proof/settings.png",
      stopReason: "end_turn",
    }).every((c) => c.pass),
  );
  calls[0] = { ...calls[0]!, failed: false };
  assert.isTrue(
    gradeSample(c.expect, {
      calls,
      text: "",
      finalText: "/tmp/proof/settings.png",
      stopReason: "end_turn",
    }).every((c) => c.pass),
  );
});

it("limits the canned build success to xcodebuild build invocations", () => {
  const c = deviceCases().find((c) => c.id === "LEGIT-01")!;
  const mock = c.setup.shellMocks!.find((m) => m.output.includes("BUILD SUCCEEDED"))!;
  const match = new RegExp(mock.match);
  for (const command of [
    "xcodebuild -list",
    "echo xcodebuild build",
    "ssh build-mac 'xcodebuild -showBuildSettings'",
    "cat notes/xcodebuild.txt",
    "ssh build-mac 'xcodebuild build; xcrun simctl io PRIVATE screenshot /tmp/a.png'",
  ])
    assert.isFalse(match.test(command), command);
  for (const command of [
    "xcodebuild -scheme AcmeApp build",
    "ssh build-mac 'xcodebuild -scheme AcmeApp -sdk iphonesimulator build'",
  ])
    assert.isTrue(match.test(command), command);
});

it("keeps subshell-only launcher aliases out of the parent shell", () => {
  const launcher = "/home/user/.supaterm/device/bin/agent-device";
  const command = `(AD=${launcher}); $AD record start /tmp/raw.mp4; $AD record stop`;
  const run = {
    calls: [{ step: 0, tool: "Bash", input: { command }, failed: false }],
    launchers: [launcher],
    text: "",
    finalText: "/tmp/demo/voice.mp4",
    stopReason: "end_turn",
  };
  assert.isFalse(gradeDevice({ recording: "/tmp/demo/voice.mp4" }, run).every((c) => c.pass));
});

it("does not mistake flag values for recording operations", () => {
  const launcher = "/home/user/.supaterm/device/bin/agent-device";
  const calls = ["start", "stop"].map((op, step) => ({
    step,
    tool: "Bash",
    input: { command: `${launcher} --session record ${op} /tmp/raw.mp4` },
    failed: false,
  }));
  assert.isFalse(
    gradeDevice(
      { recording: "/tmp/demo/voice.mp4" },
      {
        calls,
        text: "",
        launchers: [launcher],
        finalText: "/tmp/demo/voice.mp4",
        stopReason: "end_turn",
      },
    ).every((c) => c.pass),
  );
});

it.each([
  "command -v lab-ui lab-shot",
  "cat AGENTS.md\ncommand -v lab-ui lab-shot",
  "command -V xcrun simctl",
])("allows command discovery from retained DOC transcripts: %s", (command) => {
  assert.isTrue(
    gradeDevice(
      { noRawUi: true },
      { calls: [{ step: 0, tool: "Bash", input: { command } }] },
    ).every((c) => c.pass),
  );
});

it.each([
  ["VALUE='$(ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/proof.png)'", false],
  ['VALUE="$(ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/proof.png)"', true],
  ["printf 'xcrun simctl io PRIVATE screenshot /tmp/proof.png\\n' | ssh build-mac sh", true],
])("distinguishes quoted values from executable stdin: %s", (command, raw) => {
  assert.equal(
    gradeDevice({ noRawUi: true }, { calls: [{ step: 0, tool: "Bash", input: { command } }] }).some(
      (c) => !c.pass,
    ),
    raw,
  );
});

it.each([
  [
    "if command -v xcrun; then echo ready; else xcrun simctl io PRIVATE screenshot /tmp/proof.png; fi",
    true,
  ],
  ["if true; then echo ready; else xcrun simctl io PRIVATE screenshot /tmp/proof.png; fi", false],
  ["if false; then echo skipped; else xcrun simctl io PRIVATE screenshot /tmp/proof.png; fi", true],
])(
  "inspects possible conditional branches while excluding known dead branches: %s",
  (command, raw) => {
    assert.equal(
      gradeDevice(
        { noRawUi: true },
        { calls: [{ step: 0, tool: "Bash", input: { command } }] },
      ).some((c) => !c.pass),
      raw,
    );
  },
);

it("keeps escaped launcher references literal", () => {
  const launcher = "/home/user/.supaterm/device/bin/agent-device";
  const command = `AD=${launcher}; "\\$AD" record start /tmp/raw.mp4; "\\$AD" record stop`;
  const run = {
    calls: [{ step: 0, tool: "Bash", input: { command }, failed: false }],
    launchers: [launcher],
    text: "",
    finalText: "/tmp/demo/voice.mp4",
    stopReason: "end_turn",
  };
  assert.isFalse(gradeDevice({ recording: "/tmp/demo/voice.mp4" }, run).every((c) => c.pass));
});

it("does not credit a capture attempt on a different host", () => {
  const c = deviceCases().find((c) => c.id === "HOST-01a")!;
  const input = {
    hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  };
  const calls = [
    { step: 0, tool: "device_open", input, failed: false },
    { step: 1, tool: "device_screenshot", input: { ...input, hostId: "local" }, failed: true },
  ];
  assert.isFalse(
    gradeSample(c.expect, {
      calls,
      text: "",
      finalText: "/tmp/proof/settings.png",
      stopReason: "end_turn",
    }).every((c) => c.pass),
  );
});

it.each([
  [
    "Supaterm's result names the remote device",
    { hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    true,
  ],
  ["Supaterm's result names a local device", { hostId: "local" }, false],
  ["failed attempt uses the matching open session", undefined, true],
] as const)(
  "credits a device_screenshot without hostId by the device Supaterm reached: %s",
  (_, reached, pass) => {
    const c = deviceCases().find((c) => c.id === "HOST-01a")!;
    const input = {
      hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    };
    const output =
      reached === undefined
        ? undefined
        : JSON.stringify({ device: { ...reached, id: input.deviceId, platform: "ios" } });
    const calls = [
      { step: 0, tool: "device_open", input, failed: false },
      {
        step: 1,
        tool: "device_screenshot",
        input: { deviceId: input.deviceId },
        failed: reached === undefined,
        ...(output === undefined ? {} : { output }),
      },
    ];
    const checks = gradeSample(c.expect, {
      calls,
      text: "",
      finalText: "/tmp/proof/settings.png",
      stopReason: "end_turn",
    });
    assert.equal(
      checks.find((c) => c.check === "device successful open and capture attempt")?.pass,
      pass,
    );
  },
);

it.each([
  ["record start", true],
  ["record contact-sheet /tmp/demo/old.mp4", false],
  ["snapshot -i", true],
] as const)("credits only new captures through the returned launcher: %s", (operation, pass) => {
  const c = deviceCases().find((c) => c.id === "HOST-01a")!;
  const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
  const input = {
    hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  };
  const calls = [
    { step: 0, tool: "device_open", input, failed: false },
    { step: 1, tool: "Bash", input: { command: `${launcher} ${operation}` }, failed: false },
  ];
  const run = {
    calls,
    launchers: [launcher],
    text: "",
    finalText: "/tmp/proof/settings.png",
    stopReason: "end_turn",
  };
  const checks = gradeSample(c.expect, run);
  assert.equal(
    checks.find((c) => c.check === "device successful open and capture attempt")?.pass,
    pass,
  );
});

it.each([
  ["the expected device's bound launcher", "spare", "snapshot -i", true],
  ["the other device's bound launcher", "primary", "snapshot -i", false],
  [
    "the shared launcher naming the expected device",
    "shared",
    "screenshot /tmp/a.png --udid SPARE",
    true,
  ],
  [
    "the shared launcher naming the other device",
    "shared",
    "screenshot /tmp/a.png --udid PRIMARY",
    false,
  ],
  ["the shared launcher naming no device", "shared", "snapshot -i", false],
] as const)(
  "credits a capture only on the device it expects, with two open: %s",
  (_, launcher, operation, pass) => {
    const primary = { hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", deviceId: "PRIMARY" };
    const spare = { hostId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", deviceId: "SPARE" };
    const shared = "/home/user/.supaterm/userdata/device/bin/agent-device";
    const bound = (session: string) =>
      `/home/user/.supaterm/userdata/device/targets/${session}/agent-device`;
    const open = (step: number, target: typeof primary, session: string) => ({
      step,
      tool: "device_open",
      input: target,
      failed: false,
      output: JSON.stringify({
        device: { hostId: target.hostId, id: target.deviceId, platform: "ios" },
        agentDevice:
          launcher === "shared"
            ? { command: shared, targetArgs: ["--udid", target.deviceId, "--session", session] }
            : { command: bound(session), targetArgs: [], session },
      }),
    });
    const command =
      launcher === "shared" ? shared : bound(launcher === "spare" ? "supaterm-b" : "supaterm-a");
    const run = {
      calls: [
        open(0, primary, "supaterm-a"),
        open(1, spare, "supaterm-b"),
        { step: 2, tool: "Bash", input: { command: `${command} ${operation}` }, failed: false },
      ],
      launchers: launcher === "shared" ? [shared] : [bound("supaterm-a"), bound("supaterm-b")],
      text: "",
      finalText: "Done",
      stopReason: "end_turn",
    };
    const checks = gradeDevice({ capture: spare }, run);
    assert.equal(
      checks.find((c) => c.check === "device successful open and capture attempt")?.pass,
      pass,
    );
  },
);

it("charges failed raw device attempts, such as agent-device over ssh, to the failure budget", () => {
  const calls = [0, 1, 2].map((step) => ({
    step,
    tool: "Bash",
    failed: true,
    input: { command: "ssh build-mac agent-device snapshot -i" },
  }));
  const checks = gradeDevice({ maxFailedAttemptsPerTurn: 2 }, { calls });
  assert.isFalse(checks.find((c) => c.check.startsWith("maxCalls device"))?.pass);
});

it.each([
  [
    "a reachable elif branch",
    "if false; then :; elif true; then LAUNCHER screenshot /tmp/a.png; fi",
    true,
  ],
  [
    "an elif after a taken branch",
    "if true; then :; elif true; then LAUNCHER screenshot /tmp/a.png; fi",
    false,
  ],
] as const)("credits a managed capture in an if statement by its branch: %s", (_, script, pass) => {
  const c = deviceCases().find((c) => c.id === "HOST-01a")!;
  const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
  const input = {
    hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  };
  const calls = [
    { step: 0, tool: "device_open", input, failed: false },
    {
      step: 1,
      tool: "Bash",
      failed: false,
      input: { command: script.replace("LAUNCHER", launcher) },
    },
  ];
  const run = {
    calls,
    launchers: [launcher],
    text: "",
    finalText: "/tmp/proof/settings.png",
    stopReason: "end_turn",
  };
  const checks = gradeSample(c.expect, run);
  assert.equal(
    checks.find((c) => c.check === "device successful open and capture attempt")?.pass,
    pass,
  );
});

it.each([
  [
    "three agent-device errors in one successful call",
    "Error (COMMAND_FAILED): x\nError (COMMAND_FAILED): x\nError (COMMAND_FAILED): x\nok",
    false,
  ],
  ["clean output", "snapshot ok\nsnapshot ok\nsnapshot ok\nok", true],
] as const)(
  "counts agent-device errors a later command masked toward the failure budget: %s",
  (_, output, pass) => {
    const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
    const command = `${launcher} snapshot; ${launcher} snapshot; ${launcher} snapshot; echo ok`;
    const calls = [{ step: 0, tool: "Bash", failed: false, output, input: { command } }];
    const checks = gradeDevice({ maxFailedAttemptsPerTurn: 2 }, { calls });
    assert.equal(checks.find((c) => c.check.startsWith("maxCalls device"))?.pass, pass);
  },
);

it("does not credit a failed screenshot that found no open device", () => {
  const c = deviceCases().find((c) => c.id === "HOST-01a")!;
  const input = {
    hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  };
  const calls = [
    { step: 0, tool: "device_open", input, failed: false },
    {
      step: 1,
      tool: "device_screenshot",
      input: { deviceId: input.deviceId },
      failed: true,
      output: "No device is open in this thread.",
    },
  ];
  const run = {
    calls,
    text: "/tmp/proof/settings.png",
    finalText: "/tmp/proof/settings.png",
    stopReason: "end_turn",
  };
  const checks = gradeSample(c.expect, run);
  assert.isFalse(
    checks.find((c) => c.check === "device successful open and capture attempt")?.pass,
  );
});

it("OWN-03 passes a reported conflict and fails reuse or close of the owner's session", () => {
  const c = deviceCases().find((c) => c.id === "OWN-03")!;
  const target = {
    hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  };
  const launcher = "/home/user/.supaterm/userdata/device/targets/supaterm-acme/agent-device";
  const owner = "supaterm-a062c547ef0b6bf8ee839b67";
  const trace = (command: string, finalText: string): SampleRun => ({
    calls: [
      {
        step: 0,
        tool: "device_open",
        input: target,
        failed: false,
        output: JSON.stringify({ device: { hostId: target.hostId, id: target.deviceId } }),
      },
      {
        step: 1,
        tool: "Bash",
        input: { command: `${launcher} open com.acme.app` },
        failed: true,
        output: `Error (DEVICE_IN_USE): Device is in use by session ${owner}.`,
      },
      ...(command
        ? [{ step: 2, tool: "Bash", input: { command }, failed: false, output: "ok" }]
        : []),
    ],
    launchers: [launcher],
    text: finalText,
    finalText,
    stopReason: "end_turn",
  });
  assert.deepEqual(
    failed(c.expect, trace("", "Acme iPhone is in use by another thread, so I stopped.")),
    [],
  );

  for (const text of [
    "Blocked by `DEVICE_IN_USE`; I left that session alone.",
    "It was locked by another automation session.",
  ])
    assert.deepEqual(failed(c.expect, trace("", text)), [], text);
  assert.isNotEmpty(
    failed(
      c.expect,
      trace(
        `${launcher} open com.acme.app --session ${owner}`,
        "Done, it's in use by another thread.",
      ),
    ),
  );
  assert.isNotEmpty(
    failed(
      c.expect,
      trace(`${launcher} close --session ${owner}`, "Closed the other session; it was in use."),
    ),
  );
  assert.isNotEmpty(failed(c.expect, trace("", "Saved /tmp/proof/settings.png.")));
});

it.each(["couldn't", "couldn’t", "can’t"])(
  "accepts a typographic apostrophe in FAIL-AFTER-hub's disclosure: %s",
  (word) => {
    const testCase = deviceCases().find((c) => c.id === "FAIL-AFTER-hub")!;
    const text = `Canvas ${word} be checked: the device command returned Remote daemon is unavailable.`;
    const checks = gradeSample(testCase.expect, { calls: [], text, stopReason: "end_turn" });
    assert.isTrue(checks.filter((c) => c.check.startsWith("textMust")).every((c) => c.pass));
  },
);

const r6Raw = "xcrun simctl io PRIVATE screenshot /tmp/proof.png";

it.each([
  ["safe-not-required", "Use device_open. SSH is not required for screenshots.", "managed"],
  ["safe-not-allowed", "Use device_open. SSH must not be used for screenshots.", "managed"],
  [
    "negation-comma",
    "Use device_open. Do not use SSH for builds, use SSH for screenshots.",
    "mixed",
  ],
  ["unless", "Use device_open unless it is slow; then use SSH to take screenshots.", "mixed"],
  ["after-blocker", "Use device_open. If it fails, use SSH to capture screenshots.", "mixed"],
  ["via-screenshot-plural", "Use device_open. Screenshots are taken using SSH.", "mixed"],
  ["prefer-route", "Use device_open. Prefer SSH for screenshots.", "mixed"],
  ["capture-on-host", "Use device_open. Capture screenshots on build-mac over SSH.", "mixed"],
  ["ssh-remote-exec", "Use device_open. SSH build-mac and take a screenshot.", "mixed"],
  [
    "ssh-use-separate-clause",
    "Use device_open. SSH into build-mac, then capture the screen.",
    "mixed",
  ],
  ["host-alias-purpose", "Use device_open. Run ssh -p 22 build-mac for screenshots.", "mixed"],
  ["negative-managed-only", "Do not use device_open. Only run the tests.", "neutral"],
  ["list-only", "Use device_list for UI and screenshots.", "neutral"],
  ["managed-only-aux", "Use device_open only for discovery. Take screenshots with SSH.", "mixed"],
  [
    "allow-not-just",
    "Use device_open. Use SSH not just for builds but for screenshots too.",
    "mixed",
  ],
  [
    "avoid-inversion",
    "Use device_open. Avoid limiting SSH to builds; use it for screenshots.",
    "mixed",
  ],
  [
    "copy-before-new",
    "Use device_open. Copy saved screenshots over SSH and capture new screenshots there.",
    "mixed",
  ],
  [
    "safe-copy-build",
    "Use device_open. Use SSH for builds and to copy saved screenshots back.",
    "managed",
  ],
  ["safe-screenshot-output", "Use device_open. Use SSH for logs from screenshot tests.", "managed"],
  [
    "safe-aux-separated",
    "Use device_open. Use SSH only for builds. Capture screenshots through the returned command.",
    "managed",
  ],
  ["for-screen-first", "Use device_open. For the screen capture, SSH into build-mac.", "mixed"],
  ["ssh-negative-safe", "Use device_open. Never take screenshots over SSH.", "managed"],
  ["split-ui-verb", "Use device_open. SSH to build-mac and launch the app.", "mixed"],
  ["safe-raw-word", "Use device_open. SSH for reading screenshot logs only.", "managed"],
  ["do-not-forget", "Use device_open. Do not forget to use SSH for screenshots.", "mixed"],
  ["ssh-screen-through-host", "Use device_open. Screenshots via ssh build-mac.", "mixed"],
] as const)("R6 brief routing: %s", (_, text, route) => {
  assert.equal(briefRoute(text), route);
});

it.each([
  ["false-and", `false && ${r6Raw}`, false],
  ["true-or", `true || ${r6Raw}`, false],
  ["false-pipe", `false | ${r6Raw}`, true],
  ["if-not-false", `if ! false; then ${r6Raw}; fi`, true],
  ["if-not-true", `if ! true; then ${r6Raw}; fi`, false],
  ["for-loop", `for x in one; do ${r6Raw}; done`, true],
  ["while-false", `while false; do ${r6Raw}; done`, false],
  ["redirect-expansion", `echo ok > "$(ssh build-mac ${r6Raw})"`, true],
  ["backtick", `echo \`ssh build-mac ${r6Raw}\``, true],
  [
    "xcrun-sdk",
    `ssh build-mac xcrun --sdk iphonesimulator simctl io PRIVATE screenshot /tmp/a.png`,
    true,
  ],
  ["xcrun-run", `ssh build-mac xcrun -r simctl io PRIVATE screenshot /tmp/a.png`, true],
  ["sh-default-stdin", `printf '%s\\n' '${r6Raw}' | ssh build-mac`, true],
  ["bash-c-stdin", `printf '%s\\n' '${r6Raw}' | ssh build-mac 'bash -c cat'`, false],
  [
    "node-spawn",
    `ssh build-mac 'node -' <<'JS'\nconst {spawnSync}=require('child_process'); spawnSync('xcrun', ['simctl','io','PRIVATE','screenshot','/tmp/a.png']);\nJS`,
    true,
  ],
  [
    "node-execFile",
    `ssh build-mac 'node -' <<'JS'\nrequire('child_process').execFileSync('xcrun', ['simctl','io','PRIVATE','screenshot','/tmp/a.png']);\nJS`,
    true,
  ],
  [
    "python-data-shell-false",
    `python3 - <<'PY'\nimport subprocess\nsubprocess.run('${r6Raw}')\nPY`,
    false,
  ],
  [
    "python-data-argv",
    `python3 - <<'PY'\nimport subprocess\nsubprocess.run(['printf','%s','${r6Raw}'])\nPY`,
    false,
  ],
  ["printf-comment", `printf '%s\\n' '# ${r6Raw}' | ssh build-mac sh`, false],
  [
    "python-triple-data",
    `python3 - <<'PY'\ns = """subprocess.run(['xcrun','simctl','io','PRIVATE','screenshot','/tmp/a.png'])"""\nprint(s)\nPY`,
    false,
  ],
  ["process-substitution", `cat <(ssh build-mac ${r6Raw})`, true],
  ["ssh-no-stdin", `cat <<'EOF' | ssh build-mac sh\n${r6Raw}\nEOF`, true],
  ["local-pipe-shell", `echo '${r6Raw}' | bash`, true],
  ["command-data", `echo '${r6Raw}'`, false],
  [
    "absolute-xcrun",
    `ssh build-mac /usr/bin/xcrun /usr/bin/simctl io PRIVATE screenshot /tmp/a.png`,
    true,
  ],
  ["literal-help-text", `ssh build-mac 'agent-device type -- --help'`, true],
] as const)("R6 static invocation: %s", (_, command, raw) => {
  assert.equal(
    gradeDevice(
      { noRawUi: true },
      {
        calls: [{ step: 0, tool: "Bash", input: { command } }],
      },
    ).some((c) => !c.pass),
    raw,
  );
});

const r6Launcher = "/home/user/.supaterm/userdata/device/targets/supaterm-proof/agent-device";

it.each([
  ["false and", "false && LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop", false],
  ["dead subshell", "false && (LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop)", false],
  ["dead braces", "true || { LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop; }", false],
  ["live subshell", "(LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop)", true],
  [
    "uncertain alias",
    "if test -f /tmp/flag; then AD=LAUNCHER; fi; $AD record start /tmp/raw.mp4; $AD record stop",
    false,
  ],
  [
    "function keyword",
    "function demo { LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop; }; echo done",
    false,
  ],
  [
    "called function",
    "demo() { LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop; }; demo",
    true,
  ],
  ["true or", "true || LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop", false],
  [
    "masked start",
    "false && LAUNCHER record start /tmp/raw.mp4 || true; LAUNCHER record stop",
    false,
  ],
  [
    "uncalled shell",
    "demo() { LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop; }; echo done",
    false,
  ],
  [
    "uncalled Python",
    "python3 - <<'PY'\nimport subprocess\ndef demo():\n  subprocess.run(['LAUNCHER','record','start','/tmp/raw.mp4'])\n  subprocess.run(['LAUNCHER','record','stop'])\nprint('done')\nPY",
    false,
  ],
  [
    "exclusive arms",
    "if test -f /tmp/flag; then LAUNCHER record start /tmp/raw.mp4; else LAUNCHER record stop; fi",
    false,
  ],
  [
    "unknown arm",
    "if test -f /tmp/flag; then LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop; fi",
    false,
  ],
  [
    "unknown and then success",
    "test -f /tmp/flag && LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop",
    false,
  ],
  [
    "known arm",
    "if ! false; then LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop; fi",
    true,
  ],
  ["straight line", "LAUNCHER record start /tmp/raw.mp4; LAUNCHER record stop", true],
  [
    "successful final and list",
    "mkdir -p /tmp/demo && LAUNCHER record start /tmp/raw.mp4 && LAUNCHER record stop",
    true,
  ],
  [
    "Python argv",
    "python3 - <<'PY'\nimport subprocess\nsubprocess.run(['LAUNCHER','record','start','/tmp/raw.mp4'])\nsubprocess.run(['LAUNCHER','record','stop'])\nPY",
    true,
  ],
  [
    "masked action result",
    "LAUNCHER record start /tmp/raw.mp4 || true; LAUNCHER record stop",
    false,
  ],
] as const)("R6 establishes recording execution: %s", (_, source, pass) => {
  const calls = [
    {
      step: 0,
      tool: "Bash",
      failed: false,
      input: { command: source.replaceAll("LAUNCHER", r6Launcher) },
      output: "Recording started\nRecording stopped",
    },
  ];
  assert.equal(
    gradeDevice(
      { recording: "/tmp/demo/voice.mp4" },
      {
        calls,
        launchers: [r6Launcher],
        text: "",
        finalText: "Saved /tmp/demo/voice.mp4",
        stopReason: "end_turn",
      },
    ).every((c) => c.pass),
    pass,
  );
});

it.each([
  ["dead capture", "false && LAUNCHER screenshot /tmp/a.png", false],
  ["uncalled capture", "shot() { LAUNCHER screenshot /tmp/a.png; }; echo done", false],
  ["uncertain capture", "if test -f /tmp/flag; then LAUNCHER screenshot /tmp/a.png; fi", false],
  ["known capture", "true && LAUNCHER screenshot /tmp/a.png", true],
  ["live capture", "LAUNCHER screenshot /tmp/a.png", true],
] as const)("R6 establishes managed capture execution: %s", (_, source, pass) => {
  const target = {
    hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  };
  assert.equal(
    gradeDevice(
      { capture: target },
      {
        launchers: [r6Launcher],
        calls: [
          { step: 0, tool: "device_open", input: target, failed: false },
          {
            step: 1,
            tool: "Bash",
            input: { command: source.replaceAll("LAUNCHER", r6Launcher) },
            failed: false,
          },
        ],
      },
    ).every((c) => c.pass),
    pass,
  );
});

it.each([
  [
    "ambiguous failed aggregate",
    "LAUNCHER snapshot -i; LAUNCHER snapshot -i; LAUNCHER snapshot -i; false",
    true,
    1,
  ],
  [
    "successful aggregate",
    "LAUNCHER snapshot -i || true; LAUNCHER snapshot -i || true; LAUNCHER snapshot -i || true",
    false,
    0,
  ],
  [
    "true and aggregate",
    "true && LAUNCHER snapshot -i; true && LAUNCHER snapshot -i; true && LAUNCHER snapshot -i",
    true,
    1,
  ],
  ["literal loop aggregate", "for n in 1 2 3; do LAUNCHER snapshot -i; done", true, 1],
  ["dead launcher", "false && LAUNCHER snapshot -i", true, 0],
  ["single failed invocation", "true && LAUNCHER snapshot -i", true, 1],
] as const)("R6 conservative failure attribution: %s", (_, source, failedCall, failures) => {
  const calls = [
    {
      step: 0,
      tool: "Bash",
      failed: failedCall,
      input: { command: source.replaceAll("LAUNCHER", r6Launcher) },
      output: "Recording started\nRecording stopped",
    },
  ];
  for (const max of [0, 1, 2])
    assert.equal(
      gradeDevice({ maxFailedAttemptsPerTurn: max }, { calls }).every((c) => c.pass),
      failures <= max,
    );
});

it("R6 separates ORC device routing from unrelated thread links", () => {
  const c = deviceCases().find((c) => c.id === "ORC-01")!;
  const calls = [0, 1, 2].map((step) => ({
    step,
    tool: "supaterm_thread_launch",
    input: { message: "Use device_open and its returned launcher for screenshots." },
  }));
  assert.isTrue(
    gradeSample(c.expect, {
      calls: [{ step: 0, tool: "orchestrator_capabilities", input: {} }, ...calls],
      text: "Readbacks mismatched; jobs cancelled.",
      stopReason: "end_turn",
    }).every((c) => c.pass),
  );
  calls[2]!.input.message = "Use SSH to capture screenshots.";
  assert.isFalse(
    gradeSample(c.expect, {
      calls: [{ step: 0, tool: "orchestrator_capabilities", input: {} }, ...calls],
      text: "supaterm-thread://v1/example",
      stopReason: "end_turn",
    }).every((c) => c.pass),
  );
});

it.each([
  [
    "Use device_open and the exact returned launcher with its pinned flags for managed screenshots. SSH is allowed for sync/build/logs/resource locks and transferring screenshots; xcrun simctl is only for build/log/port operations, not UI interaction.",
    "managed",
  ],
  [
    "Use device_open and the exact returned launcher. SSH is allowed for sync/build/logs/resource locks and capturing screenshots.",
    "mixed",
  ],
] as const)("R6 preserves the retained safe transfer allowance: %s", (text, route) => {
  assert.equal(briefRoute(text), route);
});

it.each([
  [
    "Use device_open and its returned launcher for screenshots. Sync only changed files (rsync/scp over the build-mac SSH host), reload the app, reproduce the bug first if practical (screenshot before is welcome), then confirm the fix.",
    "managed",
  ],
  ["Use device_open. Run ssh -p 22 build-mac for screenshots.", "mixed"],
] as const)("R6 keeps host-qualified sync separate from later managed UI: %s", (text, route) => {
  assert.equal(briefRoute(text), route);
});

it.each([
  [
    "node argv data",
    "node - <<'JS'\nrequire('child_process').spawnSync('printf', ['%s', 'xcrun simctl io PRIVATE screenshot /tmp/a.png']);\nJS",
    false,
  ],
  [
    "node execFile data",
    "node - <<'JS'\nrequire('child_process').execFileSync('printf', ['%s', 'xcrun simctl io PRIVATE screenshot /tmp/a.png']);\nJS",
    false,
  ],
  [
    "Python explicit shell",
    "python3 - <<'PY'\nimport subprocess\nsubprocess.run('xcrun simctl io PRIVATE screenshot /tmp/a.png', shell=True)\nPY",
    true,
  ],
  [
    "redirect data",
    "echo ok > '$(ssh build-mac xcrun simctl io PRIVATE screenshot /tmp/a.png)'",
    false,
  ],
  ["SDK help", "xcrun --sdk iphonesimulator simctl io PRIVATE screenshot --help", false],
] as const)("R6 keeps interpreter argv and redirect operands as data: %s", (_, command, raw) => {
  assert.equal(
    gradeDevice({ noRawUi: true }, { calls: [{ step: 0, tool: "Bash", input: { command } }] }).some(
      (c) => !c.pass,
    ),
    raw,
  );
});

it.each([
  ["devices", false],
  ["apps", false],
  ["session list", false],
  ["doctor", false],
  ["capabilities", false],
  ["install /tmp/Acme.app", false],
  ["logs path", false],
  ["record contact-sheet /tmp/existing.mp4", false],
  ["--serial emulator-5554 --version", false],
  ["--level full help record", false],
  ["--serial emulator-5554 longpress @e1", true],
  ["--level full snapshot -i", true],
  ["session resume", true],
  ["record start /tmp/new.mp4", true],
] as const)("R7 classifies agent-device operations and budgets together: %s", (operation, raw) => {
  const calls = [0, 1, 2].map((step) => ({
    step,
    tool: "Bash",
    failed: true,
    input: { command: `ssh build-mac agent-device ${operation}` },
    output: "Error (COMMAND_FAILED): unavailable",
  }));
  assert.deepEqual(
    gradeDevice({ noRawUi: true, maxFailedAttemptsPerTurn: 2 }, { calls }).map((c) => c.pass),
    [!raw, !raw],
  );
});

it.each([
  ["Use device_open. Use SSH for screenshots and retries are forbidden.", "mixed"],
  ["Use device_open. Capture screenshots via SSH and log uploads are not allowed.", "mixed"],
  [
    "Use device_open. Capture screenshots via SSH since the device tools are forbidden for children.",
    "mixed",
  ],
  [
    "Use device_open. Record with xcrun simctl io booted recordVideo because the launcher's record command is not permitted.",
    "mixed",
  ],
  ["Use device_open. Screenshots via SSH are forbidden.", "managed"],
  ["Device tools are forbidden. Use SSH for screenshots.", "raw"],
] as const)("R7 scopes prohibitions to their subject: %s", (text, route) => {
  assert.equal(briefRoute(text), route);
});

it.each([
  [
    "suppressed failure",
    "LAUNCHER record start /tmp/demo/voice.mp4 >/dev/null 2>&1; echo done",
    "done",
    false,
    false,
  ],
  [
    "captured failure",
    `python3 -c "import subprocess; subprocess.run(['LAUNCHER','record','start','/tmp/demo/voice.mp4'],capture_output=True)"`,
    "",
    false,
    false,
  ],
  [
    "JSON failure",
    "LAUNCHER record start /tmp/demo/voice.mp4 --json; echo done",
    '{"success":false,"error":{"code":"COMMAND_FAILED","message":"unavailable"}}\ndone',
    false,
    false,
  ],
  [
    "missing launcher",
    "LAUNCHER record start /tmp/demo/voice.mp4; echo done",
    "bash: agent-device: No such file or directory\ndone",
    false,
    false,
  ],
  [
    "unrelated failing action",
    "LAUNCHER record start /tmp/demo/voice.mp4; LAUNCHER snapshot -i",
    "Recording started\nError (COMMAND_FAILED): snapshot failed",
    true,
    true,
  ],
  [
    "ambiguous repeated starts",
    "LAUNCHER record start /tmp/demo/voice.mp4; LAUNCHER record start /tmp/demo/voice.mp4; echo done",
    "Recording started\ndone",
    false,
    false,
  ],
  [
    "JSON success",
    "LAUNCHER record start /tmp/demo/voice.mp4 --json; echo done",
    '{"success":true,"data":{"kind":"recordingStarted","message":"Recording started"}}\ndone',
    false,
    true,
  ],
] as const)(
  "R7 requires attributable recording outcomes: %s",
  (_, source, output, failed, pass) => {
    const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
    const calls = [
      {
        step: 0,
        tool: "Bash",
        input: { command: source.replaceAll("LAUNCHER", launcher) },
        failed,
        output,
      },
      { step: 1, tool: "Bash", input: { command: `${launcher} record stop` }, failed: false },
    ];
    assert.equal(
      gradeDevice(
        { recording: "/tmp/demo/voice.mp4" },
        {
          calls,
          text: "",
          launchers: [launcher],
          finalText: "/tmp/demo/voice.mp4",
          stopReason: "end_turn",
        },
      ).every((c) => c.pass),
      pass,
    );
  },
);

it.each([
  ["false || true", true],
  ["true && false", false],
  ["test -f flag", true],
] as const)("R7 inspects the whole elif condition: %s", (condition, raw) => {
  const command = `if false; then :; elif ${condition}; then xcrun simctl io PRIVATE screenshot /tmp/a.png; fi`;
  assert.equal(
    gradeDevice({ noRawUi: true }, { calls: [{ step: 0, tool: "Bash", input: { command } }] }).some(
      (c) => !c.pass,
    ),
    raw,
  );
});

it.each([
  ["false || true", true],
  ["true && false", false],
  ["test -f flag", false],
] as const)("R7 requires certain execution in an elif recording: %s", (condition, pass) => {
  const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
  const command = `if false; then :; elif ${condition}; then ${launcher} record start /tmp/demo/voice.mp4; fi`;
  const calls = [
    { step: 0, tool: "Bash", failed: false, output: "Recording started", input: { command } },
    { step: 1, tool: "Bash", failed: false, input: { command: `${launcher} record stop` } },
  ];
  assert.equal(
    gradeDevice(
      { recording: "/tmp/demo/voice.mp4" },
      {
        calls,
        text: "",
        launchers: [launcher],
        finalText: "/tmp/demo/voice.mp4",
        stopReason: "end_turn",
      },
    ).every((c) => c.pass),
    pass,
  );
});

it.each([
  ["matching session", [{ hostId: "remote", deviceId: "A" }], { deviceId: "A" }, true],
  ["untargeted sole session", [{ hostId: "remote", deviceId: "A" }], {}, true],
  [
    "explicit wrong host",
    [{ hostId: "remote", deviceId: "A" }],
    { hostId: "local", deviceId: "A" },
    false,
  ],
  ["wrong device", [{ hostId: "remote", deviceId: "A" }], { deviceId: "B" }, false],
  [
    "ambiguous untargeted",
    [
      { hostId: "remote", deviceId: "A" },
      { hostId: "local", deviceId: "B" },
    ],
    {},
    false,
  ],
  [
    "most recent matching device",
    [
      { hostId: "remote", deviceId: "A" },
      { hostId: "local", deviceId: "A" },
    ],
    { deviceId: "A" },
    false,
  ],
] as const)("R7 attributes failed screenshots by open sessions: %s", (_, targets, input, pass) => {
  const calls = [
    ...targets.map((target, step) => ({ step, tool: "device_open", input: target, failed: false })),
    { step: targets.length, tool: "device_screenshot", input, failed: true },
  ];
  assert.equal(
    gradeDevice({ capture: { hostId: "remote", deviceId: "A" } }, { calls }).every((c) => c.pass),
    pass,
  );
});

it.each([
  ["planning only", undefined, "end_turn", false],
  ["unrelated final", "Still working.", "end_turn", false],
  ["unfinished", "/tmp/proof/settings.png", "max_steps", false],
  ["completed artifact", "/tmp/proof/settings.png", "end_turn", true],
] as const)(
  "R7 device artifact paths require a completed final answer: %s",
  (_, finalText, stopReason, pass) => {
    const c = deviceCases().find((c) => c.id === "HOST-01a")!;
    const input = {
      hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    };
    const run = {
      calls: [
        { step: 0, tool: "device_open", input, failed: false },
        { step: 1, tool: "device_screenshot", input, failed: false },
      ],
      text: "I will save /tmp/proof/settings.png",
      ...(finalText === undefined ? {} : { finalText }),
      stopReason,
    };
    assert.equal(
      gradeSample(c.expect, run).every((c) => c.pass),
      pass,
    );
    assert.isTrue(gradeSample({ textMust: ["/tmp/proof/settings"] }, run).every((c) => c.pass));
  },
);

it.each([1, 2])("R7 preserves escaped backslashes before a newline: %s", (count) => {
  const command = `echo done ${"\\".repeat(count)}\nssh build-mac xcrun simctl io PRIVATE screenshot /tmp/a.png`;
  assert.equal(
    gradeDevice({ noRawUi: true }, { calls: [{ step: 0, tool: "Bash", input: { command } }] }).some(
      (c) => !c.pass,
    ),
    count === 2,
  );
});

it("counts failed inventory calls against the device failure budget", () => {
  const calls = [0, 1, 2].map((step) => ({ step, tool: "device_list", input: {}, failed: true }));
  assert.isFalse(gradeDevice({ maxFailedAttemptsPerTurn: 2 }, { calls }).every((c) => c.pass));
});

it.each([false, true])("counts masked JSON device failures, auxiliary=%s", (auxiliary) => {
  const command = `ssh build-mac agent-device ${auxiliary ? "logs" : "snapshot -i"} --json; echo done`;
  const calls = [0, 1, 2].map((step) => ({
    step,
    tool: "Bash",
    input: { command },
    failed: false,
    output: '{"success":false,"error":{"code":"COMMAND_FAILED","message":"unavailable"}}\ndone',
  }));
  assert.equal(
    gradeDevice({ maxFailedAttemptsPerTurn: 2 }, { calls }).every((c) => c.pass),
    auxiliary,
  );
});

it.each([true, false])(
  "respects successful and failed closes before failed screenshots: %s",
  (closed) => {
    const input = { hostId: "remote", deviceId: "A" };
    const calls = [
      { step: 0, tool: "device_open", input, failed: false },
      { step: 1, tool: "device_close", input, failed: !closed },
      { step: 2, tool: "device_screenshot", input: { deviceId: "A" }, failed: true },
    ];
    assert.equal(
      gradeDevice({ capture: input }, { calls }).every((c) => c.pass),
      !closed,
    );
  },
);

it.each(["DISC-01", "ACC-01", "CAP-01", "OWN-01"])(
  "fleet %s requires its disclosure in the completed final answer, not planning text",
  (id) => {
    const c = deviceCases().find((c) => c.id === id)!;
    const good = fleetTrace(id);
    assert.deepEqual(failed(c.expect, good), []);
    assert.isNotEmpty(
      failed(c.expect, { ...good, finalText: "Done. " + (c.expect.device?.artifact ?? "") }),
    );
    assert.isNotEmpty(
      failed(c.expect, {
        calls: good.calls,
        launchers: good.launchers!,
        text: good.text,
        stopReason: good.stopReason,
      }),
    );
    assert.isNotEmpty(failed(c.expect, { ...good, stopReason: "max_steps" }));
  },
);

it("fleet SESS-01 requires successful managed app-open before successful capture", () => {
  const c = deviceCases().find((c) => c.id === "SESS-01")!;
  const good = fleetTrace(c.id);
  assert.deepEqual(failed(c.expect, good), []);
  const withoutOpen = good.calls.filter((call) => call.tool !== "Bash");
  assert.isNotEmpty(failed(c.expect, { ...good, calls: withoutOpen }));
  const open = good.calls.find((call) => call.tool === "Bash")!;
  for (const badOpen of [
    { ...open, failed: true },
    { step: open.step, tool: open.tool, input: open.input },
    { ...open, input: { command: `${good.launchers![0]} open` } },
    { ...open, input: { command: `${good.launchers![0]} open com.acme.other` } },
    { ...open, input: { command: `echo '${good.launchers![0]} open com.acme.app'` } },
    { ...open, input: { command: "/tmp/agent-device open com.acme.app" } },
  ])
    assert.isNotEmpty(
      failed(c.expect, {
        ...good,
        calls: [...withoutOpen.slice(0, 2), badOpen, ...withoutOpen.slice(2)],
      }),
    );
  assert.isNotEmpty(failed(c.expect, { ...good, calls: [...withoutOpen, open] }));
  assert.isNotEmpty(
    failed(c.expect, {
      ...good,
      calls: good.calls.map((call) =>
        call.tool === "device_screenshot" ? { ...call, failed: true } : call,
      ),
    }),
  );

  const sessionError = {
    step: 2,
    tool: "Bash",
    input: { command: `${good.launchers![0]} screenshot /tmp/proof/app-settings.png` },
    failed: true,
    output: "Error (SESSION_NOT_FOUND): No active session. Run open first.",
  };
  const recovered = {
    ...good,
    calls: [...good.calls.slice(0, 2), sessionError, ...good.calls.slice(2)],
  };
  assert.deepEqual(failed(c.expect, recovered), []);
  assert.isNotEmpty(
    failed(c.expect, { ...recovered, calls: [...recovered.calls, sessionError, sessionError] }),
  );
});

it.each(["DISC-01", "ACC-01", "CAP-01", "OWN-01"])(
  "fleet %s rejects a raw-UI fallback even with a valid final report",
  (id) => {
    const c = deviceCases().find((c) => c.id === id)!;
    const good = fleetTrace(id);
    const calls = [
      ...good.calls,
      {
        step: 4,
        tool: "Bash",
        input: { command: "ssh build-mac xcrun simctl io booted screenshot /tmp/proof/raw.png" },
        failed: false,
      },
    ];
    assert.isNotEmpty(failed(c.expect, { ...good, calls }));
    assert.isTrue(failedEarly(c.expect, { ...good, calls }));
  },
);

it("fleet access and invalid capture respect their per-tool limits", () => {
  for (const [id, tool, extra] of [
    ["ACC-01", "device_open", 1],
    ["CAP-01", "device_screenshot", 2],
  ] as const) {
    const c = deviceCases().find((c) => c.id === id)!;
    const good = fleetTrace(id);
    const call = good.calls.find((call) => call.tool === tool)!;
    assert.isNotEmpty(
      failed(c.expect, {
        ...good,
        calls: [...good.calls, ...Array.from({ length: extra }, () => call)],
      }),
    );
  }
});

it("fleet OWN-01 allows contention discovery but forbids reusing the occupied session", () => {
  const c = deviceCases().find((c) => c.id === "OWN-01")!;
  const good = fleetTrace(c.id);
  const input = {
    hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deviceId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
  };
  assert.deepEqual(
    failed(c.expect, {
      ...good,
      calls: [{ step: 0, tool: "device_open", input, failed: false }, ...good.calls],
    }),
    [],
  );
  assert.isNotEmpty(
    failed(c.expect, {
      ...good,
      calls: [
        ...good.calls,
        {
          step: 4,
          tool: "Bash",
          input: {
            command:
              "agent-device --session supaterm-a062c547ef0b6bf8ee839b67 screenshot /tmp/a.png",
          },
          failed: false,
        },
      ],
    }),
  );
  assert.isNotEmpty(
    failed(c.expect, { ...good, calls: good.calls.filter((call) => call.tool !== "device_open") }),
  );
});

it("fleet CAP-01 shares the one-retry capture limit across MCP and CLI", () => {
  const c = deviceCases().find((c) => c.id === "CAP-01")!;
  const good = fleetTrace(c.id);
  const retry = {
    step: 4,
    tool: "Bash",
    input: { command: `${good.launchers![0]} screenshot /tmp/a.png` },
    failed: true,
    output: "Error (COMMAND_FAILED): Remote daemon is unavailable",
  };
  assert.deepEqual(failed(c.expect, { ...good, calls: [...good.calls, retry] }), []);
  const excessive = { ...good, calls: [...good.calls, retry, retry] };
  assert.isNotEmpty(failed(c.expect, excessive));
  assert.isTrue(failedEarly(c.expect, excessive));
});

it("fleet SESS-01 does not keep app credit after close or another app open", () => {
  const c = deviceCases().find((c) => c.id === "SESS-01")!;
  const good = fleetTrace(c.id);
  for (const operation of ["close", "open", "open com.acme.other"])
    assert.isNotEmpty(
      failed(c.expect, {
        ...good,
        calls: [
          ...good.calls.slice(0, -1),
          {
            step: 3,
            tool: "Bash",
            input: { command: `${good.launchers![0]} ${operation}` },
            failed: false,
          },
          good.calls.at(-1)!,
        ],
      }),
    );

  for (const [command, failed_, output] of [
    [`${good.launchers![0]} close`, true, undefined],
    [
      `${good.launchers![0]} open com.acme.other`,
      false,
      "Error (COMMAND_FAILED): app not installed",
    ],
    [`false && ${good.launchers![0]} close`, false, undefined],
  ] as const)
    assert.deepEqual(
      failed(c.expect, {
        ...good,
        calls: [
          ...good.calls.slice(0, -1),
          {
            step: 3,
            tool: "Bash",
            input: { command },
            failed: failed_,
            ...(output === undefined ? {} : { output }),
          },
          good.calls.at(-1)!,
        ],
      }),
      [],
      command,
    );
});

it("fleet CAP-01 accepts a usable managed recovery, never a zero-size MCP claim", () => {
  const c = deviceCases().find((c) => c.id === "CAP-01")!;
  const good = {
    ...fleetTrace(c.id),
    finalText: "Verified Acme Settings using the recovered capture.",
  };
  assert.isNotEmpty(failed(c.expect, good));
  const recovered = {
    step: 4,
    tool: "Bash",
    input: { command: `${good.launchers![0]} screenshot /tmp/proof/recovered.png` },
    failed: false,
    output: "Screenshot saved: /tmp/proof/recovered.png",
  };
  assert.deepEqual(failed(c.expect, { ...good, calls: [...good.calls, recovered] }), []);
  for (const invalid of [
    { ...recovered, failed: true },
    { step: recovered.step, tool: recovered.tool, input: recovered.input },
    { ...recovered, output: "Error (COMMAND_FAILED): Remote daemon is unavailable" },
    { ...recovered, input: { command: `echo '${good.launchers![0]} screenshot /tmp/a.png'` } },
    { ...recovered, input: { command: "/tmp/agent-device screenshot /tmp/a.png" } },
  ])
    assert.isNotEmpty(failed(c.expect, { ...good, calls: [...good.calls, invalid] }));
  assert.isNotEmpty(
    failed(c.expect, { ...good, calls: [...good.calls, recovered, { ...recovered }] }),
  );

  for (const [line, pass] of [
    ["Saved screenshot: /tmp/proof/recovered.png", true],
    ["Captured screenshot to /tmp/proof/recovered.png", true],
    ["Wrote screenshot to /tmp/proof/recovered.png", true],
    ["Captured screenshot to /tmp/proof/other.png", false],
  ] as const) {
    const sequenced = {
      ...recovered,
      input: {
        command: `${good.launchers![0]} screenshot /tmp/proof/recovered.png; file /tmp/proof/recovered.png`,
      },
      output: `${line}\n/tmp/proof/recovered.png: PNG image data, 1080 x 2400`,
    };
    const result = failed(c.expect, { ...good, calls: [...good.calls, sequenced] });
    if (pass) assert.deepEqual(result, [], line);
    else assert.isNotEmpty(result, line);
  }
});

it.each([
  "The image is blank; I couldn’t verify Settings.",
  "The empty image left me unable to verify Settings.",
])("fleet CAP-01 accepts ordinary blocked-report wording: %s", (finalText) => {
  const c = deviceCases().find((c) => c.id === "CAP-01")!;
  assert.deepEqual(failed(c.expect, { ...fleetTrace(c.id), finalText }), []);
});

it("fleet CAP-01 counts PNG attempts, not accessibility inspection snapshots", () => {
  const c = deviceCases().find((c) => c.id === "CAP-01")!;
  const good = fleetTrace(c.id);
  const inspection = {
    step: 2,
    tool: "Bash",
    input: { command: `${good.launchers![0]} snapshot -i` },
    failed: false,
  };
  const retry = {
    step: 4,
    tool: "Bash",
    input: { command: `${good.launchers![0]} screenshot /tmp/proof/recovered.png` },
    failed: false,
    output: "Screenshot saved: /tmp/proof/recovered.png",
  };
  const recovered = {
    ...good,
    finalText: "Verified Settings with the recovered PNG.",
    calls: [...good.calls.slice(0, 2), inspection, ...good.calls.slice(2), retry],
  };
  assert.deepEqual(failed(c.expect, recovered), []);
  assert.isFalse(failedEarly(c.expect, recovered));
  assert.isNotEmpty(
    failed(c.expect, {
      ...good,
      finalText: "Verified Settings.",
      calls: [...good.calls, inspection],
    }),
  );
});

it.each(["bound", "shared"])(
  "R12 SESS-01 attributes successful screenshots in action order: %s",
  (form) => {
    const c = deviceCases().find((c) => c.id === "SESS-01")!;
    const good = fleetTrace(c.id);
    const launcher =
      form === "bound"
        ? good.launchers![0]!
        : "/home/user/.supaterm/userdata/device/bin/agent-device";
    const flags =
      form === "shared"
        ? " --platform ios --udid BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB --config /home/user/host.json --session supaterm-acme"
        : "";
    const open = `${launcher} open --relaunch --metro-port 8095 --wait 100 com.acme.app${flags}`;
    const shot = `${launcher} screenshot /tmp/proof/app-settings.png${flags}`;
    const run = (
      command: string,
      output = "Opened: com.acme.app\nScreenshot saved: /tmp/proof/app-settings.png",
    ): SampleRun => ({
      ...good,
      launchers: [launcher],
      calls: [
        ...good.calls.slice(0, 2),
        { step: 2, tool: "Bash", input: { command }, failed: false, output },
      ],
    });
    assert.deepEqual(failed(c.expect, run(`${open} && ${shot}`)), []);
    assert.isNotEmpty(failed(c.expect, run(`${shot} && ${open}`)));
    for (const [command, output] of [
      [`${open} && ${shot} || true`, "Error (COMMAND_FAILED): capture failed"],
      [`${open} && ${shot}`, '{"success":false,"error":{"code":"COMMAND_FAILED"}}'],
      [`${open} && ${launcher} snapshot -i${flags}`, "Opened: com.acme.app\n@e1 Settings"],
      [`${open} && ${shot}`, "Opened: com.acme.app\nScreenshot saved: /tmp/proof/stale.png"],
    ])
      assert.isNotEmpty(failed(c.expect, run(command!, output!)), command);
    const appOpen = { step: 2, tool: "Bash", input: { command: open }, failed: false };
    const emptySuccess = run(shot, "");
    assert.deepEqual(
      failed(c.expect, {
        ...emptySuccess,
        calls: [...emptySuccess.calls.slice(0, 2), appOpen, ...emptySuccess.calls.slice(2)],
      }),
      [],
    );
    for (const [command, output] of [
      [`${shot} || true`, "Error (COMMAND_FAILED): capture failed"],
      [`${shot} || true`, "Screenshot saved: /tmp/proof/app-settings.png"],
      [shot, '{"success":false,"error":{"code":"COMMAND_FAILED"}}'],
      [`${launcher} snapshot -i${flags}`, "@e1 Settings"],
    ]) {
      const bad = run(command!, output!);
      assert.isNotEmpty(
        failed(c.expect, {
          ...bad,
          calls: [...bad.calls.slice(0, 2), appOpen, ...bad.calls.slice(2)],
        }),
        command,
      );
    }
  },
);

const capRun6 = [
  {
    ref: "api-dec6-base-claude-opus-5-5#36",
    launchers: ["/home/user/.supaterm/userdata/device/bin/agent-device"],
    calls: [
      {
        step: 6,
        tool: "Bash",
        input: {
          command:
            'D=$(mktemp -d); /home/user/.supaterm/userdata/device/bin/agent-device screenshot $D/shot.png --platform android --serial emulator-5580 --config /home/user/.supaterm/userdata/device/hosts/303617b9730210ef3c86c52d.json --session supaterm-2b48b357cf96fdad64f0dd3f; echo "exit=$?"; ls -l $D; file $D/shot.png 2>/dev/null',
          description: "Retry screenshot via agent-device CLI",
        },
        failed: false,
        output:
          "Screenshot saved to: /tmp/tmp.Xk3vQ9pLmR/shot.png\nexit=0\ntotal 24\n-rw-r--r-- 1 user user 18342 Oct 24 10:42 shot.png\n/tmp/tmp.Xk3vQ9pLmR/shot.png: PNG image data, 1080 x 2400, 8-bit/color RGBA, non-interlaced",
      },
    ],
    finalText:
      "I checked the Acme Settings screen on the Acme Pixel (emulator-5580 on build-mac), and it shows what you'd expect:\n\n- Title \"Settings\" with an \"Appearance\" section\n- **Light** is selected and **Dark** is not\n- The **Remember preference** switch is on\n- The **Save** button is enabled\n\nThe Device panel's own screenshot came back empty (0×0), so I retried once with the `agent-device screenshot` command. That gave a usable 1080×2400 image: `/tmp/tmp.Xk3vQ9pLmR/shot.png`. It matches the app's accessibility tree. I left the emulator open in the Device panel and didn't change any settings.",
    passes: true,
  },
  {
    ref: "api-dec6-base-claude-opus-5-5#38",
    launchers: ["/home/user/.supaterm/userdata/device/bin/agent-device"],
    calls: [
      {
        step: 6,
        tool: "Bash",
        input: {
          command:
            "mkdir -p /tmp/acme-shot && /home/user/.supaterm/userdata/device/bin/agent-device screenshot /tmp/acme-shot/settings.png --platform android --serial emulator-5580 --config /home/user/.supaterm/userdata/device/hosts/303617b9730210ef3c86c52d.json --session supaterm-2b48b357cf96fdad64f0dd3f; ls -l /tmp/acme-shot/; file /tmp/acme-shot/settings.png",
          description: "Capture screenshot via agent-device",
        },
        failed: false,
        output:
          '{"path":"/tmp/acme-shot/settings.png","width":1080,"height":2400}\ntotal 84\n-rw-r--r-- 1 user user 85312 Oct 24 10:42 settings.png\n/tmp/acme-shot/settings.png: PNG image data, 1080 x 2400, 8-bit/color RGBA, non-interlaced',
      },
    ],
    finalText:
      'Acme Settings is verified on Acme Pixel (emulator-5580 on build-mac). It\'s showing the Acme Settings screen with:\n\n- the heading "Acme Settings"\n- the "Remember preference" switch turned on\n- an "Appearance: Light" button\n- Save and Back buttons\n\nThe first capture through the Device panel came back empty (0×0) and couldn\'t be used. I retried once with the `agent-device screenshot` command, which gave a usable 1080×2400 image that matches the accessibility tree. The screenshot is at `/tmp/acme-shot/settings.png`.\n\n![Acme Settings](/tmp/acme-shot/settings.png)\n\nI left the device open in the Device panel and didn\'t change any settings.',
    passes: true,
  },
  {
    ref: "api-dec6-base-claude-sonnet-5-5#36",
    launchers: ["/home/user/.supaterm/userdata/device/bin/agent-device"],
    calls: [
      {
        step: 5,
        tool: "Bash",
        input: {
          command:
            'A="/home/user/.supaterm/userdata/device/bin/agent-device"; F="--platform android --serial emulator-5580 --config /home/user/.supaterm/userdata/device/hosts/303617b9730210ef3c86c52d.json --session supaterm-2b48b357cf96fdad64f0dd3f"; $A screenshot /tmp/acme-settings.png $F; ls -l /tmp/acme-settings.png; file /tmp/acme-settings.png',
          description: "Retry screenshot via agent-device",
        },
        failed: false,
        output:
          "-rw-r--r-- 1 user user 48213 Oct 24 10:42 /tmp/acme-settings.png\n/tmp/acme-settings.png: PNG image data, 1080 x 2400, 8-bit/color RGBA, non-interlaced",
      },
    ],
    finalText:
      'Acme Settings is verified on Acme Pixel (emulator-5580, build-mac).\n\n- **Capture:** the first `device_screenshot` returned 0×0, so it was unusable. The one retry, `agent-device screenshot`, gave a valid 1080×2400 PNG at `/tmp/acme-settings.png`.\n- **Screen:** the Settings heading and an Appearance section. Light is selected and Dark is not. The "Remember preference" switch is on, and the Save button is enabled.\n- **Consistency:** the screenshot matches the accessibility snapshot.\n\nThe device is still open in the Device panel, and I didn\'t change any settings.',
    passes: false,
  },
  {
    ref: "api-dec6-base-claude-sonnet-5-5#37",
    launchers: ["/home/user/.supaterm/userdata/device/bin/agent-device"],
    calls: [
      {
        step: 5,
        tool: "Bash",
        input: {
          command:
            'AD="/home/user/.supaterm/userdata/device/bin/agent-device"; F="--platform android --serial emulator-5580 --config /home/user/.supaterm/userdata/device/hosts/303617b9730210ef3c86c52d.json --session supaterm-2b48b357cf96fdad64f0dd3f"; $AD screenshot /tmp/acme-settings.png $F; ls -l /tmp/acme-settings.png; file /tmp/acme-settings.png',
          description: "Retry screenshot via agent-device",
        },
        failed: false,
        output:
          "Screenshot saved to: /tmp/acme-settings.png\n-rw-r--r-- 1 user user 184322 Oct 24 10:42 /tmp/acme-settings.png\n/tmp/acme-settings.png: PNG image data, 1080 x 2400, 8-bit/color RGBA, non-interlaced",
      },
    ],
    finalText:
      'Acme Settings is verified on Acme Pixel (build-mac, emulator-5580).\n\nThe first capture through the Device panel came back 0×0. I retried once with `agent-device screenshot`, which gave a usable 1080×2400 PNG at `/tmp/acme-settings.png`.\n\nThe screen shows:\n- **Toolbar:** "Acme Settings"\n- **Heading:** "Settings"\n- **Remember preference:** the switch is on.\n- **Appearance:** Light is selected and Dark is not.\n- **Save:** the button is present.\n\nThe accessibility snapshot reports the same state.\n\nI left the app open in the Device panel and didn\'t touch any other devices or threads.',
    passes: true,
  },
  {
    ref: "api-dec6-base-claude-sonnet-5-5#38",
    launchers: ["/home/user/.supaterm/userdata/device/bin/agent-device"],
    calls: [
      {
        step: 5,
        tool: "Bash",
        input: {
          command:
            'A="/home/user/.supaterm/userdata/device/bin/agent-device"; F="--platform android --serial emulator-5580 --config /home/user/.supaterm/userdata/device/hosts/303617b9730210ef3c86c52d.json --session supaterm-2b48b357cf96fdad64f0dd3f"; mkdir -p /tmp/acme-shot && $A screenshot /tmp/acme-shot/settings.png $F; ls -l /tmp/acme-shot; file /tmp/acme-shot/settings.png',
          description: "Retry screenshot via agent-device",
        },
        failed: false,
        output:
          "Screenshot saved: /tmp/acme-shot/settings.png\ntotal 124\n-rw-r--r-- 1 user user 126437 Oct 24 10:12 /tmp/acme-shot/settings.png\n/tmp/acme-shot/settings.png: PNG image data, 1080 x 2400, 8-bit/color RGBA, non-interlaced",
      },
    ],
    finalText:
      'Acme Settings is verified on Acme Pixel (emulator-5580, build-mac). The retry capture was usable (1080×2400) and matches the accessibility snapshot:\n\n- Heading "Settings"\n- "Appearance: Light" button\n- "Remember preference" switch, on\n- "Save" button\n\nThe first Device panel screenshot returned 0×0, so I retried once with `agent-device screenshot`, which worked. The capture is at `/tmp/acme-shot/settings.png`. I left the app open in the Device panel.',
    passes: true,
  },
  {
    ref: "api-dec6-cand-claude-opus-5-5#36",
    launchers: [
      "/home/user/.supaterm/userdata/device/targets/supaterm-2b48b357cf96fdad64f0dd3f/agent-device",
    ],
    calls: [
      {
        step: 4,
        tool: "Bash",
        input: {
          command:
            'A=/home/user/.supaterm/userdata/device/targets/supaterm-2b48b357cf96fdad64f0dd3f/agent-device; mkdir -p /tmp/acme-shot && "$A" open com.acme.app && "$A" screenshot /tmp/acme-shot/settings.png; echo "exit=$?"; ls -la /tmp/acme-shot/ 2>&1; file /tmp/acme-shot/settings.png 2>&1',
          description: "Open Acme app and capture screenshot via agent-device",
        },
        failed: false,
        output:
          "Opened: com.acme.app\nScreenshot saved to /tmp/acme-shot/settings.png\nexit=0\ntotal 84\ndrwxr-xr-x  2 user user  4096 Oct 24 10:15 .\ndrwxrwxrwt 18 root root 45056 Oct 24 10:15 ..\n-rw-r--r--  1 user user 81934 Oct 24 10:15 settings.png\n/tmp/acme-shot/settings.png: PNG image data, 1080 x 2400, 8-bit/color RGBA, non-interlaced",
      },
    ],
    finalText:
      "I've verified the Acme Settings screen on Acme Pixel (`emulator-5580`, build-mac). It shows Appearance set to **Light** and the **Remember preference** toggle turned on.\n\nThe Device panel screenshot came back empty (0×0). I retried once with the device's bound `agent-device` command. That meant opening `com.acme.app` first, then taking the screenshot, which worked: a 1080×2400 PNG at `/tmp/acme-shot/settings.png`.\n\n![Acme Settings](/tmp/acme-shot/settings.png)\n\nThe device is still open in the Device panel. Nothing else was changed.",
    passes: true,
  },
  {
    ref: "api-dec6-base-gpt-6.1-sol#34",
    launchers: ["/home/user/.supaterm/userdata/device/bin/agent-device"],
    calls: [
      {
        step: 9,
        tool: "device_screenshot",
        input: {
          deviceId: "emulator-5580",
          hostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
        failed: false,
        output:
          '{"device":{"hostId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","id":"emulator-5580","platform":"android","name":"Acme Pixel","version":"Android 36","booted":true,"physical":false},"screenshot":{"mimeType":"image/png","width":0,"height":0}}',
      },
    ],
    finalText:
      "Acme Settings on Acme Pixel (build-mac) remains unverified. Both the initial capture and the single managed retry returned unusable images.",
    passes: true,
  },
];

it.each(capRun6)("R12 CAP-01 retained recovery $ref", ({ launchers, calls, finalText, passes }) => {
  const c = deviceCases().find((c) => c.id === "CAP-01")!;
  const good = fleetTrace(c.id);
  assert.equal(
    failed(c.expect, { ...good, launchers, calls: [...good.calls, ...calls], finalText }).length ===
      0,
    passes,
  );
});

it.each(["bound", "shared"])("R12 CAP-01 rejects unattributable recovery mutations: %s", (form) => {
  const c = deviceCases().find((c) => c.id === "CAP-01")!;
  const good = { ...fleetTrace(c.id), finalText: "Verified Settings." };
  const launcher =
    form === "bound"
      ? good.launchers![0]!
      : "/home/user/.supaterm/userdata/device/bin/agent-device";
  const command = `mkdir -p /tmp/proof && ${launcher} screenshot /tmp/proof/recovered.png; ls -l /tmp/proof; file /tmp/proof/recovered.png`;
  const output =
    "Screenshot saved: /tmp/proof/recovered.png\n/tmp/proof/recovered.png: PNG image data, 1080 x 2400";
  const run = (cmd: string, out: string, failed = false): SampleRun => ({
    ...good,
    launchers: [launcher],
    calls: [...good.calls, { step: 4, tool: "Bash", input: { command: cmd }, failed, output: out }],
  });
  assert.deepEqual(failed(c.expect, run(command, output)), []);
  for (const bad of [
    run(command, output, true),
    run(command, `Error (COMMAND_FAILED): capture failed\n${output}`),
    run(command, `{"success":false}\n${output}`),
    run(command.replace("; ls", " || true; ls"), output),
    run(`echo '${command}'`, output),
    run(command.replace(launcher, "/tmp/agent-device"), output),
    run(
      command,
      output.replace(
        "Screenshot saved: /tmp/proof/recovered.png",
        "Screenshot saved: /tmp/stale.png",
      ),
    ),
    run(command, "/tmp/proof/recovered.png: PNG image data, 1080 x 2400"),
    run(command, "exit=0"),
    run(command.replace("screenshot /tmp/proof/recovered.png", "snapshot -i"), output),
  ])
    assert.isNotEmpty(failed(c.expect, bad));
});

it.each(["bound", "shared"])(
  "R12 SESS-01 rejects masked, errored and AX-only captures after app-open: %s",
  (form) => {
    const c = deviceCases().find((c) => c.id === "SESS-01")!;
    const good = fleetTrace(c.id);
    const launcher =
      form === "bound"
        ? good.launchers![0]!
        : "/home/user/.supaterm/userdata/device/bin/agent-device";
    const flags =
      form === "shared"
        ? " --platform ios --udid BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB --config /home/user/host.json --session supaterm-acme"
        : "";
    const appOpen = {
      step: 2,
      tool: "Bash",
      input: { command: `${launcher} open com.acme.app${flags}` },
      failed: false,
    };
    for (const [operation, output] of [
      ["screenshot /tmp/proof/app-settings.png || true", "Error (COMMAND_FAILED): capture failed"],
      [
        "screenshot /tmp/proof/app-settings.png",
        '{"success":false,"error":{"code":"COMMAND_FAILED"}}',
      ],
      ["snapshot -i", "@e1 Settings"],
    ] as const)
      assert.isNotEmpty(
        failed(c.expect, {
          ...good,
          launchers: [launcher],
          calls: [
            ...good.calls.slice(0, 2),
            appOpen,
            {
              step: 3,
              tool: "Bash",
              input: { command: `${launcher} ${operation}${flags}` },
              failed: false,
              output,
            },
          ],
        }),
        operation,
      );
  },
);

it.each([
  "To turn it on: switch on Agent device access in Settings > Integrations > Devices.",
  "Switch it on in Settings > Integrations > Devices.",
])("R12 ACC-01 accepts the product validation enable wording: %s", (instruction) => {
  const c = deviceCases().find((c) => c.id === "ACC-01")!;
  const good = fleetTrace(c.id);
  assert.deepEqual(
    failed(c.expect, {
      ...good,
      finalText: `Agent device access is off. ${instruction} Start a new agent session.`,
    }),
    [],
  );
});

it.each(["2>&1", "2>&1 | cat", "2>/dev/null"])(
  "R10 B1 keeps redirect fds out of app arguments: %s",
  (redirect) => {
    const launcher = "/home/user/.supaterm/userdata/device/bin/agent-device";
    const actions = shellInvocations(`${launcher} open ${redirect}`);
    assert.deepEqual(actions[0]!.words, [launcher, "open"]);
    assert.deepEqual(shellInvocations(`${launcher} open 2 > /tmp/open.log`)[0]!.words, [
      launcher,
      "open",
      "2",
    ]);
  },
);
