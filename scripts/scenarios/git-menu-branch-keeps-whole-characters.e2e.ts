import { expect } from "e2e";

import { run } from "./shell.ts";
import { runPromise } from "./supaterm.ts";
import { NATIVE, test } from "./supaterm-mobile.ts";

// The Git menu shows 12 units, "…" and the last 11; each emoji straddles one cut.
const BRANCH = "feature/abc😀-long-branch-name-😀-for-menus";

test(
  "The Git menu's branch title keeps whole characters at both cuts",
  NATIVE,
  async ({ supaterm, app, screen }) => {
    const project = await supaterm.project("demo");
    await runPromise(run("git", ["checkout", "--quiet", "-b", BRANCH], { cwd: project }));
    await supaterm.thread({ project, title: "Branch work", messages: ["first"] });
    await supaterm.open();

    await screen.getByText("Branch work", { exact: false }).first().tap({ timeout: 120_000 });
    // The header adds its Terminal menu last, which moves Git controls; aim once it is in place.
    await screen.getByRole("button", "Terminal").first().waitFor({ timeout: 60_000 });
    await screen.getByRole("button", "Git controls").first().tap();
    const title = screen.getByText("feature/abc", { exact: false }).first();
    await title.waitFor({ timeout: 30_000 });
    await app.screenshot("git-menu");
    // iOS reads the branch and its status as one element; Android reads the branch alone.
    await expect(title).toHaveText(/^feature\/abc…-for-menus(, Clean)?$/);
  },
);
