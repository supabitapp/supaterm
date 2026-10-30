import { createInboxReturnTracker } from "@supaterm/client-runtime/state/thread-inbox";
import { presentThreadShell } from "@supaterm/client-runtime/state/models";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { planPinnedMove } from "@supaterm/client-runtime/state/thread-sort";
import {
  createPendingThreadOrder,
  createThreadMovePlanner,
  threadOrderAfterMove,
  threadDropLifecycle,
  reconcilePendingThreadOrder,
  type PendingThreadOrder,
} from "./threadOrder";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { threadSearchMatchKey } from "@supaterm/client-runtime/state/thread-search";
import { resolveSnoozePresets } from "@supaterm/client-runtime/state/thread-snooze";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { makeRawThreadShell, makeThreadShellFixture } from "../../test-fixtures";
import { threadJumpTarget } from "../keyboard/threadKeyboardShortcuts";
import {
  buildThreadListV2Items,
  buildThreadListV2ListItems,
  getThreadListV2OrderedSection,
  resolveThreadListV2SnoozeMenuSelection,
  resolveThreadListV2Status,
  resolveThreadListV2WokeAt,
  resolveThreadListV2SwipeActions,
  threadListV2ListItemsAreEqual,
  threadHasUnseenCompletion,
  type ThreadListV2ListItem,
} from "./threadListV2";

const environmentId = EnvironmentId.make("environment-1");
const decodeThreadShell = Schema.decodeUnknownSync(OrchestrationV2ThreadShell);

function makeThread(
  input: Partial<EnvironmentThreadShell> & Pick<EnvironmentThreadShell, "id" | "title">,
): EnvironmentThreadShell {
  return makeThreadShellFixture({
    environmentId,
    ...input,
  });
}

const NOW = "2026-06-02T00:00:00.000Z";

const linkedPullRequest = {
  projectId: ProjectId.make("project-1"),
  repository: "supabitapp/supaterm",
  number: 42,
  url: "https://github.com/supabitapp/supaterm/pull/42",
};

describe("resolveThreadListV2SnoozeMenuSelection", () => {
  it("recomputes presets that remain available instead of using old timestamps", () => {
    const displayedPresets = resolveSnoozePresets(new Date(2026, 4, 8, 10));
    const selectedAt = new Date(2026, 4, 8, 10, 30);
    const selection = resolveThreadListV2SnoozeMenuSelection({
      event: "snooze:hour",
      displayedPresets,
      now: selectedAt,
    });

    expect(selection._tag).toBe("selected");
    if (selection._tag === "selected") {
      expect(selection.preset.snoozedUntil).toBe(
        new Date(selectedAt.getTime() + 60 * 60 * 1_000).toISOString(),
      );
    }
  });
});

describe("resolveThreadListV2Status", () => {
  it("presents decoded thread waits as Waiting while preserving requests and older servers", () => {
    const raw = makeRawThreadShell({
      status: "running",
      activeRunId: RunId.make("run-wait"),
      latestRunId: RunId.make("run-wait"),
    });
    const present = (shell: unknown) => presentThreadShell(environmentId, decodeThreadShell(shell));

    expect(resolveThreadListV2Status(present(raw))).toBe("working");
    const blocked = present({ ...raw, blockedOnThreadWait: true });
    expect(
      resolveThreadListV2Status({
        ...blocked,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toBe("approval");
    expect(resolveThreadListV2Status({ ...blocked, hasPendingUserInput: true })).toBe("input");
    expect(resolveThreadListV2Status(blocked)).toBe("waiting");
    expect(resolveThreadListV2Status(present({ ...raw, blockedOnThreadWait: false }))).toBe(
      "working",
    );
  });

  it.each([
    { roster: "dev server", task: { kind: "command" }, status: "ready" },
    { roster: "dev server watchdog", task: { kind: "monitor" }, status: "ready" },
    { roster: "awaited command", task: { kind: "command", awaited: true }, status: "waiting" },
  ] as const)(
    "presents an unseen completion with a $roster roster as $status",
    ({ task, status }) => {
      const thread = presentThreadShell(
        environmentId,
        makeRawThreadShell({
          latestRunId: RunId.make("run-background-completion"),
          status: "completed",
          latestRunCompletedAt: DateTime.makeUnsafe(NOW),
          lastVisitedAt: DateTime.makeUnsafe("2026-06-01T23:59:00.000Z"),
          pendingBackgroundTasks: [{ taskId: "background-work", ...task }],
        }),
      );

      expect(resolveThreadListV2Status(thread)).toBe(status);
      expect(threadHasUnseenCompletion(thread)).toBe(true);
    },
  );
});

describe("queued messages keep a done thread active", () => {
  const threads = [
    makeThread({ id: ThreadId.make("active"), title: "Active" }),
    makeThread({ id: ThreadId.make("done"), title: "Done", doneOverride: "done" }),
    makeThread({
      id: ThreadId.make("done-queued"),
      title: "Done with outbox",
      doneOverride: "done",
    }),
  ];
  const queuedThreadKeys = new Set([`${environmentId}:done-queued`]);

  it("lists the thread in the active block instead of the done shelf", () => {
    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      now: NOW,
      queuedThreadKeys,
    });
    expect(layout.items.map((item) => [item.thread.id, item.variant] as const)).toEqual([
      ["active", "card"],
      ["done-queued", "card"],
      ["done", "slim"],
    ]);
    expect(layout.doneCount).toBe(1);
  });
});

describe("resolveThreadListV2SwipeActions", () => {
  it("offers reopen and snooze for done history", () => {
    expect(
      resolveThreadListV2SwipeActions({
        variant: "slim",
        markDoneSupported: true,
        snoozeSupported: true,
        snoozable: true,
      }),
    ).toEqual({ primary: "reopen", secondary: "snooze" });
  });

  it("offers wake and settle, but no snooze, on a snoozed row", () => {
    expect(
      resolveThreadListV2SwipeActions({
        variant: "slim",
        markDoneSupported: true,
        snoozeSupported: true,
        snoozable: true,
        snoozed: true,
      }),
    ).toEqual({ primary: "unsnooze", secondary: "mark-done" });
    expect(
      resolveThreadListV2SwipeActions({
        variant: "slim",
        markDoneSupported: false,
        snoozeSupported: true,
        snoozable: true,
        snoozed: true,
      }),
    ).toEqual({ primary: "unsnooze", secondary: null });
  });
});

describe("search lists ranked matches", () => {
  const matchKey = (id: string) =>
    threadSearchMatchKey({ environmentId, threadId: ThreadId.make(id) });

  it("lists matches by rank across shelves, then threads listed for their messages", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("notes"), title: "Deploy notes" }),
        makeThread({ id: ThreadId.make("mentioned"), title: "Weekly notes" }),
        makeThread({ id: ThreadId.make("exact"), title: "Deploy", doneOverride: "done" }),
      ],
      environmentId: null,
      searchQuery: "deploy",
      matchedThreadKeys: new Set([matchKey("mentioned"), matchKey("notes")]),
      doneShelfExpanded: false,
      now: NOW,
    });
    // The exact title leads even from a collapsed Done shelf, and keeps its look.
    expect(layout.items.map((item) => [item.thread.id, item.variant])).toEqual([
      ["exact", "slim"],
      ["notes", "card"],
      ["mentioned", "card"],
    ]);
    expect([...layout.contentOnlyThreadKeys]).toEqual([matchKey("mentioned")]);
  });

  it("shows matches from pinned and collapsed shelves as one list", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Deploy notes" }),
        makeThread({ id: ThreadId.make("pinned"), title: "Deploy", pinnedAt: NOW }),
      ],
      environmentId: null,
      searchQuery: "deploy",
      activeShelfExpanded: false,
      now: NOW,
    });
    const list = buildThreadListV2ListItems({
      ...layout,
      pendingTasks: [],
      activeShelfExpanded: false,
    });
    expect(
      list.map((entry) => (entry.type === "v2-thread" ? entry.item.thread.id : entry.type)),
    ).toEqual(["pinned", "active"]);
  });
});

describe("getThreadListV2OrderedSection", () => {
  it("uses each saved order and excludes done, snoozed, and archived rows", () => {
    const threads = [
      makeThread({ id: ThreadId.make("active-later"), title: "Later", activeOrderKey: "t" }),
      makeThread({ id: ThreadId.make("active-first"), title: "First", activeOrderKey: "f" }),
      makeThread({ id: ThreadId.make("active-new"), title: "New" }),
      makeThread({
        id: ThreadId.make("pinned-later"),
        title: "Pinned later",
        pinnedAt: NOW,
        pinOrderKey: "t",
        activeOrderKey: "f",
      }),
      makeThread({
        id: ThreadId.make("pinned-first"),
        title: "Pinned first",
        pinnedAt: NOW,
        pinOrderKey: "f",
        activeOrderKey: "t",
      }),
      makeThread({ id: ThreadId.make("done"), title: "Done", doneOverride: "done" }),
      makeThread({ id: ThreadId.make("archived"), title: "Archived", archivedAt: NOW }),
      makeThread({
        id: ThreadId.make("snoozed"),
        title: "Snoozed",
        snoozedUntil: "2026-06-03T10:00:00.000Z",
        snoozedAt: NOW,
      }),
      makeThread({
        id: ThreadId.make("pinned-snoozed"),
        title: "Pinned snoozed",
        pinnedAt: NOW,
        snoozedUntil: "2026-06-03T10:00:00.000Z",
        snoozedAt: NOW,
      }),
    ];
    expect(
      getThreadListV2OrderedSection({ threads, section: "active", now: NOW }).map(
        (thread) => thread.id,
      ),
    ).toEqual(["active-new", "active-first", "active-later"]);
    expect(
      getThreadListV2OrderedSection({ threads, section: "pinned", now: NOW }).map(
        (thread) => thread.id,
      ),
    ).toEqual(["pinned-first", "pinned-later"]);
  });
});

