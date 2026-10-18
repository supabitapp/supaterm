import { SidebarPendingThreadRow } from "./SidebarPendingThreadRow";
import { useThreadOutbox } from "../state/threadOutbox";
import { type EnvironmentId, type ScopedProjectRef } from "@supaterm/contracts";
import type { EnvironmentServerConfig } from "@supaterm/client-runtime/connection";
import { ThreadHoverCard, ThreadHoverCardPopup } from "./ThreadHoverCard";
import { CollapsibleSectionHeader } from "./ui/collapsible-section-header";
import { ThreadContextDragGhost } from "./chat/ThreadContextDragGhost";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag as moveThreadContextDragGhost,
} from "./chat/threadContextDrag";
import { discardComposerDraft } from "../lib/discardComposerDraft";
import { requestCustomSnooze } from "./CustomSnoozeDialog";
import { resolveThreadCurrentPullRequestLink } from "@supaterm/shared/threadPullRequests";
import { getProviderOptionDescriptors } from "@supaterm/shared/model";
import { formatModelSelectionEffort } from "@supaterm/client-runtime/state/thread-execution";
import {
  getSpeedToggle,
  SPEED_TOGGLE_LABELS,
} from "@supaterm/client-runtime/provider-speed-toggle";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { isEnvironmentConnected } from "@supaterm/client-runtime/connection";
import { replaceComposerContextReferences } from "@supaterm/shared/composerContextReferences";
import * as Schema from "effect/Schema";
import {
  DndContext,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  canSnooze,
  effectiveSnoozed,
  threadWokeAt,
} from "@supaterm/client-runtime/state/thread-snooze";
import { createInboxReturnTracker } from "@supaterm/client-runtime/state/thread-inbox";
import {
  resolveDoneThreadTimestamp,
  sortDoneThreads,
} from "@supaterm/client-runtime/state/thread-sort";
import {
  resolveThreadProviderStack,
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
  type EnvironmentMachineKind,
  type ScopedThreadRef,
  type ThreadId,
} from "@supaterm/contracts";

import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  ArrowRightLeftIcon,
  BrainIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  FolderIcon,
  GitBranchIcon,
  ListFilterIcon,
  MessageCircleQuestionIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SettingsIcon,
  ShieldQuestionIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";

import { useRightPanelStore } from "../rightPanelStore";
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
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { readLocalApi } from "../localApi";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { selectProjectGroupingSettings } from "../logicalProject";
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
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { registerMarkDoneAndAdvance } from "../markDoneAndAdvance";
import { useClientSettings } from "../hooks/useSettings";
import { usePickerShortcuts } from "../hooks/usePickerShortcuts";
import { Kbd } from "./ui/kbd";
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
  useSidebarThreadShells,
  useThreadRefs,
  useThreadShell,
} from "../state/entities";
import { useSidebarThreadNavigation } from "../hooks/useSidebarThreadNavigation";
import { primaryServerKeybindingsAtom } from "../state/server";
import { environmentProjects } from "../state/projects";
import { vcsEnvironment } from "../state/vcs";
import { threadEnvironment } from "../state/threads";
import { useEnvironmentQuery } from "../state/query";
import { environmentPresentations } from "../state/presentation";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { buildThreadRouteParams, resolveActiveThreadRouteRef } from "../threadRoutes";
import { formatRelativeTimeLabel, parseTimestampDate } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { cn } from "~/lib/utils";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { ProjectEnvironmentBadge } from "./ProjectEnvironmentBadge";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
  threadActionRequiresOperate,
} from "./threadActionMenu.logic";
import {
  animateSidebarLayoutChanges,
  applySidebarThreadDrop,
  filterSidebarV2VisibleThreads,
  buildBulkTitleRegenerationContextMenuItem,
  buildBulkUnpinContextMenuItem,
  deleteSelectedThreadEntries,
  filterSidebarProjectScopeItems,
  formatWorkingDurationLabel,
  firstValidTimestampMs,
  hasUnseenCompletion,
  isSidebarNestedLinkClick,
  isSidebarThreadWorking,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  planSidebarThreadDrop,
  reduceSidebarProjectScopeMenuState,
  resolveAdjacentThreadId,
  resolveSidebarSweepKeys,
  resolveSidebarDropTarget,
  resolveSidebarDropVerb,
  resolveSidebarThreadSection,
  resolveSidebarRowAccessibility,
  type SidebarDropVerb,
  type SidebarSweepAction,
  resolveSidebarThreadStatus,
  resolveSidebarV2DurationStartedAt,
  resolveSidebarV2TopStatus,
  shouldNavigateAfterThreadPark,
  shouldRecedeSidebarThread,
  shouldShowSidebarV2Duration,
  sidebarListItemId,
  sidebarMarkerId,
  sidebarThreadKeyAtY,
  sortInboxThreadsByReturn,
  sortPinnedThreadsForSidebar,
  sortWorkingThreadsBySend,
  useThreadJumpHintVisibility,
  useRetainedValue,
  useSidebarRowSubscriptionLease,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "./BranchToolbar.logic";
import {
  createSidebarCollisionDetection,
  createSidebarSortingStrategy,
  restrictBelowSidebarLabel,
} from "./Sidebar.drag";
import { SidebarDragLifecycle, SidebarPointerSensor } from "./Sidebar.pointer";
import { createSidebarListMotion } from "./Sidebar.motion";
import {
  ThreadPullRequestBadgeControl,
  ThreadPullRequestsMiniList,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
  terminalStatusFromRunningIds,
  ThreadTerminalStatusButton,
  type TerminalStatusIndicator,
  useLinkedThreadPullRequest,
} from "./ThreadStatusIndicators";
import { resolveSnoozePresets, snoozeWakeLabel, type SnoozePreset } from "./Sidebar.snooze";
import { ProjectFavicon, type ProjectFaviconProject } from "./ProjectFavicon";
import { makeWorkspaceFileDropHandlers } from "./chat/workspaceFileDrop";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "./chat/providerIconUtils";
import {
  deriveProviderEntriesByEnvironment,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useStableCallback } from "../hooks/useStableCallback";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Button, InlineButton } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  useComboboxFilter,
} from "./ui/combobox";
import { SidebarContent, SidebarGroup, useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { SidebarHeaderIconButton, SidebarThreadHeader } from "./sidebar/SidebarThreadHeader";
import { SidebarPrimaryNavigation } from "./sidebar/SidebarPrimaryNavigation";
import { SidebarPinButton } from "./sidebar/SidebarPinButton";
import { SidebarParkedActionButton } from "./sidebar/SidebarParkedActionButton";
import { SidebarSnoozeButton } from "./sidebar/SidebarSnoozeButton";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { MiddleTruncate } from "./ui/middle-truncate";
import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
  useThreadHasUnsentDraft,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";

// Done-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more.
// The fields thread rows show. Provider status pushes refresh `checkedAt`,
// status and auth on every provider; leaving those out keeps each
// environment's map, and every memoized row, stable across them.
type SidebarProviderEntry = Pick<
  ProviderInstanceEntry,
  | "instanceId"
  | "driverKind"
  | "displayName"
  | "accentColor"
  | "acpRegistryAgentId"
  | "acpRegistryIconUrl"
  | "models"
>;

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

const DONE_TAIL_INITIAL_COUNT = 10;
const DONE_TAIL_PAGE_COUNT = 25;
const PINNED_SHELF_EXPANDED_KEY = "supaterm:sidebar:pinned-expanded";
const DONE_SHELF_EXPANDED_KEY = "supaterm:sidebar:done-expanded";
const SNOOZED_SHELF_EXPANDED_KEY = "supaterm:sidebar:snoozed-expanded";
const WORKING_SHELF_EXPANDED_KEY = "supaterm:sidebar:working-expanded";
const DRAFTS_SHELF_EXPANDED_KEY = "supaterm:sidebar:drafts-expanded";

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

function threadShellKey(thread: Pick<SidebarThreadSummary, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

const NO_DRAGGED_ORDER: readonly string[] = [];
const NO_DRAGGED_ORDERS: {
  readonly doneOrder: readonly string[];
  readonly activeOrder: readonly string[] | undefined;
} = { doneOrder: NO_DRAGGED_ORDER, activeOrder: undefined };

// Where the dragged row would sort if dropped on the done or the
// time-ordered active shelf; the strategy previews those slots.
function resolveDraggedOrders(input: {
  readonly drag: { readonly activeKey: string; readonly occurredAt: string };
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly doneThreads: readonly EnvironmentThreadShell[];
  readonly activeThreads: readonly EnvironmentThreadShell[];
}): typeof NO_DRAGGED_ORDERS {
  const { drag, threadByKey, doneThreads, activeThreads } = input;
  const thread = threadByKey.get(drag.activeKey);
  if (thread === undefined) return NO_DRAGGED_ORDERS;
  const others = (list: readonly EnvironmentThreadShell[]) =>
    list.filter((candidate) => threadShellKey(candidate) !== drag.activeKey);
  return {
    doneOrder: sortDoneThreads([
      ...others(doneThreads),
      applySidebarThreadDrop(thread, "done", drag.occurredAt),
    ]).map(threadShellKey),
    activeOrder: sortInboxThreadsByReturn(
      [...others(activeThreads), applySidebarThreadDrop(thread, "active", drag.occurredAt)],
      inboxReturns.returnedAt,
    ).map(threadShellKey),
  };
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
  readonly routeThreadKey: string | null;
  readonly dragging: boolean;
}) {
  const { projectScopeKey, scopedProjectKeys, serverConfigs, optimisticDrop, routeThreadKey } =
    input;
  const threads = useSidebarThreadShells();
  const serverThreadRefs = useThreadRefs();
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
    if (routeThreadKey !== null) {
      const routeThread = doneThreads
        .slice(doneVisibleCount)
        .find((thread) => threadShellKey(thread) === routeThreadKey);
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible;
  })();
  const renderedDoneThreads = doneShelfExpanded
    ? visibleDoneThreads
    : routeThreadOnly(visibleDoneThreads, routeThreadKey);
  const visibleSnoozedThreads = snoozedShelfExpanded
    ? snoozedThreads
    : routeThreadOnly(snoozedThreads, routeThreadKey);
  // Sending a message folds the open thread into the Working shelf, and its
  // row must stay visible there.
  const visibleWorkingThreads = workingShelfExpanded
    ? workingThreads
    : routeThreadOnly(workingThreads, routeThreadKey);
  // Dragging exposes the full saved pin order without changing the preference.
  const pinnedShelfVisible = pinnedShelfExpanded || input.dragging;
  const visiblePinnedThreads = pinnedShelfVisible
    ? pinnedThreads
    : routeThreadOnly(pinnedThreads, routeThreadKey);
  const orderedThreads = [
    ...visiblePinnedThreads,
    ...activeThreads,
    ...visibleWorkingThreads,
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
    { value: "all", label: "All projects" },
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

function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function threadTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Done rows read "how long ago did this wrap up", matching their sort
// key: both go through resolveDoneThreadTimestamp so label and order can't
// disagree.
function doneTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = resolveDoneThreadTimestamp(thread);
  return timestamp === null ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Floats at the row's right edge, vertically centered, while the jump
// modifier is held. An overlay pill instead of an inline slot: the hint
// must neither displace the status/time label (holding ⌘ used to blank
// out "Working") nor shift any layout when it appears. pointer-events-none
// so it never swallows clicks meant for the mark-done/reopen buttons it
// can overlap.
function JumpHintBadge(props: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-border/80 bg-background/95 px-1.5 font-mono text-3xs font-medium tracking-tight text-foreground shadow-sm"
    >
      {props.label}
    </span>
  );
}

// Only the time label subscribes to the shared minute clock.
function SidebarRelativeTime({
  timestamp,
  className,
}: {
  timestamp: string;
  className?: string | undefined;
}) {
  const nowMinute = useNowMinute();
  return (
    <time
      dateTime={timestamp}
      className={cn("shrink-0 text-right text-xs text-secondary-label tabular-nums", className)}
    >
      {compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp, Date.parse(`${nowMinute}:00Z`)))}
    </time>
  );
}

