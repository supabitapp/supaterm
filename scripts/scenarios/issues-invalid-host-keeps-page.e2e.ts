import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

test(
  "An invalid host filter keeps the Issues page open",
  WEB,
  async ({ supaterm, app, browser }) => {
    await supaterm.project("demo");
    await supaterm.open("/issues?host=true");

    await app.screenshot("issues-invalid-host");
    await expect(browser.locator("h1")).toHaveText("Issues");
  },
);
