import {
  SidebarDragBoundary,
  SidebarSectionHeader,
  SidebarSectionPlaceholder,
  SIDEBAR_DRAG_LABEL_HEIGHT,
} from "./sidebar/SidebarListMarkers";
import {
  buildSidebarInboxItems,
  buildSidebarListItems,
  previewDraggedInbox,
  threadShellKey,
  sidebarListLayoutKey,
} from "./Sidebar.list";
import {
  toggleCollapsedThreadGroup,
  type ThreadGroupingProject,
} from "@supaterm/client-runtime/state/thread-grouping";
import type { SidebarThreadGrouping } from "@supaterm/contracts/settings";
import { SidebarPendingThreadRow } from "./SidebarPendingThreadRow";
import { useThreadOutbox } from "../state/threadOutbox";
import { type EnvironmentId, type ScopedProjectRef } from "@supaterm/contracts";
import type { EnvironmentServerConfig } from "@supaterm/client-runtime/connection";
import { ThreadContextDragGhost } from "./chat/ThreadContextDragGhost";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag as moveThreadContextDragGhost,
} from "./chat/threadContextDrag";
import { discardComposerDraft } from "../lib/discardComposerDraft";
import { requestCustomSnooze } from "./CustomSnoozeDialog";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import {
  DndContext,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  canSnooze,
  effectiveSnoozed,
  threadWokeAt,
} from "@supaterm/client-runtime/state/thread-snooze";
import { createInboxReturnTracker } from "@supaterm/client-runtime/state/thread-inbox";
import { sortDoneThreads } from "@supaterm/client-runtime/state/thread-sort";
import {
  threadRuntimeCanArchive,
  type EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/models";
import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@supaterm/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type KeybindingCommand,
  type ScopedThreadRef,
  type ThreadId,
} from "@supaterm/contracts";
import { PlusIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useShortcutModifierState } from "../shortcutModifierState";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import {
  projectGroupMemberKeys,
  projectGroupsSpanEnvironments,
  resolveSidebarProjectScopeKey,
  getSidebarProjectSettingsKey,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { useUiStateStore } from "../uiStateStore";
import {
  getThreadKeysToDeselectAfterDelete,
  useThreadSelectionStore,
} from "../threadSelectionStore";
import { useAcknowledgeThreadWoke, useThreadActions } from "../hooks/useThreadActions";
import { useThreadUndoNotice } from "../hooks/showThreadUndoNotice";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useSidebarProjectGroups } from "../hooks/useSidebarProjectGroups";
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { registerAppCommandHandler } from "../appCommandBus";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { registerMarkDoneAndAdvance } from "../markDoneAndAdvance";
import { updateClientSettings, useClientSettings } from "../hooks/useSettings";
import { usePickerShortcuts } from "../hooks/usePickerShortcuts";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNowMinute } from "../hooks/useNowMinute";
import {
  useEnvironmentIdentities,
  useEnvironmentMachines,
  usePrimaryEnvironmentId,
} from "../state/environments";
import {
  readThreadShell,
  useAllEnvironmentProjectSnapshotsReady,
  useProjects,
  useServerConfigs,
  useQuietSidebarThreadShells,
  useThreadRefs,
} from "../state/entities";
import { useSidebarThreadNavigation } from "../hooks/useSidebarThreadNavigation";
import { environmentPresentations } from "../state/presentation";
import { primaryServerKeybindingsAtom } from "../state/server";
import { environmentProjects } from "../state/projects";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { readEnvironmentScope } from "../state/session";
import { buildThreadRouteParams, resolveActiveThreadRouteRef } from "../threadRoutes";
import type { SidebarThreadSummary } from "../types";
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import { cn } from "~/lib/utils";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
  threadActionRequiresOperate,
} from "./threadActionMenu.logic";
import {
  applySidebarThreadDrop,
  filterSidebarV2VisibleThreads,
  buildBulkTitleRegenerationContextMenuItem,
  buildBulkUnpinContextMenuItem,
  deleteSelectedThreadEntries,
  firstValidTimestampMs,
  isSidebarNestedLinkClick,
  isSidebarThreadWorking,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  planSidebarThreadDrop,
  resolveAdjacentThreadId,
  resolveSidebarSweepKeys,
  resolveSidebarDropTarget,
  resolveSidebarDropVerb,
  resolveSidebarThreadSection,
  resolveSidebarRowThreadId,
  type SidebarSweepAction,
  shouldNavigateAfterThreadPark,
  isSidebarGroupId,
  sidebarListItemId,
  sidebarThreadKeyAtY,
  sortInboxThreadsByReturn,
  sortPinnedThreadsForSidebar,
  sortWorkingThreadsBySend,
  useThreadJumpHintVisibility,
  type SidebarSection,
} from "./Sidebar.logic";
import {
  createSidebarCollisionDetection,
  createSidebarGroupCollisionDetection,
  createSidebarSortingStrategy,
  restrictBelowSidebarLabel,
  sidebarProjectGroupBlocks,
} from "./Sidebar.drag";
import { SidebarDragLifecycle, SidebarPointerSensor } from "./Sidebar.pointer";
import { createSidebarListMotion } from "./Sidebar.motion";
import { resolveSnoozePresets, snoozeWakeLabel, type SnoozePreset } from "./Sidebar.snooze";
import { deriveProviderEntriesByEnvironment } from "../providerInstances";
import { useStableCallback } from "../hooks/useStableCallback";
import {
  completeSidebarRouteReveal,
  pendingSidebarRouteReveal,
  type SidebarRouteReveal,
} from "./sidebar/routeReveal";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { SidebarContent, SidebarGroup, useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { SidebarThreadHeader } from "./sidebar/SidebarThreadHeader";
import { SidebarProjectFilterSubmenu } from "./sidebar/SidebarProjectFilterSubmenu";
import { SidebarThreadListMenu } from "./sidebar/SidebarThreadListMenu";
import { SidebarGroupHeader } from "./sidebar/SidebarGroupHeader";
import { SidebarPrimaryNavigation } from "./sidebar/SidebarPrimaryNavigation";
import { TooltipProvider } from "./ui/tooltip";
import { composerDraftHasUserContent, DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useChatPaneStore } from "../chatPanes/store";
import { useShallow } from "zustand/react/shallow";
import { openThreadBeside } from "../chatPanes/actions";
import { SortableThreadRow, type SidebarProviderEntry } from "./sidebar/SidebarThreadRow";
import { SidebarDraftBlock } from "./sidebar/SidebarDraftBlock";

function sameSidebarProviderEntries(
  left: ReadonlyMap<string, SidebarProviderEntry>,
  right: ReadonlyMap<string, SidebarProviderEntry>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [instanceId, entry] of right) {
    const other = left.get(instanceId);
    if (
      other === undefined ||
      other.driverKind !== entry.driverKind ||
      other.enabled !== entry.enabled ||
      other.displayName !== entry.displayName ||
      other.accentColor !== entry.accentColor ||
      other.acpRegistryAgentId !== entry.acpRegistryAgentId ||
      other.acpRegistryIconUrl !== entry.acpRegistryIconUrl ||
      other.models !== entry.models
    ) {
      return false;
    }
  }
  return true;
}

// Threads on non-primary environments resolve their provider entry from their
// own environment's config: default instance ids are driver slugs, so a flat
// map would collide across environments.
const sidebarProviderEntriesAtom = Atom.make((get) => {
  const providersByEnvironment = get(environmentPresentations.providersByEnvironmentAtom);
  const derived = deriveProviderEntriesByEnvironment(
    [...get(environmentPresentations.serverConfigsAtom)].map(
      ([environmentId, config]) =>
        [environmentId, providersByEnvironment.get(environmentId) ?? [], config.settings] as const,
    ),
  );
  const previous = Option.getOrNull(
    get.self<ReadonlyMap<string, ReadonlyMap<string, SidebarProviderEntry>>>(),
  );
  const next = new Map<string, ReadonlyMap<string, SidebarProviderEntry>>();
  let changed = previous === null || previous.size !== derived.size;
  for (const [environmentId, entries] of derived) {
    const prior = previous?.get(environmentId);
    if (prior !== undefined && sameSidebarProviderEntries(prior, entries)) {
      next.set(environmentId, prior);
    } else {
      next.set(environmentId, entries);
      changed = true;
    }
  }
  return !changed && previous !== null ? previous : next;
}).pipe(Atom.withLabel("sidebar-provider-entries"));

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, SidebarProviderEntry> = new Map();
// Collapsed shelves share one empty list so a route change alone does not
// give the sidebar list a new identity.
const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];

// Done-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more.
const DONE_TAIL_INITIAL_COUNT = 10;
const DONE_TAIL_PAGE_COUNT = 25;
const PINNED_SHELF_EXPANDED_KEY = "supaterm:sidebar:pinned-expanded";
const DONE_SHELF_EXPANDED_KEY = "supaterm:sidebar:done-expanded";
const SNOOZED_SHELF_EXPANDED_KEY = "supaterm:sidebar:snoozed-expanded";
const WORKING_SHELF_EXPANDED_KEY = "supaterm:sidebar:working-expanded";
const COLLAPSED_THREAD_GROUPS_KEY = "supaterm:sidebar:collapsed-thread-groups";
const CollapsedThreadGroups = Schema.Array(Schema.String);

// When this client saw each thread leave the Working shelf.
// Module scope keeps the inbox order across routes that unmount the sidebar.
const inboxReturns = createInboxReturnTracker();

type SidebarOptimisticDrop = {
  readonly key: string;
  readonly sourceSection: SidebarSection;
  readonly section: "pinned" | "active" | "done";
  readonly occurredAt: string;
  readonly clearsSnooze: boolean;
  /** Full destination order for pinned drops. */
  readonly order: readonly string[] | null;
  readonly keysAtDrop: ReadonlyMap<string, string | null>;
  readonly assignedKeys: ReadonlyMap<string, string>;
};

interface SidebarThreadPartitionInput {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly serverThreadKeys: ReadonlySet<string>;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly optimisticDrop: SidebarOptimisticDrop | null;
  // Snooze wakes depend on the clock, so the minute tick and the precise
  // snooze-wake tick are inputs: either one advancing repartitions.
  readonly nowMinute: string;
  readonly snoozeWakeTickAt: number;
}

const NO_DRAGGED_ORDER: readonly string[] = [];

function resolveDraggedDoneOrder(input: {
  readonly drag: { readonly activeKey: string; readonly occurredAt: string };
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly doneThreads: readonly EnvironmentThreadShell[];
}): readonly string[] {
  const { drag, threadByKey, doneThreads } = input;
  const thread = threadByKey.get(drag.activeKey);
  if (thread === undefined) return NO_DRAGGED_ORDER;
  return sortDoneThreads([
    ...doneThreads.filter((candidate) => threadShellKey(candidate) !== drag.activeKey),
    applySidebarThreadDrop(thread, "done", drag.occurredAt),
  ]).map(threadShellKey);
}

// A collapsed shelf still shows the open thread, so the route never hides
// its row, highlight, or wake and reopen affordances.
function routeThreadOnly(
  threads: readonly EnvironmentThreadShell[],
  routeThreadKey: string | null,
): readonly EnvironmentThreadShell[] {
  if (routeThreadKey === null) return EMPTY_THREADS;
  const routeThread = threads.find((thread) => threadShellKey(thread) === routeThreadKey);
  return routeThread === undefined ? EMPTY_THREADS : [routeThread];
}

