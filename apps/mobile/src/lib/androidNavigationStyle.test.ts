import { describe, expect, it } from "vite-plus/test";
import { resolveAndroidNavigationStyle } from "./androidNavigationStyle";

describe("resolveAndroidNavigationStyle", () => {
  it("keeps Material as the default", () => {
    expect(resolveAndroidNavigationStyle(undefined)).toBe("material");
  });

  it.each(["material", "one-ui"] as const)("respects a saved %s choice", (choice) => {
    expect(resolveAndroidNavigationStyle(choice)).toBe(choice);
  });
});
