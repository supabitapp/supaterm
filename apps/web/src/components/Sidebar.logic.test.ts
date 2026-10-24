import { presentThreadShell } from "@supaterm/client-runtime/state/models";
import * as DateTime from "effect/DateTime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultAnimateLayoutChanges, type AnimateLayoutChanges } from "@dnd-kit/sortable";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import {
  animateSidebarLayoutChanges,
  archiveSelectedThreadEntries,
  buildBulkTitleRegenerationContextMenuItem,
  buildBulkUnpinContextMenuItem,
  buildMultiSelectThreadContextMenuItems,
  createThreadJumpHintVisibilityController,
  deleteSelectedThreadEntries,
  filterSidebarV2VisibleThreads,
  formatWorkingDurationLabel,
  getFallbackThreadIdAfterDelete,
  getProjectSortTimestamp,
  getSidebarForkParentThreadId,
  getSidebarThreadIdsToPrewarm,
  hasUnseenCompletion,
  isContextMenuPointerDown,
  isSidebarSubagentThread,
  resolveSidebarRowThreadId,
  isSidebarThreadWorking,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  pinOrderKeyBetween,
  resolveAdjacentThreadId,
  resolveProjectStatusIndicator,
  resolveSidebarSweepKeys,
  resolveSidebarStageBadgeLabel,
  resolveSidebarThreadSection,
  resolveSidebarRowAccessibility,
  resolveSidebarThreadStatus,
  resolveSidebarV2DurationStartedAt,
  resolveSidebarV2TopStatus,
  resolveThreadStatusPill,
  resolveThreadTotalWorkMs,
  pullRequestMatchesSearchQuery,
  shouldClearThreadSelectionOnMouseDown,
  shouldShowSidebarV2Duration,
  shouldRecedeSidebarThread,
  sortLogicalProjectsForSidebar,
  sortInboxThreadsByReturn,
  resolveSidebarDropTarget,
  planSidebarThreadDrop,
  sortPinnedThreadsForSidebar,
  sortProjectsForSidebar,
  sortScopedProjectsForSidebar,
  sortSidebarV2ProjectGroups,
  shouldNavigateAfterThreadPark,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
  resolveSidebarDropVerb,
} from "./Sidebar.logic";

import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@supaterm/contracts";

import { DEFAULT_RUNTIME_MODE, type Project, type Thread } from "../types";
import { makeThreadFixture, type ThreadFixtureOverrides } from "../test-fixtures";

const localEnvironmentId = EnvironmentId.make("environment-local");

describe("resolveSidebarRowAccessibility", () => {
  it.each([
    {
      title: "Can you audit the UI?",
      statusLabel: "Working",
      projectDisplayName: "supaterm",
      isActive: true,
      expected: { label: "Can you audit the UI?, Working, supaterm", current: "page" },
    },
    {
      title: "The audit is done",
      statusLabel: null,
      projectDisplayName: "supaterm",
      isActive: false,
      expected: { label: "The audit is done, supaterm", current: undefined },
    },
    {
      title: "Untitled task",
      statusLabel: null,
      projectDisplayName: null,
      isActive: false,
      expected: { label: "Untitled task", current: undefined },
    },
  ])("leads with the title without folding row actions into its name: %j", (input) => {
    const { expected, ...state } = input;
    expect(resolveSidebarRowAccessibility(state)).toEqual(expected);
  });
});

describe("animateSidebarLayoutChanges", () => {
  const baseArgs: Parameters<AnimateLayoutChanges>[0] = {
    active: null,
    containerId: "pinned-threads",
    isDragging: false,
    isSorting: false,
    id: "thread-a",
    index: 1,
    items: ["thread-b", "thread-a"],
    newIndex: 0,
    previousItems: ["thread-a", "thread-b"],
    previousContainerId: "pinned-threads",
    transition: { duration: 200, easing: "ease" },
    wasDragging: true,
  };

  it("does not replay layout movement after the pointer is released", () => {
    expect(defaultAnimateLayoutChanges(baseArgs)).toBe(true);
    expect(animateSidebarLayoutChanges(baseArgs)).toBe(false);
  });

  it("keeps layout movement while the user is sorting", () => {
    expect(animateSidebarLayoutChanges({ ...baseArgs, isSorting: true })).toBe(true);
  });
});

describe("resolveSidebarThreadSection", () => {
  it("keeps a pinned thread in the pinned shelf", () => {
    expect(resolveSidebarThreadSection({ snoozed: false, done: false, pinned: true })).toBe(
      "pinned",
    );
  });

  it("keeps lifecycle shelves authoritative over a stale pin", () => {
    expect(resolveSidebarThreadSection({ snoozed: true, done: true, pinned: true })).toBe(
      "snoozed",
    );
    expect(resolveSidebarThreadSection({ snoozed: false, done: true, pinned: true })).toBe("done");
  });
});

describe("deleteSelectedThreadEntries", () => {
  const entries = [{ threadKey: "one" }, { threadKey: "two" }, { threadKey: "three" }] as const;
  const success = AsyncResult.success(undefined);
  const failure = AsyncResult.failure(Cause.fail(new Error("Delete failed")));
  const interrupted = AsyncResult.failure(Cause.interrupt());

  it("waits for each delete and excludes only earlier successes from worktree checks", async () => {
    let resolveDelete!: (result: typeof success) => void;
    const pendingDelete = new Promise<typeof success>((resolve) => {
      resolveDelete = resolve;
    });
    const worktreeChecks: { threadKey: string; deletedThreadKeys: string[] }[] = [];
    const deletion = deleteSelectedThreadEntries({
      entries,
      delete: async ({ threadKey }, deletedThreadKeys) => {
        worktreeChecks.push({ threadKey, deletedThreadKeys: [...deletedThreadKeys] });
        return threadKey === "one" ? pendingDelete : success;
      },
    });

    expect(worktreeChecks).toEqual([{ threadKey: "one", deletedThreadKeys: [] }]);
    resolveDelete(success);
    const outcome = await deletion;

    expect(worktreeChecks).toEqual([
      { threadKey: "one", deletedThreadKeys: [] },
      { threadKey: "two", deletedThreadKeys: ["one"] },
      { threadKey: "three", deletedThreadKeys: ["one", "two"] },
    ]);
    expect(outcome).toEqual({
      deletedThreadKeys: new Set(["one", "two", "three"]),
      firstFailure: null,
    });
  });

  it("continues after ordinary failures and keeps the first failure", async () => {
    const laterFailure = AsyncResult.failure(Cause.fail(new Error("Later failure")));
    const deletedKeysAtLastEntry: string[][] = [];
    const outcome = await deleteSelectedThreadEntries({
      entries: [...entries, { threadKey: "four" }],
      delete: async ({ threadKey }, deletedThreadKeys) => {
        if (threadKey === "one") return failure;
        if (threadKey === "three") return laterFailure;
        if (threadKey === "four") deletedKeysAtLastEntry.push([...deletedThreadKeys]);
        return success;
      },
    });

    expect(deletedKeysAtLastEntry).toEqual([["two"]]);
    expect(outcome).toEqual({
      deletedThreadKeys: new Set(["two", "four"]),
      firstFailure: failure,
    });
  });

  it.each([
    { firstResult: success, deletedThreadKeys: new Set(["one"]), firstFailure: null },
    { firstResult: failure, deletedThreadKeys: new Set<string>(), firstFailure: failure },
  ])("stops on interruption and preserves earlier results %#", async (testCase) => {
    const attemptedThreadKeys: string[] = [];
    const outcome = await deleteSelectedThreadEntries({
      entries,
      delete: async ({ threadKey }) => {
        attemptedThreadKeys.push(threadKey);
        return threadKey === "one" ? testCase.firstResult : interrupted;
      },
    });

    expect(attemptedThreadKeys).toEqual(["one", "two"]);
    expect(outcome).toEqual({
      deletedThreadKeys: testCase.deletedThreadKeys,
      firstFailure: testCase.firstFailure,
    });
  });

  it("does not count a skipped entry as deleted", async () => {
    const visibleEntries = new Set(entries.map(({ threadKey }) => threadKey));
    const worktreeChecks: string[][] = [];
    const outcome = await deleteSelectedThreadEntries({
      entries,
      delete: async ({ threadKey }, deletedThreadKeys) => {
        if (!visibleEntries.has(threadKey)) return null;
        worktreeChecks.push([...deletedThreadKeys]);
        visibleEntries.delete("two");
        return success;
      },
    });

    expect(worktreeChecks).toEqual([[], ["one"]]);
    expect(outcome).toEqual({
      deletedThreadKeys: new Set(["one", "three"]),
      firstFailure: null,
    });
  });
});

