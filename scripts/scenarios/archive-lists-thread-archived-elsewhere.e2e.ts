import { expect } from "e2e";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { SCENARIO_HOME } from "../e2e.config.ts";
import { ScenarioError } from "./shell.ts";
import { approvalRequiredThreads, makeState, runPromise, test, WEB } from "./supaterm.ts";

/** Archives a thread as an outside agent does: `supaterm_thread_organize` on the server's MCP endpoint. */
const archiveOverMcp = Effect.fn("scenario.archiveOverMcp")(function* (
  baseUrl: string,
  threadId: string,
) {
  const { cli } = makeState(SCENARIO_HOME);
  const { stdout } = yield* cli([
    "auth",
    "session",
    "issue",
    "--subject",
    "mcp-client",
    "--scope",
    "orchestration:read",
    "--scope",
    "orchestration:operate",
    "--token-only",
  ]);
  const client = yield* HttpClient.HttpClient;
  let sessionId: string | null = null;
  const send = Effect.fnUntraced(function* (message: object) {
    const response = yield* client.execute(
      HttpClientRequest.post(`${baseUrl}/mcp`).pipe(
        HttpClientRequest.setHeaders({
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${stdout.trim()}`,
          ...(sessionId === null ? {} : { "mcp-session-id": sessionId }),
        }),
        HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", ...message }),
      ),
    );
    sessionId = response.headers["mcp-session-id"] ?? sessionId;
    const body = yield* response.text;
    if (response.status >= 300) {
      return yield* new ScenarioError({ message: `MCP ${response.status}: ${body}` });
    }
    return body;
  });
  yield* send({
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "scenario", version: "1" },
    },
  });
  yield* send({ method: "notifications/initialized" });
  const result = yield* send({
    id: 2,
    method: "tools/call",
    params: { name: "supaterm_thread_organize", arguments: { threadId, action: "archive" } },
  });
  if (result.includes('"isError":true')) {
    return yield* new ScenarioError({ message: `Archive failed: ${result}` });
  }
}, Effect.provide(FetchHttpClient.layer));

test(
  "Settings Archived lists a thread archived elsewhere while it is open",
  WEB,
  async ({ supaterm, app, screen }) => {
    // A token from `auth session issue` acts at most in approval-required mode, so the thread must too.
    const settings = await runPromise(approvalRequiredThreads);
    try {
      await runPromise(settings.apply);
      const project = await supaterm.project("demo");
      const thread = await supaterm.thread({
        project,
        title: "Archived elsewhere",
        messages: ["first"],
      });
      await supaterm.open("/settings/archived");
      await expect(screen.getByText("No archived threads")).toBeVisible();

      await runPromise(archiveOverMcp(app.baseUrl ?? "", thread.threadId));

      await expect(screen.getByRole("button", "Unarchive Archived elsewhere")).toBeVisible();
      await app.screenshot("archived-list");
    } finally {
      await runPromise(settings.restore);
    }
  },
);