// The elapsed label ticks independently so the row and its queries stay idle.
function WorkingDuration({ startedAt }: { startedAt: string | null }) {
  const startedMs = startedAt === null ? Number.NaN : Date.parse(startedAt);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(startedMs)) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedMs]);
  if (!Number.isFinite(startedMs)) return null;
  return <span className="tabular-nums">{formatWorkingDurationLabel(nowMs - startedMs)}</span>;
}

function terminalProcessLabel(count: number): string {
  return `${count} terminal ${count === 1 ? "process" : "processes"} running`;
}

function SidebarProviderStack(props: {
  thread: SidebarThreadSummary;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
}) {
  const stack = resolveThreadProviderStack(props.thread);
  const currentInstanceId = stack[stack.length - 1]!;
  const currentEntry = props.providerEntryByInstanceId.get(currentInstanceId) ?? null;
  if (currentEntry === null) return null;
  const showInstanceBadge = shouldShowInstanceBadge(
    currentEntry,
    props.providerEntryByInstanceId.values(),
  );
  const current = (
    <ProviderInstanceIcon
      driverKind={currentEntry.driverKind}
      displayName={currentEntry.displayName}
      accentColor={currentEntry.accentColor}
      acpRegistryAgentId={currentEntry.acpRegistryAgentId}
      acpRegistryIconUrl={currentEntry.acpRegistryIconUrl}
      showBadge={showInstanceBadge}
      iconClassName="size-3.5 opacity-60"
      badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
    />
  );
  if (stack.length === 1) {
    return <span className="inline-flex shrink-0 items-center">{current}</span>;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {stack.slice(0, -1).map((instanceId) => {
        const entry = props.providerEntryByInstanceId.get(instanceId);
        if (entry === undefined) return null;
        return (
          <ProviderInstanceIcon
            key={instanceId}
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            iconClassName="size-3 opacity-35 grayscale"
          />
        );
      })}
      <span className="relative z-10 inline-flex items-center">{current}</span>
    </span>
  );
}

function SidebarThreadTooltip({
  thread,
  project,
  projectDisplayName,
  environmentLabel,
  environmentMachine,
  providerEntry,
  providerEntryByInstanceId,
  showInstanceBadge,
  modelInstanceId,
  modelLabel,
  branchMismatch,
  terminalStatus,
  terminalProcessCount,
}: {
  thread: SidebarThreadSummary;
  project: ProjectFaviconProject | null;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntry: SidebarProviderEntry | null;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  showInstanceBadge: boolean;
  modelInstanceId: string;
  modelLabel: string;
  branchMismatch: {
    threadBranch: string;
    currentBranch: string;
  } | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalProcessCount: number;
}) {
  const driverKind = providerEntry?.driverKind ?? null;
  const models = providerEntry?.models ?? [];
  const effortLabel = formatModelSelectionEffort(thread.modelSelection, models);
  const selectedModel = models.find((model) => model.slug === thread.modelSelection.model);
  const descriptors = selectedModel?.capabilities
    ? getProviderOptionDescriptors({
        caps: selectedModel.capabilities,
        selections: thread.modelSelection.options,
      })
    : [];
  const speedToggle = getSpeedToggle(driverKind, descriptors);
  const previousProviderNames = thread.providerInstanceHistory
    .filter((instanceId) => instanceId !== modelInstanceId)
    .map((instanceId) => providerEntryByInstanceId.get(instanceId)?.displayName ?? instanceId);
  return (
    <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
      <ThreadHoverCard
        title={thread.title}
        footer={
          thread.pullRequests.length > 0 ? (
            <div className="border-t border-border/60 pt-2 pl-0.5 text-xs text-muted-foreground">
              <ThreadPullRequestsMiniList pullRequests={thread.pullRequests} />
            </div>
          ) : null
        }
      >
        {projectDisplayName ? (
          <div className="flex min-w-0 items-center gap-2">
            {project ? <ProjectFavicon project={project} className="size-3 shrink-0" /> : null}
            <div className="min-w-0 truncate text-foreground/75">{projectDisplayName}</div>
          </div>
        ) : null}
        {environmentLabel ? (
          <div className="flex min-w-0 items-center gap-2">
            <EnvironmentMachineIcon
              kind={environmentMachine}
              className="size-3 shrink-0 stroke-muted-foreground"
            />
            <div className="min-w-0 truncate text-foreground/75">{environmentLabel}</div>
          </div>
        ) : null}
        {thread.branch ? (
          <div className="flex min-w-0 items-center gap-2">
            <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
            <MiddleTruncate value={thread.branch} className="flex" />
          </div>
        ) : null}
        {branchMismatch ? (
          <div className="flex min-w-0 items-start gap-2 text-warning">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
            <div className="min-w-0 flex-1 wrap-break-word leading-5">
              You're currently checked out on another branch.
            </div>
          </div>
        ) : null}
        {driverKind ? (
          <div className="flex min-w-0 items-center gap-2">
            <ProviderInstanceIcon
              driverKind={driverKind}
              displayName={
                providerEntry?.displayName ?? thread.runtime?.providerName ?? modelInstanceId
              }
              accentColor={providerEntry?.accentColor}
              acpRegistryAgentId={providerEntry?.acpRegistryAgentId}
              acpRegistryIconUrl={providerEntry?.acpRegistryIconUrl}
              showBadge={showInstanceBadge && providerEntry?.accentColor !== undefined}
              badgeContent="none"
              badgeClassName="h-2 min-w-2 px-0"
              iconClassName="size-3 shrink-0 grayscale opacity-60"
            />
            <div className="min-w-0 truncate text-foreground/75">
              {showInstanceBadge && providerEntry
                ? `${modelLabel} · ${providerEntry.displayName}`
                : modelLabel}
            </div>
          </div>
        ) : null}
        {effortLabel ? (
          <div className="flex min-w-0 items-center gap-2">
            <BrainIcon aria-hidden className="size-3 shrink-0 stroke-muted-foreground" />
            <div className="min-w-0 truncate text-foreground/75">Thinking: {effortLabel}</div>
          </div>
        ) : null}
        {speedToggle ? (
          <div className="flex min-w-0 items-center gap-2">
            <ZapIcon aria-hidden className="size-3 shrink-0 stroke-muted-foreground" />
            <div className="min-w-0 truncate text-foreground/75">
              {SPEED_TOGGLE_LABELS[speedToggle.level]}
            </div>
          </div>
        ) : null}
        {previousProviderNames.length > 0 ? (
          <div className="flex min-w-0 items-center gap-2">
            <ArrowRightLeftIcon className="size-3 shrink-0 stroke-muted-foreground" />
            <div className="min-w-0 truncate text-foreground/75">
              Handed off from {previousProviderNames.join(", ")}
            </div>
          </div>
        ) : null}
        {terminalStatus ? (
          <div className="flex min-w-0 items-center gap-2">
            <TerminalIcon
              aria-hidden
              className={cn("size-3 shrink-0", terminalStatus.colorClass)}
            />
            <div className="min-w-0 truncate text-foreground/75">
              {terminalProcessLabel(terminalProcessCount)}
            </div>
          </div>
        ) : null}
        {thread.runtime?.lastError ? (
          <div
            className={cn(
              "flex min-w-0 items-center gap-2",
              thread.runtime.lastErrorClass === "usage_limit" ? "text-warning" : "text-error",
            )}
          >
            <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
            <div className="min-w-0 truncate">
              {thread.runtime.lastErrorClass === "usage_limit"
                ? "Usage limit reached"
                : "Error occurred"}
            </div>
          </div>
        ) : null}
      </ThreadHoverCard>
    </ThreadHoverCardPopup>
  );
}

