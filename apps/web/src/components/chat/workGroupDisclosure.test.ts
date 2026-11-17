import { describe, expect, it } from "vite-plus/test";
import {
  expandedWorkGroupIds,
  restoredWorkGroupDisclosures,
  settleWorkGroupTransition,
  startWorkGroupTransition,
  nextWorkGroupTransition,
} from "./workGroupDisclosure";

describe("work group disclosure", () => {
  it("lets the latest toggle decide how a group settles", () => {
    const restored = restoredWorkGroupDisclosures(new Set(["restored"]));
    expect(restored.get("restored")).toBe("open");

    expect(nextWorkGroupTransition(restored.get("group"))).toBe("opening");
    const opening = startWorkGroupTransition(restored, "group", "opening");
    expect(expandedWorkGroupIds(opening)).toEqual(new Set(["restored", "group"]));

    expect(nextWorkGroupTransition(opening.get("group"))).toBe("closing");
    const closing = startWorkGroupTransition(opening, "group", "closing");
    expect(expandedWorkGroupIds(closing)).toEqual(new Set(["restored"]));
    expect(settleWorkGroupTransition(closing, "group", "opening")).toBe(closing);

    expect(nextWorkGroupTransition(closing.get("group"))).toBe("opening");
    const reopening = startWorkGroupTransition(closing, "group", "opening");
    expect(settleWorkGroupTransition(reopening, "group", "closing")).toBe(reopening);
    expect(settleWorkGroupTransition(reopening, "group", "opening").get("group")).toBe("open");

    expect(settleWorkGroupTransition(closing, "group", "closing").has("group")).toBe(false);
  });
});