describe("archiveSelectedThreadEntries", () => {
  const entries = [{ threadKey: "one" }, { threadKey: "two" }, { threadKey: "three" }] as const;
  const success = { _tag: "Success" } as const;
  const failure = { _tag: "Failure" } as const;

  it("records every entry after full success", async () => {
    const outcome = await archiveSelectedThreadEntries({
      entries,
      archive: async (_entry, onArchived) => {
        onArchived();
        return success;
      },
    });

    expect(outcome).toEqual({
      archivedThreadKeys: ["one", "two", "three"],
      mutationFailure: null,
      followupFailures: [],
    });
  });

  it("stops at a mutation failure and retains prior successes", async () => {
    const archive = vi.fn(async (entry: (typeof entries)[number], onArchived: () => void) => {
      if (entry.threadKey === "two") return failure;
      onArchived();
      return success;
    });
    const outcome = await archiveSelectedThreadEntries({ entries, archive });

    expect(archive).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({
      archivedThreadKeys: ["one"],
      mutationFailure: failure,
      followupFailures: [],
    });
  });

  it("continues after a post-archive failure", async () => {
    const archive = vi.fn(async (entry: (typeof entries)[number], onArchived: () => void) => {
      onArchived();
      return entry.threadKey === "two" ? failure : success;
    });
    const outcome = await archiveSelectedThreadEntries({ entries, archive });

    expect(archive).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({
      archivedThreadKeys: ["one", "two", "three"],
      mutationFailure: null,
      followupFailures: [failure],
    });
  });
});

describe("buildBulkUnpinContextMenuItem", () => {
  it("counts only the pinned rows of a mixed selection", () => {
    expect(buildBulkUnpinContextMenuItem({ pinnedCount: 2 })).toEqual({
      id: "unpin",
      label: "Unpin (2)",
    });
  });

  it("omits the action when nothing selected is pinned", () => {
    expect(buildBulkUnpinContextMenuItem({ pinnedCount: 0 })).toBeNull();
  });
});

describe("buildBulkTitleRegenerationContextMenuItem", () => {
  it("counts only threads that can start a new regeneration", () => {
    expect(
      buildBulkTitleRegenerationContextMenuItem({
        supportedCount: 4,
        actionableCount: 3,
      }),
    ).toEqual({
      id: "regenerate-title",
      label: "Regenerate titles (3)",
    });
  });

  it("shows a disabled progress item when every supported thread is pending", () => {
    expect(
      buildBulkTitleRegenerationContextMenuItem({
        supportedCount: 2,
        actionableCount: 0,
      }),
    ).toEqual({
      id: "regenerate-title",
      label: "Regenerating… (2)",
      disabled: true,
    });
  });

  it("omits the action when no selected environment supports it", () => {
    expect(
      buildBulkTitleRegenerationContextMenuItem({
        supportedCount: 0,
        actionableCount: 0,
      }),
    ).toBeNull();
  });
});

describe("buildMultiSelectThreadContextMenuItems", () => {
  it("offers bulk archive with the selected count", () => {
    expect(
      buildMultiSelectThreadContextMenuItems({ count: 3, hasRunningThread: false }),
    ).toContainEqual({ id: "archive", label: "Archive (3)", disabled: false });
  });

  it("disables bulk archive when a selected thread is running", () => {
    expect(
      buildMultiSelectThreadContextMenuItems({ count: 2, hasRunningThread: true }),
    ).toContainEqual({ id: "archive", label: "Archive (2)", disabled: true });
  });
});

describe("resolveSidebarStageBadgeLabel", () => {
  it("returns Nightly for nightly primary server versions", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: null,
      }),
    ).toBe("Nightly");
  });

  it("returns the fallback label for stable primary server versions", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: "0.0.27",
        fallbackStageLabel: null,
      }),
    ).toBeNull();
  });

  it("returns the fallback label when the primary server version is missing", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: null,
        fallbackStageLabel: "Dev",
      }),
    ).toBe("Dev");
  });

  it("returns the fallback label for malformed nightly prerelease versions", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: "0.0.28-nightly.20260616",
        fallbackStageLabel: null,
      }),
    ).toBeNull();
  });
});

