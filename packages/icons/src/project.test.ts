import { describe, expect, it } from "vite-plus/test";
import { PROJECT_ICONS, projectIconByName, projectIconForLucideName } from "./project.ts";

describe("project icons", () => {
  it("maps icon names saved from the old Lucide picker onto the current set", () => {
    expect(projectIconForLucideName("folder-code")?.name).toBe("folder");
    expect(projectIconForLucideName("layers-3")?.name).toBe("layers");
    expect(projectIconForLucideName("message-square-dashed")?.name).toBe("message-square-more");
    expect(projectIconForLucideName("rocket")?.name).toBe("rocket");
    expect(projectIconForLucideName("alarm-clock-check")).toBeUndefined();
  });

  it("offers each icon once", () => {
    const names = PROJECT_ICONS.map((icon) => icon.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(projectIconByName(name)?.name).toBe(name);
  });
});