// Everything Sidebar derives from thread shells. Computed inside one hook so
// each value reaches the component frozen and cached on its real inputs: in
// the component body, later hook calls made the compiler treat these maps as
// possibly mutated and recompute them, and every dnd-kit input with them.
function useSidebarThreads(input: {
  readonly projectScopeKey: string | null;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly optimisticDrop: SidebarOptimisticDrop | null;
  readonly routeThreadRef: ScopedThreadRef | null;
  readonly dragging: boolean;
  readonly grouping: SidebarThreadGrouping;
  readonly groupingProjects: readonly ThreadGroupingProject[];
}) {
  const { projectScopeKey, scopedProjectKeys, serverConfigs, optimisticDrop, routeThreadRef } =
    input;
  const threads = useQuietSidebarThreadShells();
  const serverThreadRefs = useThreadRefs();
  const routeRowThreadKey =
    routeThreadRef === null
      ? null
      : scopedThreadKey(
          scopeThreadRef(
            routeThreadRef.environmentId,
            resolveSidebarRowThreadId(
              routeThreadRef.threadId,
              routeThreadRef.environmentId,
              threads,
            ),
          ),
        );
  const nowMinute = useNowMinute();
  // Snooze wake times are second-precise, so classifying with the quantized
  // minute would hold a woken thread on the shelf for up to a minute. The
  // tick records when the next wake boundary passed; the partition never
  // reads a clock earlier than the latest minute or wake tick.
  const [snoozeWakeTickAt, setSnoozeWakeTickAt] = useState(0);
  const [nextSnoozeWakeAt, setNextSnoozeWakeAt] = useState<string | null>(null);
  useEffect(
    () => scheduleSnoozeWake(nextSnoozeWakeAt, () => setSnoozeWakeTickAt(Date.now())),
    [nextSnoozeWakeAt],
  );
  const [pinnedShelfExpanded, setPinnedShelfExpanded] = useLocalStorage(
    PINNED_SHELF_EXPANDED_KEY,
    true,
    Schema.Boolean,
  );
  const [doneShelfExpanded, setDoneShelfExpanded] = useLocalStorage(
    DONE_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  // The snoozed shelf is collapsed by default: out of the way, never gone.
  // Collapsed threads don't render (and so don't participate in jump
  // shortcuts or multi-select), matching the done tail's paging model.
  const [snoozedShelfExpanded, setSnoozedShelfExpanded] = useLocalStorage(
    SNOOZED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [workingShelfExpanded, setWorkingShelfExpanded] = useLocalStorage(
    WORKING_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [collapsedThreadGroups, setCollapsedThreadGroups] = useLocalStorage(
    COLLAPSED_THREAD_GROUPS_KEY,
    [],
    CollapsedThreadGroups,
  );
  const collapsedThreadGroupKeys = new Set(collapsedThreadGroups);
  // The done tail renders in pages: history shouldn't dominate the sidebar,
  // and the common lookups are recent. Paging restarts whenever the project
  // scope changes, so a scope flip never inherits a deep page state.
  const [doneTail, setDoneTail] = useState({
    scopeKey: projectScopeKey,
    count: DONE_TAIL_INITIAL_COUNT,
  });
  if (doneTail.scopeKey !== projectScopeKey) {
    setDoneTail({ scopeKey: projectScopeKey, count: DONE_TAIL_INITIAL_COUNT });
  }
  const doneVisibleCount =
    doneTail.scopeKey === projectScopeKey ? doneTail.count : DONE_TAIL_INITIAL_COUNT;

  const serverThreadKeys = new Set(serverThreadRefs.map(scopedThreadKey));
  const partition = partitionSidebarThreads({
    threads,
    scopedProjectKeys,
    serverThreadKeys,
    serverConfigs,
    optimisticDrop,
    nowMinute,
    snoozeWakeTickAt,
  });
  const partitionNextWakeAt = partition.snoozedThreads[0]?.snoozedUntil ?? null;
  if (partitionNextWakeAt !== nextSnoozeWakeAt) setNextSnoozeWakeAt(partitionNextWakeAt);

  const { pinnedThreads, activeThreads, workingThreads, snoozedThreads, doneThreads } = partition;
  const visibleDoneThreads = (() => {
    if (doneThreads.length <= doneVisibleCount) return doneThreads;
    const visible = doneThreads.slice(0, doneVisibleCount);
    // The open thread must never hide under "Show more": navigating into a
    // deep done thread (search, deep link) pulls its row into the visible
    // tail so the highlight and the reopen affordance stay reachable.
    if (routeRowThreadKey !== null) {
      const routeThread = doneThreads
        .slice(doneVisibleCount)
        .find((thread) => threadShellKey(thread) === routeRowThreadKey);
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible;
  })();
  const renderedDoneThreads = doneShelfExpanded
    ? visibleDoneThreads
    : routeThreadOnly(visibleDoneThreads, routeRowThreadKey);
  const visibleSnoozedThreads = snoozedShelfExpanded
    ? snoozedThreads
    : routeThreadOnly(snoozedThreads, routeRowThreadKey);
  // Sending a message folds the open thread into the Working shelf, and its
  // row must stay visible there.
  const visibleWorkingThreads = workingShelfExpanded
    ? workingThreads
    : routeThreadOnly(workingThreads, routeRowThreadKey);
  // Dragging exposes the full saved pin order without changing the preference.
  const pinnedShelfVisible = pinnedShelfExpanded || input.dragging;
  const visiblePinnedThreads = pinnedShelfVisible
    ? pinnedThreads
    : routeThreadOnly(pinnedThreads, routeRowThreadKey);
  const inboxItems = buildSidebarInboxItems({
    mode: input.grouping,
    active: activeThreads,
    working: workingThreads,
    visibleWorking: visibleWorkingThreads,
    projects: input.groupingProjects,
    collapsedGroups: collapsedThreadGroupKeys,
    routeThreadKey: routeRowThreadKey,
  });
  const inboxThreadsByKey = new Map(
    [...activeThreads, ...workingThreads].map((thread) => [threadShellKey(thread), thread]),
  );
  const orderedThreads = [
    ...visiblePinnedThreads,
    ...inboxItems.flatMap((item) => {
      const thread = item.kind === "thread" ? inboxThreadsByKey.get(item.key) : undefined;
      return thread ? [thread] : [];
    }),
    ...visibleSnoozedThreads,
    ...renderedDoneThreads,
  ];
  const sectionByThreadKey = new Map<string, SidebarSection>();
  for (const [list, section] of [
    [pinnedThreads, "pinned"],
    [activeThreads, "active"],
    [workingThreads, "working"],
    [snoozedThreads, "snoozed"],
    [doneThreads, "done"],
  ] as const) {
    for (const thread of list) sectionByThreadKey.set(threadShellKey(thread), section);
  }
  return {
    routeRowThreadKey,
    inboxItems,
    ...partition,
    threads,
    serverThreadKeys,
    doneVisibleCount,
    hiddenDoneCount: doneThreads.length - visibleDoneThreads.length,
    showMoreDone: () =>
      setDoneTail((current) => ({
        scopeKey: current.scopeKey,
        count: current.count + DONE_TAIL_PAGE_COUNT,
      })),
    pinnedShelfExpanded,
    pinnedShelfVisible,
    togglePinnedShelf: () => setPinnedShelfExpanded((value) => !value),
    doneShelfExpanded,
    toggleDoneShelf: () => setDoneShelfExpanded((value) => !value),
    snoozedShelfExpanded,
    toggleSnoozedShelf: () => setSnoozedShelfExpanded((value) => !value),
    workingShelfExpanded,
    toggleWorkingShelf: () => setWorkingShelfExpanded((value) => !value),
    collapsedThreadGroups,
    collapsedThreadGroupKeys,
    toggleThreadGroup: (key: string) =>
      setCollapsedThreadGroups((keys) => toggleCollapsedThreadGroup(keys, key)),
    visiblePinnedThreads,
    renderedDoneThreads,
    visibleSnoozedThreads,
    visibleWorkingThreads,
    orderedThreadKeys: orderedThreads.map(threadShellKey),
    threadByKey: new Map(orderedThreads.map((thread) => [threadShellKey(thread), thread] as const)),
    doneThreadKeys: new Set(doneThreads.map(threadShellKey)),
    snoozedThreadKeys: new Set(snoozedThreads.map(threadShellKey)),
    sectionByThreadKey,
    pinnedKeys: pinnedThreads.map(threadShellKey),
    pinnedKeysById: new Map(
      threads.map((thread) => [threadShellKey(thread), thread.pinOrderKey ?? null] as const),
    ),
  };
}

function partitionSidebarThreads(input: SidebarThreadPartitionInput) {
  const { threads, scopedProjectKeys, serverThreadKeys, serverConfigs, optimisticDrop } = input;
  // Snooze classification uses a real clock, not the quantized minute: wake
  // times are second-precise and a woken thread must not linger on the
  // shelf for the rest of the minute.
  const preciseNow = new Date(
    Math.max(Date.now(), Date.parse(`${input.nowMinute}:00.000Z`), input.snoozeWakeTickAt),
  ).toISOString();
  const visible = filterSidebarV2VisibleThreads(threads, scopedProjectKeys);
  inboxReturns.observe(threads);
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  // Only inbox threads fold into Working. Pins stay where the user put them,
  // and snoozed or done threads keep their shelves.
  const inbox = (thread: EnvironmentThreadShell) =>
    isSidebarThreadWorking(thread) ? working : active;
  const snoozed: EnvironmentThreadShell[] = [];
  const done: EnvironmentThreadShell[] = [];
  const draggable = new Set<string>();
  for (const thread of visible) {
    // Until the environment's config loads, threads never classify as
    // done or snoozed and cannot be dragged: the user could not act on them.
    const loaded = serverConfigs.has(thread.environmentId);
    const threadKey = threadShellKey(thread);
    if (serverThreadKeys.has(threadKey) && loaded) {
      draggable.add(threadKey);
    }
    if (optimisticDrop?.key === threadKey) {
      const projected = applySidebarThreadDrop(
        thread,
        optimisticDrop.section,
        optimisticDrop.occurredAt,
        optimisticDrop.assignedKeys.get(threadKey),
      );
      (optimisticDrop.section === "pinned"
        ? pinned
        : optimisticDrop.section === "done"
          ? done
          : inbox(projected)
      ).push(
        optimisticDrop.clearsSnooze
          ? projected
          : { ...projected, snoozedAt: thread.snoozedAt, snoozedUntil: thread.snoozedUntil },
      );
    } else {
      const section = resolveSidebarThreadSection({
        snoozed: loaded && effectiveSnoozed(thread, { now: preciseNow }),
        done: loaded && thread.doneOverride === "done",
        pinned: thread.pinnedAt != null,
      });
      (section === "snoozed"
        ? snoozed
        : section === "done"
          ? done
          : section === "pinned"
            ? pinned
            : inbox(thread)
      ).push(thread);
    }
  }
  const sortedPinned = sortPinnedThreadsForSidebar(pinned);
  return {
    pinnedThreads:
      optimisticDrop?.section !== "pinned" || optimisticDrop.order === null
        ? sortedPinned
        : orderItemsByPreferredIds({
            items: sortedPinned,
            preferredIds: optimisticDrop.order,
            getId: threadShellKey,
          }),
    draggableThreadKeys: draggable,
    activeThreads: sortInboxThreadsByReturn(active, inboxReturns.returnedAt),
    workingThreads: sortWorkingThreadsBySend(working),
    snoozedThreads: snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil ?? null) -
        firstValidTimestampMs(right.snoozedUntil ?? null),
    ),
    doneThreads: sortDoneThreads(done),
    snoozeNow: preciseNow,
  };
}

function isOptimisticDropReleased(input: {
  readonly optimisticDrop: SidebarOptimisticDrop;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly pinnedKeys: readonly string[];
  readonly now: string;
}): boolean {
  const { optimisticDrop, threads, pinnedKeys, now } = input;
  const canonicalByKey = new Map(threads.map((thread) => [threadShellKey(thread), thread]));
  const thread = canonicalByKey.get(optimisticDrop.key);
  if (thread === undefined || thread.archivedAt !== null) return true;
  const canonicalSection = effectiveSnoozed(thread, { now })
    ? "snoozed"
    : thread.doneOverride === "done"
      ? "done"
      : thread.pinnedAt != null
        ? "pinned"
        : "active";
  if (
    canonicalSection !== optimisticDrop.sourceSection &&
    canonicalSection !== optimisticDrop.section
  ) {
    return true;
  }
  if (optimisticDrop.order === null) {
    // Marking done also emits unpin/unsnooze events. Wait for the entire move
    // before releasing the projected fields and sort timestamps.
    return (
      canonicalSection === optimisticDrop.section &&
      thread.pinnedAt == null &&
      (!optimisticDrop.clearsSnooze || thread.snoozedUntil == null)
    );
  }
  if (canonicalSection !== optimisticDrop.section) return false;
  if (optimisticDrop.clearsSnooze && thread.snoozedUntil != null) return false;
  const canonicalDestination = pinnedKeys.flatMap((key) => {
    const canonical = canonicalByKey.get(key);
    return canonical === undefined ? [] : [canonical];
  });
  const keyByThread = new Map(
    canonicalDestination.map((thread) => [threadShellKey(thread), thread.pinOrderKey ?? null]),
  );
  const heldOrder = optimisticDrop.order;
  const heldKeys = new Set(heldOrder);
  const membershipChanged =
    pinnedKeys.length !== heldOrder.length || pinnedKeys.some((key) => !heldKeys.has(key));
  const foreignKeyLanded = pinnedKeys.some((threadKey) => {
    const currentKey = keyByThread.get(threadKey) ?? null;
    if (currentKey === (optimisticDrop.keysAtDrop.get(threadKey) ?? null)) return false;
    return currentKey !== optimisticDrop.assignedKeys.get(threadKey);
  });
  const allAssignmentsLanded = [...optimisticDrop.assignedKeys].every(
    ([threadKey, orderKey]) => keyByThread.get(threadKey) === orderKey,
  );
  return membershipChanged || foreignKeyLanded || allAssignmentsLanded;
}

// Sidebar() is large enough that the compiler cannot prove its local maps stay
// unmutated; built inside a hook they reach it frozen and cached.
function useSidebarLookups() {
  const projects = useProjects();
  const environments = useEnvironmentIdentities();
  const serverConfigs = useServerConfigs();
  const providerEntriesByEnvironment = useAtomValue(sidebarProviderEntriesAtom);
  const projectGroups = useSidebarProjectGroups();
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const projectByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const projectDisplayNameByKey = new Map(
    projectGroups.flatMap((group) =>
      group.memberProjects.map(
        (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
      ),
    ),
  );
  const projectGroupByScopeKey = new Map(
    projectGroups.map((project) => [project.projectKey, project] as const),
  );
  const projectScopeItems = [
    { value: "all", label: "All" },
    ...projectGroups.map((project) => ({ value: project.projectKey, label: project.displayName })),
  ];
  return {
    projects,
    serverConfigs,
    projectGroups,
    environmentLabelById,
    providerEntriesByEnvironment,
    projectByKey,
    projectDisplayNameByKey,
    projectGroupByScopeKey,
    projectScopeItems,
  };
}

function scheduleSnoozeWake(wakeAt: string | null, onWake: () => void): (() => void) | undefined {
  const wakeAtMs = wakeAt === null ? Number.NaN : Date.parse(wakeAt);
  if (Number.isNaN(wakeAtMs)) return undefined;
  // setTimeout delays are signed 32-bit: anything larger overflows and fires
  // immediately, turning a far-future wake (event-condition snoozes synced
  // from elsewhere) into a tight re-arm loop.
  const delayMs = Math.min(Math.max(0, wakeAtMs - Date.now()) + 50, 2_147_483_647);
  const id = window.setTimeout(onWake, delayMs);
  return () => window.clearTimeout(id);
}

function canOperateThreads(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  return threads.every((thread) =>
    readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope),
  );
}

function checkThreadOperations(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  if (canOperateThreads(threads)) return true;
  toastManager.add({
    type: "error",
    title: "Thread action unavailable",
    description: "This connection cannot change one or more selected threads.",
  });
  return false;
}

const SIDEBAR_DRAG_DISTANCE = 6;

function toastThreadActionFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export default function Sidebar({ routeReveal }: { routeReveal: SidebarRouteReveal }) {
  const {
    projects,
    serverConfigs,
    projectGroups,
    environmentLabelById,
    providerEntriesByEnvironment,
    projectByKey,
    projectDisplayNameByKey,
    projectGroupByScopeKey,
    projectScopeItems,
  } = useSidebarLookups();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const threadGrouping = useClientSettings((s) => s.sidebarThreadGrouping);
  const projectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const groupingProjects = projectGroups.map((group) => ({
    key: group.projectKey,
    label: group.displayName,
    memberProjectRefs: group.memberProjectRefs,
  }));
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const {
    markThreadDone,
    reopenThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    confirmAndUnpinThread,
    setThreadAutoMarkDone,
    reorderPinnedThread,
    markThreadUnread,
    archiveThread,
    deleteThread,
  } = useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({
        type: "success",
        title: "Branch copied",
        description: branch,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy branch",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: ({ threadId }) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const handleNewThread = useNewThreadHandler();
  const openAddProjectCommandPalette = () => openCommandPalette({ open: "add-project" });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const acknowledgeWoke = useAcknowledgeThreadWoke();
  const routeTarget = useThreadRouteTarget();
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const environmentMachineById = useEnvironmentMachines();
  const persistedProjectScopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const setPersistedProjectScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const [threadListMenuOpen, setThreadListMenuOpen] = useState(false);
  const [projectFilterOpen, setProjectFilterOpen] = useState(false);
  // Closing a controlled menu from code skips onOpenChange, so the submenu's
  // flag, which arms the project shortcuts, has to close with it.
  const closeThreadListMenu = () => {
    setThreadListMenuOpen(false);
    setProjectFilterOpen(false);
  };
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  const allProjectConfigsReady = useAtomValue(environmentProjects.projectConfigsReadyAtom);
  const outboxEntries = useThreadOutbox();
  // Done threads are live shells, so opening one is plain navigation:
  // history stays readable without reopening, and sending a message or
  // starting a session reopens server-side.
  const navigateToThread = useSidebarThreadNavigation();
  const queuePendingFileDrop = useSidebarPendingFileDropStore((s) => s.queuePendingFileDrop);
  const clearPendingFileDrop = useSidebarPendingFileDropStore((s) => s.clearPendingFileDrop);
  // The undo notice resizes the footer and shifts the bottom-pinned done
  // shelf. It mounts and expires apart from any reorder, so it needs its own pass.
  const undoNoticeShown = useThreadUndoNotice((state) => state.notice !== null);
  const shortcutModifiers = useShortcutModifierState();
  const terminalFocused = useTerminalFocus();
  const { showThreadJumpHints: showJumpHints, updateThreadJumpHintsVisibility } =
    useThreadJumpHintVisibility();
  // Safari can send a click after Ctrl+click opens settings. Ignore that one
  // selection, then clear the guard when the menu opens again.
  const suppressNextScopeChangeRef = useRef(false);
  // Keep a dropped row at its destination while its server applies the
  // lifecycle command and any order-key writes. The next pickup waits for
  // this hold so a second drop cannot replace an unconfirmed placement.
  const [optimisticDrop, setOptimisticDrop] = useState<SidebarOptimisticDrop | null>(null);
  const [dragState, setDragState] = useState<{
    readonly activeKey: string;
    readonly activeSection: SidebarSection;
    readonly occurredAt: string;
    readonly activationY: number | null;
    readonly targetSection: SidebarSection | null;
    readonly contextDrag: boolean;
  } | null>(null);
  const [actionSweep, setActionSweep] = useState<{
    action: SidebarSweepAction;
    keys: ReadonlySet<string>;
  } | null>(null);
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  // handleNewThread changes with the projects list; a ref keeps it out of the
  // mark-done handlers.
  const handleNewThreadRef = useRef(handleNewThread);
  const projectGroupsRef = useRef(projectGroups);
  // One mark-done per thread at a time: double clicks and repeated menu picks
  // must not dispatch a second mark-done that fails and toasts a false error.
  const markingDoneThreadKeysRef = useRef(new Set<string>());
  // One snooze per thread at a time — same double-dispatch guard as marking done.
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const threadListRef = useRef<HTMLUListElement | null>(null);
  const dragLabelOffsetRef = useRef(0);
  const listMotionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const dragSensorRef = useRef<SidebarPointerSensor | null>(null);
  const contextDragKeyRef = useRef<string | null>(null);
  const routeThreadRef = resolveActiveThreadRouteRef(routeTarget, routeDraftThread);
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const paneThreadKeyList = useChatPaneStore(
    useShallow((state) =>
      (state.layout?.cells ?? []).flatMap((cell) =>
        cell.target.kind === "server" ? [scopedThreadKey(cell.target.threadRef)] : [],
      ),
    ),
  );
  const paneThreadKeys = new Set(paneThreadKeyList);
  // Post-completion navigation validates against the CURRENT route, not the one
  // captured when marking done started: if the user navigated elsewhere while
  // the command was in flight, completing it must not yank them away.
  const routeThreadKeyRef = useRef(routeThreadKey);
  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );

  // A selection made under one scope can hold threads the next scope hides.
  const setProjectScopeKey = (key: string | null) => {
    clearSelection();
    setPersistedProjectScopeKey(key);
  };
  const projectScopeKey = resolveSidebarProjectScopeKey({
    groups: projectGroups,
    key: persistedProjectScopeKey,
    settings: projectGroupingSettings,
  });
  const showProjectEnvironments = projectGroupsSpanEnvironments(projectGroups);
  const scratchMachineLabelFor = (
    thread: Pick<SidebarThreadSummary, "environmentId" | "projectId">,
  ) => {
    if (!showProjectEnvironments) return null;
    const project = projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
    if (
      !project ||
      !isScratchProject(project, serverConfigs.get(thread.environmentId)?.scratchWorkspaceRoot)
    ) {
      return null;
    }
    return environmentLabelById.get(thread.environmentId) ?? null;
  };
  const projectScopeJumpLabels = usePickerShortcuts({
    picker: "project",
    open: projectFilterOpen,
    items: projectScopeItems.filter((item) => item.value !== "all"),
    fixedChoice: { item: projectScopeItems[0]!, command: "projectPicker.noProject" },
    keybindings,
    onSelect: (item) => {
      setProjectScopeKey(item.value === "all" ? null : item.value);
      closeThreadListMenu();
    },
  });
  const scopedProjectGroup =
    projectScopeKey === null
      ? null
      : (projectGroups.find((project) => project.projectKey === projectScopeKey) ?? null);
  const scopedProjectKeys =
    scopedProjectGroup === null ? null : projectGroupMemberKeys(scopedProjectGroup);
  useEffect(() => {
    const nextKey = resolveSidebarProjectScopeKey({
      groups: projectGroups,
      key: persistedProjectScopeKey,
      settings: projectGroupingSettings,
      canClearMissingScope: allProjectSnapshotsReady && allProjectConfigsReady,
    });
    if (nextKey !== persistedProjectScopeKey) {
      clearSelection();
      setPersistedProjectScopeKey(nextKey);
    }
  }, [
    allProjectConfigsReady,
    allProjectSnapshotsReady,
    clearSelection,
    persistedProjectScopeKey,
    projectGroups,
    projectGroupingSettings,
    setPersistedProjectScopeKey,
  ]);
  const routeDraftIdForRows = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const visibleDraftSessionCount = useComposerDraftStore((store) => {
    let count = 0;
    for (const [draftKey, session] of Object.entries(store.draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (!composerDraftHasUserContent(store.draftsByThreadKey[draftKey])) {
        continue;
      }
      if (
        scopedProjectKeys !== null &&
        !scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      count += 1;
    }
    return count;
  });

  const openProjectSettings = useStableCallback(
    (projectGroup: SidebarProjectSnapshot, projectRef?: ScopedProjectRef) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/projects/$projectKey",
        params: {
          projectKey: getSidebarProjectSettingsKey(
            projectGroup,
            projectGroupingSettings,
            projects,
            projectRef,
          ),
        },
      });
    },
  );
  const handleProjectSettings = useStableCallback(
    (event: ReactMouseEvent<HTMLElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      suppressNextScopeChangeRef.current = true;
      closeThreadListMenu();
      openProjectSettings(projectGroup);
    },
  );

  const {
    threads,
    serverThreadKeys,
    pinnedThreads,
    draggableThreadKeys,
    activeThreads,
    workingThreads,
    snoozedThreads,
    doneThreads,
    snoozeNow,
    doneVisibleCount,
    hiddenDoneCount,
    showMoreDone,
    pinnedShelfExpanded,
    pinnedShelfVisible,
    togglePinnedShelf,
    doneShelfExpanded,
    toggleDoneShelf,
    snoozedShelfExpanded,
    toggleSnoozedShelf,
    workingShelfExpanded,
    toggleWorkingShelf,
    collapsedThreadGroups,
    collapsedThreadGroupKeys,
    toggleThreadGroup,
    visiblePinnedThreads,
    renderedDoneThreads,
    visibleSnoozedThreads,
    visibleWorkingThreads,
    inboxItems,
    orderedThreadKeys,
    threadByKey,
    doneThreadKeys,
    snoozedThreadKeys,
    sectionByThreadKey,
    pinnedKeys,
    pinnedKeysById,
    routeRowThreadKey,
  } = useSidebarThreads({
    grouping: threadGrouping,
    groupingProjects,
    projectScopeKey,
    scopedProjectKeys,
    serverConfigs,
    optimisticDrop,
    routeThreadRef,
    // A Working row only drags out as chat context, so it never reveals the pin order.
    dragging: dragState !== null && dragState.activeSection !== "working",
  });
  // Once delivery starts, the optimistic creation shell owns the row, so
  // checking only server shells would show the thread twice until the ack.
  const pendingThreads = outboxEntries.filter((entry) => {
    const creation = entry.payload.input.bootstrap?.createThread;
    return (
      creation &&
      !threads.some((thread) => threadShellKey(thread) === entry.scope) &&
      (scopedProjectKeys === null ||
        scopedProjectKeys.has(`${entry.payload.environmentId}:${creation.projectId}`))
    );
  });

  // History, the command palette, and links can open a thread the project
  // scope hides or the list has scrolled away. A remount starts the list at
  // the top, so each mount also scrolls to the open thread once, without
  // widening the scope.
  const mountRevealOwed = useRef(true);
  const revealRouteRow = useStableCallback(() => {
    const pendingKey = pendingSidebarRouteReveal(routeReveal, routeRowThreadKey);
    const revealKey = pendingKey ?? (mountRevealOwed.current ? routeRowThreadKey : null);
    if (revealKey === null) return;
    const thread = threads.find((candidate) => threadShellKey(candidate) === revealKey);
    if (thread === undefined) return;
    if (
      pendingKey !== null &&
      scopedProjectKeys !== null &&
      filterSidebarV2VisibleThreads([thread], scopedProjectKeys).length === 0 &&
      filterSidebarV2VisibleThreads([thread], null).length === 1
    ) {
      // The row renders under the widened scope; scroll on that pass.
      setProjectScopeKey(null);
      return;
    }
    const activeRow = document.querySelector('[data-sidebar="content"] [aria-current="page"]');
    if (!activeRow) return;
    completeSidebarRouteReveal(routeReveal);
    mountRevealOwed.current = false;
    activeRow.scrollIntoView({ block: "nearest" });
  });
  useEffect(revealRouteRow, [revealRouteRow, routeRowThreadKey, threads, projectScopeKey]);

  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  // Handlers read these through refs: depending on per-update Map/Set
  // identities would give every row a fresh callback prop on each shell
  // event and defeat row memoization during streaming.
  const threadByKeyRef = useRef(threadByKey);
  const doneThreadKeysRef = useRef(doneThreadKeys);
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);
  const sectionByThreadKeyRef = useRef(sectionByThreadKey);
  useLayoutEffect(() => {
    routeThreadKeyRef.current = routeThreadKey;
    projectGroupsRef.current = projectGroups;
    orderedThreadKeysRef.current = orderedThreadKeys;
    threadByKeyRef.current = threadByKey;
    handleNewThreadRef.current = handleNewThread;
    doneThreadKeysRef.current = doneThreadKeys;
    snoozedThreadKeysRef.current = snoozedThreadKeys;
    sectionByThreadKeyRef.current = sectionByThreadKey;
  });

  const pinShortcut = shortcutLabelForCommand(keybindings, "thread.pin");
  const doneShortcut = shortcutLabelForCommand(keybindings, "thread.mark-done");
  const jumpLabelByKey = (() => {
    const mapping = new Map<string, string>();
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(threadKey, label);
    }
    return mapping;
  })();

  const handleThreadFileDrop = async (threadRef: ScopedThreadRef, files: File[]) => {
    const dropId = queuePendingFileDrop({ threadRef, files });
    const landedBefore =
      router.buildLocation({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      }).pathname === router.state.location.pathname;
    if (landedBefore) return;

    try {
      await navigateToThread(threadRef);
      const landed =
        router.buildLocation({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        }).pathname === router.state.location.pathname;
      if (!landed) clearPendingFileDrop(dropId);
    } catch {
      clearPendingFileDrop(dropId);
    }
  };

  const navigateToDraft = (draftId: DraftId) => {
    clearSelection();
    if (isMobile) {
      setOpenMobile(false);
    }
    void router.navigate({ to: "/draft/$draftId", params: { draftId } });
  };

  const startThreadRename = (threadRef: ScopedThreadRef, title: string) => {
    if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  };
  const cancelThreadRename = () => setRenamingThreadKey(null);
  const commitThreadRename = (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
    void (async () => {
      if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
      const trimmed = title.trim();
      setRenamingThreadKey(null);
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (trimmed === originalTitle) return;
      const result = await updateThreadMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, title: trimmed },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };

  const handleThreadClick = (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
    if (isSidebarNestedLinkClick(event.target)) return;
    if (readThreadShell(threadRef) === null) {
      event.preventDefault();
      void navigateToThread(threadRef);
      return;
    }
    const isMac = isMacPlatform(navigator.platform);
    const isModClick = isMac ? event.metaKey : event.ctrlKey;
    const threadKey = scopedThreadKey(threadRef);
    if (isModClick) {
      event.preventDefault();
      toggleThreadSelection(threadKey);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      rangeSelectTo(
        threadKey,
        orderedThreadKeysRef.current.filter((key) => serverThreadKeys.has(key)),
      );
      return;
    }
    if (isTrailingDoubleClick(event.detail)) {
      return;
    }
    navigateToThread(threadRef);
  };

  // Parking the thread you're looking at (mark done or snooze) moves you
  // forward: the next remaining card (never a done or snoozed row, never
  // one leaving in the same batch), or a fresh draft in this project when it
  // was the last active one. Callers snapshot the plan BEFORE the command
  // mutates the partition; background parks never navigate (null plan).
  const planForwardNavigation = (
    threadKey: string,
    coParkingKeys?: ReadonlySet<string>,
  ): (() => void) | null => {
    if (routeThreadKeyRef.current !== threadKey) return null;
    const shell = threadByKeyRef.current.get(threadKey);
    const orderedKeys = orderedThreadKeysRef.current;
    const doneKeys = doneThreadKeysRef.current;
    const snoozedKeys = snoozedThreadKeysRef.current;
    const currentIndex = orderedKeys.indexOf(threadKey);
    const nextCardKey =
      currentIndex === -1
        ? null
        : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
            (key) => !doneKeys.has(key) && !snoozedKeys.has(key) && !coParkingKeys?.has(key),
          ) ?? null);
    const nextThread = nextCardKey ? threadByKeyRef.current.get(nextCardKey) : null;
    return nextThread
      ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
      : shell
        ? () =>
            void handleNewThreadRef.current(scopeProjectRef(shell.environmentId, shell.projectId))
        : () => void router.navigate({ to: "/" });
  };

  const attemptMarkDone = (
    threadRef: ScopedThreadRef,
    opts: { coMarkingDoneKeys?: ReadonlySet<string> } = {},
  ) => {
    void (async () => {
      const threadKey = scopedThreadKey(threadRef);
      if (markingDoneThreadKeysRef.current.has(threadKey)) return;
      markingDoneThreadKeysRef.current.add(threadKey);
      const navigateAfterMarkDone = planForwardNavigation(threadKey, opts.coMarkingDoneKeys);
      const result = await markThreadDone(threadRef);
      markingDoneThreadKeysRef.current.delete(threadKey);
      if (result._tag === "Failure") {
        // Never navigate away from a thread that was not marked done.
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to mark thread as Done",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      // Only move forward if the user is still on the done thread —
      // a navigation made during the await wins over ours.
      if (
        shouldNavigateAfterThreadPark({
          threadKey,
          currentThreadKey: routeThreadKeyRef.current,
          action: "mark-done",
          now: new Date().toISOString(),
          thread: readThreadShell(threadRef),
        })
      ) {
        navigateAfterMarkDone?.();
      }
    })();
  };
  useEffect(() => registerMarkDoneAndAdvance(attemptMarkDone), [attemptMarkDone]);
  // Post-completion navigation must skip threads being marked done in this same batch —
  // they are all leaving the card block together. Rows already in the done
  // shelf are skipped: nothing to do on a valid mixed selection. Pinned and
  // snoozed rows ARE included: the decider clears the pin and the snooze as
  // part of marking done, so they park like the rest, even when a snooze hides
  // an earlier mark-done.
  const markThreadsDone = (threadKeys: readonly string[]) => {
    const coMarkingDoneKeys = new Set(threadKeys);
    for (const threadKey of threadKeys) {
      const thread = threadByKeyRef.current.get(threadKey);
      if (!thread || doneThreadKeysRef.current.has(threadKey)) continue;
      attemptMarkDone(scopeThreadRef(thread.environmentId, thread.id), { coMarkingDoneKeys });
    }
  };
  const attemptReopen = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await reopenThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to reopen thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptUnsnooze = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await unsnoozeThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to wake thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const restrictBelowPins: Modifier = (args) =>
    restrictBelowSidebarLabel(args, dragLabelOffsetRef.current);
  // A new array re-renders DndContext and with it every sortable row.
  const dndModifiers = [
    restrictToVerticalAxis,
    restrictBelowPins,
    restrictToFirstScrollableAncestor,
  ];
  const attachListMotionRef = (node: HTMLUListElement | null) => {
    threadListRef.current = node;
    listMotionRef.current?.dispose();
    listMotionRef.current = node === null ? null : createSidebarListMotion(node);
    listMotionRef.current?.update(false);
  };
  const prepareShelfMotion = () => listMotionRef.current?.prepare();

  // Working rows can supply chat context, but never preview sidebar movement.
  const isContextDrag = dragState?.contextDrag === true || dragState?.activeSection === "working";
  const dragTargetSection = isContextDrag ? null : (dragState?.targetSection ?? null);
  const finishThreadDrag = (started: boolean) => {
    dragSensorRef.current = null;
    contextDragKeyRef.current = null;
    endThreadContextDrag();
    if (started) {
      listMotionRef.current?.release();
      setDragState(null);
    }
  };
  const attachDragSensor = (sensor: SidebarPointerSensor) => {
    dragSensorRef.current = sensor;
  };
  const cancelThreadDrag = () => {
    dragSensorRef.current?.cancel();
  };
  const contextDragThreads = (): ReadonlyArray<ScopedThreadRef> => {
    const key = contextDragKeyRef.current;
    if (key === null) return [];
    const selected = useThreadSelectionStore.getState().selectedThreadKeys;
    const keys = selected.has(key) ? [...selected] : [key];
    return keys.flatMap((candidate) => {
      const ref = parseScopedThreadKey(candidate);
      return ref ? [ref] : [];
    });
  };
  const pointerOutsideThreadList = (point: { x: number; y: number }) => {
    const bounds = threadListRef.current?.getBoundingClientRect();
    return bounds !== undefined && (point.x < bounds.left || point.x > bounds.right);
  };
  const moveThreadContextDrag = (point: { x: number; y: number }) => {
    if (contextDragKeyRef.current === null) return false;
    const contextDrag = pointerOutsideThreadList(point);
    setDragState((current) =>
      current === null || current.contextDrag === contextDrag
        ? current
        : { ...current, contextDrag },
    );
    if (!contextDrag) {
      endThreadContextDrag();
      return false;
    }
    const threads = contextDragThreads();
    const title =
      threadByKeyRef.current.get(contextDragKeyRef.current ?? "")?.title.trim() || "Thread";
    moveThreadContextDragGhost(
      point,
      { title, count: threads.length },
      { kind: "threads", threads },
    );
    return true;
  };
  const dropThreadContextDrag = (point: { x: number; y: number }) => {
    if (contextDragKeyRef.current === null || !pointerOutsideThreadList(point)) return false;
    dropThreadContext(point, { kind: "threads", threads: contextDragThreads() });
    return true;
  };
  // useSensor memoizes on the options object; a fresh one each render rebuilds
  // the sensors, and with them DndContext and every sortable row.
  const pointerSensorOptions = {
    distance: SIDEBAR_DRAG_DISTANCE,
    onAttach: attachDragSensor,
    onFinish: finishThreadDrag,
    onMove: moveThreadContextDrag,
    onDrop: dropThreadContextDrag,
  };
  const dndSensors = useSensors(useSensor(SidebarPointerSensor, pointerSensorOptions));
  const startActionSweep = useStableCallback(
    (threadRef: ScopedThreadRef, action: SidebarSweepAction, event: PointerEvent) => {
      const originKey = scopedThreadKey(threadRef);
      const originSection = sectionByThreadKeyRef.current.get(originKey);
      const canApply = (key: string) => {
        const thread = threadByKeyRef.current.get(key);
        return (
          thread !== undefined &&
          sectionByThreadKeyRef.current.get(key) === originSection &&
          serverConfigs.has(thread.environmentId)
        );
      };
      let targetKey: string | null = null;
      let sweptKeys: string[] = [];
      const sweepTo = (key: string | null) => {
        if (key === null || key === targetKey) return;
        targetKey = key;
        sweptKeys = resolveSidebarSweepKeys(orderedThreadKeysRef.current, originKey, key, canApply);
        setActionSweep({ action, keys: new Set(sweptKeys) });
      };
      dragSensorRef.current = new SidebarPointerSensor({
        active: originKey,
        event,
        options: {
          distance: SIDEBAR_DRAG_DISTANCE,
          onAttach: () => {},
          onFinish: () => {
            dragSensorRef.current = null;
            setActionSweep(null);
          },
        },
        onPending: () => {},
        onStart: () => sweepTo(originKey),
        onMove: ({ y }) =>
          sweepTo(threadListRef.current && sidebarThreadKeyAtY(threadListRef.current, y)),
        onEnd: () => {
          const keys = sweptKeys.filter(canApply);
          if (action === "mark-done") {
            markThreadsDone(keys);
            return;
          }
          for (const key of keys) {
            const ref = parseScopedThreadKey(key);
            if (ref === null) continue;
            if (action === "reopen") attemptReopen(ref);
            else attemptUnsnooze(ref);
          }
        },
        onCancel: () => {},
        onAbort: () => {},
      });
    },
  );
  // Release the hold during render once the server state catches up, so the
  // canonical order shows in the same frame instead of after an effect pass.
  if (
    optimisticDrop !== null &&
    isOptimisticDropReleased({ optimisticDrop, threads, pinnedKeys, now: snoozeNow })
  ) {
    setOptimisticDrop(null);
  }
  const attemptPin = (threadRef: ScopedThreadRef) => {
    void (async () => {
      // Fresh pins take the top of the arranged run: pinThread computes a
      // key before the smallest key across ALL pinned shells — including
      // snoozed pins hidden from this list, whose keys are still part of
      // the run — so the new pin can't land beneath a hidden head.
      const result = await pinThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to pin thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptUnpin = (threadRef: ScopedThreadRef) =>
    void confirmAndUnpinThread(threadRef).then((result) =>
      toastThreadActionFailure("Failed to unpin thread", result),
    );
  const attemptUnpinWithoutDialog = (threadRef: ScopedThreadRef) =>
    void unpinThread(threadRef).then((result) =>
      toastThreadActionFailure("Failed to unpin thread", result),
    );

  const handleGroupDragStart = () => {
    listMotionRef.current?.suspend();
    const list = threadListRef.current;
    const firstGroup = list?.querySelector<HTMLElement>('[data-testid^="sidebar-group-project:"]');
    dragLabelOffsetRef.current =
      list && firstGroup
        ? firstGroup.getBoundingClientRect().top - list.getBoundingClientRect().top
        : 0;
  };
  const handleThreadDragStart = (event: DragStartEvent) => {
    const activeKey = String(event.active.id);
    contextDragKeyRef.current = activeKey;
    const activeSection = sectionByThreadKey.get(activeKey);
    if (activeSection === undefined) return;
    listMotionRef.current?.suspend();
    const list = threadListRef.current;
    const header = list?.querySelector<HTMLElement>('[data-testid="sidebar-pinned-header"]');
    if (list && header) {
      const listRect = list.getBoundingClientRect();
      const scale = list.offsetWidth > 0 ? listRect.width / list.offsetWidth : 1;
      dragLabelOffsetRef.current =
        header.getBoundingClientRect().top -
        listRect.top +
        Math.max(header.getBoundingClientRect().height, SIDEBAR_DRAG_LABEL_HEIGHT * scale);
    } else {
      dragLabelOffsetRef.current = 0;
    }
    setDragState({
      activeKey,
      activeSection,
      targetSection: activeSection,
      contextDrag: false,
      occurredAt: new Date().toISOString(),
      activationY:
        event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY : null,
    });
  };
  const sidebarHasThreadSections =
    pinnedThreads.length +
      activeThreads.length +
      workingThreads.length +
      snoozedThreads.length +
      doneThreads.length >
    0;
  const showWorkingShelf = inboxItems.some(
    (item) => item.kind === "marker" && item.marker === "working-header",
  );
  const inboxCount = activeThreads.length + (showWorkingShelf ? 0 : workingThreads.length);
  const sidebarListItemsFresh = buildSidebarListItems({
    hasThreads: sidebarHasThreadSections,
    pinned: visiblePinnedThreads,
    snoozed: visibleSnoozedThreads,
    done: renderedDoneThreads,
    showSnoozed: snoozedThreads.length > 0,
    inboxItems,
  });
  // Thread shells update on every streamed event without moving rows. Keep the
  // list's identity until its order changes, so the sorting strategy, the
  // sortable context and every sortable row stay memoized meanwhile.
  const sidebarListItemsKey = sidebarListLayoutKey(sidebarListItemsFresh);
  const [sidebarListItemsState, setSidebarListItems] = useState(sidebarListItemsFresh);
  const [sidebarListItemsKeyState, setSidebarListItemsKeyState] = useState(sidebarListItemsKey);
  let sidebarListItems = sidebarListItemsState;
  if (sidebarListItemsKeyState !== sidebarListItemsKey) {
    setSidebarListItemsKeyState(sidebarListItemsKey);
    setSidebarListItems(sidebarListItemsFresh);
    // The rest of this render still runs before React applies the update, and
    // threadByKey already lacks rows that just left, such as a thread marked
    // done into the collapsed Done shelf.
    sidebarListItems = sidebarListItemsFresh;
  }
  useEffect(() => {
    if (
      dragState !== null &&
      !sidebarListItems.some((item) => item.kind === "thread" && item.key === dragState.activeKey)
    ) {
      cancelThreadDrag();
    }
  }, [cancelThreadDrag, dragState, sidebarListItems]);
  // Every shell event rebuilds sidebarListItems, but rows only move when the
  // rendered order, a row's section, the draft block, the pending rows, the
  // undo notice or a shelf toggle changes. Keying the motion pass on those
  // keeps ordinary updates from forcing a layout read and animating rows
  // whose position drifted for other reasons.
  const listMotionLayoutKey = [
    sidebarListLayoutKey(sidebarListItems),
    routeDraftIdForRows ?? "",
    visibleDraftSessionCount,
    pendingThreads.length,
    undoNoticeShown,
  ].join("\n");
  const listMotionShelfState = `${pinnedShelfExpanded}:${workingShelfExpanded}:${snoozedShelfExpanded}:${doneShelfExpanded}:${collapsedThreadGroups.join(",")}`;
  const listMotionAnimate =
    dragState === null &&
    (sidebarHasThreadSections || visibleDraftSessionCount > 0 || pendingThreads.length > 0);
  const listMotionPass = {
    layoutKey: listMotionLayoutKey,
    shelfState: listMotionShelfState,
    animate: listMotionAnimate,
    grouping: threadGrouping,
  };
  const previousGroupingRef = useRef(threadGrouping);
  const previousShelfStateRef = useRef(listMotionPass.shelfState);
  useLayoutEffect(() => {
    if (previousGroupingRef.current !== listMotionPass.grouping) listMotionRef.current?.suspend();
    previousGroupingRef.current = listMotionPass.grouping;
    const shelfToggled = previousShelfStateRef.current !== listMotionPass.shelfState;
    previousShelfStateRef.current = listMotionPass.shelfState;
    listMotionRef.current?.update(listMotionPass.animate, shelfToggled);
  }, [listMotionPass]);
  const handleThreadDragOver = (event: DragOverEvent) => {
    const target = event.over
      ? resolveSidebarDropTarget(sidebarListItems, String(event.active.id), String(event.over.id))
      : null;
    setDragState((current) =>
      current === null || current.activeKey !== String(event.active.id)
        ? current
        : { ...current, targetSection: target?.section ?? null },
    );
  };
  const sortableIds = sidebarListItems.map(sidebarListItemId);
  // Outside a drag the orders are constants, so the strategy, and with it
  // every sortable row, keeps its identity while thread shells stream in.
  // The inbox is time-ordered too, so the preview shows the slot a drop will
  // land in, not the slot under the pointer.
  const draggedDoneOrder =
    dragState === null
      ? NO_DRAGGED_ORDER
      : resolveDraggedDoneOrder({ drag: dragState, threadByKey, doneThreads });
  // oxlint-disable-next-line supaterm/no-manual-memo -- The compiler merges this scope across hooks; Sidebar.compiled.test.ts guards strategy caching.
  const draggedInbox = useMemo(
    () =>
      previewDraggedInbox({
        mode: threadGrouping,
        drag: dragState,
        threadByKey,
        active: activeThreads,
        working: workingThreads,
        visibleWorking: visibleWorkingThreads,
        inboxReturnAt: inboxReturns.returnedAt,
        workingShelfExpanded,
        routeThreadKey: routeRowThreadKey,
        projects: groupingProjects,
        collapsedGroups: collapsedThreadGroupKeys,
      }),
    [
      threadGrouping,
      dragState,
      threadByKey,
      activeThreads,
      workingThreads,
      visibleWorkingThreads,
      workingShelfExpanded,
      routeRowThreadKey,
      groupingProjects,
      collapsedThreadGroupKeys,
    ],
  );
  const sidebarSortingStrategy = createSidebarSortingStrategy({
    inbox: draggedInbox,
    items: sidebarListItems,
    enabled: !isContextDrag,
    boundaryLabelHeight: SIDEBAR_DRAG_LABEL_HEIGHT,
    doneOrder: draggedDoneOrder,
    doneExpanded: doneShelfExpanded,
    doneVisibleCount,
    routeThreadKey: routeRowThreadKey,
    snoozedThreadCount: snoozedThreads.length,
  });
  const draggedThreadKey = dragState?.activeKey;
  const draggedFromSection = dragState?.activeSection;
  const dragActivationY = dragState?.activationY;
  const dndCollisionDetection = (() => {
    if (draggedThreadKey === undefined || draggedFromSection === undefined)
      return createSidebarCollisionDetection(() => true);
    const source = threadByKey.get(draggedThreadKey);
    if (source === undefined) return createSidebarCollisionDetection(() => false);
    return createSidebarCollisionDetection(
      (id) => {
        const target = resolveSidebarDropTarget(sidebarListItems, draggedThreadKey, id);
        if (target === null) return false;
        return (
          planSidebarThreadDrop({
            activeKey: draggedThreadKey,
            activeSection: draggedFromSection,
            activePinned: source.pinnedAt != null,
            activeDone: source.doneOverride === "done",
            supportsMarkDone: serverConfigs.has(source.environmentId),
            target,
            pinnedOrder: pinnedKeys,
            pinnedKeysById,
            reorderableKeys: draggableThreadKeys,
          }).kind !== "none"
        );
      },
      {
        items: sidebarListItems,
        activationY: dragActivationY ?? null,
      },
    );
  })();
  const groupCollisionDetection = createSidebarGroupCollisionDetection(sidebarListItems);
  const sidebarCollisionDetection: CollisionDetection = (args) =>
    isSidebarGroupId(String(args.active.id))
      ? groupCollisionDetection(args)
      : dndCollisionDetection(args);
  const handleGroupDragEnd = (event: DragEndEvent) => {
    const blocks = sidebarProjectGroupBlocks(sidebarListItems);
    const projectKeyOf = (id: string | undefined) =>
      blocks.find((block) => sidebarListItemId(block.item) === id)?.item.projectKey ?? null;
    const dragged = projectKeyOf(String(event.active.id));
    const target = projectKeyOf(event.over === null ? undefined : String(event.over.id));
    if (dragged === null || target === null || dragged === target) return;
    const memberKeys = (projectKey: string) =>
      projectGroupByScopeKey.get(projectKey)?.memberProjects.map(getProjectOrderKey) ?? [];
    useUiStateStore.getState().reorderProjects(
      projectGroups.flatMap((group) => group.memberProjects.map(getProjectOrderKey)),
      memberKeys(dragged),
      memberKeys(target),
    );
    if (projectSortOrder !== "manual") {
      void updateClientSettings({ sidebarProjectSortOrder: "manual" });
    }
  };
  const handleThreadDragEnd = (event: DragEndEvent) => {
    const activeKey = String(event.active.id);
    const activeSection = sectionByThreadKey.get(activeKey);
    const target =
      event.over === null
        ? null
        : resolveSidebarDropTarget(sidebarListItems, activeKey, String(event.over.id));
    const activeThread = threadByKey.get(activeKey);
    if (activeSection === undefined || target === null || activeThread === undefined) return;
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    const plan = planSidebarThreadDrop({
      activeKey,
      activeSection,
      activePinned: activeThread.pinnedAt != null,
      activeDone: activeThread.doneOverride === "done",
      supportsMarkDone: serverConfigs.has(activeThread.environmentId),
      target,
      pinnedOrder: pinnedKeys,
      pinnedKeysById,
      reorderableKeys: draggableThreadKeys,
    });
    if (plan.kind === "none") return;
    if (plan.kind === "mark-done" && markingDoneThreadKeysRef.current.has(activeKey)) return;
    const assignments =
      plan.kind === "pin"
        ? [
            ...(plan.orderKey === undefined ? [] : [{ id: activeKey, orderKey: plan.orderKey }]),
            ...plan.extraAssignments,
          ]
        : plan.kind === "reorder-pinned"
          ? plan.assignments
          : [];
    if (
      !checkThreadOperations(
        [activeKey, ...assignments.map(({ id }) => id)].flatMap((key) => {
          const thread = threadByKey.get(key);
          return thread ? [thread] : [];
        }),
      )
    )
      return;
    const drop = {
      key: activeKey,
      sourceSection: activeSection,
      section: target.section,
      occurredAt: new Date().toISOString(),
      clearsSnooze:
        plan.kind === "pin" ||
        plan.kind === "mark-done" ||
        (plan.kind === "move-active" && plan.unsnooze),
      order: plan.kind === "pin" || plan.kind === "reorder-pinned" ? plan.order : null,
      keysAtDrop: pinnedKeysById,
      assignedKeys: new Map(assignments.map(({ id, orderKey }) => [id, orderKey])),
    };
    setOptimisticDrop(drop);
    void (async () => {
      const run = async (
        operation: Promise<AtomCommandResult<unknown, unknown>>,
        title: string,
      ) => {
        const result = await operation;
        if (result._tag === "Success") return true;
        setOptimisticDrop((current) => (current === drop ? null : current));
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title,
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return false;
      };
      switch (plan.kind) {
        case "mark-done": {
          markingDoneThreadKeysRef.current.add(activeKey);
          const navigateAfterMarkDone = planForwardNavigation(activeKey);
          const done = await run(markThreadDone(threadRef), "Failed to mark thread as Done");
          markingDoneThreadKeysRef.current.delete(activeKey);
          if (
            done &&
            shouldNavigateAfterThreadPark({
              threadKey: activeKey,
              currentThreadKey: routeThreadKeyRef.current,
              action: "mark-done",
              now: new Date().toISOString(),
              thread: readThreadShell(threadRef),
            })
          )
            navigateAfterMarkDone?.();
          return;
        }
        case "move-active":
          if (plan.unpin && !(await run(unpinThread(threadRef), "Failed to unpin thread"))) return;
          if (plan.reopen && !(await run(reopenThread(threadRef), "Failed to reopen thread")))
            return;
          if (plan.unsnooze) await run(unsnoozeThread(threadRef), "Failed to wake thread");
          return;
        case "pin":
          if (
            !(await run(
              pinThread(threadRef, plan.orderKey === undefined ? {} : { orderKey: plan.orderKey }),
              "Failed to pin thread",
            ))
          )
            return;
          break;
        case "reorder-pinned":
          break;
      }
      const keyWrites = plan.kind === "pin" ? plan.extraAssignments : plan.assignments;
      for (const assignment of keyWrites) {
        const thread = threadByKey.get(assignment.id);
        if (thread === undefined) continue;
        if (
          !(await run(
            reorderPinnedThread(
              scopeThreadRef(thread.environmentId, thread.id),
              assignment.orderKey,
            ),
            "Failed to reorder pinned threads",
          ))
        )
          return;
      }
    })();
  };
  const performSnooze = async (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
  ) => {
    const threadKey = scopedThreadKey(threadRef);
    if (snoozingThreadKeysRef.current.has(threadKey)) {
      return { status: "skipped" } as const;
    }
    snoozingThreadKeysRef.current.add(threadKey);
    // Snoozing the open thread moves you forward, same as marking done —
    // both park the thread you're done with for now.
    const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
    const result = await snoozeThread(threadRef, preset.snoozedUntil);
    snoozingThreadKeysRef.current.delete(threadKey);
    if (result._tag === "Failure") {
      return isAtomCommandInterrupted(result)
        ? ({ status: "interrupted" } as const)
        : ({ status: "failure", error: squashAtomCommandFailure(result) } as const);
    }
    if (
      shouldNavigateAfterThreadPark({
        threadKey,
        currentThreadKey: routeThreadKeyRef.current,
        action: "snooze",
        now: new Date().toISOString(),
        thread: readThreadShell(threadRef),
      })
    ) {
      navigateAfterSnooze?.();
    }
    return { status: "success" } as const;
  };
  const attemptSnooze = (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
  ) => {
    void (async () => {
      const outcome = await performSnooze(threadRef, preset, opts);
      if (outcome.status === "failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to snooze thread",
            description:
              outcome.error instanceof Error ? outcome.error.message : "An error occurred.",
          }),
        );
        return;
      }
    })();
  };

  const handleMultiSelectContextMenu = useStableCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      // One exact actionable set: keys whose rows are actually rendered
      // right now. Selections can outlive their rows (done-tail paging,
      // thread deletion elsewhere) and the menu labels must count only what
      // the actions will touch.
      const selectedThreadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      const threadKeys = selectedThreadKeys.filter((threadKey) => {
        const ref = parseScopedThreadKey(threadKey);
        return (
          ref !== null && readThreadShell(ref) !== null && threadByKeyRef.current.has(threadKey)
        );
      });
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      const selectionNow = new Date();
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const inDoneShelf = (thread: EnvironmentThreadShell) =>
        doneThreadKeysRef.current.has(
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        );
      const markingDoneThreads = selectedThreads.filter((thread) => !inDoneShelf(thread));
      const canSnoozeSelection = selectedThreads.every(
        (thread) =>
          serverConfigs.has(thread.environmentId) &&
          canSnooze(thread, { now: selectionNow.toISOString() }),
      );
      const titleRegenerationThreads = selectedThreads.filter((thread) =>
        serverConfigs.has(thread.environmentId),
      );
      const regeneratableTitleThreads = titleRegenerationThreads.filter(
        (thread) => thread.titleRegeneration == null,
      );
      const titleRegenerationMenuItem = buildBulkTitleRegenerationContextMenuItem({
        supportedCount: titleRegenerationThreads.length,
        actionableCount: regeneratableTitleThreads.length,
      });
      const pinnedSelectedThreads = selectedThreads.filter(
        (thread) => serverConfigs.has(thread.environmentId) && thread.pinnedAt != null,
      );
      const unpinMenuItem = buildBulkUnpinContextMenuItem({
        pinnedCount: pinnedSelectedThreads.length,
      });
      const snoozePresets = resolveSnoozePresets(new Date(), timestampFormat);
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            ...(unpinMenuItem
              ? [{ ...unpinMenuItem, disabled: !canOperateThreads(pinnedSelectedThreads) }]
              : []),
            {
              id: "mark-done",
              label: `Mark as Done (${count})`,
              disabled: markingDoneThreads.length === 0 || !canOperateThreads(markingDoneThreads),
            },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: `Snooze (${count})`,
                    disabled: !canOperateThreads(selectedThreads),
                    children: [
                      ...snoozePresets.map((preset) => ({
                        id: `snooze:${preset.id}`,
                        label: `${preset.label} (${preset.whenLabel})`,
                        disabled: !canOperateThreads(selectedThreads),
                      })),
                      {
                        id: "snooze:custom",
                        label: "Custom…",
                        separatorBefore: true,
                        disabled: !canOperateThreads(selectedThreads),
                      },
                    ],
                  },
                ]
              : []),
            ...(titleRegenerationMenuItem
              ? [
                  {
                    ...titleRegenerationMenuItem,
                    disabled:
                      titleRegenerationMenuItem.disabled ||
                      !canOperateThreads(regeneratableTitleThreads),
                  },
                ]
              : []),
            { id: "mark-unread", label: `Mark unread (${count})` },
            {
              id: "delete",
              label: `Delete (${count})`,
              destructive: true,
              disabled: !canOperateThreads(selectedThreads),
            },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure" || clicked.value === null) return;
      const actionTargets =
        clicked.value === "unpin"
          ? pinnedSelectedThreads
          : clicked.value === "regenerate-title"
            ? regeneratableTitleThreads
            : clicked.value === "mark-done"
              ? markingDoneThreads.flatMap((thread) => {
                  const current = threadByKeyRef.current.get(
                    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                  );
                  return current && !inDoneShelf(current) ? [current] : [];
                })
              : selectedThreads;
      if (clicked.value === "mark-done" && actionTargets.length === 0) return;
      if (clicked.value !== "mark-unread" && !checkThreadOperations(actionTargets)) return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset =
          clicked.value === "snooze:custom"
            ? await requestCustomSnooze()
            : snoozePresets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
        if (preset) {
          const coSnoozingKeys = new Set(threadKeys);
          clearSelection();
          const outcomes = await Promise.all(
            selectedThreads.map(async (thread) => {
              const threadRef = scopeThreadRef(thread.environmentId, thread.id);
              const outcome = await performSnooze(threadRef, preset, { coSnoozingKeys });
              return { outcome, threadRef };
            }),
          );
          const snoozedThreadRefs = outcomes.flatMap(({ outcome, threadRef }) =>
            outcome.status === "success" ? [threadRef] : [],
          );
          const failures = outcomes.flatMap(({ outcome }) =>
            outcome.status === "failure" ? [outcome.error] : [],
          );

          if (failures.length > 0) {
            const firstError = failures[0];
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title:
                  snoozedThreadRefs.length > 0
                    ? `Failed to snooze ${failures.length} thread${failures.length === 1 ? "" : "s"}`
                    : "Failed to snooze threads",
                description:
                  firstError instanceof Error ? firstError.message : "An error occurred.",
              }),
            );
          }
        }
        return;
      }
      if (clicked.value === "unpin") {
        for (const thread of pinnedSelectedThreads) {
          attemptUnpin(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value === "regenerate-title") {
        for (const thread of regeneratableTitleThreads) {
          const result = await updateThreadMetadata({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, regenerateTitle: true },
          });
          if (result._tag === "Success") continue;
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to regenerate thread titles",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        clearSelection();
        return;
      }
      if (clicked.value === "mark-done") {
        markThreadsDone(
          actionTargets.map((thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          ),
        );
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          if (thread) markThreadUnread(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value !== "delete") return;
      if (confirmThreadDelete) {
        const confirmed = await settlePromise(() =>
          api.dialogs.confirm(
            [
              `Delete ${count} thread${count === 1 ? "" : "s"}?`,
              "This permanently clears conversation history for these threads.",
            ].join("\n"),
            { variant: "destructive" },
          ),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      if (
        !checkThreadOperations(
          threadKeys.flatMap((threadKey) => {
            const thread = threadByKeyRef.current.get(threadKey);
            return thread ? [thread] : [];
          }),
        )
      )
        return;
      const { deletedThreadKeys, firstFailure } = await deleteSelectedThreadEntries({
        entries: threadKeys.map((threadKey) => ({ threadKey })),
        delete: async ({ threadKey }, deletedThreadKeys) => {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread) return null;
          return deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
            deletedThreadKeys,
          });
        },
      });
      if (firstFailure !== null) {
        const firstError = squashAtomCommandFailure(firstFailure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to delete threads",
            description: firstError instanceof Error ? firstError.message : "An error occurred.",
          }),
        );
      }
      removeFromSelection(
        getThreadKeysToDeselectAfterDelete(selectedThreadKeys, deletedThreadKeys, (threadKey) => {
          const threadRef = parseScopedThreadKey(threadKey);
          return threadRef !== null && readThreadShell(threadRef) !== null;
        }),
      );
    },
  );

  const handleDraftContextMenu = useStableCallback(
    (draftId: DraftId, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        const session = useComposerDraftStore.getState().getDraftSession(draftId);
        if (!api || !session || session.promotedTo) return;
        const projectGroup = projectGroupsRef.current.find((group) =>
          group.memberProjectRefs.some(
            (ref) =>
              ref.environmentId === session.environmentId && ref.projectId === session.projectId,
          ),
        );
        const workspacePath =
          session.worktreePath ??
          projectByKey.get(`${session.environmentId}:${session.projectId}`)?.workspaceRoot;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildDraftActionMenuItems({
              hasPath: Boolean(workspacePath),
              hasBranch: Boolean(session.branch),
              hasProject: projectGroup != null,
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "project-settings":
            if (projectGroup)
              openProjectSettings(projectGroup, {
                environmentId: session.environmentId,
                projectId: session.projectId,
              });
            return;
          case "copy-path":
            if (workspacePath) copyPathToClipboard(workspacePath, { path: workspacePath });
            return;
          case "copy-branch":
            if (session.branch) copyBranchToClipboard(session.branch, { branch: session.branch });
            return;
          case "discard": {
            // The menu can stay open while the draft sends; discarding a
            // promoting draft would strand the send.
            const current = useComposerDraftStore.getState().getDraftSession(draftId);
            if (current && !current.promotedTo) discardComposerDraft(draftId);
            return;
          }
        }
      })();
    },
  );

  const handleThreadContextMenu = useStableCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const selectionState = useThreadSelectionStore.getState();
        if (selectionState.hasSelection() && selectionState.selectedThreadKeys.has(threadKey)) {
          await handleMultiSelectContextMenu(position);
          return;
        }
        const thread = readThreadShell(threadRef);
        if (!thread) return;
        const threadWorkspacePath =
          thread.worktreePath ??
          projectByKey.get(`${thread.environmentId}:${thread.projectId}`)?.workspaceRoot ??
          null;
        const isRegeneratingTitle = thread.titleRegeneration != null;
        const isDone = doneThreadKeysRef.current.has(threadKey);
        const isSnoozed = snoozedThreadKeysRef.current.has(threadKey);
        const isPinned = thread.pinnedAt != null;
        const snoozePresets = resolveSnoozePresets(new Date(), timestampFormat);
        const threadProjectGroup =
          projectGroupsRef.current.find((project) =>
            project.memberProjectRefs.some(
              (projectRef) =>
                projectRef.environmentId === thread.environmentId &&
                projectRef.projectId === thread.projectId,
            ),
          ) ?? null;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildThreadActionMenuItems({
              canOperate: readEnvironmentScope(
                threadRef.environmentId,
                AuthOrchestrationOperateScope,
              ),
              branch: thread.branch ?? null,
              projectFilter: threadProjectGroup
                ? {
                    label: threadProjectGroup.displayName,
                    isActive: projectScopeKey === threadProjectGroup.projectKey,
                  }
                : null,
              isPinned,
              isDone,
              autoMarkDoneEnabled: thread.autoMarkDoneDisabledAt == null,
              isSnoozed,
              canSnoozeNow: canSnooze(thread, { now: new Date().toISOString() }),
              isRegeneratingTitle,
              isRunning: !threadRuntimeCanArchive(thread.runtime),
              snoozePresets,
              canOpenBeside: routeTarget !== null && routeThreadKey !== scopedThreadKey(threadRef),
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        if (threadActionRequiresOperate(clicked.value) && !checkThreadOperations([thread])) return;
        if (clicked.value?.startsWith("snooze:")) {
          const preset =
            clicked.value === "snooze:custom"
              ? await requestCustomSnooze()
              : snoozePresets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
          if (preset) attemptSnooze(threadRef, preset);
          return;
        }
        switch (clicked.value) {
          case "open-beside":
            if (!openThreadBeside({ kind: "server", threadRef }, "right")) {
              void navigateToThread(threadRef);
            }
            return;
          case "filter-by-project":
            if (threadProjectGroup) {
              setProjectScopeKey(
                projectScopeKey === threadProjectGroup.projectKey
                  ? null
                  : threadProjectGroup.projectKey,
              );
            }
            return;
          case "project-settings":
            if (threadProjectGroup)
              openProjectSettings(threadProjectGroup, {
                environmentId: threadRef.environmentId,
                projectId: thread.projectId,
              });
            return;
          case "new-thread-on-branch": {
            const result = await settlePromise(() =>
              handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "mark-done":
            attemptMarkDone(threadRef);
            return;
          case "reopen":
            attemptReopen(threadRef);
            return;
          case "unsnooze":
            attemptUnsnooze(threadRef);
            return;
          case "pin":
            attemptPin(threadRef);
            return;
          case "unpin":
            attemptUnpin(threadRef);
            return;
          case "auto-mark-done:enabled":
          case "auto-mark-done:disabled": {
            const result = await setThreadAutoMarkDone(
              threadRef,
              clicked.value === "auto-mark-done:enabled",
            );
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to update automatic completion",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "regenerate-title": {
            if (isRegeneratingTitle) return;
            const result = await updateThreadMetadata({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, regenerateTitle: true },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to regenerate thread title",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "mark-unread":
            markThreadUnread(threadRef);
            return;
          case "copy-path":
            if (!threadWorkspacePath) {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Path unavailable",
                  description: "This thread does not have a workspace path to copy.",
                }),
              );
              return;
            }
            copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
            return;
          case "copy-branch":
            if (thread.branch) {
              copyBranchToClipboard(thread.branch, { branch: thread.branch });
            }
            return;
          case "copy-thread-id":
            copyThreadIdToClipboard(thread.id, { threadId: thread.id });
            return;
          case "archive": {
            if (confirmThreadArchive) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(`Archive thread "${thread.title}"?`),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            let didArchive = false;
            const result = await archiveThread(threadRef, {
              onArchived: () => {
                didArchive = true;
              },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: didArchive
                    ? "Thread archived, but navigation failed"
                    : "Failed to archive thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            return;
          }
          case "delete": {
            if (confirmThreadDelete) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(
                  [
                    `Delete thread "${thread.title}"?`,
                    "This permanently clears conversation history for this thread.",
                  ].join("\n"),
                  { variant: "destructive" },
                ),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            const result = await deleteThread(threadRef);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to delete thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            return;
          }
          default:
            return;
        }
      })();
    },
  );

  useEffect(() => {
    const navigateToThreadKey = (targetThreadKey: string | null) => {
      if (!targetThreadKey) return false;
      const targetThread = threadByKey.get(targetThreadKey);
      if (!targetThread) return false;
      navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
      return true;
    };
    const navigateForCommand = (command: KeybindingCommand | null) => {
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        return navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeRowThreadKey,
            direction: traversalDirection,
          }),
        );
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return false;
      return navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen()) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
          isWeb: !isElectron,
          isDesktop: isElectron,
        },
      });
      if (!navigateForCommand(command)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    const unregister = registerAppCommandHandler(
      (command) => !isCommandPaletteOpen() && !isModelPickerOpen() && navigateForCommand(command),
    );
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      unregister();
    };
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    routeRowThreadKey,
    routeTerminalOpen,
    threadByKey,
  ]);

  const shouldShowJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    {
      platform: navigator.platform,
      context: {
        terminalFocus: terminalFocused,
        terminalOpen: routeTerminalOpen,
        modelPickerOpen: isModelPickerOpen(),
        isWeb: !isElectron,
        isDesktop: isElectron,
      },
    },
  );
  useEffect(() => {
    updateThreadJumpHintsVisibility(shouldShowJumpHintsNow);
  }, [shouldShowJumpHintsNow, updateThreadJumpHintsVisibility]);

  return (
    <>
      <ThreadContextDragGhost />
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup>
            <div className="flex flex-col gap-2">
              <SidebarPrimaryNavigation projectGroupCount={projectGroups.length} />
              {projectGroups.length > 0 ? (
                <SidebarThreadHeader
                  scopeLabel={scopedProjectGroup?.displayName ?? null}
                  onNewProject={openAddProjectCommandPalette}
                  optionsMenu={
                    <SidebarThreadListMenu
                      open={threadListMenuOpen}
                      onOpenChange={(open) => {
                        if (!open) return closeThreadListMenu();
                        suppressNextScopeChangeRef.current = false;
                        setThreadListMenuOpen(true);
                      }}
                      projectFilter={
                        <SidebarProjectFilterSubmenu
                          items={projectScopeItems}
                          value={projectScopeKey ?? "all"}
                          open={projectFilterOpen}
                          onOpenChange={setProjectFilterOpen}
                          projects={projectGroupByScopeKey}
                          environments={
                            showProjectEnvironments
                              ? {
                                  primaryEnvironmentId,
                                  machineByEnvironmentId: environmentMachineById,
                                }
                              : null
                          }
                          shortcutLabels={projectScopeJumpLabels}
                          onSelect={(value) => {
                            if (suppressNextScopeChangeRef.current) {
                              suppressNextScopeChangeRef.current = false;
                              return;
                            }
                            setProjectScopeKey(value === "all" ? null : value);
                          }}
                          onProjectSettings={handleProjectSettings}
                        />
                      }
                    />
                  }
                />
              ) : null}
            </div>
          </SidebarGroup>
        }
      >
        <SidebarGroup className="flex-1" role="presentation">
          <TooltipProvider
            key="sidebar-thread-tooltips-150"
            delay={150}
            closeDelay={0}
            timeout={400}
          >
            <DndContext
              sensors={dndSensors}
              autoScroll={!isContextDrag}
              collisionDetection={sidebarCollisionDetection}
              modifiers={dndModifiers}
              onDragStart={(event: DragStartEvent) =>
                isSidebarGroupId(String(event.active.id))
                  ? handleGroupDragStart()
                  : handleThreadDragStart(event)
              }
              onDragOver={handleThreadDragOver}
              onDragEnd={(event: DragEndEvent) =>
                isSidebarGroupId(String(event.active.id))
                  ? handleGroupDragEnd(event)
                  : handleThreadDragEnd(event)
              }
            >
              <SidebarDragLifecycle onUnmount={cancelThreadDrag} />
              <SortableContext items={sortableIds} strategy={sidebarSortingStrategy}>
                <ul
                  ref={attachListMotionRef}
                  // VoiceOver treats an exposed list as an interaction boundary,
                  // which hides its rows from ordinary linear navigation. A
                  // presentational list also makes its implicit listitems
                  // presentational while preserving every descendant control.
                  role="presentation"
                  className={cn(
                    // The last shelf is bottom-pinned; let it use the group's
                    // bottom inset once instead of adding a second gap above
                    // the footer's own vertical inset.
                    "relative -mb-2 flex flex-col gap-px",
                    sidebarHasThreadSections && "flex-1",
                    actionSweep !== null && "**:pointer-events-none",
                  )}
                >
                  {(() => {
                    const renderThreadRow = (
                      thread: EnvironmentThreadShell,
                      section: SidebarSection,
                      showProjectIcon: boolean,
                    ) => {
                      const threadKey = scopedThreadKey(
                        scopeThreadRef(thread.environmentId, thread.id),
                      );
                      const isActive = routeRowThreadKey === threadKey;
                      return (
                        <SortableThreadRow
                          inOtherPane={!isActive && paneThreadKeys.has(threadKey)}
                          key={threadKey}
                          sortableId={threadKey}
                          contextDrag={isContextDrag}
                          sortableDisabled={
                            renamingThreadKey === threadKey ||
                            !draggableThreadKeys.has(threadKey) ||
                            optimisticDrop !== null
                          }
                          thread={thread}
                          // Snoozed rows wake, done rows reopen, and active rows become done.
                          variantAction={
                            section === "snoozed"
                              ? "unsnooze"
                              : section === "done"
                                ? "reopen"
                                : "mark-done"
                          }
                          markDoneSupported={serverConfigs.has(thread.environmentId)}
                          snoozeSupported={serverConfigs.has(thread.environmentId)}
                          pinningSupported={serverConfigs.has(thread.environmentId)}
                          isPinned={thread.pinnedAt != null}
                          dropVerb={
                            dragState?.activeKey === threadKey
                              ? resolveSidebarDropVerb(dragState.activeSection, dragTargetSection)
                              : null
                          }
                          dragOverPinned={
                            dragState?.activeKey === threadKey && dragTargetSection === "pinned"
                          }
                          sweepAction={actionSweep?.keys.has(threadKey) ? actionSweep.action : null}
                          snoozeWakeLabelText={
                            section === "snoozed" && thread.snoozedUntil != null
                              ? snoozeWakeLabel(thread.snoozedUntil, { now: snoozeNow })
                              : null
                          }
                          // All sections: a woken thread can classify straight
                          // into the done tail (PR merged while snoozed), and
                          // the wake signal must survive the trip. Still-snoozed
                          // rows resolve to null on their own.
                          wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                          isActive={isActive}
                          isRouteThread={routeThreadKey === threadKey}
                          pinShortcut={routeThreadKey === threadKey ? pinShortcut : null}
                          doneShortcut={routeThreadKey === threadKey ? doneShortcut : null}
                          openPullRequestsInRightPanel={routeThreadRef !== null}
                          jumpLabel={showJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null}
                          currentEnvironmentId={primaryEnvironmentId}
                          environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                          environmentMachine={
                            environmentMachineById.get(thread.environmentId) ?? "server"
                          }
                          scratchMachineLabel={scratchMachineLabelFor(thread)}
                          project={
                            projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                          }
                          showProjectIcon={showProjectIcon}
                          projectDisplayName={
                            projectDisplayNameByKey.get(
                              `${thread.environmentId}:${thread.projectId}`,
                            ) ?? null
                          }
                          providerEntryByInstanceId={
                            providerEntriesByEnvironment.get(thread.environmentId) ??
                            EMPTY_PROVIDER_ENTRIES
                          }
                          onThreadClick={handleThreadClick}
                          onThreadActivate={navigateToThread}
                          onStartRename={startThreadRename}
                          onRenameTitleChange={setRenamingTitle}
                          onCommitRename={commitThreadRename}
                          onCancelRename={cancelThreadRename}
                          isRenaming={renamingThreadKey === threadKey}
                          renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
                          onContextMenu={handleThreadContextMenu}
                          onMarkDone={attemptMarkDone}
                          onActionSweepStart={startActionSweep}
                          onReopen={attemptReopen}
                          onSnooze={attemptSnooze}
                          onUnsnooze={attemptUnsnooze}
                          onPin={attemptPin}
                          onUnpin={attemptUnpinWithoutDialog}
                          onAcknowledgeWoke={acknowledgeWoke}
                          onFileDropThreads={handleThreadFileDrop}
                        />
                      );
                    };
                    const from = isContextDrag ? null : (dragState?.activeSection ?? null);
                    const items: ReactNode[] = pendingThreads.map((entry) => (
                      <SidebarPendingThreadRow
                        key={`pending:${entry.scope}`}
                        entry={entry}
                        projectTitle={
                          entry.payload.input.bootstrap?.createThread
                            ? projectDisplayNameByKey.get(
                                `${entry.payload.environmentId}:${entry.payload.input.bootstrap.createThread.projectId}`,
                              )
                            : undefined
                        }
                        active={entry.scope === routeThreadKey}
                        onNavigate={navigateToThread}
                      />
                    ));
                    let underProjectGroup = false;
                    for (const item of sidebarListItems) {
                      if (item.kind === "thread") {
                        items.push(
                          renderThreadRow(
                            threadByKey.get(item.key)!,
                            item.section,
                            !underProjectGroup,
                          ),
                        );
                        continue;
                      }
                      underProjectGroup = item.kind === "group" && item.projectKey !== null;
                      if (item.kind === "group") {
                        items.push(
                          <SidebarGroupHeader
                            key={sidebarListItemId(item)}
                            item={item}
                            project={
                              item.projectKey === null
                                ? null
                                : (projectGroupByScopeKey.get(item.projectKey) ?? null)
                            }
                            onToggle={toggleThreadGroup}
                            prepare={prepareShelfMotion}
                          />,
                        );
                        continue;
                      }
                      switch (item.marker) {
                        case "pinned-header":
                          items.push(
                            pinnedThreads.length > 0 ? (
                              <SidebarSectionHeader
                                key="pinned-header"
                                marker="pinned-header"
                                label={
                                  pinnedShelfVisible ? "Pinned" : `Pinned (${pinnedThreads.length})`
                                }
                                dragging={from !== null}
                                isDropTarget={dragTargetSection === "pinned"}
                                toggle={{
                                  expanded: pinnedShelfVisible,
                                  onToggle: togglePinnedShelf,
                                  prepare: prepareShelfMotion,
                                }}
                              />
                            ) : (
                              <SidebarDragBoundary
                                key="pinned-header"
                                marker="pinned-header"
                                label="Pinned"
                                visible={from !== null}
                                isDropTarget={dragTargetSection === "pinned"}
                              />
                            ),
                          );
                          break;
                        case "drafts-block":
                          items.push(
                            <SidebarDraftBlock
                              key="draft-sessions"
                              projectByKey={projectByKey}
                              projectDisplayNameByKey={projectDisplayNameByKey}
                              scopedProjectKeys={scopedProjectKeys}
                              routeDraftId={routeDraftIdForRows}
                              onNavigateToDraft={navigateToDraft}
                              onDraftContextMenu={handleDraftContextMenu}
                            />,
                          );
                          break;
                        case "pinned-divider":
                          items.push(
                            <SidebarDragBoundary
                              key="pinned-divider"
                              marker="pinned-divider"
                              label="Active"
                              persistent={pinnedThreads.length > 0 && inboxCount > 0}
                              visible={from !== null}
                              isDropTarget={dragTargetSection === "active"}
                            />,
                          );
                          break;
                        case "active-placeholder":
                          items.push(
                            <SidebarSectionPlaceholder
                              key="active-placeholder"
                              marker="active-placeholder"
                              label="Active"
                              showHint={
                                from !== null &&
                                (inboxCount === 0 ||
                                  (from === "active" &&
                                    inboxCount === 1 &&
                                    dragTargetSection !== null &&
                                    dragTargetSection !== "active"))
                              }
                              isDropTarget={dragTargetSection === "active"}
                            />,
                          );
                          break;
                        case "working-header":
                          items.push(
                            <SidebarSectionHeader
                              key="working-shelf-header"
                              marker="working-header"
                              className="mt-auto"
                              label={
                                workingShelfExpanded
                                  ? "Working"
                                  : `Working (${workingThreads.length})`
                              }
                              toggle={{
                                expanded: workingShelfExpanded,
                                onToggle: toggleWorkingShelf,
                                prepare: prepareShelfMotion,
                              }}
                            />,
                          );
                          break;
                        case "snoozed-header":
                          items.push(
                            <SidebarSectionHeader
                              key="snoozed-shelf-header"
                              marker="snoozed-header"
                              className={cn(!showWorkingShelf && "mt-auto")}
                              label={
                                snoozedShelfExpanded
                                  ? "Snoozed"
                                  : `Snoozed (${snoozedThreads.length})`
                              }
                              toggle={{
                                expanded: snoozedShelfExpanded,
                                onToggle: toggleSnoozedShelf,
                                prepare: prepareShelfMotion,
                              }}
                            />,
                          );
                          break;
                        case "done-header":
                          items.push(
                            !showWorkingShelf && snoozedThreads.length === 0 ? (
                              <li
                                key="done-shelf-spacer"
                                aria-hidden
                                className="mt-auto h-0 list-none"
                              />
                            ) : null,
                            <SidebarSectionHeader
                              key="done-shelf-header"
                              marker="done-header"
                              label={doneShelfExpanded ? "Done" : `Done (${doneThreads.length})`}
                              dragging={from !== null}
                              isDropTarget={dragTargetSection === "done"}
                              toggle={{
                                expanded: doneShelfExpanded,
                                onToggle: toggleDoneShelf,
                                prepare: prepareShelfMotion,
                              }}
                            />,
                          );
                          break;
                        case "done-placeholder":
                          items.push(
                            <SidebarSectionPlaceholder
                              key="done-placeholder"
                              marker="done-placeholder"
                              label="Done"
                              showHint={
                                from !== null &&
                                (renderedDoneThreads.length === 0 ||
                                  (from === "done" &&
                                    renderedDoneThreads.length === 1 &&
                                    dragTargetSection !== null &&
                                    dragTargetSection !== "done"))
                              }
                              isDropTarget={dragTargetSection === "done"}
                            />,
                          );
                          break;
                      }
                    }
                    return items;
                  })()}
                  {doneShelfExpanded && hiddenDoneCount > 0 ? (
                    <li className="list-none">
                      <button
                        type="button"
                        onClick={showMoreDone}
                        className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                      >
                        <PlusIcon aria-hidden className="size-4 shrink-0" />
                        Show {Math.min(hiddenDoneCount, DONE_TAIL_PAGE_COUNT)} more
                      </button>
                    </li>
                  ) : null}
                </ul>
              </SortableContext>
            </DndContext>
          </TooltipProvider>
          {visibleDraftSessionCount === 0 &&
          pendingThreads.length === 0 &&
          pinnedThreads.length +
            activeThreads.length +
            workingThreads.length +
            snoozedThreads.length +
            doneThreads.length ===
            0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {projects.length === 0 ? (
                <>
                  <span>No projects yet</span>
                  <button
                    type="button"
                    onClick={openAddProjectCommandPalette}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon className="-mx-0.5 size-3" />
                    Add project
                  </button>
                </>
              ) : scopedProjectGroup ? (
                `No threads in ${scopedProjectGroup.displayName} yet`
              ) : (
                "No threads yet"
              )}
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
