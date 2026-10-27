import { describe, expect, it } from "vite-plus/test";
import { filterProjectIcons, firstEmoji } from "./projectIconOptions";

const names = (query: string) => filterProjectIcons(query).map((icon) => icon.name);

describe("projectIconOptions", () => {
  it("matches icons by name and by what they depict", () => {
    expect(names("git branch")).toContain("git-branch");
    expect(names("console")).toContain("terminal");
    expect(names("not-an-icon")).toEqual([]);
  });

  it("extracts one complete emoji grapheme", () => {
    expect(firstEmoji("  👩🏽‍💻 hello")).toBe("👩🏽‍💻");
    expect(firstEmoji("🇺🇸 project")).toBe("🇺🇸");
    expect(firstEmoji("1️⃣ project")).toBe("1️⃣");
    expect(firstEmoji("plain text")).toBeNull();
  });
});
