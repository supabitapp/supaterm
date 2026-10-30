import { describe, expect, it } from "vite-plus/test";

import {
  assignProjectColors,
  preferredProjectColor,
  projectColorKey,
  projectMonogram,
} from "./projectIdentity.ts";

function projects(...titles: ReadonlyArray<string>) {
  return titles.map((title, index) => ({
    title,
    createdAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
  }));
}

describe("projectMonogram", () => {
  it.each([
    ["Nebula", "NA"],
    ["Silver Orchard", "SO"],
    ["Quiet Lantern Workshop", "QW"],
    ["m7forge", "M7"],
    ["M7 Forge", "M7"],
    ["X", "XX"],
    ["---", "PR"],
    ["ﬁle", "FE"],
    ["Ｆｏｏ １２", "F1"],
    ["𠮷野", "𠮷野"],
    ["ß", "SS"],
  ])("derives %s as %s", (name, expected) => {
    expect(projectMonogram(name)).toBe(expected);
  });
});

describe("projectColorKey", () => {
  it.each([
    ["  NEBULA  ", "nebula"],
    ["  Ｎｅｂｕｌａ  ", "nebula"],
    ["CAFE\u0301", "café"],
    ["Lake  Studio", "lake  studio"],
  ])("normalizes %s to %s", (name, expected) => {
    expect(projectColorKey(name)).toBe(expected);
  });
});

describe("preferredProjectColor", () => {
  it.each([
    ["supaterm", "pink"],
    ["Lake Studio", "orange"],
    ["Cedar Engine", "blue"],
    ["Orbit Notes", "cyan"],
    ["Nebula", "orange"],
    ["Silver Orchard", "lime"],
  ])("preserves the web color for %s", (name, expected) => {
    expect(preferredProjectColor(projectColorKey(name))).toBe(expected);
  });
});

describe("assignProjectColors", () => {
  const names = [
    "supaterm",
    "Lake Studio",
    "Cedar Engine",
    "Orbit Notes",
    "Nebula",
    "Silver Orchard",
    "Blue Harbor",
    "Copper Finch",
    "Juniper Vale",
  ];

  it("preserves the web palette and collision choices", () => {
    expect([...assignProjectColors(projects(...names))]).toEqual([
      ["supaterm", "pink"],
      ["lake studio", "orange"],
      ["cedar engine", "blue"],
      ["orbit notes", "cyan"],
      ["nebula", "lime"],
      ["silver orchard", "emerald"],
      ["blue harbor", "amber"],
      ["copper finch", "violet"],
      ["juniper vale", "red"],
    ]);
  });

  it("reuses the palette after every color has been assigned", () => {
    const colors = assignProjectColors(projects(...names, "文書"));
    expect(new Set([...colors.values()].slice(0, 9)).size).toBe(9);
    expect(colors.get("文書")).toBe("pink");
  });

  it("keeps existing colors when a newer project is added", () => {
    const before = assignProjectColors(projects(...names.slice(0, 5)));
    const after = assignProjectColors(projects(...names.slice(0, 6)));

    for (const [key, color] of before) {
      expect(after.get(key)).toBe(color);
    }
  });

  it("assigns by creation time without changing the input list", () => {
    const newestFirst = Object.freeze(projects(...names).toReversed());
    expect(assignProjectColors(newestFirst)).toEqual(assignProjectColors(projects(...names)));
    expect(newestFirst[0]?.title).toBe("Juniper Vale");
  });

  it("shares one color between normalized equivalent names", () => {
    const colors = assignProjectColors(projects("Nebula", "  NEBULA  ", "Ｎｅｂｕｌａ"));
    expect([...colors]).toEqual([["nebula", "orange"]]);
  });

  it("returns no assignments for an empty project list", () => {
    expect(assignProjectColors([]).size).toBe(0);
  });
});