describe("sidebar thread lineage helpers", () => {
  it("keeps only top-level, unarchived threads in the Sidebar V2 project scope", () => {
    const parentId = ThreadId.make("thread-parent");
    const projectId = ProjectId.make("project-visible");
    const environmentId = EnvironmentId.make("environment-visible");
    const root = makeThreadFixture({
      id: parentId,
      environmentId,
      projectId,
    });
    const subagent = makeThreadFixture({
      id: ThreadId.make("thread-subagent"),
      environmentId,
      projectId,
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const fork = makeThreadFixture({
      id: ThreadId.make("thread-fork"),
      environmentId,
      projectId,
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "fork",
      },
    });
    const archived = makeThreadFixture({
      id: ThreadId.make("thread-archived"),
      environmentId,
      projectId,
      archivedAt: "2026-01-02T00:00:00.000Z",
    });
    const otherProject = makeThreadFixture({
      id: ThreadId.make("thread-other-project"),
      environmentId,
      projectId: ProjectId.make("project-other"),
    });

    expect(
      filterSidebarV2VisibleThreads(
        [root, subagent, fork, archived, otherProject],
        new Set([`${environmentId}:${projectId}`]),
      ).map((thread) => thread.id),
    ).toEqual([parentId, fork.id]);
  });

  it("identifies subagent threads so the sidebar can hide them", () => {
    const parentId = ThreadId.make("thread-parent");
    const subagent = makeThreadFixture({
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });

    expect(isSidebarSubagentThread(subagent)).toBe(true);
    expect(isSidebarSubagentThread(makeThreadFixture())).toBe(false);
  });

  it("maps an open subagent to its nearest visible ancestor's sidebar row", () => {
    const environmentId = EnvironmentId.make("environment-row");
    const otherEnvironmentId = EnvironmentId.make("environment-other");
    const subagentOf = (id: string, parentId: ThreadId, environment = environmentId) =>
      makeThreadFixture({
        id: ThreadId.make(id),
        environmentId: environment,
        lineage: {
          rootThreadId: parentId,
          parentThreadId: parentId,
          relationshipToParent: "subagent",
        },
      });
    const root = makeThreadFixture({ id: ThreadId.make("thread-root"), environmentId });
    const fork = makeThreadFixture({
      id: ThreadId.make("thread-fork"),
      environmentId,
      lineage: {
        rootThreadId: root.id,
        parentThreadId: root.id,
        relationshipToParent: "fork",
      },
    });
    const child = subagentOf("thread-child", root.id);
    const grandchild = subagentOf("thread-grandchild", child.id);
    const forkChild = subagentOf("thread-fork-child", fork.id);
    const orphan = subagentOf("thread-orphan", ThreadId.make("thread-missing"));
    const elsewhere = subagentOf("thread-elsewhere", root.id, otherEnvironmentId);
    const threads = [root, fork, child, grandchild, forkChild, orphan, elsewhere];

    expect(resolveSidebarRowThreadId(child.id, environmentId, threads)).toBe(root.id);
    expect(resolveSidebarRowThreadId(grandchild.id, environmentId, threads)).toBe(root.id);
    expect(resolveSidebarRowThreadId(forkChild.id, environmentId, threads)).toBe(fork.id);
    expect(resolveSidebarRowThreadId(elsewhere.id, otherEnvironmentId, threads)).toBe(elsewhere.id);
    expect(resolveSidebarRowThreadId(orphan.id, environmentId, threads)).toBe(orphan.id);
    const loopA = subagentOf("thread-loop-a", ThreadId.make("thread-loop-b"));
    const loopB = subagentOf("thread-loop-b", loopA.id);
    expect(resolveSidebarRowThreadId(loopA.id, environmentId, [loopA, loopB])).toBe(loopA.id);
  });

  it("resolves the parent thread for fork sidebar affordances", () => {
    const parentId = ThreadId.make("thread-parent");
    const fallbackParentId = ThreadId.make("thread-fallback-parent");
    const runFork = makeThreadFixture({
      forkedFrom: { type: "run", threadId: parentId, runId: "run-1" as never },
      lineage: {
        rootThreadId: parentId,
        parentThreadId: fallbackParentId,
        relationshipToParent: "fork",
      },
    });
    const lineageFork = makeThreadFixture({
      lineage: {
        rootThreadId: parentId,
        parentThreadId: fallbackParentId,
        relationshipToParent: "fork",
      },
    });

    expect(getSidebarForkParentThreadId(runFork)).toBe(parentId);
    expect(getSidebarForkParentThreadId(lineageFork)).toBe(fallbackParentId);
    expect(getSidebarForkParentThreadId(makeThreadFixture())).toBeNull();
  });
});

function makeLatestRun(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): NonNullable<Thread["latestRun"]> {
  return {
    runId: "turn-1" as never,
    status: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt:
      overrides?.startedAt !== undefined ? overrides.startedAt : "2026-03-09T10:00:00.000Z",
    completedAt:
      overrides?.completedAt !== undefined ? overrides.completedAt : "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        latestRun: makeLatestRun(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        runtime: null,
      }),
    ).toBe(true);
  });

  it("treats a missing client visit marker as read", () => {
    expect(
      hasUnseenCompletion({
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        latestRun: makeLatestRun(),
        lastVisitedAt: undefined,
        runtime: null,
      }),
    ).toBe(false);
  });
});

describe("shouldRecedeSidebarThread", () => {
  it.each(["working", "waiting"] as const)(
    "recedes an inactive %s thread even when it is unread and woke",
    (status) => {
      expect(
        shouldRecedeSidebarThread({
          status,
          isUnread: true,
          isWoke: true,
          isActive: false,
          isSelected: false,
        }),
      ).toBe(true);
    },
  );

  it.each(["ready", "approval", "input"] as const)(
    "keeps an unread %s thread prominent",
    (status) => {
      expect(
        shouldRecedeSidebarThread({
          status,
          isUnread: true,
          isWoke: false,
          isActive: false,
          isSelected: false,
        }),
      ).toBe(false);
    },
  );

  it("keeps active and selected working threads prominent", () => {
    const input = {
      status: "working" as const,
      isUnread: true,
      isWoke: true,
      isActive: false,
      isSelected: false,
    };

    expect(shouldRecedeSidebarThread({ ...input, isActive: true })).toBe(false);
    expect(shouldRecedeSidebarThread({ ...input, isSelected: true })).toBe(false);
  });

  it.each([false, true])("keeps input-required threads prominent with unread=%s", (isUnread) => {
    expect(
      shouldRecedeSidebarThread({
        status: "input",
        isUnread,
        isWoke: false,
        isActive: false,
        isSelected: false,
      }),
    ).toBe(false);
  });
});

describe("createThreadJumpHintVisibilityController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays showing jump hints until the configured delay elapses", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS - 1);

    expect(visibilityChanges).toEqual([]);

    vi.advanceTimersByTime(1);

    expect(visibilityChanges).toEqual([true]);
  });

  it("hides immediately when the modifiers are released", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    controller.sync(false);

    expect(visibilityChanges).toEqual([true, false]);
  });

  it("cancels a pending reveal when the modifier is released early", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(Math.floor(THREAD_JUMP_HINT_SHOW_DELAY_MS / 2));
    controller.sync(false);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);

    expect(visibilityChanges).toEqual([]);
  });
});

describe("getSidebarThreadIdsToPrewarm", () => {
  it("returns only the first visible thread ids up to the prewarm limit", () => {
    expect(getSidebarThreadIdsToPrewarm(["t1", "t2", "supaterm"], 2)).toEqual(["t1", "t2"]);
  });

  it("returns all visible thread ids when they fit within the limit", () => {
    expect(getSidebarThreadIdsToPrewarm(["t1", "t2"], 10)).toEqual(["t1", "t2"]);
  });

  it("returns no thread ids when the limit is zero", () => {
    expect(getSidebarThreadIdsToPrewarm(["t1", "t2"], 0)).toEqual([]);
  });
});

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("isTrailingDoubleClick", () => {
  it("treats a single click as a normal activation", () => {
    expect(isTrailingDoubleClick(1)).toBe(false);
  });

  it("treats synthetic/keyboard activations (detail 0) as a normal activation", () => {
    expect(isTrailingDoubleClick(0)).toBe(false);
  });

  it("ignores the second click of a double-click so it does not navigate", () => {
    expect(isTrailingDoubleClick(2)).toBe(true);
  });

  it("ignores further clicks of a triple-click", () => {
    expect(isTrailingDoubleClick(3)).toBe(true);
  });
});

describe("orderItemsByPreferredIds", () => {
  it("keeps preferred ids first, skips stale ids, and preserves the relative order of remaining items", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.make("project-1"), name: "One" },
        { id: ProjectId.make("project-2"), name: "Two" },
        { id: ProjectId.make("project-3"), name: "Three" },
      ],
      preferredIds: [
        ProjectId.make("project-3"),
        ProjectId.make("project-missing"),
        ProjectId.make("project-1"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.make("project-3"),
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("does not duplicate items when preferred ids repeat", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.make("project-1"), name: "One" },
        { id: ProjectId.make("project-2"), name: "Two" },
      ],
      preferredIds: [
        ProjectId.make("project-2"),
        ProjectId.make("project-1"),
        ProjectId.make("project-2"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("honors projectOrder physical keys via getProjectOrderKey", async () => {
    const { getProjectOrderKey } = await import("../logicalProject");
    const projects = [
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-alpha"),
        workspaceRoot: "/work/alpha",
      },
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-beta"),
        workspaceRoot: "/work/beta",
      },
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-gamma"),
        workspaceRoot: "/work/gamma",
      },
    ];
    const ordered = orderItemsByPreferredIds({
      items: projects,
      preferredIds: [getProjectOrderKey(projects[2]!), getProjectOrderKey(projects[0]!)],
      getId: getProjectOrderKey,
    });

    expect(ordered.map((project) => project.workspaceRoot)).toEqual([
      "/work/gamma",
      "/work/alpha",
      "/work/beta",
    ]);
  });
});

