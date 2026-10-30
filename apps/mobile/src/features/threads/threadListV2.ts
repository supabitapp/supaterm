import {
  collapseThreadGroups,
  groupInboxThreadsByProject,
  type ThreadGroupingProject,
} from "@supaterm/client-runtime/state/thread-grouping";
import type { SidebarThreadGrouping } from "@supaterm/contracts";
import {
  canSnooze,
  effectiveSnoozed,
  hasQueuedTurnStart,
  pickSnoozePreset,
  QUEUED_TURN_START_GRACE_MS,
  resolveSnoozePresets,
  snoozeWakeLabel,
  threadWokeAt,
} from "@supaterm/client-runtime/state/thread-snooze";
import type { SnoozePreset } from "@supaterm/client-runtime/state/thread-snooze";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { resolveThreadProviderStack } from "@supaterm/client-runtime/state/models";
import {
  threadSearchMatchKey,
  threadSearchSubject,
} from "@supaterm/client-runtime/state/thread-search";
import {
  foldSearchQuery,
  rankSearchItems,
  scoreThreadSearch,
} from "@supaterm/shared/paletteSearch";
import {
  createInboxReturnTracker,
  isThreadWorking,
  sortInboxThreadsByReturn,
  sortWorkingThreadsBySend,
} from "@supaterm/client-runtime/state/thread-inbox";
import {
  sortActiveThreadsByOrderKey,
  resolveDoneThreadTimestamp,
  sortPinnedThreadsByOrderKey,
  sortDoneThreads,
} from "@supaterm/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectId } from "@supaterm/contracts";
import type { SnoozePresetSetting } from "@supaterm/contracts/settings";

import type { ThreadListProvider } from "../../state/thread-list-environments";

import { relativeTime } from "../../lib/time";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";

import {
  applyPendingThreadOrder,
  reconcilePendingThreadOrder,
  type PendingThreadOrder,
} from "./threadOrder";

export { snoozeWakeLabel };

/** When this device saw each thread leave the Working shelf. One instance for
    Home and the iPad sidebar, so both lists order the inbox the same way and
    the order survives screens that unmount. */
export const threadListInboxReturns = createInboxReturnTracker();

export function resolveThreadListV2ProviderDrivers(
  thread: Pick<EnvironmentThreadShell, "providerInstanceHistory" | "modelSelection" | "runtime">,
  providers: ReadonlyArray<ThreadListProvider> | undefined,
): ReadonlyArray<string> {
  if (providers === undefined) return [];
  const stack = resolveThreadProviderStack(thread);
  const drivers = stack.flatMap((instanceId) => {
    const driver = providers.find((provider) => provider.instanceId === instanceId)?.driver;
    return driver === undefined ? [] : [driver];
  });
  const currentDriver = providers.find(
    (provider) => provider.instanceId === stack[stack.length - 1],
  )?.driver;
  return currentDriver === undefined ? [] : drivers;
}

export type ThreadListV2Status =
  | "approval"
  | "input"
  | "request"
  | "working"
  | "waiting"
  | "failed"
  | "limited"
  | "ready";
export type ThreadListV2SwipeAction = "archive" | "mark-done" | "reopen" | "snooze" | "unsnooze";

/**
 * Presets for a row's snooze menu, read at the list's minute instead of the
 * clock: the compiler keys a row's memo on its inputs, so a clock read inside
 * it would keep the times from the row's first render.
 */
export function resolveThreadListV2SnoozePresets(input: {
  readonly secondary: "snooze" | null;
  readonly now: string;
  readonly presets: ReadonlyArray<SnoozePresetSetting> | undefined;
}): ReadonlyArray<SnoozePreset> {
  return input.secondary === "snooze"
    ? resolveSnoozePresets(new Date(input.now), presetOptions(input.presets))
    : [];
}

function presetOptions(presets: ReadonlyArray<SnoozePresetSetting> | undefined) {
  return presets ? { presets } : {};
}

export function resolveThreadListV2SnoozeMenuSelection(input: {
  readonly event: string;
  readonly displayedPresets: ReadonlyArray<SnoozePreset>;
  readonly now: Date;
  readonly presets: ReadonlyArray<SnoozePresetSetting> | undefined;
}):
  | { readonly _tag: "selected"; readonly preset: SnoozePreset }
  | { readonly _tag: "expired" }
  | { readonly _tag: "not-snooze" } {
  if (!input.event.startsWith("snooze:")) return { _tag: "not-snooze" };
  const preset = pickSnoozePreset({
    shown: input.displayedPresets,
    id: input.event.slice("snooze:".length),
    now: input.now,
    ...presetOptions(input.presets),
  });
  return preset ? { _tag: "selected", preset } : { _tag: "expired" };
}