describe("buildThreadListV2Items", () => {
  it("collapses Active while keeping its count and selected thread reachable", () => {
    const threads = ["active-one", "active-two"].map((id) =>
      makeThread({ id: ThreadId.make(id), title: id }),
    );
    const input = { threads, environmentId: null, searchQuery: "", now: NOW };
    const collapsed = buildThreadListV2Items({ ...input, activeShelfExpanded: false });
    const list = buildThreadListV2ListItems({
      ...collapsed,
      pendingTasks: [makePendingTask("queued")],
      activeShelfExpanded: false,
    });
    expect(collapsed.items).toEqual([]);
    expect(list).toEqual([
      {
        type: "v2-active-header",
        key: "v2-active-header",
        count: 3,
        expanded: false,
        disabled: false,
      },
    ]);
    expect(threadJumpTarget(list, "thread.jump.1")).toBeNull();
    const selected = buildThreadListV2Items({
      ...input,
      activeShelfExpanded: false,
      selectedThreadKey: `${environmentId}:active-two`,
    });
    const selectedList = buildThreadListV2ListItems({
      ...selected,
      pendingTasks: [],
      activeShelfExpanded: false,
    });
    expect(selected.activeCount).toBe(2);
    expect(threadJumpTarget(selectedList, "thread.jump.1")?.id).toBe("active-two");
    expect(threadJumpTarget(selectedList, "thread.jump.2")).toBeNull();
    expect(buildThreadListV2Items({ ...input, activeShelfExpanded: true }).items).toHaveLength(2);
  });

  it("places a persisted done thread in the done shelf", () => {
    const thread = makeThread({
      id: ThreadId.make("linked-merged"),
      title: "Linked merged pull request",
      linkedPullRequest,
      doneOverride: "done",
      doneAt: NOW,
    });
    const layout = buildThreadListV2Items({
      threads: [thread],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.doneCount).toBe(1);
    expect(layout.items[0]?.variant).toBe("slim");
  });

  it("hides snoozed threads and counts them — visibility parity with web", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("woken"),
          title: "Woken",
          snoozedUntil: "2026-06-01T18:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "woken"]);
    expect(layout.snoozedCount).toBe(1);
  });

  it("places done pinned threads in the done shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("pinned-done"),
          title: "Pinned while done",
          pinnedAt: "2026-06-01T12:00:00.000Z",
          doneOverride: "done",
          doneAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "pinned-done"]);
    expect(layout.items.map((item) => item.pinned)).toEqual([false, false]);
    expect(layout.doneCount).toBe(1);
  });

  it("collapses pins without losing the selected thread or their saved order", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("later"),
        title: "Later pin",
        pinnedAt: NOW,
        pinOrderKey: "b",
      }),
      makeThread({ id: ThreadId.make("active"), title: "Active" }),
      makeThread({
        id: ThreadId.make("first"),
        title: "First pin",
        pinnedAt: NOW,
        pinOrderKey: "a",
      }),
    ];
    const input = { threads, environmentId: null, searchQuery: "", now: NOW };
    const expanded = buildThreadListV2Items(input);
    expect(expanded.pinnedCount).toBe(2);
    expect(expanded.items.map((item) => item.thread.id)).toEqual(["first", "later", "active"]);
    const collapsed = buildThreadListV2Items({ ...input, pinnedShelfExpanded: false });
    expect(collapsed.items.map((item) => item.thread.id)).toEqual(["active"]);
    const collapsedList = buildThreadListV2ListItems({
      ...collapsed,
      pendingTasks: [],
      pinnedShelfExpanded: false,
    });
    expect(collapsedList.map((item) => item.type)).toEqual([
      "v2-pinned-shelf",
      "v2-active-header",
      "v2-thread",
    ]);
    expect(collapsedList[0]).toMatchObject({ count: 2, expanded: false });
    const selected = buildThreadListV2Items({
      ...input,
      pinnedShelfExpanded: false,
      selectedThreadKey: `${environmentId}:later`,
    });
    expect(selected.items.map((item) => item.thread.id)).toEqual(["later", "active"]);
    expect(
      getThreadListV2OrderedSection({ threads, section: "pinned", now: NOW }).map(
        (thread) => thread.id,
      ),
    ).toEqual(["first", "later"]);
    expect(buildThreadListV2Items({ ...input, pinnedShelfExpanded: true }).items).toEqual(
      expanded.items,
    );
    const filtered = buildThreadListV2Items({
      ...input,
      searchQuery: "First",
      pinnedShelfExpanded: false,
    });
    const filteredList = buildThreadListV2ListItems({
      ...filtered,
      pendingTasks: [],
      pinnedShelfExpanded: false,
    });
    // Search lists its matches without shelves, so a collapsed pin still shows.
    expect(
      filteredList.map((entry) => (entry.type === "v2-thread" ? entry.item.thread.id : entry.type)),
    ).toEqual(["first"]);
    const header = collapsedList[0]!;
    expect(threadListV2ListItemsAreEqual(header, { ...header })).toBe(true);
    if (header.type !== "v2-pinned-shelf") throw new Error("Expected Pinned header");
    expect(threadListV2ListItemsAreEqual(header, { ...header, expanded: true })).toBe(false);
    expect(threadListV2ListItemsAreEqual(header, { ...header, disabled: true })).toBe(false);
  });

  it("keeps active pinned threads in the pinned block", () => {
    const pinned = makeThread({
      id: ThreadId.make("pinned"),
      title: "Pinned thread",
      pinnedAt: "2026-06-01T12:00:00.000Z",
    });
    const layout = buildThreadListV2Items({
      threads: [pinned],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items[0]).toMatchObject({
      thread: { id: "pinned" },
      variant: "card",
      pinned: true,
    });
    expect(layout.doneCount).toBe(0);
  });

  it("moves a done pinned thread into the done shelf — parity with web (#7969)", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("pinned-done"),
          title: "Pinned while done",
          pinnedAt: "2026-06-01T12:00:00.000Z",
          // Stale done state (the decider clears it on pin): the pin wins.
          doneOverride: "done",
          doneAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    // A done thread leaves the active block even while pinned;
    // the pin re-applies when the thread is un-done.
    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "pinned-done"]);
    expect(layout.items.map((item) => item.pinned)).toEqual([false, false]);
    expect(layout.doneCount).toBe(1);
  });

  it("snooze hides a pinned thread and wake restores it to the pinned block", () => {
    const snoozedInput = {
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("pinned-snoozed"),
          title: "Pinned and snoozed",
          pinnedAt: "2026-06-01T12:00:00.000Z",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T11:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
    };

    const whileSnoozed = buildThreadListV2Items({ ...snoozedInput, now: NOW });
    expect(whileSnoozed.items.map((item) => item.thread.id)).toEqual(["active"]);
    expect(whileSnoozed.snoozedCount).toBe(1);

    const afterWake = buildThreadListV2Items({ ...snoozedInput, now: "2026-06-03T10:00:00.000Z" });
    expect(afterWake.items.map((item) => item.thread.id)).toEqual(["pinned-snoozed", "active"]);
    expect(afterWake.items[0]?.pinned).toBe(true);
    expect(afterWake.snoozedCount).toBe(0);
  });

  it("classifies snooze with the second-precise clock and reports the next wake", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("just-woke"),
          title: "Just woke",
          snoozedUntil: "2026-06-02T00:00:30.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("still-snoozed"),
          title: "Still snoozed",
          snoozedUntil: "2026-06-02T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: "2026-06-02T00:01:07.500Z",
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["just-woke"]);
    expect(layout.snoozedCount).toBe(1);
    expect(layout.nextSnoozeWakeAt).toBe("2026-06-02T09:00:00.000Z");
  });

  it("builds snoozed rows between active and done when the shelf is expanded", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("done"),
          title: "Done",
          doneOverride: "done",
          doneAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("later"),
          title: "Wakes later",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("sooner"),
          title: "Wakes sooner",
          snoozedUntil: "2026-06-02T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      snoozedShelfExpanded: true,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual([
      "active",
      "sooner",
      "later",
      "done",
    ]);
    expect(layout.items.map((item) => item.snoozed)).toEqual([false, true, true, false]);
    expect(layout.snoozedShelfHeaderIndex).toBe(1);
    expect(layout.snoozedCount).toBe(2);
  });

  it("collapses to a header-only shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items).toEqual([]);
    expect(layout.snoozedCount).toBe(1);
    expect(layout.snoozedShelfHeaderIndex).toBe(0);
  });

  it("keeps the selected thread on a collapsed shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("open"),
          title: "Open",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("other"),
          title: "Other",
          snoozedUntil: "2026-06-03T10:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      selectedThreadKey: `${environmentId}:open`,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["open"]);
    expect(layout.items[0]?.snoozed).toBe(true);
    expect(layout.snoozedCount).toBe(2);
  });

  it("classifies snoozed threads without environment configuration", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items).toEqual([]);
    expect(layout.snoozedCount).toBe(1);
  });

  it("partitions done threads into a slim shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("done"),
          title: "Done",
          doneOverride: "done",
          doneAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("done-2"),
          title: "Done 2",
          doneOverride: "done",
          doneAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => [item.thread.id, item.variant])).toEqual([
      ["active", "card"],
      ["done", "slim"],
      ["done-2", "slim"],
    ]);
    expect(layout.items.map((item) => item.isLast)).toEqual([false, false, true]);
    expect(layout.doneCount).toBe(2);
    expect(layout.doneShelfHeaderIndex).toBe(1);
  });

  it("collapses done threads to a counted shelf header", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("done"),
          title: "Done",
          doneOverride: "done",
          doneAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      doneShelfExpanded: false,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["active"]);
    expect(layout.doneCount).toBe(1);
    expect(layout.doneShelfHeaderIndex).toBe(1);
  });

  it("keeps the selected done thread visible when its shelf is collapsed", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("selected"),
          title: "Selected",
          doneOverride: "done",
          doneAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("other"),
          title: "Other",
          doneOverride: "done",
          doneAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      doneShelfExpanded: false,
      selectedThreadKey: `${environmentId}:selected`,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["selected"]);
    expect(layout.doneCount).toBe(2);
    expect(layout.doneShelfHeaderIndex).toBe(0);
  });

  it("keeps cards in creation order while done sorts by recency", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("older-created"),
          title: "Older",
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("newer-created"),
          title: "Newer",
          createdAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["newer-created", "older-created"]);
  });

  it("sorts done threads by their persisted settlement timestamp", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("done-newer"),
          title: "Done newer",
          doneOverride: "done",
          doneAt: "2026-06-01T12:00:00.000Z",
          latestUserMessageAt: "2026-06-01T08:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("done-older"),
          title: "Done older",
          doneOverride: "done",
          doneAt: "2026-06-01T10:00:00.000Z",
          latestUserMessageAt: "2026-06-01T09:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["done-newer", "done-older"]);
  });

  it("keeps done threads in the tail and filters by search query", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("match"), title: "Fix login bug" }),
        makeThread({ id: ThreadId.make("miss"), title: "Greeting" }),
        makeThread({
          id: ThreadId.make("done"),
          title: "Fix login again",
          doneOverride: "done",
          doneAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "login",
      now: NOW,
    });

    expect(items.map((item) => [item.thread.id, item.variant])).toEqual([
      ["match", "card"],
      ["done", "slim"],
    ]);
  });

  it("includes a thread matched by message content", () => {
    const thread = makeThread({
      id: ThreadId.make("content-match"),
      title: "Unrelated title",
    });
    const { items } = buildThreadListV2Items({
      threads: [thread],
      environmentId: null,
      searchQuery: "relay reconnect",
      matchedThreadKeys: new Set([
        threadSearchMatchKey({
          environmentId,
          threadId: thread.id,
        }),
      ]),
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["content-match"]);
  });

  it("scopes the flat list to one project", () => {
    const projectId = ProjectId.make("project-1");
    const otherProjectId = ProjectId.make("project-2");
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("included"), projectId, title: "Included" }),
        makeThread({
          id: ThreadId.make("excluded"),
          projectId: otherProjectId,
          title: "Excluded",
        }),
      ],
      environmentId: null,
      projectRefs: [{ environmentId, projectId }],
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["included"]);
  });

  it("forgives a typo even when a hidden thread matches the query exactly", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("visible"), title: "Restore drag handles" }),
        makeThread({ id: ThreadId.make("archived"), title: "Drga notes", archivedAt: NOW }),
      ],
      environmentId: null,
      searchQuery: "drga",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["visible"]);
  });

  it("scopes the flat list to every environment member of a logical project", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const projectId = ProjectId.make("project-1");
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("local"), projectId, title: "Local" }),
        makeThread({
          environmentId: remoteEnvironmentId,
          id: ThreadId.make("remote"),
          projectId,
          title: "Remote",
        }),
      ],
      environmentId: null,
      projectRefs: [
        { environmentId, projectId },
        { environmentId: remoteEnvironmentId, projectId },
      ],
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["local", "remote"]);
  });
});

