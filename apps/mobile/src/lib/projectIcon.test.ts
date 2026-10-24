import type { ProjectIconOverride } from "@supaterm/contracts";
import { Folder, Rocket } from "@supaterm/icons/nodes";
import { describe, expect, it } from "vite-plus/test";

import {
  projectAutoMonogram,
  resolveProjectChipIcon,
  resolveProjectIconGlyph,
} from "./projectIcon";

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

const project = (title: string, projectIcon?: ProjectIconOverride) => ({
  title,
  workspaceRoot: `/work/${title}`,
  projectIcon,
});

describe("resolveProjectChipIcon", () => {
  const favicon = () => "https://env.example/favicon.png";
  const noFavicon = () => null;
  const lime = () => "lime" as const;

  it("shows the chat bubble for unknown threads and the no-project folder", () => {
    expect(resolveProjectChipIcon(null, "/scratch", favicon, lime)).toBeNull();
    expect(resolveProjectChipIcon(project("scratch"), "/work/scratch", favicon, lime)).toBeNull();
  });

  it("prefers a custom icon over the favicon", () => {
    expect(
      resolveProjectChipIcon(
        project("supaterm", { kind: "monogram", text: "Q7", color: "violet" }),
        null,
        favicon,
        lime,
      ),
    ).toEqual({ kind: "monogram", text: "Q7", color: "violet" });
    expect(
      resolveProjectChipIcon(
        project("supaterm", { kind: "emoji", emoji: "🚀" }),
        null,
        favicon,
        lime,
      ),
    ).toEqual({ kind: "emoji", emoji: "🚀" });
    expect(
      resolveProjectChipIcon(
        project("lucide proj", { kind: "lucide", name: "rocket", color: "emerald" }),
        null,
        favicon,
        lime,
      ),
    ).toEqual({ kind: "icon", node: Rocket, color: "emerald" });
  });

  it("uses the favicon, then a monogram of the title in the project's color", () => {
    expect(resolveProjectChipIcon(project("supaterm"), null, favicon, lime)).toEqual({
      kind: "favicon",
      uri: "https://env.example/favicon.png",
    });
    expect(resolveProjectChipIcon(project("Auto Monogram"), null, noFavicon, lime)).toEqual({
      kind: "monogram",
      text: "AM",
      color: "lime",
    });
    expect(
      resolveProjectChipIcon(
        project("supaterm"),
        null,
        () => "https://env.example/api/assets/project-favicon-missing",
        lime,
      ),
    ).toMatchObject({ kind: "monogram" });
  });
});

describe("projectAutoMonogram", () => {
  it("leaves untitled projects to the folder icon", () => {
    expect(projectAutoMonogram("", "blue")).toBeNull();
    expect(projectAutoMonogram("   ", "blue")).toBeNull();
  });
});