export function resolveThreadListV2SwipeActions(input: {
  readonly variant: "card" | "slim";
  readonly markDoneSupported: boolean;
  readonly snoozeSupported: boolean;
  readonly snoozable: boolean;
  readonly snoozed?: boolean;
}): {
  readonly primary: Exclude<ThreadListV2SwipeAction, "snooze">;
  readonly secondary: "snooze" | "mark-done" | null;
} {
  if (input.snoozed === true) {
    return { primary: "unsnooze", secondary: input.markDoneSupported ? "mark-done" : null };
  }
  const primary = input.markDoneSupported
    ? input.variant === "slim"
      ? "reopen"
      : "mark-done"
    : "archive";
  return {
    primary,
    secondary: input.snoozeSupported && input.snoozable ? "snooze" : null,
  };
}

export function resolveThreadListV2SnoozeGateExpiryMs(
  thread: Pick<
    EnvironmentThreadShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "pendingSubagentRequest"
    | "latestRun"
    | "latestUserMessageAt"
    | "runtime"
  >,
  options: { readonly now: string },
): number | null {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return null;
  if (thread.pendingSubagentRequest != null) return null;
  if (!hasQueuedTurnStart(thread, options)) return null;
  const messageAtMs = Date.parse(thread.latestUserMessageAt ?? "");
  if (Number.isNaN(messageAtMs)) return null;
  return messageAtMs + QUEUED_TURN_START_GRACE_MS;
}

// Done-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more. Shared by the compact Home list and
// the iPad sidebar so both page identically.
export const THREAD_LIST_V2_DONE_INITIAL_COUNT = 10;
export const THREAD_LIST_V2_DONE_PAGE_COUNT = 25;

export function threadHasUnseenCompletion(
  thread: Pick<EnvironmentThreadShell, "latestRun" | "lastVisitedAt">,
): boolean {
  const completedAt = thread.latestRun?.completedAt;
  if (!completedAt) return false;
  const completedAtMs = Date.parse(completedAt);
  if (Number.isNaN(completedAtMs)) return false;
  if (!thread.lastVisitedAt) return false;
  const lastVisitedAtMs = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAtMs)) return true;
  return completedAtMs > lastVisitedAtMs;
}

export function resolveThreadListV2WokeAt(
  thread: EnvironmentThreadShell,
  options: { readonly now: string },
): string | null {
  if (thread.doneOverride === "done") return null;
  const wokeAt = threadWokeAt(thread, options);
  const wokeAtMs = Date.parse(wokeAt ?? "");
  const lastVisitedAtMs = Date.parse(thread.lastVisitedAt ?? "");
  return !Number.isNaN(wokeAtMs) && (Number.isNaN(lastVisitedAtMs) || lastVisitedAtMs < wokeAtMs)
    ? wokeAt
    : null;
}

export function resolveThreadListV2Status(
  thread: Pick<
    EnvironmentThreadShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "pendingSubagentRequest"
    | "pendingGuestMessageCount"
    | "runtime"
    | "blockedOnThreadWait"
  >,
): ThreadListV2Status {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") {
    return "approval";
  }
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") {
    return "input";
  }
  // A guest is waiting on the owner; the agent's own requests come first.
  if ((thread.pendingGuestMessageCount ?? 0) > 0) {
    return "request";
  }
  if (thread.runtime?.status === "running" && thread.blockedOnThreadWait === true) {
    return "waiting";
  }
  if (
    thread.runtime !== null &&
    ["preparing", "queued", "starting", "running", "waiting"].includes(thread.runtime.status)
  ) {
    return "working";
  }
  if (thread.runtime?.status === "idle") {
    return "waiting";
  }
  if (thread.runtime?.status === "failed") {
    return thread.runtime.lastErrorClass === "usage_limit" ? "limited" : "failed";
  }
  return "ready";
}

