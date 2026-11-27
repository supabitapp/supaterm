import { describe, expect, it } from "vite-plus/test";

import {
  addAllowedTailnetLogin,
  normalizeTailnetHostnameDraft,
  tailnetControlUrlDraftError,
  tailnetHostnameDraftError,
} from "./BuiltInTailscaleSettings.logic";

describe("tailnet machine name drafts", () => {
  it("turns typed names into DNS labels", () => {
    expect(normalizeTailnetHostnameDraft("Ada's Mac_mini.local")).toBe("ada's-mac-mini-local");
  });

  it.each([
    ["supaterm-studio", null],
    ["  desk  ", null],
    ["", "Enter a machine name."],
    ["-desk", expect.stringContaining("hyphens")],
    ["ada's-mac", expect.stringContaining("hyphens")],
    ["a".repeat(64), expect.stringContaining("63")],
  ])("checks %j", (draft, expected) => {
    expect(tailnetHostnameDraftError(draft)).toEqual(expected);
  });
});

describe("tailnet control server drafts", () => {
  it.each([
    ["", true],
    ["https://headscale.example.com", true],
    ["http://10.0.0.2:8080", true],
    ["https://admin:secret@headscale.example.com", false],
    ["ftp://headscale.example.com", false],
    ["headscale.example.com", false],
  ])("accepts %j: %s", (draft, valid) => {
    expect(tailnetControlUrlDraftError(draft) === null).toBe(valid);
  });
});

describe("addAllowedTailnetLogin", () => {
  it("adds a trimmed login", () => {
    expect(addAllowedTailnetLogin(["ada@example.com"], "  grace@example.com ")).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
  });

  it("adds nothing for a blank draft or a login already allowed in another case", () => {
    expect(addAllowedTailnetLogin(["ada@example.com"], "   ")).toBeNull();
    expect(addAllowedTailnetLogin(["ada@example.com"], "ADA@example.com")).toBeNull();
  });
});
