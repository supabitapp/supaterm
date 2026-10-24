import { describe, expect, it } from "vite-plus/test";

import { mobileHtmlRenderTheme } from "./htmlRenderTheme";
import { getMobileThemeVariables } from "./mobileTheme";

describe("mobileHtmlRenderTheme", () => {
  it("paints the page with the feed's own canvas", () => {
    const variables = {
      ...getMobileThemeVariables("dracula", "dark"),
      "--color-thread-canvas": "#101010",
    };
    const theme = (platform: string) =>
      mobileHtmlRenderTheme({
        themeId: "dracula",
        appearance: "dark",
        variables,
        systemColors: false,
        platform,
      });
    expect(theme("android").variables["--background"]).toBe("#101010");
    expect(theme("ios").variables["--background"]).toBe(variables["--color-screen"]);
  });
});