describe("resolveAdjacentThreadId", () => {
  it("resolves adjacent thread ids in ordered sidebar traversal", () => {
    const threads = [
      ThreadId.make("thread-1"),
      ThreadId.make("thread-2"),
      ThreadId.make("thread-3"),
    ];

    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "previous",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "next",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "next",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "previous",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[0] ?? null,
        direction: "previous",
      }),
    ).toBeNull();
  });
});

describe("isContextMenuPointerDown", () => {
  it("treats secondary-button presses as context menu gestures on all platforms", () => {
    expect(
      isContextMenuPointerDown({
        button: 2,
        ctrlKey: false,
        isMac: false,
      }),
    ).toBe(true);
  });

  it("treats ctrl+primary-click as a context menu gesture on macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: true,
      }),
    ).toBe(true);
  });

  it("does not treat ctrl+primary-click as a context menu gesture off macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: false,
      }),
    ).toBe(false);
  });
});

describe("resolveSidebarThreadStatus", () => {
  const runtime = {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };

  const idle = { hasPendingApprovals: false, hasPendingUserInput: false, runtime: null };

  it("prioritizes approval over a running runtime", () => {
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        hasPendingApprovals: true,
        runtime,
        blockedOnThreadWait: true,
      }),
    ).toBe("approval");
  });

  it("prioritizes awaiting input over a running runtime, below approval", () => {
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        hasPendingUserInput: true,
        runtime,
        blockedOnThreadWait: true,
      }),
    ).toBe("input");
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
        blockedOnThreadWait: true,
        runtime,
      }),
    ).toBe("approval");
  });

  it("reports working for running and starting runtimes", () => {
    expect(resolveSidebarThreadStatus({ ...idle, runtime })).toBe("working");
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        runtime: { ...runtime, status: "starting" as const },
        blockedOnThreadWait: true,
      }),
    ).toBe("working");
  });

  it("keeps usage-limit stops Limited and visible until the thread recovers", () => {
    const limited = {
      ...runtime,
      status: "failed" as const,
      lastError: "Plan limit reached",
      lastErrorClass: "usage_limit" as const,
    };
    expect(resolveSidebarThreadStatus({ ...idle, runtime: limited })).toBe("limited");
    expect(
      resolveSidebarThreadStatus({ ...idle, runtime: { ...limited, status: "running" } }),
    ).toBe("working");
    expect(
      resolveSidebarThreadStatus({ ...idle, runtime: { ...limited, status: "completed" } }),
    ).toBe("ready");
    expect(
      resolveSidebarV2TopStatus({
        environmentConnected: true,
        status: "limited",
        isUnread: false,
        isWoke: false,
      }),
    ).toBe("limited");
    expect(
      shouldRecedeSidebarThread({
        status: "limited",
        isUnread: false,
        isWoke: false,
        isActive: false,
        isSelected: false,
      }),
    ).toBe(false);
  });

  it("reports failed only while the latest run failed", () => {
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        runtime: { ...runtime, status: "failed" as const, lastError: "boom" },
      }),
    ).toBe("failed");
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        runtime: { ...runtime, status: "completed" as const, lastError: "persisted" },
      }),
    ).toBe("ready");
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        runtime: { ...runtime, status: "idle" as const, lastError: "persisted" },
      }),
    ).toBe("waiting");
  });

  it("defaults to ready with no runtime", () => {
    expect(resolveSidebarThreadStatus(idle)).toBe("ready");
  });

  it("keeps a waiting runtime visible ahead of unread and woke presentation", () => {
    expect(
      resolveSidebarV2TopStatus({
        environmentConnected: true,
        status: "waiting",
        isUnread: true,
        isWoke: true,
      }),
    ).toBe("waiting");
  });

  it("shows elapsed duration for Waiting and Working", () => {
    expect(shouldShowSidebarV2Duration("waiting")).toBe(true);
    expect(shouldShowSidebarV2Duration("working")).toBe(true);
    expect(shouldShowSidebarV2Duration("ready")).toBe(false);
  });
});

describe("pullRequestMatchesSearchQuery", () => {
  const branchPullRequest = {
    projectId: ProjectId.make("project"),
    repository: "supabitapp/supaterm",
    number: 123,
    url: "https://github.com/supabitapp/supaterm/pull/123",
  };

  it("matches when every query token appears in the PR's terms", () => {
    expect(pullRequestMatchesSearchQuery({ branchPullRequest }, "123")).toBe(true);
    expect(pullRequestMatchesSearchQuery({ branchPullRequest }, "supabitapp/supaterm #123")).toBe(
      true,
    );
  });

  it("rejects queries with a token the PR does not carry, and blank queries", () => {
    expect(pullRequestMatchesSearchQuery({ branchPullRequest }, "rebase 123")).toBe(false);
    expect(pullRequestMatchesSearchQuery({ branchPullRequest }, "   ")).toBe(false);
  });
});

describe("environment connection status in the sidebar", () => {
  it.each([
    ["working", "working"],
    ["waiting", "waiting"],
    ["approval", "approval"],
    ["input", "input"],
    ["failed", "failed"],
    ["limited", "limited"],
    ["ready", "woke"],
  ] as const)("replaces cached %s status until the environment connects", (status, restored) => {
    const input = { status, isUnread: true, isWoke: true };
    expect(resolveSidebarV2TopStatus({ ...input, environmentConnected: false })).toBe("connecting");
    expect(resolveSidebarV2TopStatus({ ...input, environmentConnected: true })).toBe(restored);
  });
});

describe("resolveSidebarV2DurationStartedAt", () => {
  const thread = makeThreadFixture({
    latestRun: makeLatestRun(),
    runtime: {
      status: "idle",
      activeRunId: null,
      activityStartedAt: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: null,
      lastError: null,
      updatedAt: "2026-03-09T10:05:00.000Z",
    },
  });

  it("counts a wait from when the parent run settled, not from when its work began", () => {
    expect(resolveSidebarV2DurationStartedAt(thread)).toBe("2026-03-09T10:05:00.000Z");
  });

  it("counts work from the activity start carried across background wakes", () => {
    expect(
      resolveSidebarV2DurationStartedAt({
        ...thread,
        runtime: {
          ...thread.runtime!,
          status: "running",
          activityStartedAt: "2026-03-09T09:55:00.000Z",
        },
      }),
    ).toBe("2026-03-09T09:55:00.000Z");
  });

  it("does not count a wait from the work start while the parked run is still settling", () => {
    expect(
      resolveSidebarV2DurationStartedAt({
        ...thread,
        latestRun: makeLatestRun({ completedAt: null }),
        runtime: { ...thread.runtime!, activityStartedAt: "2026-03-09T09:55:00.000Z" },
      }),
    ).toBeNull();
  });

  it("leaves a wait untimed when the latest run never started or has no valid completion", () => {
    expect(
      resolveSidebarV2DurationStartedAt({
        ...thread,
        latestRun: makeLatestRun({ startedAt: null }),
      }),
    ).toBeNull();
    expect(
      resolveSidebarV2DurationStartedAt({
        ...thread,
        latestRun: makeLatestRun({ completedAt: "invalid" }),
      }),
    ).toBeNull();
  });

  it("leaves ready threads and waits without a known run untimed", () => {
    expect(
      resolveSidebarV2DurationStartedAt({
        ...thread,
        runtime: { ...thread.runtime!, status: "completed" },
      }),
    ).toBeNull();
    expect(resolveSidebarV2DurationStartedAt({ ...thread, latestRun: null })).toBeNull();
  });
});

