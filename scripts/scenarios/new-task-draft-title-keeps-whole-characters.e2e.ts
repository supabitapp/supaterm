import { expect } from "e2e";

import { NATIVE, test } from "./supaterm-mobile.ts";

const KEPT = "a".repeat(68);
// The emoji's two UTF-16 units straddle unit 69, where a draft's title is cut.
const PROMPT = `${KEPT}😀 and the rest of the prompt`;

test(
  "An unsent new-task draft's row title ends without a broken character",
  NATIVE,
  async ({ supaterm, app, screen, device }) => {
    await supaterm.project("demo");
    await supaterm.open();

    await screen
      .getByLabel(/^New (chat|thread)$/)
      .first()
      .tap({ timeout: 120_000 });
    const composer = screen.getByRole("textbox", "Ask anything");
    if (supaterm.platform === "ios") {
      const projectSearch = screen.getByRole("textbox", "Search projects");
      // The project list slides over the draft, which names its project too.
      await projectSearch.waitFor();
      await composer.waitFor({ state: "hidden" });
      await screen.getByRole("button", "demo").tap();
      await projectSearch.waitFor({ state: "hidden" });
    } else {
      // Android lists projects by name and path before the draft opens.
      const project = screen.getByRole("button", /^demo, /).first();
      await project.tap();
      await project.waitFor({ state: "hidden" });
    }
    await composer.fill(PROMPT);
    // Send appears once the app holds the prompt; leaving before then can drop the draft.
    await screen.getByRole("button", "Send").waitFor();
    await (
      supaterm.platform === "ios"
        ? screen.getByTestId("BackButton")
        : screen.getByRole("button", "Navigate up").first()
    ).tap();

    const row = screen.getByLabel(KEPT, { exact: false });
    await row.waitFor({ timeout: 30_000 });
    // The row clips its title before the cut; the discard prompt shows it whole.
    await row.longPress();
    // Android's long-press menu exposes its items as text, iOS's as buttons.
    await (
      supaterm.platform === "ios"
        ? screen.getByRole("button", "Discard")
        : screen.getByText("Discard", { exact: true })
    ).tap();
    await app.screenshot("discard-prompt");
    // iOS confirms in a system alert; Android in the app's own dialog.
    if (supaterm.platform === "ios") await device.alert("dismiss");
    else await screen.getByText("Cancel", { exact: true }).tap();
    await expect(row).toHaveAccessibleName(`${KEPT}...`);
  },
);
