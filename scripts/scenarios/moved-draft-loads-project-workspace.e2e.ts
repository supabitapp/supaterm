import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

test(
  "A moved draft loads the workspace default of a project it has never opened",
  WEB,
  async ({ supaterm, app, browser, screen }) => {
    await supaterm.project("checkout-project", {
      "supaterm.json": JSON.stringify({ defaultThreadEnvMode: "local" }),
    });
    await supaterm.open();
    const picker = browser.locator("[data-draft-project-trigger]");
    const workspace = browser.locator('[data-composer-shortcut="composer.workspace"]');
    await picker.filter({ hasText: "checkout-project" }).waitFor();
    await screen.getByRole("textbox").fill("Plan the implementation");

    await supaterm.project("worktree-project", {
      "supaterm.json": JSON.stringify({ defaultThreadEnvMode: "worktree" }),
    });
    await picker.tap();
    await screen.getByRole("option", "worktree-project", { exact: true }).tap();
    await picker.filter({ hasText: "worktree-project" }).waitFor();
    await app.screenshot("workspace-after-moving-draft");
    await expect(workspace).toContainText("New worktree");
  },
);