describe("resolveThreadTotalWorkMs", () => {
  const thread = makeThreadFixture({
    latestRun: makeLatestRun(),
    completedWorkMs: 90_000,
    runtime: {
      status: "running",
      activeRunId: null,
      activityStartedAt: "2026-03-09T10:00:00.000Z",
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: null,
      lastError: null,
      updatedAt: "2026-03-09T10:00:00.000Z",
    },
  });
  const nowMs = Date.parse("2026-03-09T10:00:30.000Z");

  it("adds the session in progress to the ended sessions", () => {
    expect(resolveThreadTotalWorkMs(thread, nowMs)).toBe(120_000);
  });

  it("waits for execution to start before adding the session in progress", () => {
    for (const status of ["preparing", "starting"] as const) {
      expect(
        resolveThreadTotalWorkMs({ ...thread, runtime: { ...thread.runtime!, status } }, nowMs),
      ).toBe(90_000);
    }
  });

  it("uses the ended sessions alone once nothing is working", () => {
    expect(
      resolveThreadTotalWorkMs(
        { ...thread, runtime: { ...thread.runtime!, status: "idle", activityStartedAt: null } },
        nowMs,
      ),
    ).toBe(90_000);
  });

  it("is unknown when the server does not report work time", () => {
    expect(resolveThreadTotalWorkMs({ ...thread, completedWorkMs: null }, nowMs)).toBeNull();
  });
});

describe("formatWorkingDurationLabel", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatWorkingDurationLabel(0)).toBe("0s");
    expect(formatWorkingDurationLabel(42_000)).toBe("42s");
    expect(formatWorkingDurationLabel(60_000)).toBe("1m");
    expect(formatWorkingDurationLabel(5 * 60_000)).toBe("5m");
    expect(formatWorkingDurationLabel(60 * 60_000)).toBe("1h 0m");
    expect(formatWorkingDurationLabel(90 * 60_000)).toBe("1h 30m");
  });

  it("clamps negative and non-finite elapsed values to zero", () => {
    expect(formatWorkingDurationLabel(-5_000)).toBe("0s");
    expect(formatWorkingDurationLabel(Number.NaN)).toBe("0s");
    expect(formatWorkingDurationLabel(Number.POSITIVE_INFINITY)).toBe("0s");
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestRun: null,
    lastVisitedAt: undefined,
    runtime: {
      status: "running" as const,
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      activeRunId: "turn-1" as never,
      lastError: null,
      updatedAt: "2026-03-09T10:00:00.000Z",
    },
  };

  it("shows Connecting ahead of cached approvals and restores them after reconnect", () => {
    const thread = { ...baseThread, hasPendingApprovals: true, hasPendingUserInput: true };
    expect(resolveThreadStatusPill({ thread, environmentConnected: false })).toMatchObject({
      label: "Connecting",
      pulse: false,
    });
    expect(resolveThreadStatusPill({ thread, environmentConnected: true })).toMatchObject({
      label: "Pending Approval",
      pulse: false,
    });
  });

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasPendingApprovals: true,
          hasPendingUserInput: true,
          blockedOnThreadWait: true,
        },
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when user answers are required", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasPendingUserInput: true,
          blockedOnThreadWait: true,
        },
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows an active thread wait without a pulse and resumes Working when it ends", () => {
    const blocked = { ...baseThread, blockedOnThreadWait: true };
    expect(resolveSidebarThreadStatus(blocked)).toBe("waiting");
    expect(resolveThreadStatusPill({ thread: blocked })).toMatchObject({
      label: "Waiting",
      pulse: false,
    });

    const resumed = { ...blocked, blockedOnThreadWait: false };
    expect(resolveSidebarThreadStatus(resumed)).toBe("working");
    expect(resolveThreadStatusPill({ thread: resumed })).toMatchObject({
      label: "Working",
      pulse: true,
    });
  });

  it("shows waiting for an idle thread with pending background tasks", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          pendingBackgroundTasks: [{ taskId: "bg-1", description: "Watch build", kind: "monitor" }],
          runtime: {
            ...baseThread.runtime,
            status: "idle",
            activeRunId: null,
          },
        },
      }),
    ).toMatchObject({
      label: "Waiting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: false,
    });
  });

  it("keeps an active turn working when background tasks are also present", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          pendingBackgroundTasks: [{ taskId: "bg-1", description: "sleep 20", kind: "command" }],
        },
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("does not show waiting after the background task roster clears", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          pendingBackgroundTasks: [],
          runtime: {
            ...baseThread.runtime,
            status: "idle",
            activeRunId: null,
          },
        },
      }),
    ).toBeNull();
  });

  it("does not manufacture completed state without a client visit marker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestRun: makeLatestRun(),
          runtime: {
            ...baseThread.runtime,
            status: "completed",
            activeRunId: null,
          },
        },
      }),
    ).toBeNull();
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestRun: makeLatestRun(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          runtime: {
            ...baseThread.runtime,
            status: "completed",
            activeRunId: null,
          },
        },
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });

  it("shows failed, not completed, when the unseen run failed", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestRun: { ...makeLatestRun(), status: "failed" },
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          runtime: {
            ...baseThread.runtime,
            status: "failed",
            activeRunId: null,
            lastError: "Provider turn failed.",
          },
        },
      }),
    ).toMatchObject({ label: "Failed", pulse: false });
  });

  it("shows failed for a thread nobody has opened yet", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestRun: { ...makeLatestRun(), status: "failed" },
          lastVisitedAt: null,
          runtime: { ...baseThread.runtime, status: "failed", activeRunId: null },
        },
      }),
    ).toMatchObject({ label: "Failed" });
  });

  it("shows failed, not plan ready, when a plan run proposed a plan and then failed", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestRun: { ...makeLatestRun(), status: "failed" },
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          runtime: { ...baseThread.runtime, status: "failed", activeRunId: null },
        },
      }),
    ).toMatchObject({ label: "Failed" });
  });

  it("drops the failed pill once the failure has been seen", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestRun: { ...makeLatestRun(), status: "failed" },
          lastVisitedAt: "2026-03-09T10:06:00.000Z",
          runtime: { ...baseThread.runtime, status: "failed", activeRunId: null },
        },
      }),
    ).toBeNull();
  });
});

describe("resolveProjectStatusIndicator", () => {
  it("ranks a failure above work in progress and completions", () => {
    expect(
      resolveProjectStatusIndicator([
        { label: "Completed", colorClass: "", dotClass: "", pulse: false },
        { label: "Working", colorClass: "", dotClass: "", pulse: true },
        { label: "Failed", colorClass: "", dotClass: "", pulse: false },
      ]),
    ).toMatchObject({ label: "Failed" });
  });

  it("returns null when no threads have a notable status", () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull();
  });

  it("surfaces the highest-priority actionable state across project threads", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Pending Approval",
          colorClass: "text-amber-600",
          dotClass: "bg-amber-500",
          pulse: false,
        },
        {
          label: "Working",
          colorClass: "text-sky-600",
          dotClass: "bg-sky-500",
          pulse: true,
        },
      ]),
    ).toMatchObject({ label: "Pending Approval", dotClass: "bg-amber-500" });
  });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const { defaultModelSelection, ...rest } = overrides;
  return {
    id: ProjectId.make("project-1"),
    environmentId: localEnvironmentId,
    title: "Project",
    workspaceRoot: "/tmp/project",
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...defaultModelSelection,
    },
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    ...rest,
  };
}