describe("buildThreadListV2Items done paging", () => {
  it("caps the done tail at doneLimit and reports the hidden count", () => {
    const threads = [
      makeThread({ id: ThreadId.make("active"), title: "Active" }),
      ...Array.from({ length: 4 }, (_, index) =>
        makeThread({
          id: ThreadId.make(`done-${index}`),
          title: `Done ${index}`,
          doneOverride: "done",
          doneAt: `2026-06-01T0${index}:10:00.000Z`,
          latestUserMessageAt: `2026-06-01T0${index}:00:00.000Z`,
          latestRun: {
            runId: RunId.make(`run-${index}`),
            status: "completed",
            requestedAt: `2026-06-01T0${index}:00:00.000Z`,
            startedAt: `2026-06-01T0${index}:00:00.000Z`,
            completedAt: `2026-06-01T0${index}:10:00.000Z`,
            assistantMessageId: null,
          },
        }),
      ),
    ];

    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      doneLimit: 2,
      now: NOW,
    });

    expect(layout.hiddenDoneCount).toBe(2);
    expect(layout.items.filter((item) => item.variant === "slim")).toHaveLength(2);
    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "done-3", "done-2"]);
  });

  it("keeps the selected done thread visible past doneLimit", () => {
    const threads = Array.from({ length: 4 }, (_, index) =>
      makeThread({
        id: ThreadId.make(`done-${index}`),
        title: `Done ${index}`,
        doneOverride: "done",
        doneAt: `2026-06-01T0${index}:10:00.000Z`,
      }),
    );

    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      doneLimit: 2,
      now: NOW,
      selectedThreadKey: `${environmentId}:done-0`,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["done-3", "done-2", "done-0"]);
    expect(layout.hiddenDoneCount).toBe(1);
  });

  it("lists only loaded done rows and counts the threads the shell left out", () => {
    const settled = (index: number) =>
      makeThread({
        id: ThreadId.make(`settled-${index}`),
        title: `Settled ${index}`,
        doneOverride: "done",
        doneAt: `2026-06-0${index}T00:00:00.000Z`,
      });
    const threads = [settled(1), settled(2), settled(3)];
    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      doneLimit: 10,
      now: NOW,
      // settled-1 came back mid-session, below the loaded range; the route keeps it visible.
      isListedDone: (thread) => thread.id !== "settled-1",
      unloadedDoneCount: 40,
      selectedThreadKey: `${threads[0]!.environmentId}:settled-1`,
    });
    expect(layout.items.map((item) => item.thread.id)).toEqual([
      "settled-3",
      "settled-2",
      "settled-1",
    ]);
    expect(layout.doneCount).toBe(43);
    expect(layout.hiddenDoneCount).toBe(40);

    // A scope whose done threads are all older still shows its Done header.
    const unloadedOnly = buildThreadListV2Items({
      threads: [],
      environmentId: null,
      searchQuery: "",
      doneLimit: 10,
      now: NOW,
      unloadedDoneCount: 5,
    });
    expect(unloadedOnly.doneCount).toBe(5);
    expect(unloadedOnly.doneShelfHeaderIndex).toBe(0);
  });
});

describe("buildThreadListV2Items done sort reuse", () => {
  const otherEnvironmentId = EnvironmentId.make("environment-2");

  function makeDone(
    id: string,
    doneAt: string,
    overrides: Partial<EnvironmentThreadShell> = {},
  ): EnvironmentThreadShell {
    return makeThread({
      id: ThreadId.make(id),
      title: id,
      doneOverride: "done",
      doneAt,
      ...overrides,
    });
  }

  function doneOrder(
    threads: ReadonlyArray<EnvironmentThreadShell>,
    scope: EnvironmentId | null = null,
  ) {
    return buildThreadListV2Items({
      threads,
      environmentId: scope,
      searchQuery: "",
      now: NOW,
    })
      .items.filter((item) => item.variant === "slim")
      .map((item) => `${item.thread.environmentId}:${item.thread.id}`);
  }

  const older = makeDone("older", "2026-06-01T01:00:00.000Z");
  const newer = makeDone("newer", "2026-06-01T03:00:00.000Z");
  const middle = makeDone("middle", "2026-06-01T02:00:00.000Z");

  it("re-sorts when a done row is replaced, added, or removed", () => {
    expect(doneOrder([older, newer])).toEqual([`${environmentId}:newer`, `${environmentId}:older`]);
    const markedDoneAgainOlder = makeDone("older", "2026-06-01T04:00:00.000Z");
    expect(doneOrder([markedDoneAgainOlder, newer])).toEqual([
      `${environmentId}:older`,
      `${environmentId}:newer`,
    ]);
    expect(doneOrder([markedDoneAgainOlder, newer, middle])).toEqual([
      `${environmentId}:older`,
      `${environmentId}:newer`,
      `${environmentId}:middle`,
    ]);
    expect(doneOrder([newer, middle])).toEqual([
      `${environmentId}:newer`,
      `${environmentId}:middle`,
    ]);
  });

  it("recomputes when builds alternate between environments", () => {
    const remoteOlder = makeDone("remote-older", "2026-06-01T01:30:00.000Z", {
      environmentId: otherEnvironmentId,
    });
    const remoteNewer = makeDone("remote-newer", "2026-06-01T05:00:00.000Z", {
      environmentId: otherEnvironmentId,
    });
    const threads = [older, newer, remoteOlder, remoteNewer];

    for (let round = 0; round < 2; round += 1) {
      expect(doneOrder(threads, environmentId)).toEqual([
        `${environmentId}:newer`,
        `${environmentId}:older`,
      ]);
      expect(doneOrder(threads, otherEnvironmentId)).toEqual([
        `${otherEnvironmentId}:remote-newer`,
        `${otherEnvironmentId}:remote-older`,
      ]);
    }
  });
});

function makePendingTask(id: string): PendingNewTask {
  const creation = {
    projectId: ProjectId.make("project-1"),
    workspaceMode: "worktree" as const,
    branch: null,
    worktreePath: null,
  };
  return {
    kind: "pending",
    key: `pending-task:${id}`,
    environmentId,
    projectId: creation.projectId,
    projectTitle: undefined,
    projectCwd: undefined,
    branch: null,
    title: id,
    createdAt: NOW,
    message: {
      environmentId,
      threadId: ThreadId.make(`thread-${id}`),
      messageId: MessageId.make(id),
      commandId: CommandId.make(`command-${id}`),
      text: id,
      attachments: [],
      createdAt: NOW,
      creation,
    },
    creation,
  };
}

function makeDraftTask(id: string): PendingNewTask {
  return {
    kind: "draft",
    key: `draft-task:new-task:${id}`,
    environmentId,
    projectId: ProjectId.make("project-1"),
    projectTitle: undefined,
    projectCwd: undefined,
    branch: null,
    title: id,
    createdAt: NOW,
    draftKey: `new-task:${id}`,
  };
}

describe("buildThreadListV2ListItems", () => {
  it("orders all five sections and keeps paging inside Done", () => {
    const threads = [
      makeThread({ id: ThreadId.make("active"), title: "active" }),
      makeThread({ id: ThreadId.make("pinned"), title: "pinned", pinnedAt: NOW }),
      makeThread({
        id: ThreadId.make("working"),
        title: "working",
        runtime: {
          status: "running",
          activeRunId: null,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerName: "Codex",
          lastError: null,
          lastErrorClass: null,
          updatedAt: NOW,
        },
      }),
      makeThread({
        id: ThreadId.make("snoozed"),
        title: "snoozed",
        snoozedAt: NOW,
        snoozedUntil: "2026-06-03T09:00:00.000Z",
      }),
      ...["done-one", "done-two"].map((id) =>
        makeThread({
          id: ThreadId.make(id),
          title: id,
          doneOverride: "done",
          doneAt: NOW,
        }),
      ),
    ];
    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      now: NOW,
      workingShelfExpanded: true,
      snoozedShelfExpanded: true,
      doneLimit: 1,
    });
    const input = {
      ...layout,
      pendingTasks: [],
      workingShelfExpanded: true,
      snoozedShelfExpanded: true,
    };
    const items = buildThreadListV2ListItems(input);
    expect(items.map((item) => item.type)).toEqual([
      "v2-pinned-shelf",
      "v2-thread",
      "v2-active-header",
      "v2-thread",
      "v2-working-shelf",
      "v2-thread",
      "v2-snoozed-shelf",
      "v2-thread",
      "v2-done-shelf",
      "v2-thread",
      "v2-show-more",
    ]);
    expect(items.at(-1)).toEqual({ type: "v2-show-more", key: "v2-show-more", hiddenCount: 1 });
    expect(
      buildThreadListV2ListItems({ ...input, doneShelfExpanded: false }).some(
        (item) => item.type === "v2-show-more",
      ),
    ).toBe(false);
  });

  const layout = buildThreadListV2Items({
    threads: [
      makeThread({ id: ThreadId.make("active"), title: "active" }),
      makeThread({
        id: ThreadId.make("done"),
        title: "done",
        doneOverride: "done",
        doneAt: NOW,
      }),
    ],
    environmentId: null,
    searchQuery: "",
    now: NOW,
  });

  it("leads the list with unsent drafts and queued tasks, preserving section dividers", () => {
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [
        {
          kind: "draft",
          key: "draft-task:new-task:unsent",
          environmentId,
          projectId: ProjectId.make("project-1"),
          projectTitle: undefined,
          projectCwd: undefined,
          branch: null,
          title: "unsent",
          createdAt: NOW,
          draftKey: "new-task:unsent",
        },
        makePendingTask("queued-1"),
        makePendingTask("queued-2"),
      ],
      doneCount: layout.doneCount,
      doneShelfHeaderIndex: layout.doneShelfHeaderIndex,
    });

    expect(
      items.map((item) =>
        item.type === "v2-pending"
          ? item.pendingTask.title
          : item.type === "v2-thread"
            ? item.item.thread.id
            : item.type,
      ),
    ).toEqual([
      "unsent",
      "v2-active-header",
      "queued-1",
      "queued-2",
      "active",
      "v2-done-shelf",
      "done",
    ]);
    expect(
      items.flatMap((item) => (item.type === "v2-pending" ? [item.showPendingDivider] : [])),
    ).toEqual([true, true, false]);
    expect(
      items.map((item) =>
        item.type === "v2-thread" || item.type === "v2-pending" ? item.showTrailingDivider : null,
      ),
    ).toEqual([false, null, true, true, false, null, false]);
  });

  it("puts queued tasks above active rows when nothing has done yet", () => {
    const activeOnly = buildThreadListV2Items({
      threads: [makeThread({ id: ThreadId.make("active"), title: "active" })],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });
    const items = buildThreadListV2ListItems({
      items: activeOnly.items,
      pendingTasks: [makePendingTask("queued-1")],
    });

    expect(items.map((item) => item.type)).toEqual(["v2-active-header", "v2-pending", "v2-thread"]);
  });

  it("puts Drafts between Pinned and Active while queued tasks stay in Active", () => {
    const pinnedLayout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("pinned"), title: "pinned", pinnedAt: NOW }),
        makeThread({ id: ThreadId.make("active"), title: "active" }),
        makeThread({
          id: ThreadId.make("done"),
          title: "done",
          doneOverride: "done",
          doneAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });
    const items = buildThreadListV2ListItems({
      ...pinnedLayout,
      pendingTasks: [
        makeDraftTask("draft-1"),
        makeDraftTask("draft-2"),
        makePendingTask("queued-1"),
        makePendingTask("queued-2"),
      ],
    });

    expect(
      items.map((item) =>
        item.type === "v2-thread"
          ? item.item.thread.id
          : item.type === "v2-pending"
            ? item.pendingTask.title
            : item.type,
      ),
    ).toEqual([
      "v2-pinned-shelf",
      "pinned",
      "draft-1",
      "draft-2",
      "v2-active-header",
      "queued-1",
      "queued-2",
      "active",
      "v2-done-shelf",
      "done",
    ]);
    expect(
      items
        .filter((item) => item.type === "v2-pending")
        .map((item) => [item.pendingTask.kind, item.showPendingDivider, item.showTrailingDivider]),
    ).toEqual([
      ["draft", true, true],
      ["draft", false, false],
      ["pending", true, true],
      ["pending", false, true],
    ]);
  });

  it("puts Drafts above Active when nothing is pinned", () => {
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makeDraftTask("draft"), makePendingTask("queued")],
      doneCount: layout.doneCount,
      doneShelfHeaderIndex: layout.doneShelfHeaderIndex,
    });

    expect(
      items.map((item) =>
        item.type === "v2-thread"
          ? item.item.thread.id
          : item.type === "v2-pending"
            ? item.pendingTask.title
            : item.type,
      ),
    ).toEqual(["draft", "v2-active-header", "queued", "active", "v2-done-shelf", "done"]);
  });

  it("places Done below Active when nothing is queued", () => {
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [],
      doneCount: layout.doneCount,
      doneShelfHeaderIndex: layout.doneShelfHeaderIndex,
    });

    expect(items.map((item) => item.key)).toEqual([
      "v2-active-header",
      `v2-thread:${environmentId}:active`,
      "v2-done-shelf",
      `v2-thread:${environmentId}:done`,
    ]);
  });

  it("places queued tasks above active rows and a collapsed snoozed shelf", () => {
    const snoozedLayout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "active" }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("done"),
          title: "done",
          doneOverride: "done",
          doneAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });
    const items = buildThreadListV2ListItems({
      items: snoozedLayout.items,
      pendingTasks: [makePendingTask("queued")],
      snoozedCount: snoozedLayout.snoozedCount,
      snoozedShelfExpanded: false,
      snoozedShelfHeaderIndex: snoozedLayout.snoozedShelfHeaderIndex,
      doneCount: snoozedLayout.doneCount,
      doneShelfHeaderIndex: snoozedLayout.doneShelfHeaderIndex,
    });

    expect(items.map((item) => item.type)).toEqual([
      "v2-active-header",
      "v2-pending",
      "v2-thread",
      "v2-snoozed-shelf",
      "v2-done-shelf",
      "v2-thread",
    ]);
    expect(threadJumpTarget(items, "thread.jump.1")?.id).toBe("active");
    expect(threadJumpTarget(items, "thread.jump.2")?.id).toBe("done");
    expect(threadJumpTarget(items, "thread.jump.3")).toBeNull();
  });
});