type SortableThreadRowBag = Pick<
  ReturnType<typeof useSortable>,
  "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
>;

// useSortable memoizes on its `disabled` object, so a fresh one per render
// re-renders every row and marker on each sidebar update.
const SIDEBAR_SORTABLE_DRAG_DISABLED = { draggable: true } as const;
const SIDEBAR_SORTABLE_DRAG_ENABLED = { draggable: false } as const;

// Takes the row's props rather than a render function: a closure from the
// sidebar body is new on every sidebar render, which rebuilt the bag and
// re-rendered every memoized row with it.
function SortableThreadRow(
  props: Omit<SidebarThreadRowProps, "sortable"> & {
    sortableId: string;
    sortableDisabled: boolean;
    contextDrag: boolean;
  },
) {
  const { sortableId, sortableDisabled, contextDrag, ...rowProps } = props;
  const canOperateThread = useEnvironmentScope(
    rowProps.thread.environmentId,
    AuthOrchestrationOperateScope,
  );
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled:
      sortableDisabled || !canOperateThread
        ? SIDEBAR_SORTABLE_DRAG_DISABLED
        : SIDEBAR_SORTABLE_DRAG_ENABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // dnd-kit memoizes each field but not the bag, so the memoized row would
  // rerender on every shell update without this.
  const bag = {
    listeners,
    setNodeRef,
    transform: contextDrag ? null : transform,
    transition: contextDrag && isDragging ? "transform 150ms ease-out" : transition,
    isDragging: isDragging && !contextDrag,
  };
  return <SidebarThreadRow {...rowProps} sortable={bag} />;
}

// The pen identifies unsent work on both draft sessions and existing threads.
const draftPenClassName = "size-3 shrink-0 text-warning-foreground";

function SidebarDraftDiscardButton(props: {
  onClick: (event: ReactMouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <span className="group/draft-action relative inline-flex size-4 shrink-0 items-center justify-center">
      <span className="inline-flex items-center justify-center group-any-hover/sidebar-row:invisible group-has-[:focus-visible]/draft-action:invisible">
        {props.children}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Discard draft"
              onClick={props.onClick}
              onPointerDown={(event) => event.stopPropagation()}
              className="pointer-events-none absolute inset-0 inline-flex cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100"
            />
          }
        >
          <XIcon aria-hidden className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">Discard draft</TooltipPopup>
      </Tooltip>
    </span>
  );
}

