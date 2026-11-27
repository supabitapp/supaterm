import { ThreadId } from "@supaterm/contracts";
import { expect } from "e2e";
import * as Effect from "effect/Effect";

import { SCENARIO_HOME } from "../e2e.config.ts";
import { rpcClient, runPromise, test, WEB } from "./supaterm.ts";

test(
  "The drawer removes a terminal closed by another client",
  WEB,
  async ({ supaterm, app, screen }) => {
    const cwd = await supaterm.project("demo");
    const thread = await supaterm.thread({
      project: cwd,
      title: "Shared terminals",
      messages: ["first"],
    });
    const threadId = ThreadId.make(thread.threadId);
    const origin = app.baseUrl ?? "";
    const kept = "kept-shell";
    const closed = "closed-elsewhere";

    await runPromise(
      Effect.gen(function* () {
        const client = yield* rpcClient(SCENARIO_HOME, origin);
        for (const terminalId of [kept, closed]) {
          yield* client["terminal.open"]({ threadId, terminalId, cwd });
        }
      }).pipe(Effect.scoped),
    );
    await supaterm.open(thread);
    await screen.getByRole("button", "Toggle terminal drawer").tap();
    await screen.getByRole("button", kept, { exact: true }).tap();
    const closedTab = screen.getByRole("button", closed, { exact: true });
    await closedTab.waitFor();

    await runPromise(
      Effect.gen(function* () {
        const client = yield* rpcClient(SCENARIO_HOME, origin);
        yield* client["terminal.close"]({ threadId, terminalId: closed, deleteHistory: true });
      }).pipe(Effect.scoped),
    );

    await app.screenshot("after-close-from-another-client");
    await expect(closedTab).toBeHidden();
  },
);
