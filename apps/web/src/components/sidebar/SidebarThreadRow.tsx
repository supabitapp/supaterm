import { SIDEBAR_SORTABLE_DRAG_DISABLED } from "./SidebarListMarkers";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { discardComposerDraft } from "../../lib/discardComposerDraft";
import { resolveThreadCurrentPullRequestLink } from "@supaterm/shared/threadPullRequests";
import { getProviderOptionDescriptors } from "@supaterm/shared/model";
import { formatModelSelectionEffort } from "@supaterm/client-runtime/state/thread-execution";
import {
  getSpeedToggle,
  SPEED_TOGGLE_LABELS,
} from "@supaterm/client-runtime/provider-speed-toggle";
import { useAtomValue } from "@effect/atom-react";
import { isEnvironmentConnected } from "@supaterm/client-runtime/connection";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  canSnooze,
  hasQueuedTurnStart,
  QUEUED_TURN_START_GRACE_MS,
} from "@supaterm/client-runtime/state/thread-snooze";
import { resolveDoneThreadTimestamp } from "@supaterm/client-runtime/state/thread-sort";
import { resolveThreadProviderStack } from "@supaterm/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@supaterm/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentMachineKind,
  type ScopedThreadRef,
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
  GitBranchIcon,
  MessageCircleQuestionIcon,
  PinIcon,
  PinOffIcon,
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
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useRightPanelStore } from "../../rightPanelStore";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useSidebarThreadShell, useThreadShell } from "../../state/entities";
import { useNowSecond } from "../../hooks/useNowSecond";
import { environmentPresentations } from "../../state/presentation";
import { vcsEnvironment } from "../../state/vcs";
import { useEnvironmentQuery } from "../../state/query";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { formatRelativeTimeLabel, parseTimestampDate } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { cn } from "~/lib/utils";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import {
  animateSidebarLayoutChanges,
  formatWorkingDurationLabel,
  hasUnseenCompletion,
  resolveSidebarRowAccessibility,
  type SidebarDropVerb,
  type SidebarSweepAction,
  resolveSidebarThreadStatus,
  resolveSidebarV2DurationStartedAt,
  resolveSidebarV2TopStatus,
  shouldRecedeSidebarThread,
  shouldShowSidebarV2Duration,
  useRetainedValue,
  useSidebarRowSubscriptionLease,
} from "../Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "../BranchToolbar.logic";
import {
  ThreadPullRequestBadgeControl,
  ThreadPullRequestsMiniList,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
  terminalStatusFromRunningIds,
  ThreadTerminalStatusButton,
  type TerminalStatusIndicator,
  useLinkedThreadPullRequest,
} from "../ThreadStatusIndicators";
import { type SnoozePreset } from "../Sidebar.snooze";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { makeWorkspaceFileDropHandlers } from "../chat/workspaceFileDrop";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { useThreadRunningTerminalIds } from "../../state/terminalSessions";
import { InlineButton } from "../ui/button";
import { SidebarPinButton } from "./SidebarPinButton";
import { SidebarParkedActionButton } from "./SidebarParkedActionButton";
import { SidebarSnoozeButton } from "./SidebarSnoozeButton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";
import { useThreadHasUnsentDraft } from "../../composerDraftStore";

// The fields thread rows show. Provider status pushes refresh `checkedAt`,
// status and auth on every provider; leaving those out keeps each
// environment's map, and every memoized row, stable across them.
export type SidebarProviderEntry = Pick<
  ProviderInstanceEntry,
  | "instanceId"
  | "driverKind"
  | "enabled"
  | "displayName"
  | "accentColor"
  | "acpRegistryAgentId"
  | "acpRegistryIconUrl"
  | "models"
>;

function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function threadTimeTimestamp(thread: SidebarThreadSummary): string {
  return thread.latestUserMessageAt ?? thread.updatedAt;
}