function parseTimestampMs(isoDate: string): number {
  const parsed = Date.parse(isoDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Canonical card section for arranging, independent of search or scope. */
export function getThreadListV2OrderedSection(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly section: "pinned" | "active";
  readonly pendingOrder?: PendingThreadOrder | null;
  readonly now: string;
  readonly queuedThreadKeys?: ReadonlySet<string>;
}): EnvironmentThreadShell[] {
  const queuedThreadKeys = input.queuedThreadKeys?.size ? input.queuedThreadKeys : undefined;
  const threads = input.threads.filter((thread) => {
    if (thread.archivedAt !== null || thread.lineage.relationshipToParent === "subagent")
      return false;
    if (
      thread.doneOverride === "done" &&
      queuedThreadKeys?.has(`${thread.environmentId}:${thread.id}`) !== true
    ) {
      return false;
    }
    if (effectiveSnoozed(thread, { now: input.now })) {
      return false;
    }
    return (thread.pinnedAt != null) === (input.section === "pinned");
  });
  const ordered =
    input.section === "pinned"
      ? sortPinnedThreadsByOrderKey(threads)
      : sortActiveThreadsByOrderKey(threads);
  const pending =
    input.pendingOrder?.section === input.section
      ? reconcilePendingThreadOrder(input.pendingOrder, ordered)
      : null;
  return applyPendingThreadOrder(ordered, input.section, pending);
}

export interface ThreadListV2Item {
  readonly thread: EnvironmentThreadShell;
  readonly variant: "card" | "slim";
  readonly snoozed: boolean;
  readonly pinned: boolean;
  readonly wokeAt: string | null;
  readonly isLast: boolean;
}

export interface ThreadListV2InboxGroup {
  readonly key: string;
  readonly label: string;
  readonly projectKey: string | null;
  /** Threads in the group, including rows hidden by collapse. */
  readonly count: number;
  readonly collapsed: boolean;
  /** Rows of `items` the group renders, starting where the previous group ended. */
  readonly rowCount: number;
}

export interface ThreadListV2Layout {
  readonly items: ThreadListV2Item[];
  /** Done threads beyond the render limit (behind "Show more"). */
  readonly hiddenDoneCount: number;
  readonly listedSettledThreads: ReadonlyArray<EnvironmentThreadShell>;
  /** Pinned threads in scope, including collapsed rows. */
  readonly pinnedCount: number;
  readonly activeCount: number;
  /** Working threads folded into the Working shelf. */
  readonly workingCount: number;
  readonly workingShelfHeaderIndex: number | null;
  /** Headers for the inbox rows when grouping by project or update time. */
  readonly inboxGroups: readonly ThreadListV2InboxGroup[] | null;
  readonly snoozedCount: number;
  readonly snoozedShelfHeaderIndex: number | null;
  /** Total done threads in scope, including rows hidden by collapse/paging. */
  readonly doneCount: number;
  /** Index in `items` where the Done shelf header belongs. */
  readonly doneShelfHeaderIndex: number | null;
  /** Soonest wake time among snoozed threads, or null. Callers arm
      a timeout at this boundary so the list re-partitions the moment a
      snooze expires instead of on the next minute tick. */
  readonly nextSnoozeWakeAt: string | null;
  /** Threads listed only because their messages match the search. */
  readonly contentOnlyThreadKeys: ReadonlySet<string>;
  readonly searching: boolean;
}

export interface ThreadListV2ThreadListItem {
  readonly type: "v2-thread";
  readonly key: string;
  readonly item: ThreadListV2Item;
  readonly snoozeWakeLabelText: string | undefined;
  readonly timeLabel: string;
  readonly snoozePresetMinute: string | undefined;
  readonly showTrailingDivider: boolean;
  readonly showProjectIcon: boolean;
  /**
   * Carried on the item so an outbox write (which never touches the thread
   * shell) reaches the row through recycled-list equality instead of leaving a
   * stale icon.
   */
  readonly hasQueuedMessages: boolean;
}

export interface ThreadListV2PendingListItem {
  readonly type: "v2-pending";
  readonly key: string;
  readonly pendingTask: PendingNewTask;
  /** The first draft or queued row draws its section's divider. */
  readonly showPendingDivider: boolean;
  readonly showTrailingDivider: boolean;
}

export interface ThreadListV2PinnedShelfListItem {
  readonly type: "v2-pinned-shelf";
  readonly key: "v2-pinned-shelf"; // gitleaks:allow -- static list item identity
  readonly count: number;
  readonly expanded: boolean;
  readonly disabled: boolean;
}

export interface ThreadListV2ActiveHeaderListItem {
  readonly type: "v2-active-header";
  readonly key: "v2-active-header";
  readonly count: number;
  readonly expanded: boolean;
  readonly disabled: boolean;
}

export interface ThreadListV2ShowMoreListItem {
  readonly type: "v2-show-more";
  readonly key: "v2-show-more";
  readonly hiddenCount: number;
}

export interface ThreadListV2WorkingShelfListItem {
  readonly type: "v2-working-shelf";
  readonly key: "v2-working-shelf";
  readonly count: number;
  readonly expanded: boolean;
  readonly disabled: boolean;
}

export interface ThreadListV2SnoozedShelfListItem {
  readonly type: "v2-snoozed-shelf";
  readonly key: "v2-snoozed-shelf";
  readonly count: number;
  readonly expanded: boolean;
  /**
   * Carried on the item because a recycled cell ignores the render closure —
   * without it the header would stay visibly disabled (or enabled too early)
   * after the preference load lands.
   */
  readonly disabled: boolean;
}

export interface ThreadListV2DoneShelfListItem {
  readonly type: "v2-done-shelf";
  readonly key: "v2-done-shelf";
  readonly count: number;
  readonly expanded: boolean;
  readonly disabled: boolean;
}

export interface ThreadListV2GroupHeaderListItem {
  readonly type: "v2-group-header";
  readonly key: string;
  readonly groupKey: string;
  readonly label: string;
  readonly projectKey: string | null;
  readonly count: number;
  readonly expanded: boolean;
  readonly disabled: boolean;
}

export type ThreadListV2ListItem =
  | ThreadListV2GroupHeaderListItem
  | ThreadListV2ThreadListItem
  | ThreadListV2PendingListItem
  | ThreadListV2PinnedShelfListItem
  | ThreadListV2ActiveHeaderListItem
  | ThreadListV2WorkingShelfListItem
  | ThreadListV2SnoozedShelfListItem
  | ThreadListV2DoneShelfListItem
  | ThreadListV2ShowMoreListItem;

/**
 * Item objects are rebuilt on every minute tick and every partition run;
 * without this the lists would consider every mounted row changed and re-render
 * all of them (each carrying a swipeable + a PR subscription).
 */
export function threadListV2ListItemsAreEqual(
  previous: ThreadListV2ListItem,
  item: ThreadListV2ListItem,
): boolean {
  switch (item.type) {
    case "v2-group-header":
      return (
        previous.type === item.type &&
        previous.key === item.key &&
        previous.label === item.label &&
        previous.projectKey === item.projectKey &&
        previous.count === item.count &&
        previous.expanded === item.expanded &&
        previous.disabled === item.disabled
      );
    case "v2-thread":
      return (
        previous.type === "v2-thread" &&
        previous.key === item.key &&
        previous.item.thread === item.item.thread &&
        previous.item.variant === item.item.variant &&
        previous.item.snoozed === item.item.snoozed &&
        previous.item.pinned === item.item.pinned &&
        previous.item.wokeAt === item.item.wokeAt &&
        previous.snoozeWakeLabelText === item.snoozeWakeLabelText &&
        previous.timeLabel === item.timeLabel &&
        previous.snoozePresetMinute === item.snoozePresetMinute &&
        previous.showTrailingDivider === item.showTrailingDivider &&
        previous.showProjectIcon === item.showProjectIcon &&
        previous.hasQueuedMessages === item.hasQueuedMessages
      );
    case "v2-pending":
      return (
        previous.type === "v2-pending" &&
        previous.key === item.key &&
        previous.pendingTask === item.pendingTask &&
        previous.showPendingDivider === item.showPendingDivider &&
        previous.showTrailingDivider === item.showTrailingDivider
      );
    case "v2-active-header":
    case "v2-pinned-shelf":
    case "v2-working-shelf":
    case "v2-snoozed-shelf":
    case "v2-done-shelf":
      return (
        previous.type === item.type &&
        previous.count === item.count &&
        previous.expanded === item.expanded &&
        previous.disabled === item.disabled
      );
    case "v2-show-more":
      return previous.type === item.type && previous.hiddenCount === item.hiddenCount;
  }
}

/** The timestamp a row renders when it shows no status label: the done
    stamp on done slim rows, otherwise the latest activity. Blank for
    status-labelled cards and snoozed rows with a wake countdown — those
    never draw a time, so their minute tick must not invalidate the cell. */
function resolveThreadListV2ItemTimeLabel(
  item: ThreadListV2Item,
  showSnoozeWakeLabel: boolean,
): string {
  const { thread, variant, snoozed } = item;
  if (showSnoozeWakeLabel) return "";
  if (
    variant === "card" &&
    (resolveThreadListV2Status(thread) !== "ready" ||
      item.wokeAt !== null ||
      threadHasUnseenCompletion(thread))
  )
    return "";
  const doneTimestamp = variant === "slim" && !snoozed ? resolveDoneThreadTimestamp(thread) : null;
  return relativeTime(
    doneTimestamp ?? thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
  );
}

export function buildThreadListV2ListItems(input: {
  readonly items: ReadonlyArray<ThreadListV2Item>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly pinnedCount?: number;
  readonly pinnedShelfExpanded?: boolean;
  readonly activeCount?: number;
  readonly activeShelfExpanded?: boolean;
  readonly workingCount?: number;
  readonly workingShelfExpanded?: boolean;
  readonly workingShelfHeaderIndex?: number | null;
  readonly inboxGroups?: readonly ThreadListV2InboxGroup[] | null;
  readonly snoozedCount?: number;
  readonly snoozedShelfExpanded?: boolean;
  readonly snoozedShelfHeaderIndex?: number | null;
  readonly doneCount?: number;
  readonly doneShelfExpanded?: boolean;
  readonly doneShelfHeaderIndex?: number | null;
  readonly hiddenDoneCount?: number;
  readonly snoozeLabelNow?: string;
  readonly loadedEnvironmentIds?: ReadonlySet<EnvironmentId>;
  readonly queuedThreadKeys?: ReadonlySet<string>;
  readonly shelfPreferencesLoading?: boolean;
  readonly searching?: boolean;
}): ThreadListV2ListItem[] {
  const queuedThreadKeys = input.queuedThreadKeys?.size ? input.queuedThreadKeys : undefined;
  const threadItems = input.items.map((item): ThreadListV2ThreadListItem => {
    const snoozeWakeLabelText =
      item.snoozed && item.thread.snoozedUntil != null && input.snoozeLabelNow !== undefined
        ? snoozeWakeLabel(item.thread.snoozedUntil, { now: input.snoozeLabelNow })
        : undefined;
    // The minute clock belongs on the item, not the list's extraData, so the
    // recycler's equality can confine the per-minute re-render to rows whose
    // snooze menu actually shows preset times.
    const snoozePresetMinute =
      !item.snoozed &&
      input.snoozeLabelNow !== undefined &&
      (input.loadedEnvironmentIds?.has(item.thread.environmentId) ?? true) &&
      canSnooze(item.thread, { now: input.snoozeLabelNow })
        ? input.snoozeLabelNow
        : undefined;
    return {
      type: "v2-thread",
      key: `v2-thread:${item.thread.environmentId}:${item.thread.id}`,
      item,
      snoozeWakeLabelText,
      timeLabel: resolveThreadListV2ItemTimeLabel(item, snoozeWakeLabelText !== undefined),
      snoozePresetMinute,
      showTrailingDivider: false,
      showProjectIcon: true,
      hasQueuedMessages:
        queuedThreadKeys?.has(`${item.thread.environmentId}:${item.thread.id}`) === true,
    };
  });
  const pendingItems: ThreadListV2PendingListItem[] = [];
  const draftItems: ThreadListV2PendingListItem[] = [];
  for (const pendingTask of input.pendingTasks) {
    const sectionItems = pendingTask.kind === "draft" ? draftItems : pendingItems;
    sectionItems.push({
      type: "v2-pending",
      key: `v2-${pendingTask.key}`,
      pendingTask,
      showPendingDivider: sectionItems.length === 0,
      showTrailingDivider: false,
    });
  }
  if (input.searching) return [...draftItems, ...pendingItems, ...threadItems];
  const workingCount = input.workingCount ?? 0;
  const workingShelfHeaderIndex = input.workingShelfHeaderIndex ?? null;
  const snoozedCount = input.snoozedCount ?? 0;
  const snoozedShelfHeaderIndex = input.snoozedShelfHeaderIndex ?? null;
  const doneCount = input.doneCount ?? 0;
  const doneShelfHeaderIndex = input.doneShelfHeaderIndex ?? null;
  const hiddenDoneCount = input.hiddenDoneCount ?? 0;
  const snoozedEnd = doneShelfHeaderIndex ?? threadItems.length;
  const workingEnd = snoozedShelfHeaderIndex ?? snoozedEnd;
  const activeEnd = workingShelfHeaderIndex ?? workingEnd;
  const pinnedEnd = input.items.filter((item) => item.pinned).length;
  const pinnedCount = input.pinnedCount ?? pinnedEnd;
  const activeCount = input.activeCount ?? activeEnd - pinnedEnd;
  const shelfDisabled = input.shelfPreferencesLoading === true;
  const result: ThreadListV2ListItem[] = [];
  if (pinnedCount > 0) {
    result.push({
      type: "v2-pinned-shelf",
      key: "v2-pinned-shelf", // gitleaks:allow -- static list item identity
      count: pinnedCount,
      expanded: input.pinnedShelfExpanded !== false,
      disabled: shelfDisabled,
    });
    result.push(...threadItems.slice(0, pinnedEnd));
  }
  result.push(...draftItems);
  if (activeCount > 0 || pendingItems.length > 0) {
    result.push({
      type: "v2-active-header",
      key: "v2-active-header",
      count: activeCount + pendingItems.length,
      expanded: input.activeShelfExpanded !== false,
      disabled: shelfDisabled,
    });
    if (input.activeShelfExpanded !== false) result.push(...pendingItems);
    if (input.inboxGroups == null) {
      result.push(...threadItems.slice(pinnedEnd, activeEnd));
    } else {
      let index = pinnedEnd;
      for (const group of input.inboxGroups) {
        result.push({
          type: "v2-group-header",
          key: `v2-group:${group.key}`,
          groupKey: group.key,
          label: group.label,
          projectKey: group.projectKey,
          count: group.count,
          expanded: !group.collapsed,
          disabled: shelfDisabled,
        });
        const rows = threadItems.slice(index, index + group.rowCount);
        result.push(
          ...(group.projectKey === null
            ? rows
            : rows.map((row) => ({ ...row, showProjectIcon: false }))),
        );
        index += group.rowCount;
      }
    }
  }
  if (workingShelfHeaderIndex !== null && workingCount > 0) {
    result.push({
      type: "v2-working-shelf",
      key: "v2-working-shelf",
      count: workingCount,
      expanded: input.workingShelfExpanded === true,
      disabled: shelfDisabled,
    });
    result.push(...threadItems.slice(workingShelfHeaderIndex, workingEnd));
  }
  if (snoozedShelfHeaderIndex !== null && snoozedCount > 0) {
    result.push({
      type: "v2-snoozed-shelf",
      key: "v2-snoozed-shelf",
      count: snoozedCount,
      expanded: input.snoozedShelfExpanded === true,
      disabled: shelfDisabled,
    });
    result.push(...threadItems.slice(snoozedShelfHeaderIndex, snoozedEnd));
  }
  if (doneShelfHeaderIndex !== null && doneCount > 0) {
    result.push({
      type: "v2-done-shelf",
      key: "v2-done-shelf",
      count: doneCount,
      expanded: input.doneShelfExpanded !== false,
      disabled: shelfDisabled,
    });
    result.push(...threadItems.slice(doneShelfHeaderIndex));
    if (input.doneShelfExpanded !== false && hiddenDoneCount > 0) {
      result.push({
        type: "v2-show-more",
        key: "v2-show-more",
        hiddenCount: hiddenDoneCount,
      });
    }
  }
  return result.map((entry, index) => {
    if (entry.type !== "v2-thread" && entry.type !== "v2-pending") return entry;
    const next = result[index + 1];
    const showTrailingDivider =
      next?.type === "v2-thread" || (next?.type === "v2-pending" && !next.showPendingDivider);
    return showTrailingDivider === entry.showTrailingDivider
      ? entry
      : { ...entry, showTrailingDivider };
  });
}

let lastDoneInput: ReadonlyArray<EnvironmentThreadShell> = [];
let lastDoneOutput: ReadonlyArray<EnvironmentThreadShell> = [];

function sortDoneThreadsReusingLast(
  done: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  if (done.length === lastDoneInput.length) {
    let same = true;
    for (let index = 0; index < done.length; index += 1) {
      if (done[index] !== lastDoneInput[index]) {
        same = false;
        break;
      }
    }
    if (same) return lastDoneOutput;
  }
  lastDoneInput = done;
  lastDoneOutput = sortDoneThreads(done);
  return lastDoneOutput;
}

export function buildThreadListV2Items(input: {
  readonly grouping?: SidebarThreadGrouping;
  readonly groupingProjects?: readonly ThreadGroupingProject[];
  readonly pendingOrder?: PendingThreadOrder | null;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs?: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }> | null;
  readonly searchQuery: string;
  readonly matchedThreadKeys?: ReadonlySet<string>;
  /** Max done rows to render; the rest are counted, not built. */
  readonly doneLimit?: number;
  readonly now: string;
  /** Pins are expanded by default. The selected row stays visible when collapsed. */
  readonly pinnedShelfExpanded?: boolean;
  readonly activeShelfExpanded?: boolean;
  readonly workingShelfExpanded?: boolean;
  /** Group keys collapsed to their header. The selected row stays visible. */
  readonly collapsedGroups?: readonly string[];
  /** Returns this device observed but the server does not stamp, such as an
      approval request mid-turn. */
  readonly isWorking?: (thread: EnvironmentThreadShell) => boolean;
  readonly inboxReturnAt?: (thread: EnvironmentThreadShell) => number | undefined;
  readonly snoozedShelfExpanded?: boolean;
  /** Expands the done shelf into rows. Expanded is the default. */
  readonly doneShelfExpanded?: boolean;
  readonly selectedThreadKey?: string | null;
  /** Thread keys (`environmentId:threadId`) with a message waiting in the
      outbox. Such a thread has work the user is waiting on, so it stays in
      the active block even when the server has done it. */
  readonly queuedThreadKeys?: ReadonlySet<string>;
  /** Whether the shelf may list a settled row yet; older settled rows load in pages. */
  readonly isListedSettled?: (thread: EnvironmentThreadShell) => boolean;
  /** Settled threads in scope that are not local (older settled threads not loaded). */
  readonly unloadedSettledCount?: number;
}): ThreadListV2Layout {
  const now = input.now;
  const pending =
    input.pendingOrder == null
      ? null
      : reconcilePendingThreadOrder(
          input.pendingOrder,
          getThreadListV2OrderedSection({
            ...input,
            section: input.pendingOrder.section,
            pendingOrder: null,
          }),
        );
  const query = foldSearchQuery(input.searchQuery);
  const nowMs = Date.parse(now);
  const projectKeys = input.projectRefs
    ? new Set(input.projectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`))
    : null;

  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  const done: EnvironmentThreadShell[] = [];
  const snoozed: EnvironmentThreadShell[] = [];
  let nextSnoozeWakeAt: string | null = null;

  const queuedThreadKeys = input.queuedThreadKeys?.size ? input.queuedThreadKeys : undefined;
  const listedThreads = input.threads.filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.lineage.relationshipToParent !== "subagent" &&
      (input.environmentId === null || thread.environmentId === input.environmentId) &&
      (projectKeys === null || projectKeys.has(`${thread.environmentId}:${thread.projectId}`)),
  );
  // The same matches as the command palette, typo fallback included. Only
  // listed threads are ranked: a hidden exact match must not turn typos off.
  const rankedMatches =
    query.length > 0
      ? rankSearchItems(listedThreads, (thread, options) =>
          scoreThreadSearch(query, threadSearchSubject(thread, null), nowMs, {
            ...options,
            picks: false,
          }),
        ).map(({ item }) => item)
      : null;
  const matchingThreads = rankedMatches === null ? null : new Set(rankedMatches);
  // Threads listed only because their messages match; only their rows show
  // the message and open at it.
  const contentOnlyThreadKeys = new Set<string>();
  for (const thread of listedThreads) {
    if (matchingThreads !== null && !matchingThreads.has(thread)) {
      const key = threadSearchMatchKey({
        environmentId: thread.environmentId,
        threadId: thread.id,
      });
      if (input.matchedThreadKeys?.has(key) !== true) continue;
      contentOnlyThreadKeys.add(key);
    }
    // Snooze outranks completion and pinning until the thread wakes.
    if (effectiveSnoozed(thread, { now })) {
      snoozed.push(thread);
      if (
        thread.snoozedUntil != null &&
        (nextSnoozeWakeAt === null ||
          parseTimestampMs(thread.snoozedUntil) < parseTimestampMs(nextSnoozeWakeAt))
      ) {
        nextSnoozeWakeAt = thread.snoozedUntil;
      }
      continue;
    }
    const hasQueuedMessages =
      queuedThreadKeys?.has(`${thread.environmentId}:${thread.id}`) === true;
    if (thread.doneOverride === "done" && !hasQueuedMessages) {
      done.push(thread);
    } else if (thread.pinnedAt != null) {
      pinned.push(thread);
    } else if ((input.isWorking ?? isThreadWorking)(thread)) {
      working.push(thread);
    } else {
      active.push(thread);
    }
  }

  if (rankedMatches !== null) {
    // Searching lists every match by rank across shelves, as the palette and
    // the web sidebar do, then threads listed for their messages in the
    // server's order. Each row keeps its shelf's look.
    const slim = new Set([...snoozed, ...done]);
    const snoozedThreads = new Set(snoozed);
    const pinnedThreads = new Set(pinned);
    const threadByKey = new Map(
      listedThreads.map((thread) => [
        threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
        thread,
      ]),
    );
    const contentOnly = [...(input.matchedThreadKeys ?? [])].flatMap((key) => {
      const thread = contentOnlyThreadKeys.has(key) ? threadByKey.get(key) : undefined;
      return thread ? [thread] : [];
    });
    const results = [...rankedMatches, ...contentOnly];
    return {
      items: results.map((thread, index) => ({
        thread,
        variant: slim.has(thread) ? "slim" : "card",
        snoozed: snoozedThreads.has(thread),
        pinned: pinnedThreads.has(thread),
        wokeAt: slim.has(thread) ? null : resolveThreadListV2WokeAt(thread, { now }),
        isLast: index === results.length - 1,
      })),
      searching: true,
      hiddenDoneCount: 0,
      listedSettledThreads: [],
      pinnedCount: 0,
      activeCount: 0,
      inboxGroups: null,
      workingCount: 0,
      workingShelfHeaderIndex: null,
      snoozedCount: 0,
      snoozedShelfHeaderIndex: null,
      doneCount: 0,
      doneShelfHeaderIndex: null,
      nextSnoozeWakeAt,
      contentOnlyThreadKeys,
    };
  }

  // The inbox orders by when each thread came back to the user, not the saved
  // arrangement.
  const grouping = input.grouping ?? "status";
  const selectedThreadKey = input.selectedThreadKey ?? null;
  const groups =
    grouping === "status"
      ? null
      : collapseThreadGroups(
          groupInboxThreadsByProject({
            threads: [...active, ...working],
            projects: input.groupingProjects ?? [],
          }),
          new Set(input.collapsedGroups),
          (thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey,
        );
  const orderedInbox =
    groups === null
      ? sortInboxThreadsByReturn(active, input.inboxReturnAt)
      : groups.flatMap((group) => group.threads);
  const inboxCount = groups === null ? active.length : active.length + working.length;
  const orderedWorking = groups === null ? sortWorkingThreadsBySend(working) : [];
  const orderedSnoozed = [...snoozed].sort(
    (left, right) =>
      parseTimestampMs(left.snoozedUntil ?? "") - parseTimestampMs(right.snoozedUntil ?? ""),
  );
  const visibleInbox =
    input.activeShelfExpanded !== false
      ? orderedInbox
      : orderedInbox.filter(
          (thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey,
        );
  const visibleWorking =
    input.workingShelfExpanded === true
      ? orderedWorking
      : orderedWorking.filter(
          (thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey,
        );
  const visibleSnoozed =
    input.snoozedShelfExpanded === true
      ? orderedSnoozed
      : orderedSnoozed.filter(
          (thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey,
        );
  const orderedDone = sortDoneThreadsReusingLast(done);
  const listedSettled =
    input.isListedSettled === undefined ? orderedDone : orderedDone.filter(input.isListedSettled);
  const settledTotal = orderedDone.length + (input.unloadedSettledCount ?? 0);
  const doneLimit = input.doneLimit ?? Number.POSITIVE_INFINITY;
  const limitedDone =
    listedSettled.length > doneLimit ? listedSettled.slice(0, doneLimit) : listedSettled;
  const selectedDone =
    selectedThreadKey === null ||
    limitedDone.some((thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey)
      ? undefined
      : orderedDone.find((thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey);
  const pagedDone = selectedDone === undefined ? limitedDone : [...limitedDone, selectedDone];
  const visibleDone =
    input.doneShelfExpanded !== false
      ? pagedDone
      : pagedDone.filter((thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey);

  const items: ThreadListV2Item[] = [];
  const orderedPinned = applyPendingThreadOrder(
    sortPinnedThreadsByOrderKey(pinned),
    "pinned",
    pending,
  );
  const visiblePinned =
    input.pinnedShelfExpanded !== false
      ? orderedPinned
      : orderedPinned.filter(
          (thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey,
        );
  for (const thread of visiblePinned) {
    items.push({
      thread,
      variant: "card",
      snoozed: false,
      pinned: true,
      wokeAt: resolveThreadListV2WokeAt(thread, { now }),
      isLast: false,
    });
  }
  for (const thread of visibleInbox) {
    items.push({
      thread,
      variant: "card",
      snoozed: false,
      pinned: false,
      wokeAt: resolveThreadListV2WokeAt(thread, { now }),
      isLast: false,
    });
  }
  const workingShelfHeaderIndex = orderedWorking.length > 0 ? items.length : null;
  for (const thread of visibleWorking) {
    items.push({
      thread,
      variant: "card",
      snoozed: false,
      pinned: false,
      wokeAt: resolveThreadListV2WokeAt(thread, { now }),
      isLast: false,
    });
  }
  const snoozedShelfHeaderIndex = orderedSnoozed.length > 0 ? items.length : null;
  for (const thread of visibleSnoozed) {
    items.push({
      thread,
      variant: "slim",
      snoozed: true,
      pinned: false,
      wokeAt: null,
      isLast: false,
    });
  }
  const doneShelfHeaderIndex = settledTotal > 0 ? items.length : null;
  for (const thread of visibleDone) {
    items.push({
      thread,
      variant: "slim",
      snoozed: false,
      pinned: false,
      wokeAt: null,
      isLast: false,
    });
  }
  const last = items.at(-1);
  if (last) {
    items[items.length - 1] = { ...last, isLast: true };
  }
  return {
    items,
    searching: false,
    pinnedCount: pinned.length,
    activeCount: inboxCount,
    hiddenDoneCount: Math.max(0, settledTotal - pagedDone.length),
    listedSettledThreads: listedSettled,
    workingCount: orderedWorking.length,
    workingShelfHeaderIndex,
    inboxGroups:
      groups === null || input.activeShelfExpanded === false
        ? null
        : groups.map((group) => ({
            key: group.key,
            label: group.label,
            projectKey: group.projectKey,
            count: group.count,
            collapsed: group.collapsed,
            rowCount: group.threads.length,
          })),
    snoozedCount: orderedSnoozed.length,
    snoozedShelfHeaderIndex,
    doneCount: settledTotal,
    doneShelfHeaderIndex,
    nextSnoozeWakeAt,
    contentOnlyThreadKeys,
  };
}

export function nextSnoozeWakeAfter(
  threads: ReadonlyArray<{ readonly snoozedUntil?: string | null }>,
  nowMs: number,
): number | null {
  let next: number | null = null;
  for (const thread of threads) {
    if (thread.snoozedUntil == null) continue;
    const wakeAtMs = Date.parse(thread.snoozedUntil);
    if (wakeAtMs > nowMs && (next === null || wakeAtMs < next)) next = wakeAtMs;
  }
  return next;
}
