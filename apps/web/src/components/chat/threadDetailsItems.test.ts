import { describe, expect, it } from "vite-plus/test";

import {
  isDefaultThreadDetailsVisibility,
  resolveThreadDetailsVisibility,
  setThreadDetailsItem,
  THREAD_DETAILS_ITEMS,
  withoutParentCheckoutItems,
} from "./threadDetailsItems";

const usage = THREAD_DETAILS_ITEMS.find((item) => item.id === "usage")!;
const servers = THREAD_DETAILS_ITEMS.find((item) => item.id === "servers")!;

describe("thread details items", () => {
  it.each([
    { items: {}, usage: false },
    { items: { usage: true }, usage: true },
    { items: { usage: true, retired: false }, usage: true },
  ])("resolves Usage limits from sparse overrides: %o", (row) => {
    const visibility = resolveThreadDetailsVisibility({ threadDetailsItems: row.items });
    expect(visibility.usage).toBe(row.usage);
    expect(visibility.servers).toBe(true);
    expect(visibility.context).toBe(true);
  });

  it("stores only choices that differ from the default", () => {
    const none = { threadDetailsItems: {} };
    expect(setThreadDetailsItem(none, usage, true)).toEqual({ usage: true });
    expect(setThreadDetailsItem({ threadDetailsItems: { usage: true } }, usage, false)).toEqual({});

    const hidden = { threadDetailsItems: { servers: false } };
    expect(setThreadDetailsItem(hidden, servers, true)).toEqual({});
    expect(isDefaultThreadDetailsVisibility(resolveThreadDetailsVisibility(hidden))).toBe(false);
  });

  it("leaves the parent checkout's controls out of a side chat's card", () => {
    const visibility = withoutParentCheckoutItems(
      resolveThreadDetailsVisibility({ threadDetailsItems: {} }),
    );
    expect(visibility).toMatchObject({ environment: false, branch: false });
    expect(visibility).toMatchObject({ openIn: true, context: true, sideChats: true });
  });
});
