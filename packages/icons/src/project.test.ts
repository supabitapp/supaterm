import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_PROJECT_ICON, PROJECT_ICONS, resolveProjectIcon } from "./project.ts";

const lucide = (name: string) => resolveProjectIcon({ kind: "lucide", name }).name;

describe("resolveProjectIcon", () => {
  it("maps icon names saved from the old Lucide picker onto the current set", () => {
    expect(lucide("folder-code")).toBe("folder");
    expect(lucide("layers-3")).toBe("layers");
    expect(lucide("message-square-dashed")).toBe("message-square-more");
    expect(lucide("rocket")).toBe("rocket");
  });

  it("draws the default icon for a name this client does not offer", () => {
    expect(lucide("alarm-clock-check")).toBe(DEFAULT_PROJECT_ICON.name);
    expect(resolveProjectIcon({ kind: "icon", name: "from-a-newer-client" })).toBe(
      DEFAULT_PROJECT_ICON,
    );
  });

  it("resolves every offered icon by its own name", () => {
    for (const icon of PROJECT_ICONS) {
      expect(resolveProjectIcon({ kind: "icon", name: icon.name })).toBe(icon);
    }
  });
});
