import * as Dialog from "../../components/ui/Dialog";
import type { ThreadRowProviderInstance } from "./thread-provider-instance";
import {
  THREAD_LIST_V2_MONO_FONT as MONO_FONT,
  THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME,
  THREAD_LIST_V2_ROW_DIVIDERS,
  selectedThreadRowColors,
  getThreadListV2NewBranchMenuTitle,
  getThreadListV2RowAppearance,
} from "./thread-list-v2-row-appearance";
import { RowPressable } from "../../components/ui/RowPressable";
import { CustomSnoozeSheet } from "./CustomSnoozeSheet";
import { appAtomRegistry } from "../../state/atom-registry";
import { threadArrangementOpenAtom } from "../../state/thread-order";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomValue } from "@effect/atom-react";
import { isEnvironmentConnected } from "@supaterm/client-runtime/connection";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import type { EnvironmentThreadSearchMatch } from "@supaterm/client-runtime/state/thread-search";
import { AuthOrchestrationOperateScope, type EnvironmentMachineKind } from "@supaterm/contracts";
import { resolveThreadListDurationStartedAt } from "@supaterm/client-runtime/state/thread-timing";
import { canSnooze, resolveSnoozePresets } from "@supaterm/client-runtime/state/thread-snooze";
import { withOccurrenceKeys } from "@supaterm/shared/occurrenceKeys";
import type { MenuAction } from "@react-native-menu/menu";
import { memo, useCallback, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import type { ThreadListProvider } from "../../state/thread-list-environments";
import { environmentPresentations } from "../../state/presentation";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { ProviderIcon, ProviderInstanceIcon } from "../../components/ProviderIcon";
import { useNowAfter } from "../../lib/clock";
import { cn } from "../../lib/cn";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useEnvironmentScope } from "../../state/session";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  resolveThreadPrBadgeAction,
  type ThreadPrPresentation,
} from "../../state/thread-pr-presentation";
import { useThreadPr } from "../../state/use-thread-pr";
import { useThreadHasUnsentDraft } from "../../state/use-thread-has-unsent-draft";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useSwipeRowDormant } from "../home/swipe-row-activation";
import { ThreadSwipeable, type ThreadSwipeAction } from "../home/thread-swipe-actions";
import { buildThreadTitleRegenerationMenuItems } from "./thread-title-regeneration-menu";
import {
  type ThreadListV2Status,
  THREAD_LIST_V2_DONE_PAGE_COUNT,
  resolveThreadListV2SnoozeGateExpiryMs,
  resolveThreadListV2SnoozeMenuSelection,
  threadHasUnseenCompletion,
  resolveThreadListV2Status,
  resolveThreadListV2ProviderDrivers,
  resolveThreadListV2SwipeActions,
} from "./threadListV2";
import { QueuedMessageIcon } from "./queued-message-icon";
import { UnsentDraftIcon } from "./unsent-draft-icon";
import { shouldRecedeThreadRow } from "./thread-row-emphasis";
import { ThreadSearchMatchExcerpt } from "./thread-search-match";
import { useScaledTextRole } from "../settings/appearance/useScaledTextRole";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { pullRequestStatus } from "../pull-requests/pullRequestStatus";
import { DisclosureChevron } from "../../components/ui/DisclosureChevron";
import { THREAD_LIST_MOTION_DURATION } from "./thread-list-motion";
import { ThreadListWorkingStatus } from "./thread-list-working-status";
import { resolveThreadListV2RowStatusLabel } from "./thread-list-row-status";

/**
 * Thread List v2 renders one flat native list: rich edge-to-edge rows for
 * active work and a receded done tail, all with native swipe and
 * long-press actions. State reads through colored status labels and text
 * hierarchy rather than card fills.
 */

interface StatusLabel {
  readonly label: string;
  readonly icon: AppSymbolName;
  readonly className: string;
  readonly iconTintClassName: string;
}
const STATUS_LABEL_BY_STATUS: Partial<Record<ThreadListV2Status, StatusLabel>> = {
  approval: {
    label: "Approval",
    icon: "exclamationmark.shield",
    className: "text-warning-foreground",
    iconTintClassName: "accent-warning-foreground",
  },
  input: {
    label: "Input",
    icon: "questionmark.bubble",
    className: "text-adaptive-indigo-600-300",
    iconTintClassName: "accent-adaptive-indigo-600-300",
  },
  working: {
    label: "Working",
    icon: "circle.dashed",
    className: "text-adaptive-sky-600-400",
    iconTintClassName: "accent-adaptive-sky-600-400",
  },
  waiting: {
    label: "Waiting",
    icon: "circle.dashed.inset.filled",
    className: "text-foreground-muted",
    iconTintClassName: "accent-foreground-muted",
  },
  failed: {
    label: "Failed",
    icon: "exclamationmark.circle",
    className: "text-danger-foreground",
    iconTintClassName: "accent-danger-foreground",
  },
  limited: {
    label: "Limited",
    icon: "exclamationmark.circle",
    className: "text-warning-foreground",
    iconTintClassName: "accent-warning-foreground",
  },
};
const READY_STATUS_LABEL: StatusLabel = {
  label: "Ready",
  icon: "checkmark.circle",
  className: "text-adaptive-emerald-700-300",
  iconTintClassName: "accent-adaptive-emerald-700-300",
};

const MARK_DONE_MENU_ACTION: MenuAction = {
  id: "mark-done",
  title: "Mark as Done",
  image: "checkmark",
};