function SortableSidebarMarker(props: {
  marker: SidebarListMarker;
  className?: string;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  const { setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-testid={props["data-testid"]}
      className={cn("list-none", props.className)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

function SidebarSectionPlaceholder(props: {
  marker: "active-placeholder" | "done-placeholder";
  label: string;
  showHint: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="relative mx-0.5 -mb-px h-0"
    >
      {props.showHint ? (
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-md border border-dashed border-sidebar-foreground/25 text-xs text-sidebar-foreground/80",
            props.isDropTarget && "border-primary/40 bg-primary/5 text-primary",
          )}
        >
          {props.label}
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

const SIDEBAR_DRAG_DISTANCE = 6;

const SIDEBAR_DRAG_LABEL_HEIGHT = 24;

function SidebarDragBoundary(props: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  persistent?: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("pointer-events-none relative mx-0.5", props.persistent ? "h-8" : "-mb-px h-0")}
    >
      {props.visible || props.persistent ? (
        <div
          className={cn(
            "sidebar-drag-boundary-label absolute inset-x-2 flex h-4 items-center gap-2",
            props.persistent ? "top-2" : "top-1",
          )}
        >
          <span
            className={cn(
              "shrink-0 text-xs",
              props.isDropTarget ? "text-primary" : "text-sidebar-muted-foreground/60",
            )}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "h-px flex-1",
              props.isDropTarget ? "bg-primary/50" : "bg-sidebar-border/60",
            )}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

function SidebarSectionHeader(props: {
  marker: "pinned-header" | "working-header" | "snoozed-header" | "done-header";
  label: string;
  className?: string;
  // While dragging, the done header reads at full strength and takes the
  // accent while the lifted row is over it.
  dragging?: boolean;
  isDropTarget?: boolean;
  toggle: { expanded: boolean; onToggle: () => void; prepare: () => void };
}) {
  const shelf = props.marker.replace("-header", "");
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("mx-0.5 h-8", props.className)}
    >
      <CollapsibleSectionHeader
        onClick={() => {
          props.toggle.prepare();
          props.toggle.onToggle();
        }}
        expanded={props.toggle.expanded}
        weight="normal"
        tone={props.isDropTarget ? "accent" : props.dragging ? "emphasized" : "muted"}
        data-testid={`sidebar-${shelf}-shelf-toggle`}
      >
        {props.label}
      </CollapsibleSectionHeader>
    </SortableSidebarMarker>
  );
}

// One unsent draft session the user has invested content in. Two lines,
// with the typed prompt above the branch or project name. All the draft's
// settings (model, env mode, branch, worktree) still travel with it —
// clicking is a plain navigation to /draft/$draftId, which touches nothing.
// While the draft is open the row renders a frozen snapshot (see
// SidebarDraftBlock); memoized so per-keystroke block re-renders skip it
// entirely.
const SidebarDraftRow = memo(function SidebarDraftRow(props: {
  draftId: DraftId;
  composer: ComposerThreadDraftState;
  branch: string | null;
  project: ProjectFaviconProject | null;
  projectDisplayName: string | null;
  isActive: boolean;
  onNavigate: (draftId: DraftId) => void;
  onDiscard: (draftId: DraftId) => void;
  onContextMenu: (draftId: DraftId, position: { x: number; y: number }) => void;
}) {
  const { composer, draftId, onContextMenu, onDiscard, onNavigate } = props;
  const promptPreview =
    replaceComposerContextReferences(composer.prompt, (occurrence) => occurrence.label)
      .trim()
      .split("\n", 1)[0] ?? "";
  // images mirrors persistedAttachments once rehydration finishes; before
  // that only the persisted list is populated, hence max not sum.
  const attachmentCount =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.files.length +
    composer.terminalContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length;
  const preview =
    promptPreview.length > 0
      ? promptPreview
      : `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`;
  const accessibility = resolveSidebarRowAccessibility({
    title: preview,
    statusLabel: "Unsent draft",
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });
  const handleActivate = () => onNavigate(draftId);
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    // Keys targeting the nested discard button belong to the button:
    // preventDefault here would swallow Space's synthesized click and
    // navigate instead of discarding.
    if ((event.target as HTMLElement).closest("button")) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onContextMenu(draftId, { x: rect.left, y: rect.bottom });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onNavigate(draftId);
    }
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    onContextMenu(draftId, { x: event.clientX, y: event.clientY });
  };
  const handleDiscard = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onDiscard(draftId);
  };
  return (
    <li className="list-none">
      <Tooltip>
        <TooltipTrigger
          render={<div />}
          role="button"
          tabIndex={0}
          aria-label={accessibility.label}
          aria-current={accessibility.current}
          data-testid="sidebar-draft-row"
          className={cn(
            "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left text-sidebar-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            props.isActive ? "bg-sidebar-row-active" : "bg-transparent hover:bg-sidebar-row-hover",
          )}
          onClick={handleActivate}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
          onMouseDown={(event) => {
            if (event.button !== 1 || (event.target as HTMLElement).closest("button, a, input")) {
              return;
            }
            event.preventDefault();
          }}
          onAuxClick={(event) => {
            if (event.button !== 1 || (event.target as HTMLElement).closest("button, a, input")) {
              return;
            }
            handleDiscard(event);
          }}
        >
          <span className="sr-only">{preview}</span>
          <div className="relative z-10 h-12 px-2.5 pt-1.5">
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              {props.project ? (
                <ProjectFavicon project={props.project} className="size-4 shrink-0" />
              ) : null}
              <span
                aria-hidden
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90"
              >
                {preview}
              </span>
              <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
                <SidebarDraftDiscardButton onClick={handleDiscard}>
                  <SquarePenIcon aria-hidden className={draftPenClassName} />
                </SidebarDraftDiscardButton>
              </span>
            </div>
            <div className="mt-0.5 flex h-4 min-w-0 items-center text-xs text-secondary-label">
              <span className="min-w-0 truncate">{props.branch ?? props.projectDisplayName}</span>
            </div>
          </div>
        </TooltipTrigger>
        <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
          <ThreadHoverCard title={preview}>
            <div>Unsent draft</div>
            {props.projectDisplayName ? <div>{props.projectDisplayName}</div> : null}
          </ThreadHoverCard>
        </ThreadHoverCardPopup>
      </Tooltip>
    </li>
  );
});

interface SidebarDraftRowData {
  draftId: DraftId;
  session: DraftSessionState;
  composer: ComposerThreadDraftState;
}

// Own store subscriptions keep per-keystroke composer updates
// inside this block. Vanishes at count 0.
const SidebarDraftBlock = memo(function SidebarDraftBlock(props: {
  projectByKey: ReadonlyMap<string, EnvironmentProject>;
  projectDisplayNameByKey: ReadonlyMap<string, string>;
  scopedProjectKeys: ReadonlySet<string> | null;
  routeDraftId: string | null;
  onNavigateToDraft: (draftId: DraftId) => void;
  onDraftContextMenu: (draftId: DraftId, position: { x: number; y: number }) => void;
}) {
  const [draftsShelfExpanded, setDraftsShelfExpanded] = useLocalStorage(
    DRAFTS_SHELF_EXPANDED_KEY,
    true,
    Schema.Boolean,
  );
  const toggleDraftsShelf = () => setDraftsShelfExpanded((value) => !value);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  const [frozenActive, setFrozenActive] = useState<{
    routeDraftId: string | null;
    row: SidebarDraftRowData | null;
  }>({ routeDraftId: null, row: null });
  if (frozenActive.routeDraftId !== props.routeDraftId) {
    let row: SidebarDraftRowData | null = null;
    if (props.routeDraftId !== null && props.routeDraftId.trim() !== "") {
      const draftId = DraftId.make(props.routeDraftId);
      const session = draftThreadsByThreadKey[draftId];
      const composer = draftsByThreadKey[draftId];
      row =
        session && session.promotedTo == null && composer && composerDraftHasUserContent(composer)
          ? { draftId, session, composer }
          : null;
    }
    setFrozenActive({ routeDraftId: props.routeDraftId, row });
  }
  const drafts = (() => {
    const rows: SidebarDraftRowData[] = [];
    for (const [draftKey, session] of Object.entries(draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (
        props.scopedProjectKeys !== null &&
        !props.scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      if (draftKey === props.routeDraftId) {
        if (frozenActive.routeDraftId === draftKey && frozenActive.row !== null) {
          rows.push(frozenActive.row);
        }
        continue;
      }
      const composer = draftsByThreadKey[draftKey];
      if (!composer || !composerDraftHasUserContent(composer)) {
        continue;
      }
      rows.push({ draftId: DraftId.make(draftKey), session, composer });
    }
    rows.sort((left, right) => right.session.createdAt.localeCompare(left.session.createdAt));
    return rows;
  })();
  if (drafts.length === 0) {
    return null;
  }
  const renderedDrafts = draftsShelfExpanded
    ? drafts
    : drafts.filter(({ draftId }) => draftId === props.routeDraftId);
  return (
    <SortableSidebarMarker marker="drafts-block">
      <ul role="presentation" className="flex flex-col gap-px">
        <li data-thread-selection-safe className="mx-0.5 h-8 list-none">
          <CollapsibleSectionHeader
            expanded={draftsShelfExpanded}
            onClick={toggleDraftsShelf}
            weight="normal"
            data-testid="sidebar-drafts-shelf-toggle"
          >
            {draftsShelfExpanded ? "Drafts" : `Drafts (${drafts.length})`}
          </CollapsibleSectionHeader>
        </li>
        {renderedDrafts.map(({ composer, draftId, session }) => {
          const projectKey = `${session.environmentId}:${session.projectId}`;
          return (
            <SidebarDraftRow
              key={draftId}
              branch={session.branch}
              draftId={draftId}
              composer={composer}
              project={props.projectByKey.get(projectKey) ?? null}
              projectDisplayName={props.projectDisplayNameByKey.get(projectKey) ?? null}
              isActive={draftId === props.routeDraftId}
              onNavigate={props.onNavigateToDraft}
              onDiscard={discardComposerDraft}
              onContextMenu={props.onDraftContextMenu}
            />
          );
        })}
      </ul>
    </SortableSidebarMarker>
  );
});

const dropVerbBadge: Record<SidebarDropVerb, ReactNode> = {
  pin: (
    <>
      <PinIcon aria-hidden className="size-3" />
      Pin
    </>
  ),
  unpin: (
    <>
      <PinOffIcon aria-hidden className="size-3" />
      Unpin
    </>
  ),
  "mark-done": (
    <>
      <CircleCheckIcon aria-hidden className="size-3" />
      Mark as Done
    </>
  ),
  reopen: (
    <>
      <Undo2Icon aria-hidden className="size-3" />
      Reopen
    </>
  ),
  wake: (
    <>
      <AlarmClockOffIcon aria-hidden className="size-3" />
      Wake
    </>
  ),
};

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

type SidebarThreadRowProps = {
  thread: SidebarThreadSummary;
  // Done rows reopen, snoozed rows wake, and active rows become done.
  variantAction: SidebarSweepAction;
  // False on environments whose server predates thread.mark-done/reopen:
  // the lifecycle affordances hide entirely rather than fail on click.
  markDoneSupported: boolean;
  snoozeSupported: boolean;
  // Hide unsupported actions on environments with older servers.
  pinningSupported: boolean;
  isPinned: boolean;
  sortable?: SortableThreadRowBag | undefined;
  dropVerb: SidebarDropVerb | null;
  dragOverPinned: boolean;
  sweepAction: SidebarSweepAction | null;
  snoozeWakeLabelText: string | null;
  wokeAt: string | null;
  isActive: boolean;
  // The pin and mark-done shortcuts act on the active thread, so only its row receives them.
  pinShortcut: string | null;
  doneShortcut: string | null;
  openPullRequestsInRightPanel: boolean;
  jumpLabel: string | null;
  currentEnvironmentId: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  scratchMachineLabel: string | null;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
  isRenaming: boolean;
  renamingTitle: string;
  onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  onMarkDone: (threadRef: ScopedThreadRef) => void;
  onActionSweepStart: (
    threadRef: ScopedThreadRef,
    action: SidebarSweepAction,
    event: PointerEvent,
  ) => void;
  onReopen: (threadRef: ScopedThreadRef) => void;
  onSnooze: (threadRef: ScopedThreadRef, preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  onUnsnooze: (threadRef: ScopedThreadRef) => void;
  onPin: (threadRef: ScopedThreadRef) => void;
  onUnpin: (threadRef: ScopedThreadRef) => void;
  onAcknowledgeWoke: (threadRef: ScopedThreadRef, visitedAt: string) => void;
  onFileDropThreads?: ((threadRef: ScopedThreadRef, files: File[]) => void) | undefined;
};

const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  const {
    isRenaming,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onAcknowledgeWoke,
    onFileDropThreads,
    onRenameTitleChange,
    onMarkDone,
    onActionSweepStart,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onReopen,
    onSnooze,
    onUnsnooze,
    onPin,
    onUnpin,
    openPullRequestsInRightPanel,
    renamingTitle,
    thread,
    variantAction,
  } = props;
  const isParked = variantAction !== "mark-done";
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const environmentConnected = useAtomValue(
    environmentPresentations.presentationAtom(thread.environmentId),
    isEnvironmentConnected,
  );
  const isPendingCreation = useThreadShell(threadRef) === null;
  const markDoneSupported = props.markDoneSupported && !isPendingCreation;
  const snoozeSupported = props.snoozeSupported && !isPendingCreation;
  const canOperateThread = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  useEffect(() => {
    if (!canOperateThread && isRenaming) onCancelRename();
  }, [canOperateThread, isRenaming, onCancelRename]);
  const { leaseLiveStatus, rowRef } = useSidebarRowSubscriptionLease(props.isActive);
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const lastVisitedAt = thread.lastVisitedAt ?? undefined;
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const openPrLink = useOpenPrLink();
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const terminalProcessCount = runningTerminalIds.length;
  const hasUnsentDraft = useThreadHasUnsentDraft(threadRef) && !props.isActive;
  const handleDiscardDraftClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    discardComposerDraft(threadRef);
  };

  const gitCwd = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const linkedPullRequestStatus = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.pullRequests,
    thread.branchPullRequest,
    leaseLiveStatus,
  );
  const gitStatus = useEnvironmentQuery(
    leaseLiveStatus && (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd, includeRemote: false },
        })
      : null,
  );
  const visibleGitStatus = useRetainedValue(
    JSON.stringify([thread.environmentId, gitCwd]),
    gitStatus.data,
  );
  const pr = linkedPullRequestStatus?.pr ?? null;
  const currentLinkedPr = resolveThreadCurrentPullRequestLink(thread.pullRequests);

  // Never-visited threads count as read so historical threads do not light up
  // as unread on first load.
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarThreadStatus(thread);
  const showDuration = environmentConnected && shouldShowSidebarV2Duration(status);
  // A woken thread reappears at its original position (the sort is
  // deliberately static), so the pill has to carry the weight. Snoozing is
  // an explicit act, so the pill clears only when the user re-engages:
  // reading a completion-triggered wake, clicking the pill, sending a
  // message, marking done, archiving, or a change request state that completes the
  // thread. Timer wakes survive a mere visit. An unparseable visit timestamp
  // counts as never-visited, so corrupt local data cannot eat the wake signal.
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke =
    wokeAtDate !== null &&
    (lastVisitedDate === null || lastVisitedDate < wokeAtDate) &&
    thread.doneOverride !== "done";
  const parkedActionSupported = variantAction === "unsnooze" ? snoozeSupported : markDoneSupported;
  const snoozedMarkDoneSupported =
    variantAction === "unsnooze" && snoozeSupported && markDoneSupported;
  const replaceTimeOnHover = parkedActionSupported && !isWoke;
  const reserveActionGutter = parkedActionSupported && isWoke;
  const shouldRecede = shouldRecedeSidebarThread({
    status,
    isUnread,
    isWoke,
    isActive: props.isActive,
    isSelected,
  });
  // Status hues follow the system-wide convention set by sidebar v1 and the
  // mobile widgets (amber approval, indigo input, sky working) so a thread
  // reads the same color everywhere it surfaces.
  const topStatusKind = resolveSidebarV2TopStatus({
    environmentConnected,
    status,
    isUnread,
    isWoke,
  });
  const topStatus =
    topStatusKind === "connecting"
      ? { label: "Connecting", icon: null, className: "text-secondary-label" }
      : isPendingCreation
        ? { label: "Preparing", icon: null, className: "text-info" }
        : topStatusKind === "working"
          ? {
              label: thread.goal?.status === "active" ? "Goal" : "Working",
              icon: "working" as const,
              className: "text-info",
            }
          : topStatusKind === "waiting"
            ? {
                label: "Waiting",
                icon: null,
                className: "text-muted-foreground",
              }
            : topStatusKind === "approval"
              ? {
                  label: "Approval",
                  icon: "approval" as const,
                  className: "text-warning-foreground",
                }
              : topStatusKind === "input"
                ? {
                    label: "Input",
                    icon: "input" as const,
                    className: "text-indigo-600 dark:text-indigo-300",
                  }
                : topStatusKind === "limited"
                  ? {
                      label: "Limited",
                      icon: "failed" as const,
                      className: "text-warning",
                    }
                  : topStatusKind === "failed"
                    ? {
                        label: "Failed",
                        icon: "failed" as const,
                        className: "text-error",
                      }
                    : topStatusKind === "woke"
                      ? {
                          label: "Woke",
                          icon: "woke" as const,
                          className: "text-warning",
                        }
                      : topStatusKind === "ready"
                        ? {
                            label: "Ready",
                            icon: "done" as const,
                            className: "text-success",
                          }
                        : null;
  const isWokeStatus = topStatus?.icon === "woke";

  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: visibleGitStatus?.refName ?? null,
  });
  const prStatus = prStatusIndicator(pr, linkedPullRequestStatus?.sourceControlProvider);

  const modelInstanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : thread.modelSelection.model;

  const isRemote = thread.environmentId !== props.currentEnvironmentId;
  const showsScratchMachine = !thread.branch && props.scratchMachineLabel !== null;

  const detailsTooltip = (
    <SidebarThreadTooltip
      thread={thread}
      project={props.project}
      projectDisplayName={props.projectDisplayName}
      environmentLabel={props.environmentLabel}
      environmentMachine={props.environmentMachine}
      providerEntry={providerEntry}
      providerEntryByInstanceId={props.providerEntryByInstanceId}
      showInstanceBadge={showInstanceBadge}
      modelInstanceId={modelInstanceId}
      modelLabel={modelLabel}
      branchMismatch={branchMismatch}
      terminalStatus={terminalStatus}
      terminalProcessCount={terminalProcessCount}
    />
  );

  const handleClick = (event: ReactMouseEvent) => {
    onThreadClick(event, threadRef);
  };
  const handleMiddleMouseDown = (event: ReactMouseEvent) => {
    if (
      event.button !== 1 ||
      !markDoneSupported ||
      variantAction !== "mark-done" ||
      (event.target as HTMLElement).closest("button, a, input")
    ) {
      return;
    }
    event.preventDefault();
  };
  const handleAuxClick = (event: ReactMouseEvent) => {
    if (
      event.button !== 1 ||
      !markDoneSupported ||
      variantAction !== "mark-done" ||
      (event.target as HTMLElement).closest("button, a, input")
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onMarkDone(threadRef);
  };
  const handleAcknowledgeWokeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (props.wokeAt === null) return;
    onAcknowledgeWoke(threadRef, props.wokeAt);
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
  };
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onThreadActivate(threadRef);
  };
  const handleDoubleClick = (event: ReactMouseEvent) => {
    if (
      isPendingCreation ||
      !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope) ||
      isRenaming ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    event.preventDefault();
    onStartRename(threadRef, thread.title);
  };
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = onFileDropThreads
    ? makeWorkspaceFileDropHandlers({
        setDragActive: setIsFileDragOver,
        addFiles: (files) => {
          onFileDropThreads(threadRef, files);
        },
        addFolders: () => {},
      })
    : null;
  useEffect(() => {
    if (!isFileDragOver) return;
    const clearFileDrag = () => setIsFileDragOver(false);
    window.addEventListener("dragend", clearFileDrag);
    return () => window.removeEventListener("dragend", clearFileDrag);
  }, [isFileDragOver]);
  const renameCommittedRef = useRef(false);
  useEffect(() => {
    if (isRenaming) renameCommittedRef.current = false;
  }, [isRenaming]);
  const handleRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      renameCommittedRef.current = true;
      onCommitRename(threadRef, renamingTitle, thread.title);
    } else if (event.key === "Escape") {
      event.preventDefault();
      renameCommittedRef.current = true;
      onCancelRename();
    }
  };
  const handleRenameBlur = () => {
    if (!renameCommittedRef.current) {
      onCommitRename(threadRef, renamingTitle, thread.title);
    }
  };
  const handleMarkDoneClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onMarkDone(threadRef);
  };
  const handleSweepPointerDown = (action: SidebarSweepAction, event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    onActionSweepStart(threadRef, action, event.nativeEvent);
  };
  const handleMarkDonePointerDown = (event: ReactPointerEvent) =>
    handleSweepPointerDown("mark-done", event);
  const handleReopenClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onReopen(threadRef);
  };
  const handleUnsnoozeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnsnooze(threadRef);
  };
  const handleUnpin = () => onUnpin(threadRef);
  const handlePin = () => onPin(threadRef);
  const handleSnoozePreset = (preset: Pick<SnoozePreset, "snoozedUntil">) =>
    onSnooze(threadRef, preset);
  const showSnoozeButton =
    canOperateThread &&
    !isParked &&
    snoozeSupported &&
    canSnooze(thread, { now: new Date().toISOString() });
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  // A newly blocked thread unmounts the menu without an onOpenChange callback.
  if (!showSnoozeButton && snoozeMenuOpenRaw) setSnoozeMenuOpen(false);
  const handlePrClick = (event: ReactMouseEvent<HTMLElement>, targetUrl?: string) => {
    const url = targetUrl ?? pr?.url ?? currentLinkedPr?.url;
    if (!url) return;
    const showInRightPanel = targetUrl !== undefined || openPullRequestsInRightPanel;
    const openedInRightPanel = openPrLink(event, url, showInRightPanel ? threadRef : undefined);
    if (openedInRightPanel && showInRightPanel && !props.isActive) {
      onThreadActivate(threadRef);
    }
  };

  // All sidebar rows share one surface model. Live threads used to look
  // like elevated cards while done threads were plain rows, leaving neither
  // a useful hierarchy nor a reliable hover cue. Status now lives in the row
  // content; surface is reserved for interaction (hover, multi-select, route).
  const rowSurfaceClassName = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    variantAction === "reopen" && "[&:not(:hover):not(:focus-within)_*]:text-secondary-label/70",
    props.isActive
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : isSelected || props.sweepAction !== null
        ? "bg-sidebar-row-selected text-sidebar-foreground"
        : shouldRecede
          ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    shouldRecede &&
      (status === "working" || status === "waiting") &&
      "opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none",
    isFileDragOver && "ring-1 ring-inset ring-primary/70",
    isFileDragOver && !props.isActive && !isSelected && "bg-sidebar-row-hover",
    props.sortable?.isDragging &&
      "bg-sidebar bg-linear-to-b from-sidebar-row-active to-sidebar-row-active text-sidebar-foreground opacity-100 shadow-lg",
  );
  const sortable = props.sortable;
  const sortableRootProps = sortable
    ? {
        ref: sortable.setNodeRef,
        style: {
          transform: CSS.Translate.toString(sortable.transform),
          transition: sortable.transition,
          // A zero-height boundary also makes dnd-kit scale the source to
          // zero. Only projected peers use scaleY as a visibility sentinel.
          visibility:
            !sortable.isDragging && sortable.transform?.scaleY === 0
              ? ("hidden" as const)
              : undefined,
        },
        ...sortable.listeners,
      }
    : {};
  const destinationVerb = sortable?.isDragging
    ? props.dropVerb
    : props.sweepAction === "unsnooze"
      ? "wake"
      : props.sweepAction;
  const dragDestination =
    destinationVerb !== null ? (
      <span
        role="status"
        className="pointer-events-none ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 text-2xs font-medium text-primary"
      >
        {dropVerbBadge[destinationVerb]}
      </span>
    ) : null;

  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: topStatus?.label ?? null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });

  const title =
    isRenaming && canOperateThread ? (
      <input
        autoFocus
        value={renamingTitle}
        aria-label="Thread title"
        onChange={(event) => onRenameTitleChange(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleRenameKeyDown}
        onBlur={handleRenameBlur}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
      />
    ) : (
      <span
        aria-hidden
        className={cn(
          "min-w-0 flex-1 text-sm transition-opacity motion-reduce:transition-none",
          shouldRecede ? "font-normal" : "font-medium",
          !isParked
            ? cn(
                "truncate",
                shouldRecede
                  ? "text-secondary-label"
                  : isUnread || isWoke || status === "input"
                    ? "text-foreground"
                    : status === "failed"
                      ? "text-foreground/95"
                      : "text-foreground/90",
              )
            : cn(
                "truncate group-focus-within/sidebar-row:text-foreground group-hover/sidebar-row:text-foreground",
                shouldRecede
                  ? "text-secondary-label/70"
                  : props.isActive || isWoke || status === "input"
                    ? "text-foreground"
                    : isUnread
                      ? "text-muted-foreground"
                      : "text-secondary-label/70",
              ),
          isRegeneratingTitle && "opacity-55",
        )}
      >
        {thread.title}
      </span>
    );
  const accessibleTitle = isRenaming ? null : <span className="sr-only">{thread.title}</span>;

  const prBadgeShape = resolveThreadPullRequestBadge(thread.pullRequests);
  const handlePrListClick = () => {
    useRightPanelStore.getState().open(threadRef, "pull-requests");
    if (!props.isActive) onThreadActivate(threadRef);
  };
  const prBadge =
    prBadgeShape?.kind === "stack" || pr || currentLinkedPr ? (
      <ThreadPullRequestBadgeControl
        render={<InlineButton tone="link" />}
        badge={prBadgeShape}
        pullRequests={thread.pullRequests}
        number={pr?.number ?? currentLinkedPr?.number}
        url={pr?.url ?? currentLinkedPr?.url}
        status={prStatus}
        onOpenList={handlePrListClick}
        onOpenPullRequest={handlePrClick}
      />
    ) : null;
  const terminalStatusIcon = (
    <ThreadTerminalStatusButton
      threadRef={threadRef}
      terminalIds={runningTerminalIds}
      onThreadActivate={onThreadActivate}
    />
  );
  // Jump hints sit over the row's trailing edge. Keep the status metadata's
  // measured space, but remove it visually so the hint is easy to scan.
  const jumpHintIndicatorsClassName = props.jumpLabel !== null ? "invisible" : undefined;
  // Same pen the new-thread draft rows use, so both kinds of unsent
  // work read the same way in the list.
  const draftIndicator = hasUnsentDraft ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label="Unsent draft"
            data-testid={`sidebar-draft-indicator-${thread.id}`}
            className="inline-flex shrink-0 items-center"
          />
        }
      >
        <SquarePenIcon aria-hidden className={draftPenClassName} />
      </TooltipTrigger>
      <TooltipPopup side="top">Unsent draft</TooltipPopup>
    </Tooltip>
  ) : null;
  const showPin =
    props.isPinned && (!sortable?.isDragging || (props.dragOverPinned && props.dropVerb === null));
  const pinIndicator = showPin ? (
    props.pinningSupported && canOperateThread && !sortable?.isDragging ? (
      <SidebarPinButton
        pinned
        shortcut={props.pinShortcut}
        onPin={handlePin}
        onUnpin={handleUnpin}
      />
    ) : (
      <PinIcon
        aria-label="Pinned"
        role="img"
        className="size-3 shrink-0 text-muted-foreground/65"
      />
    )
  ) : null;

  if (isParked) {
    return (
      <li
        data-thread-item={threadKey}
        {...sortableRootProps}
        {...(fileDropHandlers ?? {})}
        className={cn(
          "list-none [content-visibility:auto] [contain-intrinsic-size:auto_36px]",
          sortable?.isDragging && "relative z-20",
        )}
      >
        <Tooltip disabled={sortable?.isDragging}>
          <TooltipTrigger
            render={
              <div
                ref={rowRef}
                role="button"
                tabIndex={0}
                aria-label={accessibility.label}
                aria-current={accessibility.current}
                data-testid="sidebar-row-slim"
                aria-busy={isRegeneratingTitle || undefined}
                className={cn(rowSurfaceClassName, "flex h-9 items-center gap-2.5 px-2.5")}
                onClick={handleClick}
                onMouseDown={handleMiddleMouseDown}
                onAuxClick={handleAuxClick}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
              />
            }
          >
            {accessibleTitle}
            {/* Done history recedes: dimmed favicon at rest, restored on
              hover so the tail stays scannable when you're hunting. */}
            <span
              className={cn(
                "flex shrink-0 items-center transition-opacity",
                (!props.isActive || variantAction === "reopen") &&
                  "opacity-40 grayscale group-focus-within/sidebar-row:opacity-100 group-focus-within/sidebar-row:grayscale-0 group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
              )}
            >
              {props.project ? <ProjectFavicon project={props.project} className="size-4" /> : null}
            </span>
            {draftIndicator}
            {title}
            {pinIndicator}
            <span className={cn("contents", jumpHintIndicatorsClassName)}>
              {terminalStatusIcon}
            </span>
            {isRegeneratingTitle ? (
              <span role="status" className="sr-only">
                Regenerating title
              </span>
            ) : null}
            {/* Keep PR badges and wake notifications visible when the parked action replaces the time. */}
            <span className={cn("contents", jumpHintIndicatorsClassName)}>{prBadge}</span>
            {sortable?.isDragging ? (
              dragDestination
            ) : (
              <span
                className={cn(
                  "relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end",
                  reserveActionGutter && "pr-6",
                  snoozedMarkDoneSupported && "min-w-11",
                  props.sweepAction !== null && "hidden",
                )}
              >
                <span
                  className={cn(
                    "inline-flex justify-end tabular-nums text-secondary-label transition-opacity",
                    replaceTimeOnHover &&
                      "group-any-hover/sidebar-row:opacity-0 group-focus-within/sidebar-row:opacity-0",
                    jumpHintIndicatorsClassName,
                  )}
                >
                  {!environmentConnected ? (
                    <span role="status" className="text-xs">
                      Connecting
                    </span>
                  ) : variantAction === "unsnooze" && props.snoozeWakeLabelText !== null ? (
                    <span className="text-xs tabular-nums">{props.snoozeWakeLabelText}</span>
                  ) : isWoke ? (
                    // A wake can land straight in the done tail (e.g. PR
                    // merged while snoozed); the signal must survive the trip.
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label="Dismiss Woke notification"
                            onClick={handleAcknowledgeWokeClick}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-warning-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          >
                            <AlarmClockIcon aria-hidden className="size-3" />
                            <span role="status">Woke</span>
                          </button>
                        }
                      />
                      <TooltipPopup side="top">Dismiss Woke notification</TooltipPopup>
                    </Tooltip>
                  ) : (
                    <span className="text-xs">
                      {variantAction === "reopen" ? doneTimeLabel(thread) : threadTimeLabel(thread)}
                    </span>
                  )}
                </span>
                {!parkedActionSupported ? null : (
                  <span className="pointer-events-none absolute inset-y-0 right-0 -mr-1 flex">
                    {variantAction === "unsnooze" ? (
                      <>
                        {snoozedMarkDoneSupported ? (
                          <SidebarParkedActionButton
                            action="mark-done"
                            label="Mark thread as Done"
                            shortcut={props.doneShortcut}
                            onClick={handleMarkDoneClick}
                            onSweepStart={handleSweepPointerDown}
                          >
                            <CheckIcon className="mb-px size-3.5" />
                          </SidebarParkedActionButton>
                        ) : null}
                        <SidebarParkedActionButton
                          action="unsnooze"
                          label="Wake thread now"
                          onClick={handleUnsnoozeClick}
                          onSweepStart={handleSweepPointerDown}
                        >
                          <AlarmClockOffIcon className="mb-px size-3" />
                        </SidebarParkedActionButton>
                      </>
                    ) : (
                      <SidebarParkedActionButton
                        action="reopen"
                        label="Reopen thread"
                        shortcut={props.doneShortcut}
                        onClick={handleReopenClick}
                        onSweepStart={handleSweepPointerDown}
                      >
                        <Undo2Icon className="mb-px size-3.5" />
                      </SidebarParkedActionButton>
                    )}
                  </span>
                )}
              </span>
            )}
            {props.sweepAction !== null ? dragDestination : null}
            {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
          </TooltipTrigger>
          {detailsTooltip}
        </Tooltip>
      </li>
    );
  }

  const StatusIcon = topStatus?.icon
    ? {
        working: CircleDashedIcon,
        input: MessageCircleQuestionIcon,
        approval: ShieldQuestionIcon,
        failed: CircleAlertIcon,
        done: CircleCheckIcon,
        woke: AlarmClockIcon,
      }[topStatus.icon]
    : isPendingCreation
      ? CircleDashedIcon
      : ClockIcon;
  const showDragDestination = sortable?.isDragging || props.sweepAction !== null;
  const showHoverActions =
    (props.pinningSupported && !isPendingCreation) ||
    showSnoozeButton ||
    markDoneSupported ||
    isWokeStatus;

  return (
    <li
      data-thread-item={threadKey}
      {...sortableRootProps}
      {...(fileDropHandlers ?? {})}
      className={cn(
        "list-none [content-visibility:auto] [contain-intrinsic-size:auto_48px]",
        sortable?.isDragging && "relative z-20",
      )}
    >
      <Tooltip disabled={snoozeMenuOpen || sortable?.isDragging}>
        <TooltipTrigger
          render={
            <div
              ref={rowRef}
              role="button"
              tabIndex={0}
              aria-label={accessibility.label}
              aria-current={accessibility.current}
              data-testid="sidebar-row"
              aria-busy={isPendingCreation || isRegeneratingTitle || undefined}
              className={rowSurfaceClassName}
              onClick={handleClick}
              onMouseDown={handleMiddleMouseDown}
              onAuxClick={handleAuxClick}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
            />
          }
        >
          {accessibleTitle}
          <div className="relative z-10 h-12 px-2.5 pt-1.5">
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              <span className="inline-flex size-4 shrink-0">
                {props.project ? (
                  <ProjectFavicon project={props.project} className="size-4" />
                ) : null}
              </span>
              {title}
              {/* Both layers reserve the same slot so hover and keyboard focus
                  replace the status without shifting the title or branch. */}
              <span
                className={cn(
                  "group/sidebar-status-slot grid h-5 shrink-0 items-center text-xs",
                  showDragDestination && "invisible",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none col-start-1 row-start-1 flex items-center gap-1.5 justify-self-end transition-opacity motion-reduce:transition-none",
                    showHoverActions &&
                      "group-any-hover/sidebar-row:opacity-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0",
                    snoozeMenuOpen && "opacity-0",
                    jumpHintIndicatorsClassName,
                  )}
                >
                  {topStatus && !showDuration && topStatusKind !== "connecting" ? (
                    <span role="status" className={cn("inline-flex shrink-0", topStatus.className)}>
                      <StatusIcon aria-hidden className="size-3.5" />
                      <span className="sr-only">{topStatus.label}</span>
                    </span>
                  ) : null}
                  {topStatus && (showDuration || topStatusKind === "connecting") ? (
                    <span className={cn("whitespace-nowrap", topStatus.className)}>
                      <span role="status">{topStatus.label}</span>
                      {showDuration ? (
                        <span aria-hidden>
                          {" "}
                          <WorkingDuration startedAt={resolveSidebarV2DurationStartedAt(thread)} />
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <SidebarRelativeTime
                      timestamp={thread.latestUserMessageAt ?? thread.updatedAt}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    "pointer-events-none col-start-1 row-start-1 flex items-center gap-1.5 justify-self-end opacity-0 transition-opacity group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 motion-reduce:transition-none",
                    snoozeMenuOpen && "pointer-events-auto opacity-100",
                  )}
                >
                  {isWokeStatus ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label="Dismiss Woke notification"
                            onClick={handleAcknowledgeWokeClick}
                            onPointerDown={(event) => event.stopPropagation()}
                            className="inline-flex shrink-0 cursor-pointer items-center rounded-sm text-warning outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          />
                        }
                      >
                        <AlarmClockIcon aria-hidden className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipPopup side="top">Dismiss Woke notification</TooltipPopup>
                    </Tooltip>
                  ) : null}
                  {props.pinningSupported && !isPendingCreation ? (
                    <SidebarPinButton
                      pinned={props.isPinned}
                      shortcut={props.pinShortcut}
                      onPin={handlePin}
                      onUnpin={handleUnpin}
                    />
                  ) : null}
                  {showSnoozeButton ? (
                    <SidebarSnoozeButton
                      open={snoozeMenuOpen}
                      onOpenChange={setSnoozeMenuOpen}
                      onSnooze={handleSnoozePreset}
                    />
                  ) : null}
                  {markDoneSupported ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label="Mark thread as Done"
                            onClick={handleMarkDoneClick}
                            onPointerDown={handleMarkDonePointerDown}
                            className="inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-sm text-muted-foreground/65 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          />
                        }
                      >
                        <CheckIcon aria-hidden className="size-3.5" />
                        Done
                      </TooltipTrigger>
                      <TooltipPopup shortcut={props.doneShortcut}>Mark thread as Done</TooltipPopup>
                    </Tooltip>
                  ) : null}
                </span>
              </span>
            </div>
            {showDragDestination ? (
              <span className="absolute right-2.5 top-1.5">{dragDestination}</span>
            ) : null}
            {isRegeneratingTitle ? (
              <span role="status" className="sr-only">
                Regenerating title
              </span>
            ) : null}
            <div className="mt-0.5 flex h-4 min-w-0 items-center gap-1.5 text-xs text-secondary-label">
              {thread.branch ? (
                <span className="flex min-w-0 flex-1 text-muted-foreground/60">
                  <MiddleTruncate value={thread.branch} showTitle={false} />
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-muted-foreground/60">
                  {showsScratchMachine ? props.scratchMachineLabel : props.projectDisplayName}
                </span>
              )}
              {hasUnsentDraft ? (
                <SidebarDraftDiscardButton onClick={handleDiscardDraftClick}>
                  {draftIndicator}
                </SidebarDraftDiscardButton>
              ) : null}
              <span className={cn("contents", jumpHintIndicatorsClassName)}>
                {terminalStatusIcon}
                {prBadge}
                <span
                  aria-hidden
                  className="pointer-events-none inline-flex shrink-0 items-center gap-1"
                >
                  {isRemote || showsScratchMachine ? (
                    <EnvironmentMachineIcon
                      kind={props.environmentMachine}
                      className="size-3.5 text-sidebar-muted-foreground/70"
                    />
                  ) : null}
                  <SidebarProviderStack
                    thread={thread}
                    providerEntryByInstanceId={props.providerEntryByInstanceId}
                  />
                </span>
              </span>
            </div>
          </div>
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </TooltipTrigger>
        {detailsTooltip}
      </Tooltip>
    </li>
  );
});

