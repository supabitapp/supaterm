import { expect } from "e2e";

import { approvalRequiredThreads, runPromise, test, WEB } from "./supaterm.ts";

test(
  "A recurring task reports when its queued occurrence is held",
  WEB,
  async ({ supaterm, app, screen }) => {
    const settings = await runPromise(approvalRequiredThreads);
    try {
      // Supervised mode makes the approval recording wait for an answer, which holds its turn open.
      await runPromise(settings.apply);
      const project = await supaterm.project("scheduled-hold");
      await supaterm.thread({ project, title: "Earlier work", messages: ["Start"] });
      const thread = await supaterm.thread({
        project,
        title: "Waiting scheduled thread",
        messages: ["Ask a question"],
        model: "approval",
      });

      await supaterm.open("/automations");
      await screen.getByRole("button", "New automation").tap();
      await screen.getByRole("textbox", "Name").fill("Held recurring task");
      await screen.getByRole("combobox", "Destination").tap();
      await screen.getByRole("option", "One thread, continuing the conversation").tap();
      await screen.getByRole("combobox", "Destination thread").tap();
      await screen.getByRole("option", "Waiting scheduled thread").tap();
      await screen.getByRole("textbox", "Prompt").fill("Scheduled check prompt");
      await screen.getByRole("button", "Every interval").tap();
      await screen.getByRole("spinbutton", "Run every").fill("1");
      await screen.getByRole("button", "Create automation").tap();

      await supaterm.open(thread);
      await screen.getByRole("button", "Approve", { exact: true }).waitFor();
      await screen
        .getByRole("button", "Automation Held recurring task")
        .waitFor({ timeout: 100_000 });
      // Stopping the active turn holds the queued scheduled occurrence.
      await screen.getByRole("button", "Stop generation").tap();
      await screen.getByRole("button", "Resume thread").waitFor();
      await screen.getByRole("button", "Edit queued message").waitFor();

      await app.open("/automations");
      await expect(
        screen.getByText(
          "A previous occurrence is held in the thread queue. Resume or remove it to run this task again.",
        ),
      ).toBeVisible({ timeout: 100_000 });
      await app.screenshot("held-scheduled-task");
    } finally {
      await runPromise(settings.restore);
    }
  },
);
