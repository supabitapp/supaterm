import { describe, expect, it } from "vite-plus/test";
import { PROJECT_ICON_COLORS } from "./projectIconColors";
import {
  assignProjectColors,
  projectColorKey,
  projectMonogram,
} from "@supaterm/shared/projectIdentity";

function projects(...titles: ReadonlyArray<string>) {
  return titles.map((title, index) => ({
    title,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
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
  ])("derives %s as %s", (projectName, expected) => {
    expect(projectMonogram(projectName)).toBe(expected);
  });
});

describe("assignProjectColors", () => {
  const names = [
    "supaterm",
    "supacode-relay",
    "claude-balancer",
    "ma-turbo-overload",
    "Nebula",
    "Silver Orchard",
    "Blue Harbor",
    "Copper Finch",
    "Juniper Vale",
  ];

  it("gives every project its own color until the palette runs out", () => {
    const colors = assignProjectColors(projects(...names));

    expect(new Set(colors.values()).size).toBe(names.length);
  });

  it("only assigns colors the icon picker offers", () => {
    const palette = PROJECT_ICON_COLORS.map(({ value }) => value);
    for (const color of assignProjectColors(projects(...names, "文書", "---")).values()) {
      expect(palette).toContain(color);
    }
  });

  it("keeps existing colors when a newer project is added", () => {
    const before = assignProjectColors(projects(...names.slice(0, 5)));
    const after = assignProjectColors(projects(...names.slice(0, 6)));

    for (const [key, color] of before) {
      expect(after.get(key)).toBe(color);
    }
  });

  it("assigns by creation time rather than list order", () => {
    const ordered = projects(...names);

    expect(assignProjectColors(ordered.toReversed())).toEqual(assignProjectColors(ordered));
  });

  it("shares one color between projects with the same name", () => {
    const colors = assignProjectColors(projects("Nebula", "  NEBULA  "));

    expect([...colors.keys()]).toEqual([projectColorKey("nebula")]);
  });
});
