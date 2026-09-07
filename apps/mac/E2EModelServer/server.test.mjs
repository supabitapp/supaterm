import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

async function launch(t, script) {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    lines.close();
  });
  async function command(action, extra = {}) {
    const response = once(lines, "line", { signal: AbortSignal.timeout(5000) });
    child.stdin.write(`${JSON.stringify({ action, ...extra })}\n`);
    return JSON.parse((await response)[0]);
  }
  const started = await command("start", { script });
  assert.equal(started.failure, null);
  return {
    command,
    child,
    baseURL: started.baseURL,
    async request(protocol, input, extra = {}) {
      const body = protocol === "messages"
        ? { model: "claude-sonnet-4-5", max_tokens: 1024, messages: input }
        : { model: "gpt-5", input };
      return fetch(`${started.baseURL}/v1/${protocol}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, stream: true, ...extra }),
        signal: AbortSignal.timeout(5000),
      });
    },
  };
}

function exchange(protocol, match, response, extra = {}) {
  return {
    match: { context: protocol, ...match },
    response,
    failuresBeforeResponse: 0,
    waitForRelease: false,
    ...extra,
  };
}

function input(protocol, text) {
  return [{ role: "user", type: "message", content: protocol === "messages"
    ? text : [{ type: "input_text", text }] }];
}

function events(text) {
  return text.split("\n").filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

async function waitForPending(server) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await server.command("status");
    assert.equal(state.failure, null);
    if (state.pending > 0) return state;
    await setTimeout(5);
  }
  assert.fail("Model request did not reach its response gate");
}

for (const protocol of ["messages", "responses"]) {
  test(`${protocol}: retries, held tool call, tool result, and streamed completion`, { timeout: 10000 }, async (t) => {
    const server = await launch(t, [
      exchange(protocol, { userMessage: "run" }, {
        toolCalls: [{ id: "call_e2e", name: "test_tool", arguments: { value: "hello" } }],
        ...(protocol === "messages" ? { reasoning: "Running the scripted E2E tool." } : {}),
      }, { failuresBeforeResponse: 2, waitForRelease: true }),
      exchange(protocol, { toolCallId: "call_e2e" }, { content: "Finished" }),
    ]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await server.request(protocol, input(protocol, "run"));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.message, "E2E reconnect drill");
    }
    const held = server.request(protocol, input(protocol, "run"));
    // Synchronize on the factory entering the gate, not on a fixed delay.
    const state = await waitForPending(server);
    assert.equal(state.remaining, 1);
    await server.command("release");
    const toolEvents = events(await (await held).text());
    let assistantBlocks;
    if (protocol === "messages") {
      const block = toolEvents.find((event) => event.content_block?.type === "tool_use").content_block;
      assert.equal(block.id, "call_e2e");
      assert.equal(block.name, "test_tool");
      const signature = toolEvents.find((event) => event.delta?.type === "signature_delta").delta.signature;
      assert.ok(signature.length > 0);
      assistantBlocks = [
        { type: "thinking", thinking: "Running the scripted E2E tool.", signature },
        { ...block, input: { value: "hello" } },
      ];
      assert.equal(toolEvents.at(-1).type, "message_stop");
    } else {
      const item = toolEvents.find((event) => event.type === "response.output_item.done").item;
      assert.equal(item.call_id, "call_e2e");
      assert.equal(item.name, "test_tool");
      assert.deepEqual(JSON.parse(item.arguments), { value: "hello" });
      assert.equal(toolEvents.at(-1).type, "response.completed");
    }
    const toolResult = protocol === "messages"
      ? [
        { role: "assistant", content: assistantBlocks },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_e2e", content: "ok" }] },
      ]
      : [{ type: "function_call_output", call_id: "call_e2e", output: "ok" }];
    const completion = await server.request(protocol, toolResult,
      protocol === "messages" ? { thinking: { type: "enabled", budget_tokens: 1024 } } : {});
    assert.equal(completion.status, 200);
    const completionEvents = events(await completion.text());
    const text = completionEvents.map((event) => protocol === "messages"
      ? event.delta?.text ?? ""
      : event.type === "response.output_text.delta" ? event.delta : "").join("");
    assert.equal(text, "Finished");
    assert.deepEqual(await server.command("status"), {
      ...state, remaining: 0, pending: 0, releases: 0, failure: null,
    });
  });

  test(`${protocol}: early releases are consumed and unmatched requests remain failures`, async (t) => {
    const server = await launch(t, [
      exchange(protocol, { userMessage: "expected" }, { content: "ok" }, { waitForRelease: true }),
    ]);
    assert.equal((await server.command("release")).releases, 1);
    const wrong = await server.request(protocol, input(protocol, "wrong"));
    assert.equal(wrong.status, 503);
    await wrong.text();
    const response = await server.request(protocol, input(protocol, "expected"));
    await response.text();
    const state = await server.command("status");
    assert.equal(state.remaining, 0);
    assert.equal(state.releases, 0);
    assert.match(state.failure, /Unexpected model request/);
  });
}

test("a request to the wrong provider cannot consume an exchange", async (t) => {
  const server = await launch(t, [exchange("messages", { userMessage: "hello" }, { content: "ok" })]);
  const response = await server.request("responses", input("responses", "hello"));
  assert.equal(response.status, 503);
  await response.text();
  assert.equal((await server.command("status")).remaining, 1);
});

test("unsupported routes fail verification even with no exchanges left", async (t) => {
  const server = await launch(t, []);
  const response = await fetch(`${server.baseURL}/v1/unsupported`, { method: "POST" });
  assert.equal(response.status, 404);
  await response.text();
  assert.match((await server.command("status")).failure, /POST \/v1\/unsupported/);
});

test("background titles and Claude probes do not consume agent turns", async (t) => {
  const server = await launch(t, [exchange("messages", { userMessage: "work" }, { content: "ok" })]);
  for (const protocol of ["messages", "responses"]) {
    const response = await server.request(protocol,
      input(protocol, protocol === "messages" ? "<session>work</session>"
        : "Generate a concise, single-line task title for this task"),
      protocol === "messages" ? { system: "You are naming a coding session. Return JSON with a single title field." } : {});
    assert.equal(response.status, 200);
    await response.text();
  }
  assert.equal((await fetch(`${server.baseURL}/api/hello`, { method: "HEAD" })).status, 200);
  const tokens = await fetch(`${server.baseURL}/v1/messages/count_tokens`, {
    method: "POST", body: "{}",
  });
  assert.deepEqual(await tokens.json(), { input_tokens: 1 });
  const state = await server.command("status");
  assert.equal(state.remaining, 1);
  assert.equal(state.failure, null);
});

test("closing the parent pipe exits even with a held response", async (t) => {
  const server = await launch(t, [
    exchange("messages", { userMessage: "hold" }, { content: "ok" }, { waitForRelease: true }),
  ]);
  const request = server.request("messages", input("messages", "hold")).catch(() => null);
  await waitForPending(server);
  const exited = once(server.child, "exit", { signal: AbortSignal.timeout(5000) });
  server.child.stdin.end();
  assert.equal((await exited)[0], 0);
  await request;
});