function makeThread(overrides: ThreadFixtureOverrides = {}): Thread {
  return makeThreadFixture({
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...overrides?.modelSelection,
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    runtime: null,
    messages: [],
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    doneOverride: null,
    doneAt: null,
    deletedAt: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestRun: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  });
}

describe("getFallbackThreadIdAfterDelete", () => {
  it("returns the top remaining thread in the deleted thread's project sidebar order", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-oldest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-other-project"),
          projectId: ProjectId.make("project-2"),
          createdAt: "2026-03-09T10:20:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-newest"));
  });

  it("skips other threads being deleted in the same action", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-next"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:07:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      deletedThreadIds: new Set([ThreadId.make("thread-active"), ThreadId.make("thread-newest")]),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-next"));
  });
});
describe("sortProjectsForSidebar", () => {
  it("sorts projects by the most recent user message across their threads", () => {
    const projects = [
      makeProject({ id: ProjectId.make("project-1"), title: "Older project" }),
      makeProject({ id: ProjectId.make("project-2"), title: "Newer project" }),
    ];
    const threads = [
      makeThread({
        projectId: ProjectId.make("project-1"),
        updatedAt: "2026-03-09T10:20:00.000Z",
        messages: [
          {
            id: "message-1" as never,
            role: "user",
            text: "older project user message",
            runId: null,
            createdAt: "2026-03-09T10:01:00.000Z",
            updatedAt: "2026-03-09T10:01:00.000Z",
            streaming: false,
          },
        ],
      }),
      makeThread({
        id: ThreadId.make("thread-2"),
        projectId: ProjectId.make("project-2"),
        updatedAt: "2026-03-09T10:05:00.000Z",
        messages: [
          {
            id: "message-2" as never,
            role: "user",
            text: "newer project user message",
            runId: null,
            createdAt: "2026-03-09T10:05:00.000Z",
            updatedAt: "2026-03-09T10:05:00.000Z",
            streaming: false,
          },
        ],
      }),
    ];

    const sorted = sortProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("falls back to project timestamps when a project has no threads", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-1"),
          title: "Older project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.make("project-2"),
          title: "Newer project",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("falls back to name and id ordering when projects have no sortable timestamps", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-2"),
          title: "Beta",
          createdAt: "invalid-created-at" as never,
          updatedAt: "invalid-updated-at" as never,
        }),
        makeProject({
          id: ProjectId.make("project-1"),
          title: "Alpha",
          createdAt: "invalid-created-at" as never,
          updatedAt: "invalid-updated-at" as never,
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("preserves manual project ordering", () => {
    const projects = [
      makeProject({ id: ProjectId.make("project-2"), title: "Second" }),
      makeProject({ id: ProjectId.make("project-1"), title: "First" }),
    ];

    const sorted = sortProjectsForSidebar(projects, [], "manual");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it.each(["updated_at", "created_at"] as const)(
    "matches the per-comparison %s order on a shuffled list with ties",
    (sortOrder) => {
      const minute = (value: number) => `2026-03-09T10:0${value}:00.000Z`;
      const projects = Array.from({ length: 24 }, (_, index) => {
        const n = (index * 7) % 24;
        return makeProject({
          id: ProjectId.make(`project-${n}`),
          title: n % 2 === 0 ? "Alpha" : "Beta",
          createdAt: minute(n % 3),
          updatedAt: n % 5 === 0 ? "invalid" : minute(n % 2),
        });
      });
      const threads = Array.from({ length: 48 }, (_, n) => ({
        projectId: ProjectId.make(`project-${n % 16}`),
        createdAt: minute(n % 6),
        updatedAt: minute(n % 3),
        latestUserMessageAt: n % 4 === 0 ? null : minute(n % 5),
      }));
      const timestamp = (project: Project) =>
        getProjectSortTimestamp(
          project,
          threads.filter((thread) => thread.projectId === project.id),
          sortOrder,
        );
      const expected = projects.toSorted((left, right) => {
        const rightTimestamp = timestamp(right);
        const leftTimestamp = timestamp(left);
        const byTimestamp =
          rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
        return (
          byTimestamp || left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
        );
      });

      expect(sortProjectsForSidebar(projects, threads, sortOrder)).toEqual(expected);
    },
  );

  it("returns the project timestamp when no threads are present", () => {
    const timestamp = getProjectSortTimestamp(
      makeProject({ updatedAt: "2026-03-09T10:10:00.000Z" }),
      [],
      "updated_at",
    );

    expect(timestamp).toBe(Date.parse("2026-03-09T10:10:00.000Z"));
  });
});

describe("sortScopedProjectsForSidebar", () => {
  it("keeps identical project ids in different environments separate", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const sharedProjectId = ProjectId.make("shared-project");
    const projects = [
      makeProject({
        environmentId: localEnvironmentId,
        id: sharedProjectId,
        title: "Local project",
      }),
      makeProject({
        environmentId: remoteEnvironmentId,
        id: sharedProjectId,
        title: "Remote project",
      }),
    ];
    const threads = [
      makeThread({
        environmentId: localEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:02:00.000Z",
      }),
      makeThread({
        environmentId: remoteEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:10:00.000Z",
      }),
    ];

    const sorted = sortScopedProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.title)).toEqual(["Remote project", "Local project"]);
  });

  it("does not use archived threads as project activity", () => {
    const projects = [
      makeProject({
        id: ProjectId.make("project-visible"),
        title: "Visible project",
        updatedAt: "2026-03-09T10:01:00.000Z",
      }),
      makeProject({
        id: ProjectId.make("project-archived"),
        title: "Archived-only project",
        updatedAt: "2026-03-09T10:00:00.000Z",
      }),
    ];
    const threads = [
      makeThread({
        id: ThreadId.make("thread-visible"),
        projectId: ProjectId.make("project-visible"),
        updatedAt: "2026-03-09T10:02:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-archived"),
        projectId: ProjectId.make("project-archived"),
        updatedAt: "2026-03-09T10:10:00.000Z",
        archivedAt: "2026-03-09T10:11:00.000Z",
      }),
    ];

    const sorted = sortScopedProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.title)).toEqual([
      "Visible project",
      "Archived-only project",
    ]);
  });
});

describe("sortLogicalProjectsForSidebar", () => {
  it("uses saved order only in manual mode and activity order otherwise", () => {
    const olderProjectId = ProjectId.make("project-older");
    const newerProjectId = ProjectId.make("project-newer");
    const projects = [
      {
        ...makeProject({ id: olderProjectId, title: "Older project" }),
        projectKey: "logical-older",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: olderProjectId }],
      },
      {
        ...makeProject({ id: newerProjectId, title: "Newer project" }),
        projectKey: "logical-newer",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: newerProjectId }],
      },
    ];
    const threads = [
      makeThread({
        projectId: olderProjectId,
        updatedAt: "2026-03-09T10:01:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-newer"),
        projectId: newerProjectId,
        updatedAt: "2026-03-09T10:05:00.000Z",
      }),
    ];

    expect(sortLogicalProjectsForSidebar(projects, threads, "manual")).toEqual(projects);
    expect(
      sortLogicalProjectsForSidebar(projects, threads, "updated_at").map(
        (project) => project.projectKey,
      ),
    ).toEqual(["logical-newer", "logical-older"]);
  });
});