describe("buildThreadListV2ListItems empty Active block", () => {
  const working = makeThread({
    id: ThreadId.make("working"),
    title: "working",
    runtime: {
      status: "running",
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: null,
      updatedAt: NOW,
    },
  });
  const snoozed = makeThread({
    id: ThreadId.make("snoozed"),
    title: "snoozed",
    snoozedUntil: "2026-06-03T09:00:00.000Z",
    snoozedAt: "2026-06-01T12:00:00.000Z",
  });
  const done = makeThread({
    id: ThreadId.make("done"),
    title: "done",
    doneOverride: "done",
    doneAt: NOW,
  });
  const pinned = makeThread({ id: ThreadId.make("pinned"), title: "pinned", pinnedAt: NOW });
  const listTypes = (
    threads: ReadonlyArray<EnvironmentThreadShell>,
    input: {
      readonly pendingTasks?: ReadonlyArray<PendingNewTask>;
      readonly pinnedShelfExpanded?: boolean;
    } = {},
  ) => {
    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      now: NOW,
      pinnedShelfExpanded: input.pinnedShelfExpanded,
      doneShelfExpanded: false,
    });
    return buildThreadListV2ListItems({
      ...layout,
      pendingTasks: input.pendingTasks ?? [],
      pinnedShelfExpanded: input.pinnedShelfExpanded,
      doneShelfExpanded: false,
    }).map((item) => item.type);
  };

  it("renders only the shelves when no threads need attention", () => {
    expect(listTypes([working, snoozed, done])).toEqual([
      "v2-working-shelf",
      "v2-snoozed-shelf",
      "v2-done-shelf",
    ]);
    expect(listTypes([snoozed])).toEqual(["v2-snoozed-shelf"]);
  });

  it("keeps active rows, pins, queued tasks, and drafts alongside the shelves", () => {
    const active = makeThread({ id: ThreadId.make("active"), title: "active" });

    expect(listTypes([active, done])).toEqual(["v2-active-header", "v2-thread", "v2-done-shelf"]);
    expect(listTypes([pinned, done])).toEqual(["v2-pinned-shelf", "v2-thread", "v2-done-shelf"]);
    expect(listTypes([pinned, done], { pinnedShelfExpanded: false })).toEqual([
      "v2-pinned-shelf",
      "v2-done-shelf",
    ]);
    expect(listTypes([done], { pendingTasks: [makePendingTask("queued")] })).toEqual([
      "v2-active-header",
      "v2-pending",
      "v2-done-shelf",
    ]);
    expect(listTypes([done], { pendingTasks: [makeDraftTask("draft")] })).toEqual([
      "v2-pending",
      "v2-done-shelf",
    ]);
  });

  it("leaves an empty list to the list's own empty state", () => {
    expect(listTypes([])).toEqual([]);
  });
});

describe("pending mobile thread moves", () => {
  function fixture(section: "active" | "pinned" = "active") {
    const rows = ["a", "b", "c"].map((id, index) =>
      makeThread({
        id: ThreadId.make(id),
        title: id === "a" ? "hidden" : "match",
        createdAt: `2026-06-01T0${3 - index}:00:00.000Z`,
        pinnedAt: section === "pinned" ? `2026-06-01T0${3 - index}:00:00.000Z` : null,
      }),
    );
    const ordered = getThreadListV2OrderedSection({ threads: rows, section, now: NOW });
    const orderedIds = ordered.map((row) => `${row.environmentId}:${row.id}`);
    const movedId = orderedIds[2]!;
    const assignments = planPinnedMove({
      orderedIds,
      keysById: new Map(orderedIds.map((id) => [id, null])),
      movedId,
      direction: "up",
    })!;
    const pending = createPendingThreadOrder({
      section,
      ordered,
      movedId,
      direction: "up",
      assignments,
    });
    const update = (current: EnvironmentThreadShell[], assignment: (typeof assignments)[number]) =>
      current.map((row) =>
        `${row.environmentId}:${row.id}` === assignment.id
          ? {
              ...row,
              [section === "pinned" ? "pinOrderKey" : "activeOrderKey"]: assignment.orderKey,
            }
          : row,
      );
    return { rows, assignments, pending, update };
  }

  function layout(rows: EnvironmentThreadShell[], pendingOrder: PendingThreadOrder | null) {
    return buildThreadListV2Items({
      threads: rows,
      pendingOrder,
      environmentId: null,
      searchQuery: "",
      now: NOW,
    }).items.map((item) => item.thread.id);
  }

  // The inbox is time-ordered, so only pinned holds reach the built layout.
  it("holds pinned order through every intermediate key upsert", () => {
    const { rows, assignments, pending, update } = fixture("pinned");
    let current = rows;
    let hold: PendingThreadOrder | null = pending;
    const desired = pending.orderedIds.map((id) => id.split(":")[1]);
    expect(layout(current, hold)).toEqual(desired);
    for (const assignment of assignments) {
      current = update(current, assignment);
      hold = reconcilePendingThreadOrder(
        hold!,
        getThreadListV2OrderedSection({ threads: current, section: "pinned", now: NOW }),
      );
      expect(hold).not.toBeNull();
      expect(layout(current, hold)).toEqual(desired);
    }
    expect(reconcilePendingThreadOrder({ ...hold!, commandsComplete: true }, current)).toBeNull();
    expect(layout(current, null)).toEqual(desired);
  });

  it("keeps the action guard pending when receipts precede canonical shells", () => {
    const { rows, assignments, pending, update } = fixture("pinned");
    let hold: PendingThreadOrder | null = { ...pending, commandsComplete: true };
    let current = rows;
    expect(reconcilePendingThreadOrder(hold, current)).toBe(hold);
    for (const [index, assignment] of assignments.entries()) {
      current = update(current, assignment);
      hold = reconcilePendingThreadOrder(hold!, current);
      expect(hold === null).toBe(index === assignments.length - 1);
      expect(layout(current, hold)).toEqual(pending.orderedIds.map((id) => id.split(":")[1]));
    }
  });

  it("releases for real section membership and foreign key changes", () => {
    const { rows, pending } = fixture();
    expect(reconcilePendingThreadOrder(pending, rows.slice(1))).toBeNull();
    const newRow = makeThread({ id: ThreadId.make("new"), title: "new" });
    expect(reconcilePendingThreadOrder(pending, [...rows, newRow])).toBeNull();
    expect(
      reconcilePendingThreadOrder(
        pending,
        rows.map((row, index) => (index === 0 ? { ...row, activeOrderKey: "zz" } : row)),
      ),
    ).toBeNull();
    const done = rows.map((row, index) =>
      index === 0 ? { ...row, doneOverride: "done" as const } : row,
    );
    expect(layout(done, pending)).toEqual(layout(done, null));
  });

  it("does not hide a concurrent return to a previously confirmed key", () => {
    const { rows, assignments, pending, update } = fixture();
    const confirmed = reconcilePendingThreadOrder(pending, update(rows, assignments[0]!))!;
    expect(reconcilePendingThreadOrder(confirmed, rows)).toBeNull();
  });

  it("preserves the hold for activity but releases for a reopened sort anchor", () => {
    const { rows, pending } = fixture();
    expect(
      reconcilePendingThreadOrder(
        pending,
        rows.map((row) => ({ ...row, updatedAt: NOW })),
      ),
    ).toBe(pending);
    expect(
      reconcilePendingThreadOrder(
        pending,
        rows.map((row, index) => (index === 0 ? { ...row, reopenedAt: NOW } : row)),
      ),
    ).toBeNull();
  });
});

