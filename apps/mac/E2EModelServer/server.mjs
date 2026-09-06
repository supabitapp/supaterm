import { LLMock } from "@copilotkit/aimock";
import { createInterface } from "node:readline";

// Stdio controls test sequencing; aimock owns HTTP, provider formats, and SSE.
const commands = createInterface({ input: process.stdin });
let mock;
let remaining = 0;
let releases = 0;
let routeFailure;
const pending = [];

function state() {
  const unexpected = mock.getRequests().find((entry) => !entry.response.fixture);
  return {
    baseURL: mock.url,
    remaining,
    pending: pending.length,
    releases,
    failure: routeFailure ?? (unexpected
      ? `Unexpected model request: ${unexpected.method} ${unexpected.path} (${unexpected.response.status}); ${JSON.stringify(unexpected.body)}`
      : null),
  };
}

async function start(script) {
  mock = new LLMock({ host: "127.0.0.1", port: 0, latency: 0, strict: true, journalMaxEntries: 0 });
  mock.mount("", {
    async handleRequest(req, res) {
      const path = new URL(req.url, "http://localhost").pathname;
      // Keep aimock's diagnostic control API available to test tooling.
      if (path.startsWith("/__aimock/")) return false;
      // Claude Code probes connectivity and token counts outside its model turns.
      if (req.method === "HEAD" && path === "/api/hello") {
        res.writeHead(200).end();
        return true;
      }
      if (req.method === "POST" && path === "/v1/messages/count_tokens") {
        req.resume();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ input_tokens: 1 }));
        return true;
      }
      if (req.method === "POST" && ["/v1/messages", "/v1/responses"].includes(path)) {
        req.headers["x-aimock-context"] = path.slice("/v1/".length);
      } else {
        // aimock does not journal unsupported routes, so retain these separately.
        routeFailure ??= `Unexpected model request: ${req.method} ${path}`;
      }
      return false;
    },
  });
  // Background title requests must not consume the scripted agent turns.
  mock.on(
    {
      predicate: (req) => !req.tools?.length && req.messages.some((message) =>
        typeof message.content === "string" && (
          message.content.includes("Generate a concise, single-line task title") ||
          (message.role === "system" && message.content.includes("You are naming a coding session"))
        )),
    },
    { content: '{"title":"E2E title"}' },
  );
  remaining = script.length;
  let next = 0;
  for (const [index, exchange] of script.entries()) {
    let failures = exchange.failuresBeforeResponse;
    mock.on(
      { ...exchange.match, predicate: () => next === index },
      async () => {
        if (failures > 0) {
          failures -= 1;
          return { status: 503, error: { message: "E2E reconnect drill" } };
        }
        next += 1;
        remaining -= 1;
        if (exchange.waitForRelease) {
          if (releases > 0) releases -= 1;
          else await new Promise((resolve) => pending.push(resolve));
        }
        return exchange.response;
      },
      exchange.options,
    );
  }
  await mock.start();
}

// The parent owns this process. EOF also terminates requests held by cancelled turns.
commands.on("close", () => process.exit(0));
for await (const line of commands) {
  try {
    const command = JSON.parse(line);
    switch (command.action) {
      case "start":
        if (mock) throw new Error("Model server already started");
        await start(command.script);
        break;
      case "release":
        if (pending.length) pending.shift()();
        else releases += 1;
        break;
      case "status":
        break;
      default:
        throw new Error(`Unknown model server command: ${command.action}`);
    }
    process.stdout.write(`${JSON.stringify(state())}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ failure: String(error) })}\n`);
  }
}