// Subscribes to the minute tick itself, so the label keeps counting while the
// memoized row stays cached on its thread.
function CompactRelativeTimeLabel(props: { timestamp: string | null }) {
  const nowMinute = useNowMinute();
  return props.timestamp === null
    ? null
    : compactSidebarTimeLabel(
        formatRelativeTimeLabel(props.timestamp, Date.parse(`${nowMinute}:00Z`)),
      );
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
function WorkingDuration(props: { startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  if (Number.isNaN(startedMs)) return null;
  return <WorkingDurationLabel startedMs={startedMs} />;
}

function WorkingDurationLabel(props: { startedMs: number }) {
  const nowMs = useNowSecond();
  return (
    <span className="tabular-nums">{formatWorkingDurationLabel(nowMs - props.startedMs)}</span>
  );
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
      size="compact"
      iconClassName="opacity-60"
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
            <div className="min-w-0 flex-1 wrap-break-word">
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
const SIDEBAR_SORTABLE_DRAG_ENABLED = { draggable: false } as const;

// Takes the row's props rather than a render function: a closure from the
// sidebar body is new on every sidebar render, which rebuilt the bag and
// re-rendered every memoized row with it.
export function SortableThreadRow(
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
  // The sidebar arranges rows from quiet shells, which hold still while a
  // thread streams; reading the live shell here re-renders only this row.
  const thread =
    useSidebarThreadShell(scopeThreadRef(rowProps.thread.environmentId, rowProps.thread.id)) ??
    rowProps.thread;
  return <SidebarThreadRow {...rowProps} thread={thread} sortable={bag} />;
}

// The pen identifies unsent work on both draft sessions and existing threads.
export const draftPenClassName = "size-3 shrink-0 text-warning-foreground";

export function SidebarDraftDiscardButton(props: {
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
  /** Open in a chat pane that is not focused. */
  inOtherPane: boolean;
  // The pin and mark-done shortcuts act on the active thread, so only its row receives them.
  pinShortcut: string | null;
  doneShortcut: string | null;
  isRouteThread: boolean;
  openPullRequestsInRightPanel: boolean;
  jumpLabel: string | null;
  currentEnvironmentId: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  scratchMachineLabel: string | null;
  project: EnvironmentProject | null;
  /** Off under a project group, whose header already shows the icon. */
  showProjectIcon: boolean;
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
  const hasUnsentDraft = useThreadHasUnsentDraft(threadRef) && !props.isRouteThread;
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
  // The React Compiler caches render results on their inputs, so a clock read
  // here would stay frozen until `thread` changes and a queued-turn gate would
  // never reopen. The gate's clock is state, reset with the thread.
  const [snoozeGateClock, setSnoozeGateClock] = useState(() => ({
    thread,
    now: new Date().toISOString(),
  }));
  if (snoozeGateClock.thread !== thread) {
    setSnoozeGateClock({ thread, now: new Date().toISOString() });
  }
  const snoozeGateNow = snoozeGateClock.now;
  const snoozeGateExpiryMs = hasQueuedTurnStart(thread, { now: snoozeGateNow })
    ? Date.parse(thread.latestUserMessageAt ?? "") + QUEUED_TURN_START_GRACE_MS
    : Number.NaN;
  useEffect(() => {
    // A gate still closed past its expiry is held by runtime status, not time,
    // so no clock tick can open it.
    if (!Number.isFinite(snoozeGateExpiryMs) || snoozeGateExpiryMs <= Date.parse(snoozeGateNow)) {
      return;
    }
    const id = window.setTimeout(
      () => setSnoozeGateClock({ thread, now: new Date().toISOString() }),
      Math.min(Math.max(0, snoozeGateExpiryMs - Date.now()) + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(id);
  }, [snoozeGateExpiryMs, snoozeGateNow, thread]);
  const showSnoozeButton =
    canOperateThread && !isParked && snoozeSupported && canSnooze(thread, { now: snoozeGateNow });
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  // A newly blocked thread unmounts the menu without an onOpenChange callback.
  if (!showSnoozeButton && snoozeMenuOpenRaw) setSnoozeMenuOpen(false);
  const handlePrClick = (event: ReactMouseEvent<HTMLElement>, targetUrl?: string) => {
    const url = targetUrl ?? pr?.url ?? currentLinkedPr?.url;
    if (!url) return;
    const showInRightPanel = targetUrl !== undefined || openPullRequestsInRightPanel;
    const openedInRightPanel = openPrLink(event, url, showInRightPanel ? threadRef : undefined);
    if (openedInRightPanel && showInRightPanel && !props.isRouteThread) {
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
      : props.inOtherPane
        ? "bg-sidebar-row-active/50 text-sidebar-foreground hover:bg-sidebar-row-hover"
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
    if (!props.isRouteThread) onThreadActivate(threadRef);
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
                      {/* Done rows read how long ago the thread wrapped up, matching their sort key. */}
                      <CompactRelativeTimeLabel
                        timestamp={
                          variantAction === "reopen"
                            ? resolveDoneThreadTimestamp(thread)
                            : threadTimeTimestamp(thread)
                        }
                      />
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
              {props.showProjectIcon ? (
                <span className="inline-flex size-4 shrink-0">
                  {props.project ? (
                    <ProjectFavicon project={props.project} className="size-4" />
                  ) : null}
                </span>
              ) : null}
              {/* Left of the status slot, the pin would slide when hover swaps the
                label for the wider row controls. */}
              {pinIndicator}
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
