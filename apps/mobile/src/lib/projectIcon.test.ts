import { Folder, Rocket } from "@supaterm/icons/nodes";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolveProjectChipIcon, resolveProjectIconGlyph } from "./projectIcon";

describe("resolveProjectIconGlyph", () => {
  it("draws saved icons, including ones saved from the old Lucide picker", () => {
    expect(resolveProjectIconGlyph({ kind: "icon", name: "rocket", color: "blue" })).toEqual({
      kind: "icon",
      node: Rocket,
      color: "blue",
    });
    expect(resolveProjectIconGlyph({ kind: "lucide", name: "rocket", color: "red" })).toMatchObject(
      { kind: "icon", node: Rocket },
    );
  });

  it("draws a folder for an icon this client does not know", () => {
    expect(resolveProjectIconGlyph({ kind: "icon", name: "not-an-icon", color: "teal" })).toEqual({
      kind: "icon",
      node: Folder,
      color: "teal",
    });
  });
});

describe("resolveProjectChipIcon", () => {
  const project = { title: "Project One", workspaceRoot: "/work/project" };

  it("omits scratch projects without requesting a favicon", () => {
    const favicon = vi.fn(() => "https://host/api/favicon");
    expect(resolveProjectChipIcon(null, null, favicon)).toBeNull();
    expect(resolveProjectChipIcon(project, "/work/project/", favicon)).toBeNull();
    expect(favicon).not.toHaveBeenCalled();
  });

  it("preserves saved icons ahead of favicon lookup", () => {
    const favicon = vi.fn(() => "https://host/api/favicon");
    expect(
      resolveProjectChipIcon(
        { ...project, projectIcon: { kind: "icon", name: "rocket", color: "blue" } },
        null,
        favicon,
      ),
    ).toEqual({ kind: "icon", node: Rocket, color: "blue" });
    expect(favicon).not.toHaveBeenCalled();
  });

  it("uses a real favicon and replaces the server missing-image marker with a monogram", () => {
    expect(resolveProjectChipIcon(project, null, () => "https://host/api/favicon")).toEqual({
      kind: "favicon",
      uri: "https://host/api/favicon",
    });
    expect(
      resolveProjectChipIcon(project, null, () => "https://host/project-favicon-missing"),
    ).toMatchObject({ kind: "monogram", text: "PO" });
  });
});