describe("mobile move availability", () => {
  const oldEnvironment = EnvironmentId.make("older-server");
  function rows(section: "active" | "pinned", keys: readonly (string | null)[]) {
    return keys.map((key, index) =>
      makeThread({
        id: ThreadId.make(`move-${index}`),
        title: `Move ${index}`,
        environmentId: index === 1 ? oldEnvironment : environmentId,
        activeOrderKey: section === "active" ? key : null,
        pinOrderKey: section === "pinned" ? key : null,
        pinnedAt: section === "pinned" ? NOW : null,
      }),
    );
  }

  it.each(["active", "pinned"] as const)(
    "keeps unsupported keyed %s neighbors as usable anchors",
    (section) => {
      const ordered = rows(section, ["bb", "dd", "ff"]);
      const plan = createThreadMovePlanner({
        ordered,
        section,
        reorderableEnvironmentIds: new Set([environmentId]),
      });
      const assignments = plan(`${environmentId}:move-0`, "down");
      expect(assignments).toHaveLength(1);
      expect(assignments![0]!.id).toBe(`${environmentId}:move-0`);
      expect(assignments![0]!.orderKey > "dd").toBe(true);
      expect(assignments![0]!.orderKey < "ff").toBe(true);
      expect(plan(`${oldEnvironment}:move-1`, "up")).toBeNull();
      expect(plan(`${environmentId}:move-0`, "up")).toBeNull();
    },
  );

  it.each(["active", "pinned"] as const)(
    "disables %s moves requiring unsupported keyless materialization",
    (section) => {
      const ordered = rows(section, [null, null, null]);
      const plan = createThreadMovePlanner({
        ordered,
        section,
        reorderableEnvironmentIds: new Set([environmentId]),
      });
      expect(plan(`${environmentId}:move-0`, "down")).toBeNull();
      expect(plan(`${environmentId}:move-2`, "up")).toBeNull();
      const supported = createThreadMovePlanner({
        ordered,
        section,
        reorderableEnvironmentIds: new Set([environmentId, oldEnvironment]),
      });
      expect(supported(`${environmentId}:move-0`, "down")).toHaveLength(3);
    },
  );

  it.each(["active", "pinned"] as const)(
    "reserves snoozed %s keys when moving visible rows",
    (section) => {
      const ordered = rows(section, ["bb", "dd", "ff"]);
      const input = { ordered, section, reorderableEnvironmentIds: new Set([environmentId]) };
      const collision = createThreadMovePlanner(input)(`${environmentId}:move-0`, "down")![0]!
        .orderKey;
      const hidden = {
        ...ordered[0]!,
        id: ThreadId.make("snoozed"),
        snoozedAt: NOW,
        snoozedUntil: "2099-01-01T00:00:00.000Z",
        pinOrderKey: section === "pinned" ? collision : null,
        activeOrderKey: section === "active" ? collision : null,
      };
      const assignments = createThreadMovePlanner({ ...input, allThreads: [...ordered, hidden] })(
        `${environmentId}:move-0`,
        "down",
      );
      expect(assignments).toHaveLength(1);
      expect(assignments![0]!.orderKey).not.toBe(collision);
      expect(assignments![0]!.orderKey > "dd" && assignments![0]!.orderKey < "ff").toBe(true);
    },
  );
});

describe("thread drag destinations", () => {
  it("moves across multiple rows while keeping hidden anchors in place", () => {
    expect(
      threadOrderAfterMove(["a", "hidden", "b", "c"], "c", {
        targetId: "a",
        placement: "before",
      }),
    ).toEqual(["c", "a", "hidden", "b"]);
    expect(
      threadOrderAfterMove(["a", "hidden", "b", "c"], "a", {
        targetId: "b",
        placement: "after",
      }),
    ).toEqual(["hidden", "b", "a", "c"]);
  });

  it.each(["active", "pinned"] as const)(
    "persists a dropped %s row and holds its order until confirmed",
    (section) => {
      const ordered = ["a", "b", "c", "d"].map((id) =>
        makeThread({
          id: ThreadId.make(id),
          title: id,
          pinnedAt: section === "pinned" ? NOW : null,
        }),
      );
      const ids = ordered.map((row) => `${row.environmentId}:${row.id}`);
      const direction = { targetId: ids[0]!, placement: "before" as const };
      const assignments = createThreadMovePlanner({
        ordered,
        section,
        reorderableEnvironmentIds: new Set([environmentId]),
      })(ids[3]!, direction)!;
      const pending = createPendingThreadOrder({
        section,
        ordered,
        movedId: ids[3]!,
        direction,
        assignments,
      });
      expect(pending.orderedIds).toEqual([ids[3], ids[0], ids[1], ids[2]]);
      const confirmed = ordered.map((row) => ({
        ...row,
        [section === "pinned" ? "pinOrderKey" : "activeOrderKey"]: assignments.find(
          (a) => a.id === `${row.environmentId}:${row.id}`,
        )!.orderKey,
      }));
      expect(
        getThreadListV2OrderedSection({ threads: confirmed, section, now: NOW }).map(
          (row) => `${row.environmentId}:${row.id}`,
        ),
      ).toEqual(pending.orderedIds);
      expect(
        reconcilePendingThreadOrder({ ...pending, commandsComplete: true }, confirmed),
      ).toBeNull();
    },
  );

  it("refuses a drop that would need to rewrite an old server's keyless row", () => {
    const old = EnvironmentId.make("old-server");
    const ordered = [environmentId, old, environmentId].map((env, index) =>
      makeThread({
        id: ThreadId.make(String(index)),
        title: String(index),
        environmentId: env,
      }),
    );
    expect(
      createThreadMovePlanner({
        ordered,
        section: "active",
        reorderableEnvironmentIds: new Set([environmentId]),
      })(`${environmentId}:2`, { targetId: `${environmentId}:0`, placement: "before" }),
    ).toBeNull();
  });
});

it("allows a long drop past an old server even when both adjacent moves fail", () => {
  const old = EnvironmentId.make("old-server");
  const ordered = [
    makeThread({ id: ThreadId.make("a"), title: "a" }),
    makeThread({ id: ThreadId.make("b"), title: "b", environmentId: old }),
    makeThread({ id: ThreadId.make("c"), title: "c", activeOrderKey: "h" }),
    makeThread({ id: ThreadId.make("d"), title: "d", activeOrderKey: "p" }),
  ];
  const planner = createThreadMovePlanner({
    ordered,
    section: "active",
    reorderableEnvironmentIds: new Set([environmentId]),
  });
  const movedId = `${environmentId}:a`;
  expect(planner(movedId, "up")).toBeNull();
  expect(planner(movedId, "down")).toBeNull();
  const assignments = planner(movedId, { targetId: `${environmentId}:d`, placement: "after" });
  expect(assignments).toHaveLength(1);
  expect(assignments![0]!.id).toBe(movedId);
  expect(assignments![0]!.orderKey > "p").toBe(true);
});

describe("cross-section thread drops", () => {
  it.each(["pinned", "active"] as const)("inserts into an empty %s section", (section) => {
    const thread = makeThread({ id: ThreadId.make("source"), title: "source" });
    const id = `${thread.environmentId}:${thread.id}`;
    const destination = { section, targetId: null, placement: "before" as const };
    expect(threadOrderAfterMove([], id, destination)).toEqual([id]);
    const plan = createThreadMovePlanner({
      ordered: [],
      allThreads: [thread],
      section,
      reorderableEnvironmentIds: new Set([environmentId]),
    })(id, destination);
    expect(plan).toHaveLength(1);
    expect(plan![0]!.id).toBe(id);
  });
  it("places an incoming row between existing anchors without rewriting them", () => {
    const a = makeThread({ id: ThreadId.make("a"), title: "a", pinOrderKey: "h" });
    const b = makeThread({ id: ThreadId.make("b"), title: "b", pinOrderKey: "z" });
    const source = makeThread({ id: ThreadId.make("source"), title: "source" });
    const id = `${environmentId}:source`;
    const destination = {
      section: "pinned" as const,
      targetId: `${environmentId}:b`,
      placement: "before" as const,
    };
    const plan = createThreadMovePlanner({
      ordered: [a, b],
      allThreads: [a, b, source],
      section: "pinned",
      reorderableEnvironmentIds: new Set([environmentId]),
    })(id, destination);
    expect(plan).toHaveLength(1);
    expect(plan![0]!.orderKey > "h" && plan![0]!.orderKey < "z").toBe(true);
    expect(
      threadOrderAfterMove([`${environmentId}:a`, `${environmentId}:b`], id, destination),
    ).toEqual([`${environmentId}:a`, id, `${environmentId}:b`]);
  });
  it("rejects removed targets and unsupported incoming sources", () => {
    expect(
      threadOrderAfterMove(["a"], "source", {
        section: "active",
        targetId: "gone",
        placement: "before",
      }),
    ).toBeNull();
    const source = makeThread({ id: ThreadId.make("source"), title: "source" });
    expect(
      createThreadMovePlanner({
        ordered: [],
        allThreads: [source],
        section: "active",
        reorderableEnvironmentIds: new Set(),
      })(`${environmentId}:source`, { section: "active", targetId: null, placement: "before" }),
    ).toBeNull();
  });
  it("clears pinning, settlement and snooze when returning a parked thread to Active", () => {
    const thread = makeThread({
      id: ThreadId.make("parked"),
      title: "parked",
      pinnedAt: NOW,
      doneOverride: "done",
      snoozedAt: NOW,
      snoozedUntil: "2099-01-01T00:00:00.000Z",
    });
    expect(threadDropLifecycle(thread, "active", NOW)).toEqual({
      pin: false,
      unpin: true,
      reopen: true,
      unsnooze: true,
    });
    expect(threadDropLifecycle(thread, "pinned", NOW)).toEqual({
      pin: true,
      unpin: false,
      reopen: false,
      unsnooze: false,
    });
  });
});

it("excludes subagents from navigation, search and ordering while retaining user forks", () => {
  const root = makeThread({ id: ThreadId.make("root"), title: "Root" });
  const child = makeThread({
    id: ThreadId.make("child"),
    title: "Child",
    lineage: { parentThreadId: root.id, rootThreadId: root.id, relationshipToParent: "subagent" },
  });
  const fork = makeThread({
    id: ThreadId.make("fork"),
    title: "Fork",
    lineage: { parentThreadId: root.id, rootThreadId: root.id, relationshipToParent: "fork" },
  });
  const threads = [root, child, fork];
  expect(
    buildThreadListV2Items({ threads, environmentId: null, searchQuery: "", now: NOW }).items.map(
      (item) => item.thread.id,
    ),
  ).toEqual([fork.id, root.id]);
  expect(
    buildThreadListV2Items({ threads, environmentId: null, searchQuery: "Child", now: NOW }).items,
  ).toEqual([]);
  expect(
    getThreadListV2OrderedSection({ threads, section: "active", now: NOW }).map(
      (thread) => thread.id,
    ),
  ).toEqual([fork.id, root.id]);
});

const BASE_MS = Date.parse(NOW);
const isoAt = (ms: number) => new Date(ms).toISOString();
const MINUTE_MS = 60_000;

function runningRuntime() {
  return {
    status: "running" as const,
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: "full-access" as const,
    activeRunId: null,
    lastError: null,
    updatedAt: NOW,
  };
}

