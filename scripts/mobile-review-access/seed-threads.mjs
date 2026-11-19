import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

const origin = "http://127.0.0.1:3773";
const workspace = "/srv/supacode-review/workspace";
const token = (await NodeFSP.readFile(process.argv[2], "utf8")).trim();
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "x-supaterm-orchestration-protocol": "2",
};

async function api(path, method = "GET", body) {
  const response = await fetch(origin + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const ticket = await api("/api/auth/websocket-ticket", "POST");
const socket = new WebSocket(
  `ws://127.0.0.1:3773/ws?orchestrationProtocol=2&wsTicket=${encodeURIComponent(ticket.ticket)}`,
);
const pending = new Map();
const streams = new Map();
let requestNumber = 0;
socket.addEventListener("message", (message) => {
  const decoded = JSON.parse(message.data);
  for (const item of Array.isArray(decoded) ? decoded : [decoded]) {
    const id = String(item.requestId);
    if (item._tag === "Chunk") {
      for (const value of item.values) streams.get(id)?.(value);
      socket.send(JSON.stringify({ _tag: "Ack", requestId: item.requestId }));
    }
    if (item._tag === "Exit") {
      const task = pending.get(id);
      if (task) {
        pending.delete(id);
        if (item.exit._tag === "Success") task.resolve(item.exit.value);
        else task.reject(new Error(JSON.stringify(item.exit)));
      }
    }
    if (item._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
  }
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function rpc(tag, payload) {
  const id = String(++requestNumber);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
  });
}

const config = await rpc("server.getConfig", {});
const codex = config.providers.find((provider) => provider.instanceId === "codex");
console.log(
  "Codex:",
  JSON.stringify(codex, (key, value) =>
    key === "models" ? value?.map((m) => m.slug ?? m.id) : value,
  ).slice(0, 1500),
);
const modelSelection = {
  instanceId: "codex",
  model: process.env.SEED_MODEL ?? "gpt-6.1-sol",
  options: [{ id: "reasoningEffort", value: "low" }],
};

const projects = [
  {
    title: "Tidepool",
    dir: "tidepool",
    scripts: [
      { id: "dev", name: "Dev", command: "npm run dev", icon: "play", runOnWorktreeCreate: false },
      { id: "test", name: "Test", command: "npm test", icon: "test", runOnWorktreeCreate: false },
    ],
  },
  {
    title: "Pantry",
    dir: "pantry",
    scripts: [
      { id: "test", name: "Test", command: "npm test", icon: "test", runOnWorktreeCreate: false },
    ],
  },
  {
    title: "Ledger",
    dir: "ledger",
    scripts: [
      {
        id: "report",
        name: "Report",
        command: "python3 ledger.py",
        icon: "play",
        runOnWorktreeCreate: false,
      },
      {
        id: "test",
        name: "Test",
        command: "python3 -m unittest",
        icon: "test",
        runOnWorktreeCreate: false,
      },
    ],
  },
];

const existing = (await api("/api/projects")).projects ?? [];
const projectIds = {};
for (const project of projects) {
  const found = existing.find((candidate) => candidate.title === project.title);
  if (found) {
    projectIds[project.title] = found.id;
    continue;
  }
  const projectId = NodeCrypto.randomUUID();
  await api("/api/projects/mutate", "POST", {
    type: "project.create",
    commandId: NodeCrypto.randomUUID(),
    projectId,
    title: project.title,
    workspaceRoot: `${workspace}/${project.dir}`,
    defaultModelSelection: modelSelection,
    scripts: project.scripts,
  });
  projectIds[project.title] = projectId;
  console.log("Created project", project.title);
}

const threads = [
  {
    project: "Ledger",
    title: "Where did my money go in October?",
    prompt:
      "Run the report on transactions.csv and tell me where my money went in October. Call out anything that looks worth cutting back on. Don't change any files. Keep it under 150 words.",
  },
  {
    project: "Tidepool",
    title: "Add a °C / °F toggle",
    prompt:
      "Add a small °C / °F toggle to the forecast card. Put the conversion in forecast.mjs with unit tests, keep Celsius as the default, and remember the choice in localStorage. Run npm test, then commit with a conventional commit message. Summarise what you changed in under 120 words.",
  },
  {
    project: "Pantry",
    title: "Scale recipes to any number of servings",
    prompt:
      "Let me scale recipes to a number of people, for example `npm start -- shakshuka --serves 6`. Add a scaleRecipe function with tests, round measured quantities sensibly and round whole items up. Run npm test and try the CLI, then commit with a conventional commit message. Keep your summary under 120 words.",
  },
  {
    project: "Ledger",
    title: "Warn when a category goes over budget",
    prompt:
      "Use budgets.json to flag categories that went over budget in the report, showing how much over they are. Add unit tests for the budget check, run python3 -m unittest and the report, then commit with a conventional commit message. Keep your summary under 120 words.",
  },
  {
    project: "Tidepool",
    title: "How is the tide curve drawn?",
    prompt:
      "Explain how tidePath in forecast.mjs turns tide heights into an SVG path, and suggest how I could show it on the forecast card. Don't change any files. Keep it under 150 words.",
  },
];

try {
  for (const thread of threads) {
    const threadId = NodeCrypto.randomUUID();
    await rpc("orchestration.dispatchCommand", {
      type: "thread.create",
      commandId: NodeCrypto.randomUUID(),
      threadId,
      projectId: projectIds[thread.project],
      title: thread.title,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      createdBy: "user",
      creationSource: "mobile",
    });
    const streamId = String(++requestNumber);
    let complete;
    let fail;
    const finished = new Promise((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    streams.set(streamId, (item) => {
      if (item.kind !== "event" || item.event.type !== "run.updated") return;
      const status = item.event.payload.status;
      if (status === "completed") complete();
      if (["failed", "cancelled", "interrupted"].includes(status)) {
        fail(new Error(JSON.stringify(item.event.payload)));
      }
    });
    socket.send(
      JSON.stringify({
        _tag: "Request",
        id: streamId,
        tag: "orchestration.subscribeThread",
        payload: { threadId },
        headers: [],
      }),
    );
    await rpc("orchestration.dispatchCommand", {
      type: "message.dispatch",
      commandId: NodeCrypto.randomUUID(),
      threadId,
      messageId: NodeCrypto.randomUUID(),
      text: thread.prompt,
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "mobile",
    });
    await finished;
    socket.send(JSON.stringify({ _tag: "Interrupt", requestId: streamId }));
    streams.delete(streamId);
    console.log("Completed:", thread.project, "-", thread.title);
  }
} finally {
  socket.close();
}