const CARD_MENU_ACTIONS: MenuAction[] = [
  MARK_DONE_MENU_ACTION,
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const SLIM_MENU_ACTIONS: MenuAction[] = [
  { id: "reopen", title: "Reopen", image: "arrow.uturn.backward" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const SNOOZED_MENU_ACTIONS: MenuAction[] = [
  { id: "unsnooze", title: "Wake thread", image: "clock" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

// Archive is available before the environment config loads.
const LEGACY_MENU_ACTIONS: MenuAction[] = [
  { id: "archive", title: "Archive", image: "archivebox" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const SIDEBAR_V2_ROW_RADIUS = 12;

function ThreadListV2Section(props: {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly pane?: "screen" | "sidebar";
  readonly disclosure?: {
    readonly expanded: boolean;
    readonly disabled?: boolean;
    readonly onToggle: () => void;
    readonly accessibilityLabel: string;
    readonly accessibilityHint: string;
  };
}) {
  const sidebarPane = props.pane === "sidebar";
  const className = cn(
    "flex-row items-center gap-2.5",
    !props.disclosure && "mb-1.5 mt-4",
    props.pane === "sidebar" ? "px-3" : "px-5",
  );
  const content = (
    <>
      {props.icon}
      <Text
        className={cn(
          "shrink text-xs",
          sidebarPane ? "text-drawer-foreground-muted" : "text-foreground-tertiary",
        )}
        numberOfLines={1}
      >
        {props.label}
      </Text>
      <View className={cn("h-px min-w-2 flex-1", sidebarPane ? "bg-drawer-border" : "bg-border")} />
      {props.disclosure ? (
        <DisclosureChevron
          expanded={props.disclosure.expanded}
          collapsedDirection="right"
          duration={THREAD_LIST_MOTION_DURATION}
          size={10}
          tintColorClassName={
            sidebarPane ? "accent-drawer-foreground-muted" : "accent-foreground-muted"
          }
        />
      ) : null}
    </>
  );

  return props.disclosure ? (
    <Pressable
      accessibilityHint={props.disclosure.accessibilityHint}
      accessibilityLabel={props.disclosure.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{
        disabled: props.disclosure.disabled,
        expanded: props.disclosure.expanded,
      }}
      className={className}
      disabled={props.disclosure.disabled}
      onPress={props.disclosure.onToggle}
      style={({ pressed }) => ({ minHeight: 36, opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  ) : (
    <View className={className}>{content}</View>
  );
}

export const ThreadListV2SectionDivider = memo(function ThreadListV2SectionDivider(props: {
  readonly label: string;
  readonly pane?: "screen" | "sidebar";
}) {
  return <ThreadListV2Section {...props} />;
});

type ThreadListV2ShelfHeaderProps = {
  readonly count: number;
  readonly disabled?: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly pane?: "screen" | "sidebar";
};

const SHELF_LABEL = {
  active: "Active",
  pinned: "Pinned",
  working: "Working",
  snoozed: "Snoozed",
  done: "Done",
} as const;

function ThreadListV2ShelfHeader(
  props: ThreadListV2ShelfHeaderProps & { readonly kind: keyof typeof SHELF_LABEL },
) {
  const label = SHELF_LABEL[props.kind];
  return (
    <ThreadListV2Section
      label={props.expanded ? label : `${label} (${props.count})`}
      pane={props.pane}
      disclosure={{
        expanded: props.expanded,
        disabled: props.disabled,
        onToggle: props.onToggle,
        accessibilityLabel: `${props.count} ${props.kind} ${props.count === 1 ? "thread" : "threads"}`,
        accessibilityHint: `${props.expanded ? "Collapses" : "Expands"} the ${props.kind} threads.`,
      }}
    />
  );
}

export const ThreadListV2GroupHeader = memo(function ThreadListV2GroupHeader(props: {
  readonly groupKey: string;
  readonly label: string;
  readonly project?: EnvironmentProject | null;
  readonly count: number;
  readonly expanded: boolean;
  readonly disabled?: boolean;
  readonly onToggle: (groupKey: string) => void;
  readonly pane?: "screen" | "sidebar";
}) {
  const { groupKey, onToggle, project } = props;
  return (
    <ThreadListV2Section
      label={props.expanded ? props.label : `${props.label} (${props.count})`}
      icon={
        project ? (
          <ProjectFavicon
            environmentId={project.environmentId}
            faviconPath={project.faviconPath}
            projectIcon={project.projectIcon}
            size={15}
            projectTitle={project.title}
            workspaceRoot={project.workspaceRoot}
          />
        ) : undefined
      }
      pane={props.pane}
      disclosure={{
        expanded: props.expanded,
        disabled: props.disabled,
        onToggle: () => onToggle(groupKey),
        accessibilityLabel: `${props.label}, ${props.count} ${props.count === 1 ? "thread" : "threads"}`,
        accessibilityHint: `${props.expanded ? "Collapses" : "Expands"} the ${props.label} threads.`,
      }}
    />
  );
});

export const ThreadListV2PinnedShelfHeader = memo(function ThreadListV2PinnedShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="pinned" />;
});

export const ThreadListV2ActiveShelfHeader = memo(function ThreadListV2ActiveShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="active" />;
});

export const ThreadListV2WorkingShelfHeader = memo(function ThreadListV2WorkingShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="working" />;
});

export const ThreadListV2SnoozedShelfHeader = memo(function ThreadListV2SnoozedShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="snoozed" />;
});

export const ThreadListV2DoneShelfHeader = memo(function ThreadListV2DoneShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="done" />;
});

export const ThreadListV2ShowMoreRow = memo(function ThreadListV2ShowMoreRow(props: {
  readonly pane?: "screen" | "sidebar";
  readonly hiddenCount: number;
  /** Older done threads are loading, or their last read failed. */
  readonly state?: "loading" | "failed";
  readonly onPress: () => void;
}) {
  const label =
    props.state === "loading"
      ? "Loading"
      : props.state === "failed"
        ? "Could not load older threads. Retry"
        : `Show more (${props.hiddenCount} Done hidden)`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        props.state === undefined
          ? `Show ${Math.min(props.hiddenCount, THREAD_LIST_V2_DONE_PAGE_COUNT)} more Done threads`
          : label
      }
      disabled={props.state === "loading"}
      onPress={props.onPress}
      className="mx-4 mt-2 items-center rounded-lg border border-dashed border-border py-2.5"
      style={({ pressed }) => ({ minHeight: 44, opacity: pressed ? 0.6 : 1 })}
    >
      <Text
        className={
          props.pane === "sidebar"
            ? "text-xs font-supaterm-medium text-drawer-foreground-muted"
            : "text-xs font-supaterm-medium text-foreground-muted"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
});

const PENDING_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const DRAFT_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Discard", image: "trash", attributes: { destructive: true } },
];

/**
 * Unsent work reads like the thread it will become. The status slot says what happens next:
 * "Sends on reconnect" stays uncolored because nothing is asked of the user; "Draft" uses the web
 * sidebar's amber pen for work waiting on the user.
 */
export const ThreadListV2PendingRow = memo(function ThreadListV2PendingRow(props: {
  readonly pendingTask: PendingNewTask;
  readonly selected?: boolean;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  readonly environmentLabel: string | null;
  readonly environmentMachine?: EnvironmentMachineKind;
  readonly pane?: "screen" | "sidebar";
  /** Draws the "Drafts" or "Unsent" divider above the first row in each group. */
  readonly showPendingDivider: boolean;
  readonly showTrailingDivider?: boolean;
  readonly onSelectPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onDeletePendingTask: (pendingTask: PendingNewTask) => void;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  readonly activationKey?: string;
  readonly fullSwipeWidth?: number;
  readonly simultaneousSwipeGesture?: ComponentProps<typeof ThreadSwipeable>["simultaneousWith"];
}) {
  const { pendingTask, onSelectPendingTask, onDeletePendingTask } = props;
  const { width: windowWidth } = useWindowDimensions();
  const theme = useUniwindTheme();
  const dormant = useSwipeRowDormant(props.activationKey);
  const sidebarPane = props.pane === "sidebar";
  const rowAppearance = getThreadListV2RowAppearance(theme, sidebarPane, props.selected ?? false);
  const isDraft = pendingTask.kind === "draft";
  const projectTitle = props.projectTitle ?? props.project?.title ?? pendingTask.projectTitle ?? "";
  const branch = pendingTask.branch;
  const handleDelete = useCallback(
    () => onDeletePendingTask(pendingTask),
    [onDeletePendingTask, pendingTask],
  );

  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "delete") handleDelete();
    },
    [handleDelete],
  );

  const rowContent = (
    <>
      <View className="flex-row items-center gap-1.5">
        {props.project ? (
          <ProjectFavicon
            environmentId={pendingTask.environmentId}
            faviconPath={props.project.faviconPath}
            projectIcon={props.project.projectIcon}
            size={15}
            projectTitle={props.project.title}
            workspaceRoot={props.project.workspaceRoot}
          />
        ) : null}
        <Text
          className={cn(
            "flex-1 text-sm font-supaterm-medium text-foreground-muted",
            sidebarPane && "text-drawer-foreground-muted",
          )}
          numberOfLines={1}
        >
          {projectTitle}
        </Text>
        {isDraft ? (
          <View className="flex-row items-center gap-1">
            <UnsentDraftIcon size={10} />
            <Text className="text-xs text-adaptive-amber-700-300">Draft</Text>
          </View>
        ) : (
          <Text
            className={cn(
              "text-xs text-foreground-tertiary",
              sidebarPane && "text-drawer-foreground-muted",
            )}
          >
            Sends on reconnect
          </Text>
        )}
      </View>
      <Text
        className={cn(
          "mt-1 text-base font-supaterm-medium text-foreground",
          sidebarPane && "text-drawer-foreground",
        )}
        numberOfLines={1}
      >
        {pendingTask.title}
      </Text>
      {branch || props.environmentLabel ? (
        <View className="mt-1 flex-row items-center gap-1">
          <Text
            className={cn(
              "shrink text-xs text-foreground-muted",
              sidebarPane && "text-drawer-foreground-muted",
            )}
            numberOfLines={1}
          >
            {branch ? (
              <Text
                className={cn(
                  "text-xs text-foreground-muted",
                  sidebarPane && "text-drawer-foreground-muted",
                )}
                style={{ fontFamily: MONO_FONT }}
              >
                {branch}
              </Text>
            ) : null}
            {branch && props.environmentLabel ? "  ·  " : null}
            {props.environmentLabel ? (
              <Text
                className={cn(
                  "text-xs text-foreground-tertiary",
                  sidebarPane && "text-drawer-foreground-muted",
                )}
              >
                {props.environmentLabel}
              </Text>
            ) : null}
          </Text>
          {props.environmentLabel && props.environmentMachine ? (
            <EnvironmentMachineSymbol
              kind={props.environmentMachine}
              size={11}
              tintColorClassName={
                sidebarPane ? "accent-drawer-foreground-muted" : "accent-foreground-tertiary"
              }
            />
          ) : null}
        </View>
      ) : null}
    </>
  );

  const renderRow = (close: () => void) => (
    <Menu
      actions={isDraft ? DRAFT_TASK_MENU_ACTIONS : PENDING_TASK_MENU_ACTIONS}
      onPressAction={(event) => {
        close();
        handleMenuAction(event);
      }}
      shouldOpenOnLongPress
    >
      <RowPressable
        accessibilityHint={
          isDraft
            ? "Opens the draft in the new task composer. Swipe left to discard."
            : "Sends when the environment reconnects. Opens the task for editing. Swipe left to delete."
        }
        accessibilityLabel={pendingTask.title}
        accessibilityRole="button"
        accessibilityState={{ selected: props.selected ?? false }}
        key={pendingTask.key}
        className={rowAppearance.className}
        interactionClassName={rowAppearance.interactionClassName}
        interactionOpacity={rowAppearance.interactionOpacity}
        onPress={() => {
          close();
          onSelectPendingTask(pendingTask);
        }}
        style={rowAppearance.cardStyle}
      >
        {sidebarPane ? (
          rowContent
        ) : (
          <View>
            <View className="px-5 py-2.5">{rowContent}</View>
            {props.showTrailingDivider !== false ? (
              <View className="ml-5 h-px bg-border-subtle" />
            ) : null}
          </View>
        )}
      </RowPressable>
    </Menu>
  );
  const pendingDivider = props.showPendingDivider ? (
    <ThreadListV2SectionDivider label={isDraft ? "Drafts" : "Unsent"} pane={props.pane} />
  ) : null;

  return (
    <View key={pendingTask.key}>
      {pendingDivider}
      <ThreadSwipeable
        dormant={dormant}
        threadKey={pendingTask.key}
        backgroundColor={theme[sidebarPane ? "--color-drawer" : "--color-screen"]}
        containerStyle={
          sidebarPane ? { borderRadius: SIDEBAR_V2_ROW_RADIUS, overflow: "hidden" } : undefined
        }
        enableTrackpadSwipe
        fullSwipeAction="primary"
        fullSwipeWidth={props.fullSwipeWidth ?? windowWidth - 32}
        onDelete={handleDelete}
        onSwipeableClose={props.onSwipeableClose}
        onSwipeableWillOpen={props.onSwipeableWillOpen}
        primaryAction={{
          accessibilityLabel: `${isDraft ? "Discard" : "Delete"} ${pendingTask.title}`,
          icon: "trash",
          label: isDraft ? "Discard" : "Delete",
          tone: "danger",
          onPress: handleDelete,
        }}
        secondaryAction={null}
        resetKey={pendingTask.key}
        simultaneousWith={props.simultaneousSwipeGesture}
        threadTitle={pendingTask.title}
      >
        {renderRow}
      </ThreadSwipeable>
    </View>
  );
});

export const ThreadListV2Row = memo(function ThreadListV2Row(props: {
  readonly thread: EnvironmentThreadShell;
  readonly variant: "card" | "slim";
  readonly hasQueuedMessages?: boolean;
  readonly snoozed?: boolean;
  readonly pinned?: boolean;
  readonly wokeAt: string | null;
  readonly snoozeWakeLabelText?: string;
  /** Precomputed per row, not via the list's extraData, so the minute tick re-renders only rows
      whose text moved. Blank while a status label or the wake countdown owns the slot. */
  readonly timeLabel: string;
  readonly snoozePresetMinute: string;
  readonly project: EnvironmentProject | null;
  readonly showProjectIcon?: boolean;
  readonly providers: ReadonlyArray<ThreadListProvider> | undefined;
  readonly providerInstance: ThreadRowProviderInstance | null;
  readonly environmentLabel: string | null;
  readonly environmentMachine?: EnvironmentMachineKind;
  readonly pane?: "screen" | "sidebar";
  readonly showTrailingDivider?: boolean;
  readonly selected?: boolean;
  readonly fullSwipeWidth?: number;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onOpenThreadPullRequests: (
    thread: EnvironmentThreadShell,
    pr: ThreadPrPresentation,
  ) => void;
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadOnBranch: (thread: EnvironmentThreadShell) => void;
  readonly onRenameThread: (thread: EnvironmentThreadShell) => void;
  readonly onRegenerateThreadTitle: (thread: EnvironmentThreadShell) => void;
  readonly onMarkThreadDone: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly onSnoozeThread: (thread: EnvironmentThreadShell, snoozedUntil: string) => void;
  readonly onUnsnoozeThread: (thread: EnvironmentThreadShell) => void;
  readonly onReopenThread: (thread: EnvironmentThreadShell) => void;
  readonly onArchiveThread: (thread: EnvironmentThreadShell) => void;
  readonly onPinThread: (thread: EnvironmentThreadShell) => void;
  readonly onUnpinThread: (thread: EnvironmentThreadShell) => void;
  readonly onSetThreadAutoMarkDone: (thread: EnvironmentThreadShell, enabled: boolean) => void;
  /** False on environments whose server predates thread.mark-done/reopen:
      swipe + menu fall back to Archive instead of failing on use. */
  readonly markDoneSupported: boolean;
  readonly snoozeSupported: boolean;
  readonly pinningSupported: boolean;
  /** False on servers that predate thread.auto-mark-done.set. */
  readonly autoMarkDoneOptOutSupported: boolean;
  readonly titleRegenerationSupported: boolean;
  /** Server supports the Arrange threads sheet (pin reordering). */
  readonly arrangeSupported?: boolean;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  readonly activationKey?: string;
  readonly searchMatch?: EnvironmentThreadSearchMatch;
  readonly searchQuery?: string;
  readonly simultaneousSwipeGesture?: ComponentProps<typeof ThreadSwipeable>["simultaneousWith"];
}) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const titleTypography = useScaledTextRole("body");
  const metadataTypography = useScaledTextRole("label");
  const projectIconSize = titleTypography.fontSize * 1.25 * fontScale;
  const machineIconSize = metadataTypography.fontSize * fontScale;
  const titleLineHeight = titleTypography.lineHeight * fontScale;
  const {
    thread,
    variant,
    onSelectThread,
    onOpenThreadPullRequests,
    onDeleteThread,
    onRenameThread,
    onRegenerateThreadTitle,
    onNewThreadOnBranch,
    onMarkThreadDone,
    onSnoozeThread,
    onUnsnoozeThread,
    onReopenThread,
    onArchiveThread,
    onPinThread,
    onUnpinThread,
    onSetThreadAutoMarkDone,
  } = props;
  const snoozedRow = props.snoozed === true;
  const pinnedRow = props.pinned === true;
  const iconProject = props.showProjectIcon === false ? null : props.project;
  const environmentConnected = useAtomValue(
    environmentPresentations.presentationAtom(thread.environmentId),
    isEnvironmentConnected,
  );
  const dormant = useSwipeRowDormant(props.activationKey);

  const selectThread = () => onSelectThread(thread);
  const { providerDrivers, providerIconUrl } = useMemo(() => {
    const provider = props.providers?.find(
      (candidate) =>
        candidate.instanceId ===
        (thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId),
    );
    return {
      providerDrivers: resolveThreadListV2ProviderDrivers(thread, props.providers),
      providerIconUrl: provider?.iconUrl,
    };
  }, [thread, props.providers]);

  const providerInstance = props.providerInstance;
  const pr = useThreadPr(thread);
  const prBadgeLabel = pr ? resolveThreadPrBadgeAction(pr).accessibilityLabel : null;
  const handleOpenPullRequests = useCallback(() => {
    if (pr) onOpenThreadPullRequests(thread, pr);
  }, [onOpenThreadPullRequests, pr, thread]);

  const theme = useUniwindTheme();
  const sidebarPane = props.pane === "sidebar";
  const selected = props.selected === true;
  const rowAppearance = getThreadListV2RowAppearance(theme, sidebarPane, selected);
  const threadKey = scopedThreadKey(thread.environmentId, thread.id);
  // The selected thread shows its own composer in the detail pane.
  const hasUnsentDraft = useThreadHasUnsentDraft(threadKey) && !selected;
  const rowAccessibilityLabel = [
    thread.title,
    hasUnsentDraft ? "unsent draft" : null,
    props.hasQueuedMessages ? "messages queued to send" : null,
  ]
    .filter((part) => part !== null)
    .join(", ");

  const status = resolveThreadListV2Status(thread);
  const isUnread = status === "ready" && threadHasUnseenCompletion(thread);
  const showsWoke = environmentConnected && status === "ready" && props.wokeAt !== null;
  const rowStatusLabel = resolveThreadListV2RowStatusLabel({
    environmentConnected,
    status,
    isUnread,
    goalActive: thread.goal?.status === "active",
    mutedClassName: selected
      ? selectedThreadRowColors.mutedForegroundClassName
      : rowAppearance.mutedForegroundClassName,
  });
  const durationStartedAt =
    environmentConnected && (status === "working" || status === "waiting")
      ? resolveThreadListDurationStartedAt(thread)
      : null;
  const statusAppearance = environmentConnected
    ? (STATUS_LABEL_BY_STATUS[status] ?? (isUnread ? READY_STATUS_LABEL : undefined))
    : undefined;
  const statusLabel =
    rowStatusLabel === undefined
      ? undefined
      : {
          ...rowStatusLabel,
          icon: statusAppearance?.icon ?? ("wifi.slash" as const),
          iconTintClassName:
            status === "waiting"
              ? rowAppearance.mutedIconTintClassName
              : (statusAppearance?.iconTintClassName ??
                (selected
                  ? selectedThreadRowColors.iconTintClassName
                  : rowAppearance.mutedIconTintClassName)),
        };
  const recede = environmentConnected && shouldRecedeThreadRow({ status, selected });
  // The timestamp is precomputed on the list item (same stamps the done
  // tail sorts by) so a minute tick only re-renders rows that draw it.
  const timeLabel = props.timeLabel;

  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const handleAcknowledgeWoke = useCallback(() => {
    if (props.wokeAt === null) return;
    void visitThread({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, visitedAt: props.wokeAt },
    });
  }, [props.wokeAt, thread.environmentId, thread.id, visitThread]);
  // VoiceOver cannot focus buttons inside the accessible row.
  const rowAccessibilityActions = useMemo(
    () => [
      ...(prBadgeLabel ? [{ name: "openPullRequests", label: prBadgeLabel }] : []),
      ...(showsWoke ? [{ name: "dismissWoke", label: "Dismiss Woke notification" }] : []),
    ],
    [prBadgeLabel, showsWoke],
  );

  const handleDelete = useCallback(() => onDeleteThread(thread), [onDeleteThread, thread]);
  const handleRename = useCallback(() => onRenameThread(thread), [onRenameThread, thread]);
  const canOperateThread = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const handleRegenerateTitle = useCallback(
    () => onRegenerateThreadTitle(thread),
    [onRegenerateThreadTitle, thread],
  );
  const handleMarkDone = useCallback(() => onMarkThreadDone(thread), [onMarkThreadDone, thread]);
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);
  // A recycled cell reassigns this row to another thread without remounting, so row-local UI
  // state is dismissed when the identity changes; otherwise an open custom snooze sheet would
  // snooze whichever thread the cell was reassigned to.
  const [boundIdentity, setBoundIdentity] = useState(threadKey);
  if (boundIdentity !== threadKey) {
    setBoundIdentity(threadKey);
    setCustomSnoozeOpen(false);
  }
  const handleSnooze = useCallback(
    (snoozedUntil: string) => onSnoozeThread(thread, snoozedUntil),
    [onSnoozeThread, thread],
  );
  const handleUnsnooze = useCallback(() => onUnsnoozeThread(thread), [onUnsnoozeThread, thread]);
  const handleReopen = useCallback(() => onReopenThread(thread), [onReopenThread, thread]);
  const handlePin = useCallback(() => onPinThread(thread), [onPinThread, thread]);
  const handleUnpin = useCallback(() => onUnpinThread(thread), [onUnpinThread, thread]);
  const handleSetAutoMarkDone = useCallback(
    (enabled: boolean) => onSetThreadAutoMarkDone(thread, enabled),
    [onSetThreadAutoMarkDone, thread],
  );
  const handleArchive = useCallback(() => onArchiveThread(thread), [onArchiveThread, thread]);

  // Swipe: the v2 primary action is the lifecycle transition. Reopening a
  // done row keeps it active until new activity clears the user override.
  const canReopen = variant === "slim";
  // The gate's only time-dependent edge is the queued-turn grace window, so its
  // expiry is known without a clock: evaluate at the message's own timestamp.
  // A gate held by runtime status has no expiry, and no clock tick opens it.
  const snoozeGateExpiryMs = props.snoozeSupported
    ? resolveThreadListV2SnoozeGateExpiryMs(thread, { now: thread.latestUserMessageAt ?? "" })
    : null;
  // The window is inclusive, so wake just past it.
  const snoozeGateNowMs = useNowAfter(snoozeGateExpiryMs === null ? null : snoozeGateExpiryMs + 1);
  const snoozeGateNow = new Date(snoozeGateNowMs).toISOString();
  const swipeActions = resolveThreadListV2SwipeActions({
    variant,
    markDoneSupported: props.markDoneSupported,
    snoozeSupported: props.snoozeSupported,
    snoozable: canSnooze(thread, { now: snoozeGateNow }),
    snoozed: snoozedRow,
  });
  const [snoozePresetClock, setSnoozePresetClock] = useState(() => ({
    minute: props.snoozePresetMinute,
    now: new Date(),
  }));
  if (snoozePresetClock.minute !== props.snoozePresetMinute) {
    // oxlint-disable-next-line react/purity -- Resamples the preset clock only when the preset minute changes.
    setSnoozePresetClock({ minute: props.snoozePresetMinute, now: new Date() });
  }
  const snoozePresets = useMemo(
    () =>
      swipeActions.secondary === "snooze"
        ? resolveSnoozePresets(snoozePresetClock.now)
        : ([] as const),
    [snoozePresetClock.now, swipeActions.secondary],
  );
  const snoozePresetActions = useMemo<MenuAction[]>(
    () => [
      ...snoozePresets.map((preset) => ({
        id: `snooze:${preset.id}`,
        title: preset.label,
        subtitle: preset.whenLabel,
      })),
      { id: "snooze:custom", title: "Custom…" },
    ],
    [snoozePresets],
  );
  const arrangementMenuItems = useMemo<MenuAction[]>(
    () => [
      ...(props.arrangeSupported === true
        ? [{ id: "arrange", title: "Arrange threads…", image: "line.3.horizontal" }]
        : []),
      ...(props.pinningSupported
        ? [
            thread.pinnedAt != null
              ? { id: "unpin", title: "Unpin", image: "pin.slash" }
              : { id: "pin", title: "Pin", image: "pin" },
          ]
        : []),
    ],
    [props.arrangeSupported, props.pinningSupported, thread.pinnedAt],
  );
  const autoMarkDoneMenuItems = useMemo<MenuAction[]>(
    () =>
      props.autoMarkDoneOptOutSupported
        ? [
            {
              id: "auto-mark-done",
              title: "Automatic completion",
              image: "timer",
              subactions: [
                {
                  id: "auto-mark-done:enabled",
                  title: "Enabled",
                  state: thread.autoMarkDoneDisabledAt == null ? "on" : "off",
                },
                {
                  id: "auto-mark-done:disabled",
                  title: "Disabled",
                  state: thread.autoMarkDoneDisabledAt == null ? "off" : "on",
                },
              ],
            } satisfies MenuAction,
          ]
        : [],
    [props.autoMarkDoneOptOutSupported, thread.autoMarkDoneDisabledAt],
  );
  const titleMenuItems = useMemo<MenuAction[]>(
    () => [
      { id: "rename", title: "Rename", image: "square.and.pencil" },
      ...buildThreadTitleRegenerationMenuItems({
        supported: props.titleRegenerationSupported,
        isRegenerating: thread.titleRegeneration != null,
      }),
    ],
    [props.titleRegenerationSupported, thread.titleRegeneration],
  );
  const snoozableCardMenuActions = useMemo<MenuAction[]>(
    () => [
      MARK_DONE_MENU_ACTION,
      {
        id: "snooze",
        title: "Snooze",
        image: "clock",
        subactions: snoozePresetActions,
      },
      ...arrangementMenuItems,
      ...titleMenuItems,
      ...autoMarkDoneMenuItems,
      LEGACY_MENU_ACTIONS[0]!,
      { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
    ],
    [arrangementMenuItems, autoMarkDoneMenuItems, snoozePresetActions, titleMenuItems],
  );
  const cardMenuActions = useMemo<MenuAction[]>(
    () => [
      CARD_MENU_ACTIONS[0]!,
      ...arrangementMenuItems,
      ...titleMenuItems,
      ...autoMarkDoneMenuItems,
      LEGACY_MENU_ACTIONS[0]!,
      ...CARD_MENU_ACTIONS.slice(1),
    ],
    [arrangementMenuItems, autoMarkDoneMenuItems, titleMenuItems],
  );
  // Done and snoozed rows keep the setting too, matching web where every
  // row shares one menu builder.
  const slimMenuActions = useMemo<MenuAction[]>(
    () => [
      SLIM_MENU_ACTIONS[0]!,
      ...arrangementMenuItems,
      ...titleMenuItems,
      ...autoMarkDoneMenuItems,
      LEGACY_MENU_ACTIONS[0]!,
      SLIM_MENU_ACTIONS[1]!,
    ],
    [arrangementMenuItems, autoMarkDoneMenuItems, titleMenuItems],
  );
  const snoozedMenuActions = useMemo<MenuAction[]>(
    () => [
      SNOOZED_MENU_ACTIONS[0]!,
      ...(props.markDoneSupported ? [MARK_DONE_MENU_ACTION] : []),
      ...titleMenuItems,
      ...autoMarkDoneMenuItems,
      LEGACY_MENU_ACTIONS[0]!,
      SNOOZED_MENU_ACTIONS[1]!,
    ],
    [autoMarkDoneMenuItems, props.markDoneSupported, titleMenuItems],
  );
  const legacyMenuActions = useMemo<MenuAction[]>(
    () => [
      LEGACY_MENU_ACTIONS[0]!,
      ...arrangementMenuItems,
      ...titleMenuItems,
      LEGACY_MENU_ACTIONS[1]!,
    ],
    [arrangementMenuItems, titleMenuItems],
  );
  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "new-thread-on-branch") onNewThreadOnBranch(thread);
      if (nativeEvent.event === "mark-done") handleMarkDone();
      if (nativeEvent.event === "reopen") handleReopen();
      if (nativeEvent.event === "unsnooze") handleUnsnooze();
      if (nativeEvent.event === "pin") handlePin();
      if (nativeEvent.event === "unpin") handleUnpin();
      if (nativeEvent.event === "auto-mark-done:enabled") handleSetAutoMarkDone(true);
      if (nativeEvent.event === "auto-mark-done:disabled") handleSetAutoMarkDone(false);
      if (nativeEvent.event === "arrange") appAtomRegistry.set(threadArrangementOpenAtom, true);
      if (nativeEvent.event === "archive") handleArchive();
      if (nativeEvent.event === "rename") handleRename();
      if (nativeEvent.event === "regenerate-title") handleRegenerateTitle();
      if (nativeEvent.event === "copy-thread-id") {
        copyTextWithHaptic(thread.id, { target: "thread-id" });
      }
      if (nativeEvent.event === "delete") handleDelete();
      if (nativeEvent.event === "snooze:custom") {
        setCustomSnoozeOpen(true);
        return;
      }
      const snoozeSelection = resolveThreadListV2SnoozeMenuSelection({
        event: nativeEvent.event,
        displayedPresets: snoozePresets,
        now: new Date(),
      });
      if (snoozeSelection._tag === "selected") {
        handleSnooze(snoozeSelection.preset.snoozedUntil);
      } else if (snoozeSelection._tag === "expired") {
        Dialog.alert(
          "Could not snooze thread",
          "That snooze time has passed. Choose another time.",
        );
      }
    },
    [
      onNewThreadOnBranch,
      thread,
      handleArchive,
      handleDelete,
      handleRegenerateTitle,
      handleRename,
      handlePin,
      handleMarkDone,
      handleSnooze,
      handleSetAutoMarkDone,
      handleUnpin,
      handleReopen,
      handleUnsnooze,
      setCustomSnoozeOpen,
      snoozePresets,
    ],
  );
  const primaryAction = useMemo(() => {
    // Until the environment config loads, archive is the swipe action. (Slim
    // rows cannot occur here — unsupported environments never classify as
    // done.)
    if (swipeActions.primary === "archive") {
      return {
        accessibilityLabel: `Archive ${thread.title}`,
        icon: "archivebox" as const,
        label: "Archive",
        onPress: handleArchive,
      };
    }
    if (swipeActions.primary === "unsnooze") {
      return {
        accessibilityLabel: `Wake ${thread.title} now`,
        icon: "clock" as const,
        label: "Wake",
        onPress: handleUnsnooze,
      };
    }
    return swipeActions.primary === "reopen"
      ? {
          accessibilityLabel: `Reopen ${thread.title}`,
          icon: "arrow.uturn.backward" as const,
          label: "Reopen",
          onPress: handleReopen,
        }
      : {
          accessibilityLabel: `Mark as Done ${thread.title}`,
          icon: "checkmark" as const,
          label: "Done",
          onPress: handleMarkDone,
        };
  }, [
    handleArchive,
    handleMarkDone,
    handleReopen,
    handleUnsnooze,
    swipeActions.primary,
    thread.title,
  ]);
  const secondaryAction = useMemo<ThreadSwipeAction | null>(
    () =>
      swipeActions.secondary === "snooze"
        ? {
            accessibilityLabel: `Choose when to snooze ${thread.title}`,
            icon: "clock" as const,
            label: "Snooze",
            menu: {
              actions: snoozePresetActions,
              onPressAction: handleMenuAction,
              title: "Snooze until",
            },
            onPress: () => undefined,
          }
        : swipeActions.secondary === "mark-done"
          ? {
              accessibilityLabel: `Mark as Done ${thread.title}`,
              icon: "checkmark" as const,
              label: "Done",
              onPress: handleMarkDone,
            }
          : null,
    [handleMenuAction, handleMarkDone, snoozePresetActions, swipeActions.secondary, thread.title],
  );
  const swipeAccessibilityHint = !canOperateThread
    ? "Opens the thread"
    : secondaryAction === null
      ? `Opens the thread. Swipe left for the ${primaryAction.label.toLowerCase()} action.`
      : `Opens the thread. Swipe left for ${primaryAction.label.toLowerCase()} and ${secondaryAction.label.toLowerCase()} actions.`;

  const titleTextInset = iconProject ? projectIconSize + 8 : 0;
  const cardContent = (
    <>
      <View className="flex-row items-start gap-2">
        {iconProject ? (
          <View className="justify-center" style={{ height: titleLineHeight }}>
            <ProjectFavicon
              environmentId={thread.environmentId}
              faviconPath={iconProject.faviconPath}
              projectIcon={iconProject.projectIcon}
              size={projectIconSize}
              projectTitle={iconProject.title}
              workspaceRoot={iconProject.workspaceRoot}
            />
          </View>
        ) : null}
        <Text
          className={cn(
            "flex-1 text-base",
            !recede && "font-supaterm-medium",
            selected
              ? selectedThreadRowColors.foregroundClassName
              : rowAppearance.foregroundClassName,
          )}
          numberOfLines={2}
        >
          {thread.title}
        </Text>
        <View className="flex-row items-center gap-1.5" style={{ minHeight: titleLineHeight }}>
          {hasUnsentDraft ? <UnsentDraftIcon /> : null}
          {props.hasQueuedMessages ? <QueuedMessageIcon selected={selected} /> : null}
          {pinnedRow ? (
            <SymbolView
              name="pin"
              size={11}
              tintColorClassName={rowAppearance.mutedIconTintClassName}
              type="monochrome"
            />
          ) : null}
          {showsWoke ? (
            <Pressable
              className="-m-2.5 flex-row items-center gap-1 p-2.5"
              accessibilityRole="button"
              accessibilityLabel="Dismiss Woke notification"
              onPress={handleAcknowledgeWoke}
              onLongPress={() => undefined}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <SymbolView
                name="bell.badge"
                size={13}
                tintColorClassName={
                  selected ? selectedThreadRowColors.iconTintClassName : "accent-warning-foreground"
                }
                type="monochrome"
                weight="semibold"
              />
              <Text
                className={cn(
                  "text-xs font-supaterm-bold",
                  selected
                    ? selectedThreadRowColors.foregroundClassName
                    : "text-warning-foreground",
                )}
              >
                Woke
              </Text>
            </Pressable>
          ) : statusLabel ? (
            <View className="flex-row items-center gap-1">
              <SymbolView
                name={statusLabel.icon}
                size={13}
                tintColorClassName={
                  selected
                    ? selectedThreadRowColors.iconTintClassName
                    : statusLabel.iconTintClassName
                }
                type="monochrome"
                weight="semibold"
              />
              <ThreadListWorkingStatus
                className={cn(
                  "text-xs font-supaterm-bold",
                  selected ? selectedThreadRowColors.foregroundClassName : statusLabel.className,
                )}
                label={statusLabel.label}
                startedAt={durationStartedAt}
              />
            </View>
          ) : (
            <Text
              className={cn(
                "text-xs tabular-nums",
                selected
                  ? selectedThreadRowColors.foregroundClassName
                  : rowAppearance.tertiaryForegroundClassName,
              )}
            >
              {timeLabel}
            </Text>
          )}
        </View>
      </View>
      {props.searchMatch ? (
        <View className="mt-1" style={{ paddingLeft: titleTextInset }}>
          <ThreadSearchMatchExcerpt
            sidebar={sidebarPane}
            match={props.searchMatch}
            query={props.searchQuery ?? ""}
            selected={selected}
          />
        </View>
      ) : null}
      <View className="mt-1 flex-row items-center gap-2" style={{ paddingLeft: titleTextInset }}>
        {(status === "failed" || status === "limited") && thread.runtime?.lastError ? (
          <Text
            className={cn(
              "flex-1 text-xs",
              selected
                ? selectedThreadRowColors.mutedForegroundClassName
                : status === "limited"
                  ? "text-warning-foreground"
                  : "text-danger-foreground",
            )}
            numberOfLines={1}
          >
            {thread.runtime.lastError}
          </Text>
        ) : props.environmentLabel ? (
          <View className="min-w-0 flex-1 flex-row items-center gap-1">
            {props.environmentMachine ? (
              <EnvironmentMachineSymbol
                kind={props.environmentMachine}
                size={machineIconSize}
                tintColorClassName={
                  selected
                    ? selectedThreadRowColors.mutedIconTintClassName
                    : rowAppearance.tertiaryIconTintClassName
                }
              />
            ) : null}
            <Text
              className={cn(
                "shrink text-xs",
                selected
                  ? selectedThreadRowColors.mutedForegroundClassName
                  : rowAppearance.tertiaryForegroundClassName,
              )}
              numberOfLines={1}
            >
              {props.environmentLabel}
            </Text>
          </View>
        ) : (
          <View className="flex-1" />
        )}
        {pr ? (
          <Pressable
            // Padding cancelled by negative margin grows the touch target into
            // the row padding without moving the badge.
            className="-m-2.5 flex-row items-center gap-1 p-2.5"
            accessibilityRole="button"
            accessibilityLabel={prBadgeLabel ?? undefined}
            onPress={handleOpenPullRequests}
            // Without a long-press handler a hold that opens the row's iOS
            // context menu would also open the pull request on release.
            onLongPress={() => undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <SymbolView
              name={
                pr.kind === "stack"
                  ? PullRequestGlyph.stack
                  : pr.state === null
                    ? PullRequestGlyph.pullRequest
                    : pullRequestStatus({ state: pr.state, isDraft: pr.isDraft }).icon
              }
              size={12}
              tintColorClassName={
                pr.state === null || pr.isDraft
                  ? rowAppearance.mutedIconTintClassName
                  : pr.state === "open"
                    ? "accent-adaptive-emerald-600-400"
                    : pr.state === "closed"
                      ? "accent-adaptive-rose-600-400"
                      : "accent-adaptive-violet-600-400"
              }
            />
            <Text
              accessibilityLabel={pr.accessibilityLabel}
              className={cn("text-xs", pr.textClassName)}
              style={{ fontFamily: MONO_FONT }}
            >
              {pr.label}
            </Text>
          </Pressable>
        ) : null}
        {providerInstance ? (
          <View className="flex-row items-center">
            {withOccurrenceKeys(providerDrivers.slice(0, -1), (driver) => driver).map(
              ({ item: driver, key }) => (
                <View key={key} className="-mr-1 opacity-30">
                  <ProviderIcon provider={driver} size={12} />
                </View>
              ),
            )}
            <ProviderInstanceIcon
              iconUrl={providerIconUrl}
              provider={providerInstance.driverKind}
              size={14}
              displayName={providerInstance.displayName}
              accentColor={providerInstance.accentColor}
              showBadge={providerInstance.showBadge}
              surfaceColor={rowAppearance.providerIconSurfaceColor}
            />
          </View>
        ) : null}
      </View>
    </>
  );

  const fadedCardContent = recede ? (
    <View style={{ opacity: 0.55 }}>{cardContent}</View>
  ) : (
    cardContent
  );

  const rowContent = (close: () => void) =>
    variant === "card" ? (
      <RowPressable
        key={threadKey}
        interactionClassName={rowAppearance.interactionClassName}
        interactionOpacity={rowAppearance.interactionOpacity}
        className={rowAppearance.className}
        accessibilityHint={swipeAccessibilityHint}
        accessibilityLabel={rowAccessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityActions={rowAccessibilityActions}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "openPullRequests") handleOpenPullRequests();
          if (event.nativeEvent.actionName === "dismissWoke") handleAcknowledgeWoke();
        }}
        onPress={() => {
          close();
          selectThread();
        }}
        style={rowAppearance.cardStyle}
      >
        {sidebarPane ? (
          <View className={cn(!environmentConnected && "opacity-50")}>{fadedCardContent}</View>
        ) : (
          <View>
            <View
              className={cn(
                THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME,
                !environmentConnected && "opacity-50",
              )}
            >
              {fadedCardContent}
            </View>
            {THREAD_LIST_V2_ROW_DIVIDERS && props.showTrailingDivider !== false ? (
              <View className="ml-5 h-px bg-border-subtle" />
            ) : null}
          </View>
        )}
      </RowPressable>
    ) : (
      <RowPressable
        key={threadKey}
        interactionClassName={rowAppearance.interactionClassName}
        interactionOpacity={rowAppearance.interactionOpacity}
        accessibilityHint={swipeAccessibilityHint}
        accessibilityLabel={rowAccessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        className={rowAppearance.className}
        onPress={() => {
          close();
          selectThread();
        }}
        style={rowAppearance.style}
      >
        {/* Done history recedes: dimmed favicon + muted title. */}
        <View
          className={cn(
            "min-h-[44px] flex-row items-center gap-2.5 py-2",
            sidebarPane ? "px-3" : "px-5",
            !environmentConnected && "opacity-50",
          )}
        >
          {iconProject ? (
            <View className="opacity-40">
              <ProjectFavicon
                environmentId={thread.environmentId}
                faviconPath={iconProject.faviconPath}
                projectIcon={iconProject.projectIcon}
                size={projectIconSize}
                projectTitle={iconProject.title}
                workspaceRoot={iconProject.workspaceRoot}
              />
            </View>
          ) : null}
          <View className="min-w-0 flex-1">
            <Text
              className={cn(
                "text-base",
                selected
                  ? selectedThreadRowColors.foregroundClassName
                  : rowAppearance.mutedForegroundClassName,
              )}
              numberOfLines={1}
            >
              {thread.title}
            </Text>
            {props.searchMatch ? (
              <ThreadSearchMatchExcerpt
                sidebar={sidebarPane}
                match={props.searchMatch}
                query={props.searchQuery ?? ""}
                selected={selected}
              />
            ) : null}
          </View>
          {hasUnsentDraft ? <UnsentDraftIcon /> : null}
          {props.hasQueuedMessages ? <QueuedMessageIcon selected={selected} /> : null}
          <Text
            className={cn(
              "text-sm tabular-nums",
              selected
                ? selectedThreadRowColors.mutedForegroundClassName
                : rowAppearance.tertiaryForegroundClassName,
            )}
            style={{ fontFamily: MONO_FONT }}
          >
            {!environmentConnected
              ? statusLabel?.label
              : snoozedRow && props.snoozeWakeLabelText !== undefined
                ? props.snoozeWakeLabelText
                : timeLabel}
          </Text>
        </View>
      </RowPressable>
    );

  if (!canOperateThread)
    return <View style={rowAppearance.swipeContainerStyle}>{rowContent(() => {})}</View>;

  return (
    <View collapsable={false}>
      {customSnoozeOpen && (
        <CustomSnoozeSheet onClose={() => setCustomSnoozeOpen(false)} onSnooze={handleSnooze} />
      )}
      <ThreadSwipeable
        dormant={dormant}
        threadKey={threadKey}
        backgroundColor={rowAppearance.swipeBackgroundColor}
        compactActions={variant === "slim"}
        containerStyle={rowAppearance.swipeContainerStyle}
        enableTrackpadSwipe
        // Full swipe commits the advertised lifecycle action (Mark as done /
        // Reopen / Wake), never the secondary action.
        fullSwipeAction="primary"
        fullSwipeWidth={props.fullSwipeWidth ?? windowWidth - 32}
        onDelete={handleDelete}
        onSwipeableClose={props.onSwipeableClose}
        onSwipeableWillOpen={props.onSwipeableWillOpen}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        resetKey={`${threadKey}:${variant}:${snoozedRow}:${thread.doneAt}:${thread.reopenedAt}:${thread.snoozedUntil}:${thread.pinnedAt}`}
        simultaneousWith={props.simultaneousSwipeGesture}
        threadTitle={thread.title}
      >
        {(close) => (
          <Menu
            actions={[
              ...(thread.branch
                ? [
                    {
                      id: "new-thread-on-branch",
                      title: getThreadListV2NewBranchMenuTitle(thread.branch),
                      image: "square.and.pencil",
                    },
                  ]
                : []),
              { id: "copy-thread-id", title: "Copy thread ID", image: "doc.on.doc" },
              ...(snoozedRow
                ? snoozedMenuActions
                : !props.markDoneSupported
                  ? legacyMenuActions
                  : canReopen
                    ? slimMenuActions
                    : swipeActions.secondary === "snooze"
                      ? snoozableCardMenuActions
                      : cardMenuActions),
            ]}
            onPressAction={handleMenuAction}
            shouldOpenOnLongPress
          >
            {rowContent(close)}
          </Menu>
        )}
      </ThreadSwipeable>
    </View>
  );
});