function buildTickThreads() {
  return {
    ready: makeThread({
      id: ThreadId.make("tick-ready"),
      title: "tick ready",
      latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
    }),
    approval: makeThread({
      id: ThreadId.make("tick-approval"),
      title: "tick approval",
      hasPendingApprovals: true,
      latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
    }),
    done: makeThread({
      id: ThreadId.make("tick-done"),
      title: "tick done",
      doneOverride: "done",
      doneAt: isoAt(BASE_MS - 3 * 24 * 60 * MINUTE_MS),
    }),
    snoozed: makeThread({
      id: ThreadId.make("tick-snoozed"),
      title: "tick snoozed",
      snoozedAt: isoAt(BASE_MS - MINUTE_MS),
      snoozedUntil: isoAt(BASE_MS + 2 * 60 * MINUTE_MS),
    }),
  };
}

function buildTickList(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  clockMs: number,
  pendingTasks: ReadonlyArray<PendingNewTask>,
  options?: {
    readonly loadedEnvironmentIds?: ReadonlySet<EnvironmentId>;
    readonly queuedThreadKeys?: ReadonlySet<string>;
    readonly shelfPreferencesLoading?: boolean;
  },
): ThreadListV2ListItem[] {
  const now = isoAt(clockMs);
  const layout = buildThreadListV2Items({
    threads,
    environmentId: null,
    searchQuery: "",
    now,
    workingShelfExpanded: true,
    snoozedShelfExpanded: true,
  });
  return buildThreadListV2ListItems({
    items: layout.items,
    pendingTasks,
    workingCount: layout.workingCount,
    workingShelfExpanded: true,
    workingShelfHeaderIndex: layout.workingShelfHeaderIndex,
    snoozedCount: layout.snoozedCount,
    snoozedShelfExpanded: true,
    snoozedShelfHeaderIndex: layout.snoozedShelfHeaderIndex,
    doneCount: layout.doneCount,
    doneShelfHeaderIndex: layout.doneShelfHeaderIndex,
    snoozeLabelNow: now,
    ...(options?.loadedEnvironmentIds
      ? { loadedEnvironmentIds: options.loadedEnvironmentIds }
      : {}),
    ...(options?.queuedThreadKeys ? { queuedThreadKeys: options.queuedThreadKeys } : {}),
    ...(options?.shelfPreferencesLoading !== undefined
      ? { shelfPreferencesLoading: options.shelfPreferencesLoading }
      : {}),
  });
}

function itemsByThreadKey(items: ReadonlyArray<ThreadListV2ListItem>) {
  const byKey = new Map<string, ThreadListV2ListItem>();
  for (const item of items) byKey.set(item.key, item);
  return byKey;
}

describe("threadListV2ListItemsAreEqual", () => {
  const thread = makeThread({
    id: ThreadId.make("eq"),
    title: "eq",
    latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
  });
  const layout = buildThreadListV2Items({
    threads: [thread],
    environmentId: null,
    searchQuery: "",
    now: NOW,
  });
  const queued = makePendingTask("eq-queued");
  const build = () =>
    buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [queued],
      snoozeLabelNow: NOW,
    });

  it("treats rebuilt wrappers over identical rows as equal", () => {
    const first = build();
    const second = build();
    expect(first.length).toBe(second.length);
    for (let index = 0; index < first.length; index += 1) {
      expect(first[index]).not.toBe(second[index]);
      expect(threadListV2ListItemsAreEqual(first[index]!, second[index]!)).toBe(true);
    }
  });

  it("notices a replaced thread shell", () => {
    const replacement = makeThread({ id: ThreadId.make("eq"), title: "renamed" });
    const rebuilt = buildThreadListV2Items({
      threads: [replacement],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });
    const next = buildThreadListV2ListItems({
      items: rebuilt.items,
      pendingTasks: [],
      snoozeLabelNow: NOW,
    });
    const previousThread = build().find((item) => item.type === "v2-thread")!;
    const nextThread = next.find((item) => item.type === "v2-thread")!;
    expect(threadListV2ListItemsAreEqual(previousThread, nextThread)).toBe(false);
  });

  it("notices a changed wake countdown label", () => {
    const snoozedLayout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("wake"),
          title: "wake",
          snoozedAt: NOW,
          snoozedUntil: isoAt(BASE_MS + 61 * MINUTE_MS),
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      snoozedShelfExpanded: true,
    });
    const earlier = buildThreadListV2ListItems({
      items: snoozedLayout.items,
      pendingTasks: [],
      snoozedShelfExpanded: true,
      snoozeLabelNow: NOW,
    });
    const later = buildThreadListV2ListItems({
      items: snoozedLayout.items,
      pendingTasks: [],
      snoozedShelfExpanded: true,
      snoozeLabelNow: isoAt(BASE_MS + MINUTE_MS),
    });
    const rows = (items: ThreadListV2ListItem[]) => {
      const row = items.find((item) => item.key === `v2-thread:${environmentId}:wake`);
      expect(row?.type).toBe("v2-thread");
      if (row?.type !== "v2-thread") throw new Error("missing snoozed row");
      return row;
    };
    expect(rows(earlier).snoozeWakeLabelText).toBe("2h");
    expect(rows(later).snoozeWakeLabelText).toBe("1h");
    expect(threadListV2ListItemsAreEqual(rows(earlier), rows(later))).toBe(false);
  });

  it.each([
    { type: "v2-done-shelf", key: "v2-done-shelf" },
    { type: "v2-active-header", key: "v2-active-header" },
  ] as const)("notices $type count, expansion, and loading-disabled changes", (identity) => {
    const shelf = {
      ...identity,
      count: 2,
      expanded: true,
      disabled: false,
    } as const;
    expect(threadListV2ListItemsAreEqual(shelf, { ...shelf })).toBe(true);
    expect(threadListV2ListItemsAreEqual(shelf, { ...shelf, count: 3 })).toBe(false);
    expect(threadListV2ListItemsAreEqual(shelf, { ...shelf, expanded: false })).toBe(false);
    expect(threadListV2ListItemsAreEqual(shelf, { ...shelf, disabled: true })).toBe(false);
  });

  it("treats different item kinds as unequal", () => {
    const built = build();
    const threadItem = built.find((item) => item.type === "v2-thread")!;
    const pendingItem = built.find((item) => item.type === "v2-pending")!;
    expect(threadListV2ListItemsAreEqual(threadItem, pendingItem)).toBe(false);
  });

  it("notices a trailing-divider flip caused by a neighbour change", () => {
    const threadA = makeThread({ id: ThreadId.make("flip-a"), title: "flip a" });
    const threadB = makeThread({ id: ThreadId.make("flip-b"), title: "flip b" });
    const bare = buildThreadListV2ListItems({
      items: buildThreadListV2Items({
        threads: [threadA, threadB],
        environmentId: null,
        searchQuery: "",
        now: NOW,
      }).items,
      pendingTasks: [],
      snoozeLabelNow: NOW,
    });
    // The same shells with B done: A now sits above the Done section
    // rule instead of another row, so A's hairline must flip through the
    // recycled equality — its own shell reference never changed.
    const doneB = makeThread({
      id: ThreadId.make("flip-b"),
      title: "flip b",
      doneOverride: "done",
      doneAt: NOW,
    });
    const withDone = buildThreadListV2ListItems({
      items: buildThreadListV2Items({
        threads: [threadA, doneB],
        environmentId: null,
        searchQuery: "",
        now: NOW,
      }).items,
      pendingTasks: [],
      doneCount: 1,
      doneShelfHeaderIndex: 1,
      snoozeLabelNow: NOW,
    });
    const firstA = bare.find(
      (item) => item.type === "v2-thread" && item.item.thread.id === threadA.id,
    )!;
    const secondA = withDone.find(
      (item) => item.type === "v2-thread" && item.item.thread.id === threadA.id,
    )!;
    expect(firstA.type === "v2-thread" && firstA.showTrailingDivider).toBe(true);
    expect(secondA.type === "v2-thread" && secondA.showTrailingDivider).toBe(false);
    expect(threadListV2ListItemsAreEqual(firstA, secondA)).toBe(false);
  });
});

