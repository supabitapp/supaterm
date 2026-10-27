import { Folder, Rocket } from "@supaterm/icons/nodes";
import { describe, expect, it } from "vite-plus/test";

import { resolveProjectIconGlyph } from "./projectIcon";

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
