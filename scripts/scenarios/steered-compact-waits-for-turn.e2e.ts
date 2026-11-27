import { expect } from "e2e";

import { SCENARIO_HOME } from "../e2e.config.ts";
import { approvalRequiredThreads, makeState, runPromise, test, WEB } from "./supaterm.ts";

test(
  "/compact sent while the agent works waits for the turn",
  WEB,
  async ({ supaterm, app, screen }) => {
    const project = await supaterm.project("demo");
    // The showcase recording streams for several seconds, long enough to send into its turn.
    const thread = await supaterm.thread({
      project,
      title: "Long work",
      messages: ["Show me around"],
      model: "showcase",
    });
    await supaterm.open(thread);

    const composer = screen.getByRole("textbox");
    await composer.tap();
    await composer.pressSequentially("Show me again");
    await composer.press("Enter");
    await expect(screen.getByRole("button", "Stop generation")).toBeVisible();

    // The trailing space closes the slash menu so Enter sends instead of picking a command.
    await composer.pressSequentially("/compact ");
    await composer.press("Enter");
    await app.screenshot("compact-sent");
    await expect(screen.getByRole("button", "Edit queued message")).toBeVisible();

    const settings = await runPromise(approvalRequiredThreads);
    try {
      // An approval holds this turn open, so the queued command stays put while Send now is hovered.
      await runPromise(settings.apply);
      const waiting = await supaterm.thread({
        project,
        title: "Waiting work",
        messages: ["Change the file"],
        model: "approval",
      });
      await runPromise(
        makeState(SCENARIO_HOME).cli(["thread", "send", waiting.threadId, "/compact"]),
      );
      await supaterm.open(waiting);
      // The approval renders last and moves the queue; hover once it is in place.
      await screen.getByRole("button", "Approve", { exact: true }).waitFor({ timeout: 30_000 });
      // Focus opens the tooltip as hover does, without depending on how the browser emulates a
      // pointer, which differs between macOS and Linux runners.
      await screen.getByRole("button", "Send now").focus();
      await expect(
        screen.getByText("Move this command to the front of the queue", { exact: false }),
      ).toBeVisible();
      await app.screenshot("send-now-tooltip");
    } finally {
      await runPromise(settings.restore);
    }
  },
);