describe("buildThreadListV2ListItems clock scoping", () => {
  const allEnvironments = new Set<EnvironmentId>([environmentId]);
  const tickQueued = () => [makePendingTask("tick-queued")];

  it("carries the snooze menu clock on every row whose swipe menu offers presets", () => {
    const threads = buildTickThreads();
    const items = buildTickList(Object.values(threads), BASE_MS, tickQueued(), {
      loadedEnvironmentIds: allEnvironments,
    });
    const byKey = itemsByThreadKey(items);
    const ready = byKey.get(`v2-thread:${environmentId}:tick-ready`)!;
    const approval = byKey.get(`v2-thread:${environmentId}:tick-approval`)!;
    const done = byKey.get(`v2-thread:${environmentId}:tick-done`)!;
    const snoozed = byKey.get(`v2-thread:${environmentId}:tick-snoozed`)!;
    expect(ready.type === "v2-thread" && ready.snoozePresetMinute).toBe(NOW);
    // The swipe-revealed snooze action exists on slim rows too (the variant
    // only swaps the primary action), so done rows need the fresh clock.
    expect(done.type === "v2-thread" && done.snoozePresetMinute).toBe(NOW);
    expect(approval.type === "v2-thread" && approval.snoozePresetMinute).toBeUndefined();
    expect(snoozed.type === "v2-thread" && snoozed.snoozePresetMinute).toBeUndefined();
  });

  it("keeps the snooze menu clock off rows on environments without loaded configuration", () => {
    const threads = buildTickThreads();
    const items = buildTickList([threads.ready], BASE_MS, [], {
      loadedEnvironmentIds: new Set<EnvironmentId>(),
    });
    const ready = items.find((item) => item.type === "v2-thread")!;
    expect(ready.type === "v2-thread" && ready.snoozePresetMinute).toBeUndefined();
  });

  it("blanks the precomputed time for rows that render a label instead", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(BASE_MS);
      const working = makeThread({
        id: ThreadId.make("tick-working"),
        title: "tick working",
        latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
        runtime: runningRuntime(),
      });
      const threads = buildTickThreads();
      const items = buildTickList(
        [threads.ready, working, threads.done, threads.snoozed],
        BASE_MS,
        tickQueued(),
      );
      const byKey = itemsByThreadKey(items);
      const label = (key: string) => {
        const item = byKey.get(key)!;
        return item.type === "v2-thread" ? item.timeLabel : "<shelf>";
      };
      // Ready cards and done/snoozed slim rows draw a time; the wake
      // countdown outranks the time on snoozed rows; cards with a status
      // label never draw one.
      expect(label(`v2-thread:${environmentId}:tick-ready`)).toBe("5m");
      expect(label(`v2-thread:${environmentId}:tick-working`)).toBe("");
      expect(label(`v2-thread:${environmentId}:tick-done`)).toBe("3d");
      expect(label(`v2-thread:${environmentId}:tick-snoozed`)).toBe("");
      const snoozed = byKey.get(`v2-thread:${environmentId}:tick-snoozed`)!;
      expect(snoozed.type === "v2-thread" && snoozed.snoozeWakeLabelText).toBe("2h");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("thread list v2 minute tick invalidation", () => {
  it("only invalidates rows whose clock-driven content moved", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(BASE_MS);
      const threads = buildTickThreads();
      const shellOrder = [threads.ready, threads.approval, threads.done, threads.snoozed];
      const pendingTasks = [makePendingTask("tick-queued")];
      const atStart = buildTickList(shellOrder, BASE_MS, pendingTasks);
      vi.setSystemTime(BASE_MS + MINUTE_MS);
      const atNextMinute = buildTickList(shellOrder, BASE_MS + MINUTE_MS, pendingTasks);

      expect(atStart.length).toBe(atNextMinute.length);
      const invalidated: string[] = [];
      for (let index = 0; index < atStart.length; index += 1) {
        if (!threadListV2ListItemsAreEqual(atStart[index]!, atNextMinute[index]!)) {
          invalidated.push(atStart[index]!.key);
        }
      }
      // Only the ready and done rows show minute-granular text (time label or snooze presets);
      // every other row survives the tick untouched.
      expect(invalidated).toEqual([
        `v2-thread:${environmentId}:tick-ready`,
        `v2-thread:${environmentId}:tick-done`,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps unread completion labels stable across a minute tick", () => {
    const unread = makeThread({
      id: ThreadId.make("tick-unread"),
      title: "Unread completion",
      lastVisitedAt: isoAt(BASE_MS - 10 * MINUTE_MS),
      latestRun: {
        runId: RunId.make("tick-unread-run"),
        status: "completed",
        requestedAt: isoAt(BASE_MS - 6 * MINUTE_MS),
        startedAt: isoAt(BASE_MS - 6 * MINUTE_MS),
        completedAt: isoAt(BASE_MS - 5 * MINUTE_MS),
        assistantMessageId: null,
      },
    });
    const options = { loadedEnvironmentIds: new Set<EnvironmentId>() };
    const first = buildTickList([unread], BASE_MS, [], options).find(
      (item) => item.type === "v2-thread",
    )!;
    const next = buildTickList([unread], BASE_MS + MINUTE_MS, [], options).find(
      (item) => item.type === "v2-thread",
    )!;
    expect(first.type === "v2-thread" && first.timeLabel).toBe("");
    expect(threadListV2ListItemsAreEqual(first, next)).toBe(true);
  });

  it("keeps hour-granularity rows stable across a minute tick when they carry no snooze menu", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(BASE_MS);
      const staleReady = makeThread({
        id: ThreadId.make("tick-stale"),
        title: "tick stale",
        latestUserMessageAt: isoAt(BASE_MS - 3 * 60 * MINUTE_MS),
      });
      const atStart = buildTickList([staleReady], BASE_MS, [], {
        loadedEnvironmentIds: new Set<EnvironmentId>(),
      });
      vi.setSystemTime(BASE_MS + MINUTE_MS);
      const atNextMinute = buildTickList([staleReady], BASE_MS + MINUTE_MS, [], {
        loadedEnvironmentIds: new Set<EnvironmentId>(),
      });
      expect(threadListV2ListItemsAreEqual(atStart[0]!, atNextMinute[0]!)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-renders the snoozed countdown row when the wake label advances", () => {
    vi.useFakeTimers();
    try {
      const wakeAt = BASE_MS + 120 * MINUTE_MS;
      const snoozed = makeThread({
        id: ThreadId.make("tick-wake"),
        title: "tick wake",
        snoozedAt: isoAt(BASE_MS - MINUTE_MS),
        snoozedUntil: isoAt(wakeAt),
      });
      const wakeKey = `v2-thread:${environmentId}:tick-wake`;
      const wakeRow = (items: ThreadListV2ListItem[]) => itemsByThreadKey(items).get(wakeKey)!;
      vi.setSystemTime(BASE_MS);
      const atStart = buildTickList([snoozed], BASE_MS, []);
      vi.setSystemTime(BASE_MS + MINUTE_MS);
      const stillTwoHours = buildTickList([snoozed], BASE_MS + MINUTE_MS, []);
      expect(threadListV2ListItemsAreEqual(wakeRow(atStart), wakeRow(stillTwoHours))).toBe(true);
      vi.setSystemTime(BASE_MS + 61 * MINUTE_MS);
      const oneHour = buildTickList([snoozed], BASE_MS + 61 * MINUTE_MS, []);
      const oneHourRow = wakeRow(oneHour);
      expect(oneHourRow.type).toBe("v2-thread");
      expect(oneHourRow.type === "v2-thread" && oneHourRow.snoozeWakeLabelText).toBe("59m");
      expect(threadListV2ListItemsAreEqual(wakeRow(stillTwoHours), wakeRow(oneHour))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildThreadListV2ListItems trailing dividers", () => {
  it("follows the final neighbour order, not the pre-splice blocks", () => {
    const activeA = makeThread({ id: ThreadId.make("div-a"), title: "a" });
    const activeB = makeThread({ id: ThreadId.make("div-b"), title: "b" });
    const layout = buildThreadListV2Items({
      threads: [activeA, activeB],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makePendingTask("div-q1"), makePendingTask("div-q2")],
      snoozeLabelNow: NOW,
    });
    const dividers = items.map((item) =>
      item.type === "v2-thread" || item.type === "v2-pending" ? item.showTrailingDivider : "n/a",
    );
    expect(dividers).toEqual(["n/a", true, true, true, false]);
  });
});

describe("buildThreadListV2ListItems row-state stamps", () => {
  const readyThread = makeThread({
    id: ThreadId.make("stamp-ready"),
    title: "stamp ready",
    latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
  });
  const doneThread = makeThread({
    id: ThreadId.make("stamp-done"),
    title: "stamp done",
    doneOverride: "done",
    doneAt: isoAt(BASE_MS - 3 * 24 * 60 * MINUTE_MS),
  });
  const allEnvironments = new Set<EnvironmentId>([environmentId]);

  it("stamps queued outbox messages onto the matching row and notices removal", () => {
    const queued = buildTickList([readyThread, doneThread], BASE_MS, [], {
      queuedThreadKeys: new Set([`${environmentId}:stamp-ready`]),
      loadedEnvironmentIds: allEnvironments,
    });
    const plain = buildTickList([readyThread, doneThread], BASE_MS, [], {
      queuedThreadKeys: new Set<string>(),
      loadedEnvironmentIds: allEnvironments,
    });
    const byKey = (items: ThreadListV2ListItem[]) => itemsByThreadKey(items);
    const readyQueued = byKey(queued).get(`v2-thread:${environmentId}:stamp-ready`)!;
    const readyPlain = byKey(plain).get(`v2-thread:${environmentId}:stamp-ready`)!;
    const doneQueued = byKey(queued).get(`v2-thread:${environmentId}:stamp-done`)!;
    const donePlain = byKey(plain).get(`v2-thread:${environmentId}:stamp-done`)!;
    expect(readyQueued.type === "v2-thread" && readyQueued.hasQueuedMessages).toBe(true);
    expect(readyPlain.type === "v2-thread" && readyPlain.hasQueuedMessages).toBe(false);
    expect(threadListV2ListItemsAreEqual(readyQueued, readyPlain)).toBe(false);
    expect(threadListV2ListItemsAreEqual(doneQueued, donePlain)).toBe(true);
  });

  it("keeps the done slim row's swipe snooze menu fresh across a tick", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(BASE_MS);
      const atStart = buildTickList([doneThread], BASE_MS, [], {
        loadedEnvironmentIds: allEnvironments,
      });
      vi.setSystemTime(BASE_MS + MINUTE_MS);
      const atNextMinute = buildTickList([doneThread], BASE_MS + MINUTE_MS, [], {
        loadedEnvironmentIds: allEnvironments,
      });
      const rowAtStart = atStart.find((item) => item.type === "v2-thread")!;
      const rowAtNext = atNextMinute.find((item) => item.type === "v2-thread")!;
      expect(rowAtStart.type === "v2-thread" && rowAtStart.item.variant).toBe("slim");
      expect(rowAtStart.type === "v2-thread" && rowAtStart.snoozePresetMinute).toBe(isoAt(BASE_MS));
      expect(rowAtNext.type === "v2-thread" && rowAtNext.snoozePresetMinute).toBe(
        isoAt(BASE_MS + MINUTE_MS),
      );
      expect(threadListV2ListItemsAreEqual(rowAtStart, rowAtNext)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stamps the shelf loading-disabled state so recycled headers refresh", () => {
    const loading = buildTickList([doneThread], BASE_MS, [], {
      shelfPreferencesLoading: true,
      loadedEnvironmentIds: allEnvironments,
    });
    const loaded = buildTickList([doneThread], BASE_MS, [], {
      shelfPreferencesLoading: false,
      loadedEnvironmentIds: allEnvironments,
    });
    const shelfLoading = loading.find((item) => item.type === "v2-done-shelf")!;
    const shelfLoaded = loaded.find((item) => item.type === "v2-done-shelf")!;
    expect(shelfLoading.type === "v2-done-shelf" && shelfLoading.disabled).toBe(true);
    expect(shelfLoaded.type === "v2-done-shelf" && shelfLoaded.disabled).toBe(false);
    expect(threadListV2ListItemsAreEqual(shelfLoading, shelfLoaded)).toBe(false);
  });
});

describe("Working section", () => {
  const running = {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: NOW,
  };
  const finishedAt = (id: string, completedAt: string) =>
    makeThread({
      id: ThreadId.make(id),
      title: id,
      createdAt: "2026-06-01T00:00:00.000Z",
      latestRun: {
        runId: RunId.make(`run-${id}`),
        status: "completed",
        requestedAt: "2026-06-01T00:00:00.000Z",
        startedAt: "2026-06-01T00:00:00.000Z",
        completedAt,
        assistantMessageId: null,
      },
    });
  const threads = [
    finishedAt("finished-early", "2026-06-01T01:00:00.000Z"),
    finishedAt("finished-late", "2026-06-01T03:00:00.000Z"),
    makeThread({ id: ThreadId.make("working"), title: "working", runtime: running }),
    makeThread({
      id: ThreadId.make("asks-approval"),
      title: "asks-approval",
      createdAt: "2026-06-01T02:00:00.000Z",
      runtime: running,
      hasPendingApprovals: true,
    }),
    makeThread({
      id: ThreadId.make("pinned-working"),
      title: "pinned-working",
      runtime: running,
      pinnedAt: "2026-06-01T00:00:00.000Z",
    }),
  ];
  const build = (input: Partial<Parameters<typeof buildThreadListV2Items>[0]> = {}) =>
    buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      now: NOW,
      ...input,
    });
  const ids = (layout: ReturnType<typeof buildThreadListV2Items>) =>
    layout.items.map((item) => item.thread.id);

  it("folds unpinned working threads into a collapsed shelf", () => {
    const layout = build();
    expect(ids(layout)).toEqual([
      "pinned-working",
      "finished-late",
      "asks-approval",
      "finished-early",
    ]);
    expect(layout.workingCount).toBe(1);
    expect(layout.workingShelfHeaderIndex).toBe(4);
  });

  it("keeps an inactive row in Working during the shared grace and returns it on expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const tracker = createInboxReturnTracker();
    const working = makeThread({ id: ThreadId.make("grace"), title: "grace", runtime: running });
    const inactive = { ...working, runtime: null };
    const render = () =>
      build({
        threads: [inactive],
        workingShelfExpanded: true,
        isWorking: tracker.isWorking,
        inboxReturnAt: tracker.returnedAt,
      });
    try {
      tracker.observe([working]);
      tracker.observe([inactive]);
      expect(render().workingCount).toBe(1);
      expect(render().items[0]?.thread.runtime).toBeNull();
      vi.advanceTimersByTime(2_000);
      expect(render().workingCount).toBe(0);
      expect(ids(render())).toEqual(["grace"]);
      expect(tracker.returnedAt(inactive)).toBe(Date.parse(NOW) + 2_000);
    } finally {
      tracker.observe([]);
      vi.useRealTimers();
    }
  });

  it("orders the inbox by the latest return this device observed", () => {
    const layout = build({
      inboxReturnAt: (thread) =>
        thread.id === "finished-early" ? Date.parse("2026-06-01T04:00:00.000Z") : undefined,
    });
    expect(ids(layout).slice(1)).toEqual(["finished-early", "finished-late", "asks-approval"]);
  });

  it("places Working below Active and above Snoozed", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "active" }),
        makeThread({ id: ThreadId.make("working"), title: "working", runtime: running }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "snoozed",
          runtime: running,
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("done"),
          title: "done",
          doneOverride: "done",
          doneAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      workingShelfExpanded: true,
      snoozedShelfExpanded: true,
    });
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makePendingTask("queued")],
      workingCount: layout.workingCount,
      workingShelfExpanded: true,
      workingShelfHeaderIndex: layout.workingShelfHeaderIndex,
      snoozedCount: layout.snoozedCount,
      snoozedShelfExpanded: true,
      snoozedShelfHeaderIndex: layout.snoozedShelfHeaderIndex,
      doneCount: layout.doneCount,
      doneShelfHeaderIndex: layout.doneShelfHeaderIndex,
    });
    expect(
      items.map((item) =>
        item.type === "v2-thread"
          ? item.item.thread.id
          : item.type === "v2-pending"
            ? item.pendingTask.title
            : item.type,
      ),
    ).toEqual([
      "v2-active-header",
      "queued",
      "active",
      "v2-working-shelf",
      "working",
      "v2-snoozed-shelf",
      "snoozed",
      "v2-done-shelf",
      "done",
    ]);
  });
});

