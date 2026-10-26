import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  type EnvironmentId,
  INCOGNITO_BROWSER_PROFILE_ID,
  type PreviewSessionSnapshot,
  ThreadId,
} from "@supaterm/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useClosedViewStore } from "./closedViewStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const diff = (threadRef: typeof refA) =>
  ({ kind: "panel-tab", threadRef, surface: { kind: "diff", id: "diff" } }) as const;

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
});

const snapshot: PreviewSessionSnapshot = {
  threadId: refA.threadId,
  tabId: "private-tab",
  profileId: INCOGNITO_BROWSER_PROFILE_ID,
  navStatus: { _tag: "Success", url: "https://private.example", title: "Private page" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-06T17:00:00.000Z",
};

describe("closedViewStore", () => {
  it("keeps private tabs available in memory without saving their metadata", async () => {
    const store = useClosedViewStore.getState();
    const publicId = store.remember(diff(refA));
    const privateId = store.remember({ kind: "browser", threadRef: refA, snapshot });
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([
      privateId,
      publicId,
    ]);
    const { storage, name } = useClosedViewStore.persist.getOptions();
    const saved = JSON.stringify(await storage!.getItem(name!));
    expect(saved).not.toContain("private.example");
    expect(saved).not.toContain("Private page");
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([publicId]);
  });
});
