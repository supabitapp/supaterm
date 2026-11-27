import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

test(
  "A seeded thread opens by its link and shows its history",
  WEB,
  async ({ supaterm, app, screen }) => {
    const project = await supaterm.project("demo");
    const thread = await supaterm.thread({
      project,
      title: "Earlier work",
      messages: ["first", "second"],
    });
    await supaterm.open(thread);

    await expect(screen.getByText("second fixture turn complete", { exact: false })).toBeVisible();
    await app.screenshot("thread");
  },
);