describe("sortSidebarV2ProjectGroups", () => {
  it("does not let a hidden subagent thread reorder projects", () => {
    const olderProjectId = ProjectId.make("project-older");
    const newerProjectId = ProjectId.make("project-newer");
    const olderRootThreadId = ThreadId.make("thread-older-root");
    const projects = [
      {
        ...makeProject({ id: olderProjectId, title: "A older project" }),
        projectKey: "logical-older",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: olderProjectId }],
      },
      {
        ...makeProject({ id: newerProjectId, title: "Z newer project" }),
        projectKey: "logical-newer",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: newerProjectId }],
      },
    ];
    const threads = [
      makeThread({
        id: olderRootThreadId,
        projectId: olderProjectId,
        updatedAt: "2026-03-09T10:01:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-newer-root"),
        projectId: newerProjectId,
        updatedAt: "2026-03-09T10:05:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-hidden-subagent"),
        projectId: olderProjectId,
        updatedAt: "2026-03-09T10:10:00.000Z",
        lineage: {
          rootThreadId: olderRootThreadId,
          parentThreadId: olderRootThreadId,
          relationshipToParent: "subagent",
        },
      }),
    ];

    expect(
      sortSidebarV2ProjectGroups(projects, threads, "updated_at").map(
        (project) => project.projectKey,
      ),
    ).toEqual(["logical-newer", "logical-older"]);
  });
});

describe("pinOrderKeyBetween", () => {
  it("produces keys that sort between their bounds", () => {
    const middle = pinOrderKeyBetween(null, null)!;
    const top = pinOrderKeyBetween(null, middle)!;
    const bottom = pinOrderKeyBetween(middle, null)!;
    expect(top < middle).toBe(true);
    expect(middle < bottom).toBe(true);

    const between = pinOrderKeyBetween(top, middle)!;
    expect(top < between && between < middle).toBe(true);
  });

  it("extends into new digits when bounds are adjacent", () => {
    const key = pinOrderKeyBetween("g", "h")!;
    expect("g" < key && key < "h").toBe(true);
  });

  it("stays strictly ordered under repeated top insertion", () => {
    let head: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      const key: string = pinOrderKeyBetween(null, head)!;
      expect(key).not.toBeNull();
      if (head !== null) expect(key < head).toBe(true);
      keys.push(key);
      head = key;
    }
    expect(new Set(keys).size).toBe(100);
  });

  it("stays strictly ordered under repeated middle insertion", () => {
    let low = pinOrderKeyBetween(null, null)!;
    let high = pinOrderKeyBetween(low, null)!;
    for (let i = 0; i < 100; i += 1) {
      const key: string = pinOrderKeyBetween(low, high)!;
      expect(low < key && key < high).toBe(true);
      if (i % 2 === 0) low = key;
      else high = key;
    }
  });

  it("returns null for corrupt or out-of-order bounds instead of throwing", () => {
    expect(pinOrderKeyBetween("z", "a")).toBeNull();
    expect(pinOrderKeyBetween("A!", null)).toBeNull();
    expect(pinOrderKeyBetween(null, "ma")).toBeNull();
    expect(pinOrderKeyBetween("m", "m")).toBeNull();
  });
});