export default function Sidebar() {
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
  const [projectScopeMenuState, dispatchProjectScopeMenu] = useReducer(
    reduceSidebarProjectScopeMenuState,
    { open: false, query: "" },
  );
  const projectScopeFilter = useComboboxFilter();
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
  // Anchor for the scope popup: the thread list heading, not its icon trigger.
  const threadHeaderRef = useRef<HTMLDivElement | null>(null);
  // Safari can send a click after Ctrl+click opens settings. Ignore that one
  // selection, then clear the guard when the picker opens again.
  const suppressNextScopeChangeRef = useRef(false);
  const highlightedProjectScopeKeyRef = useRef<string | null>(null);
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
  const selectedProjectScopeItem =
    projectScopeItems.find((item) => item.value === (projectScopeKey ?? "all")) ??
    projectScopeItems[0]!;
  const filteredProjectScopeItems = filterSidebarProjectScopeItems({
    items: projectScopeItems,
    query: projectScopeMenuState.query,
    matches: (item, query) =>
      projectScopeFilter.contains(item, query, (candidate) => candidate.label),
  });
  const projectScopeJumpLabels = usePickerShortcuts({
    picker: "project",
    open: projectScopeMenuState.open,
    items: filteredProjectScopeItems.filter((item) => item.value !== "all"),
    keybindings,
    onSelect: (item) => {
      setProjectScopeKey(item.value);
      dispatchProjectScopeMenu({ type: "open-changed", open: false });
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
    (
      event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLInputElement>,
      projectGroup: SidebarProjectSnapshot,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      suppressNextScopeChangeRef.current = true;
      dispatchProjectScopeMenu({ type: "project-settings-opened" });
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
    visiblePinnedThreads,
    renderedDoneThreads,
    visibleSnoozedThreads,
    visibleWorkingThreads,
    orderedThreadKeys,
    threadByKey,
    doneThreadKeys,
    snoozedThreadKeys,
    sectionByThreadKey,
    pinnedKeys,
    pinnedKeysById,
  } = useSidebarThreads({
    projectScopeKey,
    scopedProjectKeys,
    serverConfigs,
    optimisticDrop,
    routeThreadKey,
    dragging: dragState !== null,
  });
  const pendingThreads = outboxEntries.filter((entry) => {
    const creation = entry.payload.input.bootstrap?.createThread;
    return (
      creation &&
      !serverThreadKeys.has(entry.scope) &&
      (scopedProjectKeys === null ||
        scopedProjectKeys.has(`${entry.payload.environmentId}:${creation.projectId}`))
    );
  });

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

  const isContextDrag = dragState?.contextDrag === true;
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
    moveThreadContextDragGhost(point, { title, count: threads.length });
    return true;
  };
  const dropThreadContextDrag = (point: { x: number; y: number }) => {
    if (!pointerOutsideThreadList(point)) return false;
    dropThreadContext(point, contextDragThreads());
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
  const sidebarListItemsFresh = ((): readonly SidebarListItem[] => {
    const rowsOf = (
      list: readonly EnvironmentThreadShell[],
      section: SidebarSection,
    ): SidebarListItem[] =>
      list.map((thread) => ({ kind: "thread", key: threadShellKey(thread), section }));
    if (
      pinnedThreads.length +
        activeThreads.length +
        workingThreads.length +
        snoozedThreads.length +
        doneThreads.length ===
      0
    ) {
      return [{ kind: "marker", marker: "drafts-block" }];
    }
    const items: SidebarListItem[] = [{ kind: "marker", marker: "pinned-header" }];
    const pinnedRows = rowsOf(visiblePinnedThreads, "pinned");
    items.push(...pinnedRows);
    items.push({ kind: "marker", marker: "drafts-block" });
    items.push({ kind: "marker", marker: "pinned-divider" });
    const activeRows = rowsOf(activeThreads, "active");
    items.push({ kind: "marker", marker: "active-placeholder" });
    items.push(...activeRows);
    if (workingThreads.length > 0) {
      items.push({ kind: "marker", marker: "working-header" });
      items.push(...rowsOf(visibleWorkingThreads, "working"));
    }
    if (snoozedThreads.length > 0) {
      items.push({ kind: "marker", marker: "snoozed-header" });
      items.push(...rowsOf(visibleSnoozedThreads, "snoozed"));
    }
    items.push({ kind: "marker", marker: "done-header" });
    const doneRows = rowsOf(renderedDoneThreads, "done");
    items.push({ kind: "marker", marker: "done-placeholder" });
    items.push(...doneRows);
    return items;
  })();
  // Thread shells update on every streamed event without moving rows. Keep the
  // list's identity until its order changes, so the sorting strategy, the
  // sortable context and every sortable row stay memoized meanwhile.
  const sidebarListItemsKey = sidebarListItemsFresh
    .map((item) => (item.kind === "thread" ? item.section + ":" + item.key : item.marker))
    .join("\n");
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
  // Reads the fresh list: calling `.some` on the state copy makes the compiler
  // drop the memo scopes of the drag handlers and the motion pass.
  const sidebarHasThreadSections = sidebarListItemsFresh.some(
    (item) => item.kind === "marker" && item.marker === "pinned-header",
  );
  // Every shell event rebuilds sidebarListItems, but rows only move when the
  // rendered order, a row's section, the draft block, the pending rows, the
  // undo notice or a shelf toggle changes. Keying the motion pass on those
  // keeps ordinary updates from forcing a layout read and animating rows
  // whose position drifted for other reasons.
  const listMotionLayoutKey = [
    sidebarListItems
      .map((item) => (item.kind === "thread" ? `${item.key}:${item.section}` : item.marker))
      .join("\0"),
    routeDraftIdForRows ?? "",
    visibleDraftSessionCount,
    pendingThreads.length,
    undoNoticeShown,
  ].join("\n");
  const listMotionShelfState = `${pinnedShelfExpanded}:${workingShelfExpanded}:${snoozedShelfExpanded}:${doneShelfExpanded}`;
  const listMotionAnimate =
    dragState === null &&
    (sidebarHasThreadSections || visibleDraftSessionCount > 0 || pendingThreads.length > 0);
  // The effect reads only `animate` and the shelf state; the pass object is
  // cached on all three fields, so a new layout key alone also triggers it.
  const listMotionPass = {
    layoutKey: listMotionLayoutKey,
    shelfState: listMotionShelfState,
    animate: listMotionAnimate,
  };
  const previousShelfStateRef = useRef(listMotionPass.shelfState);
  useLayoutEffect(() => {
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
  const { doneOrder: draggedDoneOrder, activeOrder: draggedActiveOrder } =
    dragState === null
      ? NO_DRAGGED_ORDERS
      : resolveDraggedOrders({ drag: dragState, threadByKey, doneThreads, activeThreads });
  const sidebarSortingStrategy = createSidebarSortingStrategy({
    items: sidebarListItems,
    enabled: !isContextDrag,
    boundaryLabelHeight: SIDEBAR_DRAG_LABEL_HEIGHT,
    doneOrder: draggedDoneOrder,
    ...(draggedActiveOrder === undefined ? {} : { activeOrder: draggedActiveOrder }),
    doneExpanded: doneShelfExpanded,
    doneVisibleCount,
    routeThreadKey,
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
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const targetThread = threadByKey.get(targetThreadKey);
        if (!targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    routeTerminalOpen,
    routeThreadKey,
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
          // Lifted above the stage backdrop, whose fade bleeds below the
          // header and would otherwise paint across its rows.
          <SidebarGroup className="z-[1]">
            <div className="flex flex-col gap-2">
              <SidebarPrimaryNavigation projectGroupCount={projectGroups.length} />
              {projectGroups.length > 0 ? (
                <SidebarThreadHeader
                  rowRef={threadHeaderRef}
                  scopeLabel={scopedProjectGroup?.displayName ?? null}
                  onNewProject={openAddProjectCommandPalette}
                  projectScope={
                    <Combobox
                      items={projectScopeItems}
                      filteredItems={filteredProjectScopeItems}
                      autoHighlight
                      itemToStringLabel={(item) => item.label}
                      isItemEqualToValue={(a, b) => a.value === b.value}
                      open={projectScopeMenuState.open}
                      onOpenChange={(open) => {
                        if (open) suppressNextScopeChangeRef.current = false;
                        dispatchProjectScopeMenu({ type: "open-changed", open });
                      }}
                      onItemHighlighted={(item) => {
                        highlightedProjectScopeKeyRef.current = item?.value ?? null;
                      }}
                      value={selectedProjectScopeItem}
                      onValueChange={(item) => {
                        if (suppressNextScopeChangeRef.current) {
                          suppressNextScopeChangeRef.current = false;
                          return;
                        }
                        if (!item) return;
                        setProjectScopeKey(item.value === "all" ? null : item.value);
                      }}
                    >
                      <ComboboxTrigger
                        render={
                          <SidebarHeaderIconButton
                            label={
                              scopedProjectGroup
                                ? `Filter threads by project: ${scopedProjectGroup.displayName}`
                                : "Filter threads by project"
                            }
                          />
                        }
                      >
                        {scopedProjectGroup ? (
                          <span className="flex shrink-0">
                            <ProjectFavicon project={scopedProjectGroup} className="size-4" />
                          </span>
                        ) : (
                          <ListFilterIcon className="size-4" />
                        )}
                      </ComboboxTrigger>
                      <ComboboxPopup
                        align="start"
                        // Anchored to the heading row, not the 28px trigger: the
                        // popup opens under the row, is at least as wide as it,
                        // and grows to fit project names up to a cap, past which
                        // the rows truncate.
                        anchor={threadHeaderRef}
                        className="max-w-[min(18rem,var(--available-width))] overflow-hidden"
                      >
                        <ComboboxSearchInput
                          aria-label="Search projects"
                          placeholder="Search projects..."
                          value={projectScopeMenuState.query}
                          onKeyDown={(event) => {
                            if (
                              event.defaultPrevented ||
                              event.nativeEvent.isComposing ||
                              event.ctrlKey ||
                              event.altKey ||
                              event.metaKey ||
                              (event.key !== "ContextMenu" &&
                                !(event.shiftKey && event.key === "F10"))
                            ) {
                              return;
                            }
                            const scopeKey = highlightedProjectScopeKeyRef.current;
                            const project = scopeKey ? projectGroupByScopeKey.get(scopeKey) : null;
                            if (project) handleProjectSettings(event, project);
                          }}
                          onChange={(event) =>
                            dispatchProjectScopeMenu({
                              type: "query-changed",
                              query: event.target.value,
                            })
                          }
                        />
                        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
                        <ComboboxList>
                          {(item: (typeof projectScopeItems)[number]) => {
                            const project = projectGroupByScopeKey.get(item.value) ?? null;
                            return (
                              <ComboboxItem
                                key={item.value}
                                hideIndicator
                                value={item}
                                onContextMenu={(event) => {
                                  if (project) handleProjectSettings(event, project);
                                }}
                              >
                                {project ? (
                                  <ProjectFavicon project={project} className="size-4 shrink-0" />
                                ) : (
                                  <FolderIcon className="size-4 shrink-0" />
                                )}
                                <span className="min-w-0 flex-1 truncate text-sm">
                                  {item.label}
                                </span>
                                {project && showProjectEnvironments ? (
                                  <ProjectEnvironmentBadge
                                    group={project}
                                    primaryEnvironmentId={primaryEnvironmentId}
                                    machineByEnvironmentId={environmentMachineById}
                                  />
                                ) : null}
                                {projectScopeJumpLabels.has(item) ? (
                                  <Kbd variant="plain" aria-hidden>
                                    {projectScopeJumpLabels.get(item)}
                                  </Kbd>
                                ) : null}
                                {project ? (
                                  <Button
                                    size="icon-xs"
                                    variant="ghost-muted"
                                    tabIndex={-1}
                                    aria-hidden="true"
                                    title={`Project settings for ${project.displayName}`}
                                    className="ml-auto"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      void handleProjectSettings(event, project);
                                    }}
                                  >
                                    <SettingsIcon className="size-3.5" />
                                  </Button>
                                ) : null}
                              </ComboboxItem>
                            );
                          }}
                        </ComboboxList>
                      </ComboboxPopup>
                    </Combobox>
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
              collisionDetection={dndCollisionDetection}
              modifiers={dndModifiers}
              onDragStart={handleThreadDragStart}
              onDragOver={handleThreadDragOver}
              onDragEnd={handleThreadDragEnd}
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
                    ) => {
                      const threadKey = scopedThreadKey(
                        scopeThreadRef(thread.environmentId, thread.id),
                      );
                      const isActive = routeThreadKey === threadKey;
                      return (
                        <SortableThreadRow
                          key={threadKey}
                          sortableId={threadKey}
                          contextDrag={isContextDrag}
                          sortableDisabled={
                            renamingThreadKey === threadKey ||
                            section === "working" ||
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
                              ? snoozeWakeLabel(thread.snoozedUntil, {
                                  now: new Date().toISOString(),
                                })
                              : null
                          }
                          // All sections: a woken thread can classify straight
                          // into the done tail (PR merged while snoozed), and
                          // the wake signal must survive the trip. Still-snoozed
                          // rows resolve to null on their own.
                          wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                          isActive={isActive}
                          pinShortcut={isActive ? pinShortcut : null}
                          doneShortcut={isActive ? doneShortcut : null}
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
                    for (const item of sidebarListItems) {
                      if (item.kind === "thread") {
                        items.push(renderThreadRow(threadByKey.get(item.key)!, item.section));
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
                              persistent={pinnedThreads.length > 0 && activeThreads.length > 0}
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
                                (activeThreads.length === 0 ||
                                  (from === "active" &&
                                    activeThreads.length === 1 &&
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
                              className={cn(workingThreads.length === 0 && "mt-auto")}
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
                            workingThreads.length + snoozedThreads.length === 0 ? (
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
