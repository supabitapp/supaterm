import { expect } from "e2e";

import { NATIVE, test } from "./supaterm-mobile.ts";

test(
  "The mobile app lists a seeded thread and opens its history",
  NATIVE,
  async ({ supaterm, app, screen }) => {
    const project = await supaterm.project("demo");
    await supaterm.thread({ project, title: "Earlier work", messages: ["first", "second"] });
    await supaterm.open();

    const thread = screen.getByText("Earlier work", { exact: false }).first();
    await expect(thread).toBeVisible({ timeout: 120_000 });
    await app.screenshot("home");

    await thread.tap();
    await expect(screen.getByText("second fixture turn complete", { exact: false })).toBeVisible();
    await app.screenshot("thread");
  },
);
