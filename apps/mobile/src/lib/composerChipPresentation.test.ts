import { describe, expect, it } from "vite-plus/test";

import { contextChipAccent, contextChipPresentation } from "./composerChipPresentation";
import {
  flattenThemeColor,
  getMobileThemeVariables,
  MOBILE_THEME_IDS,
  type MobileThemeVariables,
} from "./mobileTheme";

describe("contextChipPresentation image detection", () => {
  it("treats a picture attached through the file picker as an image", async () => {
    const { contextChipPresentation } = await import("./composerChipPresentation");
    expect(
      contextChipPresentation("file", { kind: "file", name: "IMG_4997.PNG", mimeType: "" }),
    ).toEqual({ accent: "#d55665", icon: "image" });
    expect(
      contextChipPresentation("file", {
        kind: "file",
        name: "shot",
        mimeType: "image/jpeg",
      }),
    ).toEqual({ accent: "#d55665", icon: "image" });
  });

  it("leaves genuine documents and videos alone", async () => {
    const { contextChipPresentation } = await import("./composerChipPresentation");
    expect(
      contextChipPresentation("file", { kind: "file", name: "notes.txt", mimeType: "text/plain" }),
    ).toEqual({ accent: "#0090cd", icon: null });
    expect(
      contextChipPresentation("file", { kind: "file", name: "clip.mp4", mimeType: "video/mp4" }),
    ).toEqual({ accent: "#d06217", icon: "film" });
  });
});

describe("pull request chip status", () => {
  const chip = async (state: string, isDraft = false) => {
    const { contextChipPresentation } = await import("./composerChipPresentation");
    return contextChipPresentation("review-comment", {
      kind: "review-comment",
      sectionId: "pull-request:10978",
      pullRequest: { state, isDraft },
    });
  };

  it("gives composer and message chips web's per-state pull request glyphs", async () => {
    expect((await chip("open")).icon).toBe("git-pull-request-arrow");
    expect((await chip("open", true)).icon).toBe("git-pull-request-draft");
    expect((await chip("merged")).icon).toBe("git-merge");
    expect((await chip("closed")).icon).toBe("git-pull-request-closed");
  });
});

describe("contextChipIcon", () => {
  it("draws the chip's own glyph, or the file-type icon for plain files", async () => {
    const { contextChipIcon, contextChipPresentation, contextRecordFileName } =
      await import("./composerChipPresentation");
    expect(contextChipIcon(contextChipPresentation("terminal"), "")).toEqual({
      kind: "chip",
      name: "terminal",
    });
    const record = { kind: "file", path: "src/index.ts" };
    expect(
      contextChipIcon(contextChipPresentation("file", record), contextRecordFileName(record)),
    ).toEqual({ kind: "file", name: expect.any(String) });
    expect(contextRecordFileName({ name: "notes.txt" })).toBe("notes.txt");
    expect(contextRecordFileName(undefined)).toBe("");
  });
});

const CHIP_ACCENTS = [
  ...new Set(
    [
      ...[
        "image",
        "video",
        "file",
        "mention",
        "terminal",
        "element",
        "review-comment",
        "pull-request",
        "skill",
        "thread",
      ].map((kind) => contextChipPresentation(kind)),
      ...[
        { state: "open", isDraft: false },
        { state: "open", isDraft: true },
        { state: "merged", isDraft: false },
        { state: "closed", isDraft: false },
      ].map((pullRequest) => contextChipPresentation("pull-request", { pullRequest })),
    ].flatMap(({ accent }) => (accent ? [accent] : [])),
  ),
];

function relativeLuminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const [darker = 0, lighter = 0] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => a - b,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function chipSurfaces(theme: MobileThemeVariables) {
  const screen = theme["--color-screen"];
  return (
    [
      ["--color-user-bubble", "--color-user-bubble-foreground"],
      ["--color-thread-canvas", "--color-md-body"],
      ["--color-composer-surface", "--color-foreground"],
    ] as const
  ).map(([surface, text]) => ({
    surface: flattenThemeColor(theme[surface], screen).slice(0, 7),
    text: theme[text],
  }));
}

const BUILT_IN_THEMES = MOBILE_THEME_IDS.filter((id) => id !== "material-you").flatMap((id) =>
  (["light", "dark"] as const).map((appearance) => ({
    name: `${id} ${appearance}`,
    theme: getMobileThemeVariables(id, appearance),
  })),
);

describe("contextChipAccent", () => {
  it("draws one color per theme that reads at 5:1 in messages, replies and the composer", () => {
    for (const { name, theme } of BUILT_IN_THEMES) {
      for (const accent of CHIP_ACCENTS) {
        const shown = contextChipAccent(accent, theme, theme["--color-md-body"])!;
        for (const { surface, text } of chipSurfaces(theme)) {
          expect(contextChipAccent(accent, theme, text)).toBe(shown);
          expect(
            contrastRatio(shown, surface),
            `${name}: ${accent} → ${shown} on ${surface}`,
          ).toBeGreaterThanOrEqual(5);
        }
      }
    }
  });

  it("reads on both a saturated Material You bubble and the light canvas beside it", () => {
    const theme = {
      ...getMobileThemeVariables("supaterm", "light"),
      "--color-user-bubble": "#6750a4",
      "--color-user-bubble-foreground": "#ffffff",
    };
    for (const { surface, text } of chipSurfaces(theme)) {
      for (const accent of CHIP_ACCENTS) {
        const shown = contextChipAccent(accent, theme, text)!;
        expect(
          contrastRatio(shown, surface),
          `${accent} → ${shown} on ${surface}`,
        ).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("keeps an accent that already reads everywhere", () => {
    const theme = getMobileThemeVariables("supaterm", "dark");
    expect(contextChipAccent("#00b07a", theme, theme["--color-md-body"])).toBe("#00b07a");
  });
});
