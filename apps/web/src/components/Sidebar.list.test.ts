import { EnvironmentId, ProviderInstanceId, ThreadId } from "@supaterm/contracts";
import { expect, it } from "vite-plus/test";
import {
  buildSidebarInboxItems,
  buildSidebarListItems,
  sidebarListLayoutKey,
  previewDraggedInbox,
} from "./Sidebar.list";
import { makeThreadFixture } from "../test-fixtures";
import { resolveSidebarDropTarget, sidebarListItemId } from "./Sidebar.logic";

it("keeps state on grouped rows and one shared Done shelf", () => {
  const environmentId = EnvironmentId.make("env");
  const row = (id: string) => makeThreadFixture({ environmentId, id: ThreadId.make(id) });
  const inboxItems = buildSidebarInboxItems({
    mode: "project",
    active: [row("a")],
    working: [row("w")],
    visibleWorking: [],
    projects: [
      {
        key: "p",
        label: "Project",
        memberProjectRefs: [{ environmentId, projectId: row("a").projectId }],
      },
    ],
    now: "2026-10-21T12:00:00.000Z",
  });
  const items = buildSidebarListItems({
    hasThreads: true,
    pinned: [row("p")],
    snoozed: [],
    done: [row("d")],
    showSnoozed: false,
    inboxItems,
  });
  expect(
    items.filter((item) => item.kind === "marker" && item.marker === "done-header"),
  ).toHaveLength(1);
  expect(items.filter((item) => item.kind === "thread")).toEqual([
    { kind: "thread", key: "env:p", section: "pinned" },
    { kind: "thread", key: "env:a", section: "active" },
    { kind: "thread", key: "env:w", section: "working" },
    { kind: "thread", key: "env:d", section: "done" },
  ]);
  expect(resolveSidebarDropTarget(items, "env:d", sidebarListItemId(inboxItems[0]!))?.section).toBe(
    "active",
  );
  expect(sidebarListLayoutKey(items)).not.toEqual(
    sidebarListLayoutKey(
      items.map((item) => (item.kind === "group" ? { ...item, label: "Renamed" } : item)),
    ),
  );
});

it("previews an unpinned working thread in the Working shelf and preserves collapsed rows", () => {
  const now = "2026-10-21T12:00:00.000Z";
  const returning = makeThreadFixture({
    pinnedAt: now,
    runtime: {
      status: "running",
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("provider"),
      providerName: "Provider",
      lastError: null,
      updatedAt: now,
    },
  });
  const activeKey = `${returning.environmentId}:${returning.id}`;
  const input = {
    mode: "status" as const,
    active: [],
    working: [returning],
    visibleWorking: [],
    projects: [],
    now,
  };
  expect(buildSidebarInboxItems(input)).toEqual([{ kind: "marker", marker: "working-header" }]);
  for (const workingShelfExpanded of [false, true]) {
    for (const routeThreadKey of [null, activeKey]) {
      const preview = previewDraggedInbox({
        ...input,
        working: [],
        drag: { activeKey, occurredAt: now },
        threadByKey: new Map([[activeKey, returning]]),
        inboxReturnAt: () => undefined,
        workingShelfExpanded,
        routeThreadKey,
      });
      expect(preview?.active).toEqual([
        { kind: "marker", marker: "working-header" },
        ...(workingShelfExpanded || routeThreadKey === activeKey
          ? [{ kind: "thread", key: activeKey, section: "working" }]
          : []),
      ]);
      expect(preview?.other).toEqual([]);
    }
  }
});