describe("grouped inbox", () => {
  it("keeps shared shelves and working cards in project mode", () => {
    const active = makeThread({ id: ThreadId.make("active"), title: "Active", createdAt: NOW });
    const working = makeThread({
      id: ThreadId.make("working"),
      title: "Working",
      createdAt: NOW,
      runtime: {
        status: "running",
        activeRunId: null,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "Codex",
        lastError: null,
        updatedAt: NOW,
      },
    });
    const done = makeThread({ id: ThreadId.make("done"), title: "Done", doneOverride: "done" });
    const pinned = makeThread({ id: ThreadId.make("pinned"), title: "Pinned", pinnedAt: NOW });
    const input = {
      grouping: "project" as const,
      threads: [active, working, done, pinned],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      groupingProjects: [
        {
          key: "project",
          label: "Project",
          memberProjectRefs: [{ environmentId, projectId: active.projectId }],
        },
      ],
    };
    const layout = buildThreadListV2Items(input);
    expect(layout.activeCount).toBe(2);
    expect(layout.workingShelfHeaderIndex).toBeNull();
    expect(
      layout.items
        .filter((row) => [active.id, working.id].includes(row.thread.id))
        .map((row) => row.variant),
    ).toEqual(["card", "card"]);
    const list = buildThreadListV2ListItems({ ...layout, pendingTasks: [] });
    expect(list.filter((row) => row.type === "v2-done-shelf")).toHaveLength(1);
    expect(list.filter((row) => row.type === "v2-working-shelf")).toHaveLength(0);
    expect(list.filter((row) => row.type === "v2-group-header")).toHaveLength(1);
    const collapsed = buildThreadListV2Items({
      ...input,
      activeShelfExpanded: false,
      selectedThreadKey: `${environmentId}:${working.id}`,
    });
    expect(collapsed.items.map((row) => row.thread.id)).toEqual([pinned.id, working.id, done.id]);
    expect(collapsed.inboxGroups).toBeNull();
    expect(
      buildThreadListV2Items({ ...input, searchQuery: "Working" }).items.map(
        (row) => row.thread.id,
      ),
    ).toEqual([working.id]);
  });

  it("collapses a group to its header and the selected thread, counting the hidden rows", () => {
    const threads = ["a", "b", "c"].map((id) =>
      makeThread({ id: ThreadId.make(id), title: id, createdAt: NOW }),
    );
    const input = {
      grouping: "project" as const,
      threads,
      environmentId: null,
      searchQuery: "",
      now: NOW,
      selectedThreadKey: `${environmentId}:b`,
      groupingProjects: [
        {
          key: "project",
          label: "Project",
          memberProjectRefs: [{ environmentId, projectId: threads[0]!.projectId }],
        },
      ],
    };
    const headers = (collapsedGroups: readonly string[]) => {
      const layout = buildThreadListV2Items({ ...input, collapsedGroups });
      return buildThreadListV2ListItems({ ...layout, pendingTasks: [] }).flatMap((row) =>
        row.type === "v2-group-header"
          ? [[row.label, row.count, row.expanded]]
          : row.type === "v2-thread"
            ? [row.item.thread.id]
            : [],
      );
    };
    expect(headers([])).toEqual([["Project", 3, true], "a", "b", "c"]);
    expect(headers(["project:project"])).toEqual([["Project", 3, false], "b"]);
    expect(
      buildThreadListV2ListItems({
        ...buildThreadListV2Items({
          ...input,
          selectedThreadKey: null,
          collapsedGroups: ["project:project"],
        }),
        pendingTasks: [],
      }).filter((row) => row.type === "v2-group-header" || row.type === "v2-thread"),
    ).toEqual([expect.objectContaining({ type: "v2-group-header", count: 3, expanded: false })]);
  });

  it("moves the project icon from rows to their project header", () => {
    const grouped = makeThread({ id: ThreadId.make("grouped"), title: "grouped", createdAt: NOW });
    const other = makeThread({
      id: ThreadId.make("other"),
      title: "other",
      createdAt: NOW,
      projectId: ProjectId.make("project-elsewhere"),
    });
    const pinned = makeThread({ id: ThreadId.make("pinned"), title: "pinned", pinnedAt: NOW });
    const done = makeThread({ id: ThreadId.make("done"), title: "done", doneOverride: "done" });
    const rows = (grouping: "status" | "project") =>
      buildThreadListV2ListItems({
        ...buildThreadListV2Items({
          grouping,
          threads: [grouped, other, pinned, done],
          environmentId: null,
          searchQuery: "",
          now: NOW,
          groupingProjects: [
            {
              key: "project",
              label: "Project",
              memberProjectRefs: [{ environmentId, projectId: grouped.projectId }],
            },
          ],
        }),
        pendingTasks: [],
      }).flatMap((row): Array<readonly [string, string | boolean | null]> =>
        row.type === "v2-group-header"
          ? [[row.label, row.projectKey]]
          : row.type === "v2-thread"
            ? [[row.item.thread.id, row.showProjectIcon]]
            : [],
      );
    expect(rows("project")).toEqual([
      ["pinned", true],
      ["Project", "project"],
      ["grouped", false],
      ["Other projects", null],
      ["other", true],
      ["done", true],
    ]);
    expect(rows("status").every((row) => row[1] === true)).toBe(true);
  });
});

describe("thread list Woke marker", () => {
  const wokeAt = isoAt(BASE_MS - MINUTE_MS);
  const thread = makeThread({
    id: ThreadId.make("woke"),
    title: "Woke",
    latestUserMessageAt: isoAt(BASE_MS - 90 * MINUTE_MS),
    snoozedAt: isoAt(BASE_MS - 60 * MINUTE_MS),
    snoozedUntil: wokeAt,
    lastVisitedAt: null,
  });

  it("keeps a timer wake through a plain visit until acknowledgement reaches its timestamp", () => {
    expect(resolveThreadListV2WokeAt(thread, { now: NOW })).toBe(wokeAt);
    expect(
      resolveThreadListV2WokeAt(
        { ...thread, lastVisitedAt: isoAt(BASE_MS - 30 * MINUTE_MS) },
        { now: NOW },
      ),
    ).toBe(wokeAt);
    expect(
      resolveThreadListV2WokeAt({ ...thread, lastVisitedAt: wokeAt }, { now: NOW }),
    ).toBeNull();
    expect(resolveThreadListV2WokeAt({ ...thread, lastVisitedAt: "invalid" }, { now: NOW })).toBe(
      wokeAt,
    );
  });

  it("stays hidden while snoozed and once marked Done", () => {
    expect(resolveThreadListV2WokeAt(thread, { now: isoAt(BASE_MS - 2 * MINUTE_MS) })).toBeNull();
    expect(resolveThreadListV2WokeAt({ ...thread, doneOverride: "done" }, { now: NOW })).toBeNull();
    expect(resolveThreadListV2WokeAt({ ...thread, snoozedUntil: null }, { now: NOW })).toBeNull();
  });

  it("keeps an early failure wake acknowledged after the scheduled time passes", () => {
    const completedAt = isoAt(BASE_MS - 2 * MINUTE_MS);
    const failed = makeThread({
      ...thread,
      snoozedUntil: isoAt(BASE_MS + MINUTE_MS),
      runtime: {
        status: "failed",
        activeRunId: null,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "Codex",
        lastError: "Run failed",
        updatedAt: completedAt,
      },
      latestRun: {
        runId: RunId.make("woke-run"),
        status: "failed",
        requestedAt: isoAt(BASE_MS - 3 * MINUTE_MS),
        startedAt: isoAt(BASE_MS - 3 * MINUTE_MS),
        completedAt,
        assistantMessageId: null,
      },
    });
    expect(resolveThreadListV2WokeAt(failed, { now: NOW })).toBe(completedAt);
    expect(
      resolveThreadListV2WokeAt(
        { ...failed, lastVisitedAt: completedAt },
        { now: isoAt(BASE_MS + 2 * MINUTE_MS) },
      ),
    ).toBeNull();
  });

  it("updates a recycled row at the wake boundary even without a new shell or minute tick", () => {
    const waking = { ...thread, snoozedUntil: isoAt(BASE_MS + 30_000) };
    const list = (now: string) =>
      buildThreadListV2ListItems({
        ...buildThreadListV2Items({
          threads: [waking],
          environmentId: null,
          searchQuery: "",
          now,
          snoozedShelfExpanded: true,
        }),
        pendingTasks: [],
        snoozedShelfExpanded: true,
        snoozeLabelNow: isoAt(BASE_MS),
      }).find((item) => item.type === "v2-thread")!;
    const before = list(NOW);
    const after = list(isoAt(BASE_MS + 37_500));
    expect(before.type === "v2-thread" && before.item.wokeAt).toBeNull();
    expect(after.type === "v2-thread" && after.item.wokeAt).toBe(waking.snoozedUntil);
    expect(after.type === "v2-thread" && after.timeLabel).toBe("");
    expect(threadListV2ListItemsAreEqual(before, after)).toBe(false);
  });
});
