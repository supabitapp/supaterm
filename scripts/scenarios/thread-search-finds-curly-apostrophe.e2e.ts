import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

test(
  "Thread search finds a curly apostrophe next to a two-character Chinese word",
  WEB,
  async ({ supaterm, app, screen }) => {
    const project = await supaterm.project("demo");
    const thread = await supaterm.thread({ project, title: "Weekly notes", messages: ["Start"] });
    await supaterm.open(thread);

    // Search reads what the user wrote; messages the CLI sends count as an agent's.
    const composer = screen.getByRole("textbox");
    await composer.pressSequentially("部署 John’s service after migration");
    await composer.press("Enter");
    await expect(screen.getByText("second fixture turn complete", { exact: false })).toBeVisible();

    await screen.getByRole("button", "Search").tap();
    await screen.getByRole("dialog", "Command palette").getByRole("combobox").fill("部署 John’s");
    await expect(screen.getByRole("dialog", "Command palette").getByRole("listbox")).toContainText(
      "John’s service",
    );
    await app.screenshot("search");
  },
);