describe("sortPinnedThreadsForSidebar", () => {
  const pinnable = (input: { id: string; createdAt: string; pinOrderKey?: string | null }) => ({
    id: input.id,
    createdAt: input.createdAt,
    pinOrderKey: input.pinOrderKey ?? null,
  });

  it("sorts keyed threads by key ahead of keyless threads in creation order", () => {
    const sorted = sortPinnedThreadsForSidebar([
      pinnable({ id: "keyless-old", createdAt: "2026-03-09T08:00:00.000Z" }),
      pinnable({ id: "second", createdAt: "2026-03-09T09:00:00.000Z", pinOrderKey: "t" }),
      pinnable({ id: "keyless-new", createdAt: "2026-03-09T12:00:00.000Z" }),
      pinnable({ id: "first", createdAt: "2026-03-09T07:00:00.000Z", pinOrderKey: "g" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual([
      "first",
      "second",
      "keyless-new",
      "keyless-old",
    ]);
  });

  it("breaks equal keys by id so raced writes render identically everywhere", () => {
    const sorted = sortPinnedThreadsForSidebar([
      pinnable({ id: "b", createdAt: "2026-03-09T10:00:00.000Z", pinOrderKey: "m" }),
      pinnable({ id: "a", createdAt: "2026-03-09T11:00:00.000Z", pinOrderKey: "m" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["a", "b"]);
  });
});

describe("resolveSidebarSweepKeys", () => {
  const ordered = ["a", "b", "c", "d", "blocked"];
  const canMarkDone = (key: string) => key !== "blocked";

  it("covers every row between the pressed row and the pointer, in either direction", () => {
    expect(resolveSidebarSweepKeys(ordered, "b", "b", canMarkDone)).toEqual(["b"]);
    expect(resolveSidebarSweepKeys(ordered, "b", "d", canMarkDone)).toEqual(["b", "c", "d"]);
    expect(resolveSidebarSweepKeys(ordered, "d", "a", canMarkDone)).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves out rows that cannot settle and rows that left the list", () => {
    expect(resolveSidebarSweepKeys(ordered, "c", "blocked", canMarkDone)).toEqual(["c", "d"]);
    expect(resolveSidebarSweepKeys(ordered, "gone", "a", canMarkDone)).toEqual([]);
  });
});

describe("navigation after parking a thread", () => {
  it.each([
    ["mark-done", "done", null, "thread", true],
    ["mark-done", "active", null, "thread", false],
    ["mark-done", "done", null, "other-thread", false],
    ["snooze", null, "2099-01-01T00:00:00.000Z", "thread", true],
    ["snooze", null, null, "thread", false],
    ["snooze", null, "2026-09-12T09:00:00.000Z", "thread", false],
    ["snooze", null, "2099-01-01T00:00:00.000Z", "thread", false, true],
    ["snooze", null, "2099-01-01T00:00:00.000Z", "other-thread", false],
  ] as const)(
    "%s with state %s / %s on %s navigates: %s",
    (
      action,
      doneOverride,
      snoozedUntil,
      currentThreadKey,
      expected,
      hasPendingApprovals: boolean = false,
    ) => {
      expect(
        shouldNavigateAfterThreadPark({
          threadKey: "thread",
          currentThreadKey,
          action,
          now: "2026-09-12T10:00:00.000Z",
          thread: {
            doneOverride,
            snoozedUntil,
            snoozedAt: null,
            session: null,
            latestTurn: null,
            hasPendingApprovals,
            hasPendingUserInput: false,
          },
        }),
      ).toBe(expected);
    },
  );
});

describe("unseen completion with background work", () => {
  it.each([
    { kind: "command", status: "ready", topStatus: "ready", receded: false, pill: "Completed" },
    { kind: "monitor", status: "waiting", topStatus: "waiting", receded: true, pill: "Waiting" },
  ] as const)("presents a completed thread with a $kind roster", (expected) => {
    const thread = presentThreadShell(localEnvironmentId, {
      ...makeThreadFixture().source,
      latestRunId: RunId.make("run-background-completion"),
      status: "completed",
      latestRunCompletedAt: DateTime.makeUnsafe("2026-06-20T01:00:00.000Z"),
      lastVisitedAt: DateTime.makeUnsafe("2026-06-20T00:59:00.000Z"),
      pendingBackgroundTasks: [{ taskId: "background-work", kind: expected.kind }],
    });
    const status = resolveSidebarThreadStatus(thread);
    const isUnread = hasUnseenCompletion(thread);

    expect(isUnread).toBe(true);
    expect(status).toBe(expected.status);
    expect(
      resolveSidebarV2TopStatus({ environmentConnected: true, status, isUnread, isWoke: false }),
    ).toBe(expected.topStatus);
    expect(
      shouldRecedeSidebarThread({
        status,
        isUnread,
        isWoke: false,
        isActive: false,
        isSelected: false,
      }),
    ).toBe(expected.receded);
    expect(isSidebarThreadWorking(thread)).toBe(expected.receded);
    expect(resolveThreadStatusPill({ thread })).toMatchObject({ label: expected.pill });
  });
});

describe("Working shelf", () => {
  const runtime = {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };
  const backgroundTask = { taskId: "bg-1", description: "Watch build", kind: "monitor" as const };
  const idle = {
    interactionMode: "default" as const,
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestRun: makeLatestRun(),
    runtime: null,
  };
  const waiting = {
    ...idle,
    runtime: { ...runtime, status: "idle" as const },
    pendingBackgroundTasks: [backgroundTask],
  };

  it("folds away running threads and threads waiting on background work only", () => {
    expect(isSidebarThreadWorking({ ...idle, runtime })).toBe(true);
    expect(isSidebarThreadWorking(waiting)).toBe(true);
    expect(isSidebarThreadWorking(idle)).toBe(false);
    expect(isSidebarThreadWorking({ ...idle, runtime, hasPendingApprovals: true })).toBe(false);
    expect(isSidebarThreadWorking({ ...idle, runtime, hasPendingUserInput: true })).toBe(false);
    expect(
      isSidebarThreadWorking({
        ...waiting,
        runtime: { ...runtime, status: "failed" as const, lastError: "boom" },
      }),
    ).toBe(false);
  });

  describe("sortInboxThreadsByReturn", () => {
    const thread = (
      id: string,
      input: { createdAt: string; completedAt?: string | null; reopenedAt?: string },
    ) => ({
      id: ThreadId.make(id),
      environmentId: localEnvironmentId,
      createdAt: input.createdAt,
      reopenedAt: input.reopenedAt ?? null,
      latestRun:
        input.completedAt === undefined
          ? null
          : { ...makeLatestRun({ completedAt: input.completedAt }), requestedAt: input.createdAt },
    });

    it("puts the thread that finished last on top, whatever its age", () => {
      const sorted = sortInboxThreadsByReturn([
        thread("new", { createdAt: "2026-03-09T11:00:00.000Z" }),
        thread("old-finished-now", {
          createdAt: "2026-03-01T09:00:00.000Z",
          completedAt: "2026-03-09T12:00:00.000Z",
        }),
        thread("reopened", {
          createdAt: "2026-03-02T09:00:00.000Z",
          reopenedAt: "2026-03-09T11:30:00.000Z",
        }),
      ]);
      expect(sorted.map((entry) => entry.id)).toEqual(["old-finished-now", "reopened", "new"]);
    });

    it("counts a return the server does not stamp, like an approval request", () => {
      const waiting = thread("asks-approval", {
        createdAt: "2026-03-09T09:00:00.000Z",
        completedAt: null,
      });
      const finished = thread("finished", {
        createdAt: "2026-03-09T09:30:00.000Z",
        completedAt: "2026-03-09T11:00:00.000Z",
      });
      expect(sortInboxThreadsByReturn([finished, waiting]).map((entry) => entry.id)).toEqual([
        "finished",
        "asks-approval",
      ]);
      expect(
        sortInboxThreadsByReturn([finished, waiting], (entry) =>
          entry === waiting ? Date.parse("2026-03-09T11:05:00.000Z") : undefined,
        ).map((entry) => entry.id),
      ).toEqual(["asks-approval", "finished"]);
    });
  });

  describe("dragging", () => {
    const marker = (name: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker: name });
    const row = (key: string, section: SidebarSection): SidebarListItem => ({
      kind: "thread",
      key,
      section,
    });
    // Pinned p1 | Active a1 a2 | Working w1 | Done s1
    const items: readonly SidebarListItem[] = [
      marker("pinned-header"),
      row("p1", "pinned"),
      marker("pinned-divider"),
      row("a1", "active"),
      row("a2", "active"),
      marker("working-header"),
      row("w1", "working"),
      marker("done-header"),
      row("s1", "done"),
    ];

    it("never drops into the Working shelf, and keeps it out of the inbox order", () => {
      expect(resolveSidebarDropTarget(items, "a1", "w1")).toBeNull();
      expect(resolveSidebarDropTarget(items, "p1", "a2")).toEqual({
        section: "active",
        pinnedOrder: [],
        activeOrder: ["a1", "a2", "p1"],
      });
      expect(resolveSidebarDropVerb("active", "working")).toBeNull();
    });

    it.each([
      ["pinned", "p1"],
      ["active", "a2"],
      ["done", "s1"],
    ] as const)(
      "does not move a Working thread into %s when its reference drag ends in the sidebar",
      (section, overKey) => {
        const target = resolveSidebarDropTarget(items, "w1", overKey);
        expect(target?.section).toBe(section);
        expect(
          planSidebarThreadDrop({
            activeKey: "w1",
            activeSection: "working",
            target: target!,
            pinnedOrder: ["p1"],
            pinnedKeysById: new Map([["p1", "m"]]),
          }),
        ).toEqual({ kind: "none" });
      },
    );

    it("arranges the pinned rows it can write when another row's server cannot store an order", () => {
      const plan = planSidebarThreadDrop({
        activeKey: "a2",
        activeSection: "pinned",
        target: {
          section: "pinned",
          pinnedOrder: ["offline", "a2", "a1"],
          activeOrder: [],
        },
        pinnedOrder: ["offline", "a1", "a2"],
        pinnedKeysById: new Map([
          ["offline", null],
          ["a1", null],
          ["a2", null],
        ]),
        reorderableKeys: new Set(["a1", "a2"]),
      });
      expect(plan.kind).toBe("reorder-pinned");
      if (plan.kind !== "reorder-pinned") return;
      expect(plan.assignments.map(({ id }) => id)).toEqual(["a2", "a1"]);
      const [a2, a1] = plan.assignments.map(({ orderKey }) => orderKey);
      expect(a2! < a1!).toBe(true);

      const above = planSidebarThreadDrop({
        activeKey: "a2",
        activeSection: "pinned",
        target: { section: "pinned", pinnedOrder: ["a2", "offline"], activeOrder: [] },
        pinnedOrder: ["offline", "a2"],
        pinnedKeysById: new Map([
          ["offline", "m"],
          ["a2", "t"],
        ]),
        reorderableKeys: new Set(["a2"]),
      });
      expect(above.kind === "reorder-pinned" && above.assignments[0]!.orderKey < "m").toBe(true);
    });

    it("only changes lifecycle when dropping into the time-ordered inbox", () => {
      const base = {
        pinnedOrder: ["p1"],
        pinnedKeysById: new Map([["p1", "m"]]),
      };
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "a1",
          activeSection: "active",
          target: { section: "active", pinnedOrder: ["p1"], activeOrder: ["a2", "a1"] },
        }),
      ).toEqual({ kind: "none" });
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "p1",
          activeSection: "pinned",
          target: { section: "active", pinnedOrder: [], activeOrder: ["a1", "p1", "a2"] },
        }),
      ).toEqual({
        kind: "move-active",
        unpin: true,
        reopen: false,
        unsnooze: false,
      });
      const intoActive = { section: "active", pinnedOrder: ["p1"], activeOrder: ["a1"] } as const;
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "s1",
          activeSection: "done",
          target: intoActive,
        }),
      ).toEqual({ kind: "move-active", unpin: false, reopen: true, unsnooze: false });
      // A snoozed thread keeps its pin beneath the shelf; Active clears both.
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "z1",
          activeSection: "snoozed",
          activePinned: true,
          target: intoActive,
        }),
      ).toEqual({ kind: "move-active", unpin: true, reopen: false, unsnooze: true });
    });
  });
});
