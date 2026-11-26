import * as Dialog from "../../components/ui/Dialog";
import type { ThreadRowProviderInstance } from "./thread-provider-instance";
import {
  THREAD_LIST_V2_MONO_FONT as MONO_FONT,
  THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME,
  THREAD_LIST_V2_ROW_DIVIDER_CLASS_NAME,
  THREAD_LIST_V2_ROW_DIVIDERS,
  THREAD_LIST_V2_SCREEN_INSET_CLASS_NAME,
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
import {
  resolveThreadRowShownStatus,
  resolveThreadRowStatus,
  type ThreadRowStatus,
} from "@supaterm/client-runtime/state/thread-row-status";
import { canSnooze, resolveSnoozePresets } from "@supaterm/client-runtime/state/thread-snooze";
import { withOccurrenceKeys } from "@supaterm/shared/occurrenceKeys";
import type { SnoozePresetSetting } from "@supaterm/contracts/settings";
import { threadChipCopyTarget } from "@supaterm/client-runtime/thread-reference";
import type { MenuAction } from "@react-native-menu/menu";
import { memo, useCallback, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import type { ThreadListProvider } from "../../state/thread-list-environments";
import { environmentPresentations } from "../../state/presentation";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import {
  ProviderIcon,
  ProviderInstanceIcon,
  providerInstanceNameLabel,
} from "../../components/ProviderIcon";
import { useNowAfter } from "../../lib/clock";
import { cn } from "../../lib/cn";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { copyThreadReference } from "../../lib/copyThreadReference";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useEnvironmentScope } from "../../state/session";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  pendingDraftBranchNeedsRefs,
  resolvePendingDraftBranch,
} from "../../state/pending-new-tasks-model";
import { useBranches } from "../../state/queries";
import { useNewTaskProjectDefaults } from "./use-new-task-project-defaults";
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
import { canTurnThreadIntoProject, turnThreadIntoProject } from "./turnThreadIntoProject";
import { threadCanArchive } from "../home/threadArchive";
import {
  THREAD_LIST_V2_DONE_PAGE_COUNT,
  resolveThreadListV2SnoozeGateExpiryMs,
  resolveThreadListV2SnoozeMenuSelection,
  threadHasUnseenCompletion,
  resolveThreadListV2ProviderDrivers,
  resolveThreadListV2SwipeActions,
  layoutThreadListV2RowMenuActions,
  threadListV2RowAccessibilityLabel,
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
import { msg, T, useGT, useMessages } from "gt-react-native";

/**
 * Thread List v2 renders one flat native list: rich edge-to-edge rows for
 * active work and a receded done tail, all with native swipe and
 * long-press actions. State reads through colored status labels and text
 * hierarchy rather than card fills.
 */

interface StatusLabel {
  readonly icon: AppSymbolName;
  readonly className: string;
  readonly iconTintClassName: string;
}
const STATUS_LABEL_BY_STATUS: Partial<Record<ThreadRowStatus, StatusLabel>> = {
  approval: {
    icon: "exclamationmark.shield",
    className: "text-warning-foreground",
    iconTintClassName: "accent-warning-foreground",
  },
  input: {
    icon: "questionmark.bubble",
    className: "text-adaptive-indigo-600-300",
    iconTintClassName: "accent-adaptive-indigo-600-300",
  },
  working: {
    icon: "circle.dashed",
    className: "text-adaptive-sky-600-400",
    iconTintClassName: "accent-adaptive-sky-600-400",
  },
  waiting: {
    icon: "circle.dashed.inset.filled",
    className: "text-foreground-muted",
    iconTintClassName: "accent-foreground-muted",
  },
  failed: {
    icon: "exclamationmark.circle",
    className: "text-danger-foreground",
    iconTintClassName: "accent-danger-foreground",
  },
  limited: {
    icon: "exclamationmark.circle",
    className: "text-warning-foreground",
    iconTintClassName: "accent-warning-foreground",
  },
};
const READY_STATUS_LABEL: StatusLabel = {
  icon: "checkmark.circle",
  className: "text-adaptive-emerald-700-300",
  iconTintClassName: "accent-adaptive-emerald-700-300",
};

const MARK_DONE_MENU_ACTION: MenuAction = {
  id: "mark-done",
  title: msg("Mark as Done"),
  image: "checkmark",
};

const CARD_MENU_ACTIONS: MenuAction[] = [
  MARK_DONE_MENU_ACTION,
  {
    id: "delete",
    title: msg("Delete", { $context: "verb, thread action" }),
    image: "trash",
    attributes: { destructive: true },
  },
];

const SLIM_MENU_ACTIONS: MenuAction[] = [
  {
    id: "reopen",
    title: msg("Reopen", { $context: "verb, thread action" }),
    image: "arrow.uturn.backward",
  },
  {
    id: "delete",
    title: msg("Delete", { $context: "verb, thread action" }),
    image: "trash",
    attributes: { destructive: true },
  },
];

const SNOOZED_MENU_ACTIONS: MenuAction[] = [
  { id: "unsnooze", title: msg("Wake thread"), image: "clock" },
  {
    id: "delete",
    title: msg("Delete", { $context: "verb, thread action" }),
    image: "trash",
    attributes: { destructive: true },
  },
];

// Archive is available before the environment config loads.
const LEGACY_MENU_ACTIONS: MenuAction[] = [
  {
    id: "archive",
    title: msg("Archive", { $context: "verb, thread action" }),
    image: "archivebox",
  },
  {
    id: "delete",
    title: msg("Delete", { $context: "verb, thread action" }),
    image: "trash",
    attributes: { destructive: true },
  },
];

const SIDEBAR_V2_ROW_RADIUS = 12;

function ThreadListV2Section(props: {
  readonly label: string;
  readonly count?: number;
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
  const textColorClassName = sidebarPane
    ? "text-drawer-foreground-muted"
    : "text-foreground-tertiary";
  const className = cn(
    "flex-row items-center gap-2.5",
    !props.disclosure && "mb-1.5 mt-4",
    props.pane === "sidebar" ? "px-3" : THREAD_LIST_V2_SCREEN_INSET_CLASS_NAME,
  );
  const content = (
    <>
      {props.icon}
      <View className="shrink flex-row items-center gap-1">
        <Text className={cn("shrink text-xs", textColorClassName)} numberOfLines={1}>
          {props.label}
        </Text>
        {props.count === undefined ? null : (
          <Text className={cn("shrink-0 text-xs tabular-nums", textColorClassName)}>
            ({props.count.toLocaleString()})
          </Text>
        )}
      </View>
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

const ThreadListV2SectionDivider = memo(function ThreadListV2SectionDivider(props: {
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

const SHELF_COPY = {
  active: {
    label: msg("Active", { $context: "thread list section" }),
    count: msg("{count, plural, one {{count} active thread} other {{count} active threads}}"),
    collapse: msg("Collapses the active threads."),
    expand: msg("Expands the active threads."),
  },
  pinned: {
    label: msg("Pinned", { $context: "thread list section" }),
    count: msg("{count, plural, one {{count} pinned thread} other {{count} pinned threads}}"),
    collapse: msg("Collapses the pinned threads."),
    expand: msg("Expands the pinned threads."),
  },
  working: {
    label: msg("Working", { $context: "thread list section" }),
    count: msg("{count, plural, one {{count} working thread} other {{count} working threads}}"),
    collapse: msg("Collapses the working threads."),
    expand: msg("Expands the working threads."),
  },
  snoozed: {
    label: msg("Snoozed", { $context: "thread list section" }),
    count: msg("{count, plural, one {{count} snoozed thread} other {{count} snoozed threads}}"),
    collapse: msg("Collapses the snoozed threads."),
    expand: msg("Expands the snoozed threads."),
  },
  done: {
    label: msg("Done", { $context: "thread list section" }),
    count: msg("{count, plural, one {{count} done thread} other {{count} done threads}}"),
    collapse: msg("Collapses the done threads."),
    expand: msg("Expands the done threads."),
  },
} as const;

function ThreadListV2ShelfHeader(
  props: ThreadListV2ShelfHeaderProps & { readonly kind: keyof typeof SHELF_COPY },
) {
  const m = useMessages();
  const copy = SHELF_COPY[props.kind];
  const label = m(copy.label);
  return (
    <ThreadListV2Section
      label={label}
      count={props.expanded ? undefined : props.count}
      pane={props.pane}
      disclosure={{
        expanded: props.expanded,
        disabled: props.disabled,
        onToggle: props.onToggle,
        accessibilityLabel: m(copy.count, { count: props.count }),
        accessibilityHint: m(props.expanded ? copy.collapse : copy.expand),
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
  const gt = useGT();
  const { groupKey, onToggle, project } = props;
  return (
    <ThreadListV2Section
      label={props.label}
      count={props.expanded ? undefined : props.count}
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
        accessibilityLabel: gt(
          "{label}, {count, plural, one {{count} thread} other {{count} threads}}",
          { label: props.label, count: props.count },
        ),
        accessibilityHint: props.expanded
          ? gt("Collapses the {label} threads.", { label: props.label })
          : gt("Expands the {label} threads.", { label: props.label }),
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
  const gt = useGT();
  const label =
    props.state === "loading"
      ? gt("Loading", { $context: "older threads are loading" })
      : props.state === "failed"
        ? gt("Could not load older threads. Retry")
        : gt("Show more ({count} Done hidden)", { count: props.hiddenCount.toLocaleString() });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        props.state === undefined
          ? gt("Show {count} more Done threads", {
              count: Math.min(props.hiddenCount, THREAD_LIST_V2_DONE_PAGE_COUNT),
            })
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
  {
    id: "delete",
    title: msg("Delete", { $context: "verb, thread action" }),
    image: "trash",
    attributes: { destructive: true },
  },
];

const DRAFT_TASK_MENU_ACTIONS: MenuAction[] = [
  {
    id: "delete",
    title: msg("Discard", { $context: "verb, discards the draft" }),
    image: "trash",
    attributes: { destructive: true },
  },
];

/**
 * Unsent work reads like the thread card it will become. "Sends on reconnect" stays uncolored
 * because nothing is asked of the user; "Draft" uses the web sidebar's amber pen for work waiting
 * on the user.
 */
export const ThreadListV2PendingRow = memo(function ThreadListV2PendingRow(props: {
  readonly pendingTask: PendingNewTask;
  readonly selected?: boolean;
  readonly project: EnvironmentProject | null;
  readonly environmentLabel: string | null;
  readonly environmentMachine?: EnvironmentMachineKind;
  readonly pane?: "screen" | "sidebar";
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
  const gt = useGT();
  const m = useMessages();
  const { pendingTask, onSelectPendingTask, onDeletePendingTask } = props;
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const titleTypography = useScaledTextRole("body");
  const metadataTypography = useScaledTextRole("label");
  const projectIconSize = titleTypography.fontSize * 1.25 * fontScale;
  const machineIconSize = metadataTypography.fontSize * fontScale;
  // Android's nonlinear system text scaling can differ from the fontScale estimate.
  const [androidTitleLineHeight, setTitleLineHeight] = useState(
    titleTypography.lineHeight * fontScale,
  );
  const titleLineHeight =
    Platform.OS === "android" ? androidTitleLineHeight : titleTypography.lineHeight * fontScale;
  const theme = useUniwindTheme();
  const dormant = useSwipeRowDormant(props.activationKey);
  const sidebarPane = props.pane === "sidebar";
  const selected = props.selected ?? false;
  const rowAppearance = getThreadListV2RowAppearance(theme, sidebarPane, selected);
  const isDraft = pendingTask.kind === "draft";
  const projectCwd = props.project?.workspaceRoot || null;
  // Drafts only; the reads are shared per-project atoms, and queued rows skip them.
  const projectDefaults = useNewTaskProjectDefaults(isDraft ? props.project : null);
  const draftDefaults = {
    canChooseWorkspace: !projectDefaults.isScratch,
    defaultMode: projectDefaults.defaultWorkspaceMode,
    defaultModeSettled: projectDefaults.defaultWorkspaceModeSettled,
  };
  const draftBranchRefs = useBranches({
    environmentId: pendingTask.environmentId,
    cwd:
      isDraft && pendingDraftBranchNeedsRefs(pendingTask.draft, draftDefaults) ? projectCwd : null,
  });
  const branch = isDraft
    ? resolvePendingDraftBranch({
        draft: pendingTask.draft,
        defaults: draftDefaults,
        isGitRepo: draftBranchRefs.data?.isRepo ?? true,
        branches: draftBranchRefs.data?.refs ?? [],
        projectCwd,
      })
    : pendingTask.branch;
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

  const titleTextInset = props.project ? projectIconSize + 8 : 0;
  const rowContent = (
    <>
      <View className="flex-row items-start gap-2">
        {props.project ? (
          <View className="justify-center" style={{ height: titleLineHeight }}>
            <ProjectFavicon
              environmentId={pendingTask.environmentId}
              faviconPath={props.project.faviconPath}
              projectIcon={props.project.projectIcon}
              size={projectIconSize}
              projectTitle={props.project.title}
              workspaceRoot={props.project.workspaceRoot}
            />
          </View>
        ) : null}
        <Text
          className={cn(
            "flex-1 text-base font-supaterm-medium",
            selected
              ? selectedThreadRowColors.foregroundClassName
              : rowAppearance.foregroundClassName,
          )}
          numberOfLines={2}
          onTextLayout={
            Platform.OS === "android"
              ? ({ nativeEvent }) => {
                  const firstLine = nativeEvent.lines[0];
                  if (firstLine && Math.abs(firstLine.height - titleLineHeight) > 0.5) {
                    setTitleLineHeight(firstLine.height);
                  }
                }
              : undefined
          }
        >
          {pendingTask.title}
        </Text>
        {isDraft ? (
          <View className="flex-row items-center gap-1" style={{ minHeight: titleLineHeight }}>
            <SymbolView
              name="square.and.pencil"
              size={13}
              tintColorClassName={
                selected
                  ? selectedThreadRowColors.iconTintClassName
                  : "accent-adaptive-amber-700-300"
              }
              type="monochrome"
              weight="semibold"
            />
            <Text
              className={cn(
                "text-xs font-supaterm-bold",
                selected
                  ? selectedThreadRowColors.foregroundClassName
                  : "text-adaptive-amber-700-300",
              )}
            >
              <T>Draft</T>
            </Text>
          </View>
        ) : null}
      </View>
      {!isDraft ? (
        <View className="mt-1" style={{ paddingLeft: titleTextInset }}>
          <Text
            className={cn(
              "text-xs",
              selected
                ? selectedThreadRowColors.foregroundClassName
                : rowAppearance.tertiaryForegroundClassName,
            )}
          >
            <T>Sends on reconnect</T>
          </Text>
        </View>
      ) : null}
      {branch || props.environmentLabel ? (
        <View className="mt-1 flex-row items-center gap-1" style={{ paddingLeft: titleTextInset }}>
          {props.environmentLabel && props.environmentMachine ? (
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
                : rowAppearance.mutedForegroundClassName,
            )}
            numberOfLines={1}
          >
            {branch ? (
              <Text
                className={cn(
                  "text-xs",
                  selected
                    ? selectedThreadRowColors.mutedForegroundClassName
                    : rowAppearance.mutedForegroundClassName,
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
                  "text-xs",
                  selected
                    ? selectedThreadRowColors.mutedForegroundClassName
                    : rowAppearance.tertiaryForegroundClassName,
                )}
              >
                {props.environmentLabel}
              </Text>
            ) : null}
          </Text>
        </View>
      ) : null}
    </>
  );

  const renderRow = (close: () => void) => (
    <Menu
      actions={(isDraft ? DRAFT_TASK_MENU_ACTIONS : PENDING_TASK_MENU_ACTIONS).map((action) => ({
        ...action,
        title: m(action.title),
      }))}
      onPressAction={(event) => {
        close();
        handleMenuAction(event);
      }}
      shouldOpenOnLongPress
    >
      <RowPressable
        accessibilityHint={
          isDraft
            ? gt("Opens the draft in the new task composer. Swipe left to discard.")
            : gt(
                "Sends when the environment reconnects. Opens the task for editing. Swipe left to delete.",
              )
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
            <View className={THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME}>{rowContent}</View>
            {THREAD_LIST_V2_ROW_DIVIDERS && props.showTrailingDivider !== false ? (
              <View className={THREAD_LIST_V2_ROW_DIVIDER_CLASS_NAME} />
            ) : null}
          </View>
        )}
      </RowPressable>
    </Menu>
  );
  const pendingDivider = props.showPendingDivider ? (
    <ThreadListV2SectionDivider
      label={
        isDraft
          ? gt("Drafts", { $context: "section of unsent drafts" })
          : gt("Unsent", { $context: "section of tasks not yet sent" })
      }
      pane={props.pane}
    />
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
        listAnimatesLayout
        onDelete={handleDelete}
        onSwipeableClose={props.onSwipeableClose}
        onSwipeableWillOpen={props.onSwipeableWillOpen}
        primaryAction={{
          accessibilityLabel: isDraft
            ? gt("Discard {title}", { title: pendingTask.title })
            : gt("Delete {title}", { title: pendingTask.title }),
          icon: "trash",
          label: isDraft
            ? gt("Discard", { $context: "verb, discards the draft" })
            : gt("Delete", { $context: "verb, thread action" }),
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
  readonly snoozePresets: ReadonlyArray<SnoozePresetSetting> | undefined;
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
  const gt = useGT();
  const m = useMessages();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const titleTypography = useScaledTextRole("body");
  const metadataTypography = useScaledTextRole("label");
  const projectIconSize = titleTypography.fontSize * 1.25 * fontScale;
  const machineIconSize = metadataTypography.fontSize * fontScale;
  // Android's nonlinear system text scaling can differ from the fontScale estimate.
  const [androidTitleLineHeight, setTitleLineHeight] = useState(
    titleTypography.lineHeight * fontScale,
  );
  const titleLineHeight =
    Platform.OS === "android" ? androidTitleLineHeight : titleTypography.lineHeight * fontScale;
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
  const providerNameLabel = providerInstance
    ? providerInstanceNameLabel({
        provider: providerInstance.driverKind,
        iconUrl: providerIconUrl,
        displayName: providerInstance.displayName,
        showBadge: providerInstance.showBadge,
      })
    : null;
  const pr = useThreadPr(thread);
  const prBadgeLabel = pr ? resolveThreadPrBadgeAction(pr, m).accessibilityLabel : null;
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
  const isRegeneratingTitle = thread.titleRegeneration != null;

  const rawStatus = resolveThreadRowStatus(thread);
  const status = resolveThreadRowShownStatus(thread);
  const isUnread = status === "ready" && threadHasUnseenCompletion(thread);
  const showsWoke = environmentConnected && status === "ready" && props.wokeAt !== null;
  const rowStatusLabel = resolveThreadListV2RowStatusLabel(
    {
      environmentConnected,
      status,
      isUnread,
      goalActive: thread.goal?.status === "active",
      mutedClassName: selected
        ? selectedThreadRowColors.mutedForegroundClassName
        : rowAppearance.mutedForegroundClassName,
    },
    m,
  );
  const durationStartedAt =
    environmentConnected && (status === "working" || status === "waiting")
      ? resolveThreadListDurationStartedAt(thread)
      : null;
  const statusAppearance = environmentConnected
    ? (STATUS_LABEL_BY_STATUS[status] ?? (isUnread ? READY_STATUS_LABEL : undefined))
    : undefined;
  const statusLabel =
    rowStatusLabel === undefined || statusAppearance === undefined
      ? undefined
      : {
          ...rowStatusLabel,
          icon: statusAppearance.icon,
          iconTintClassName:
            status === "waiting"
              ? rowAppearance.mutedIconTintClassName
              : statusAppearance.iconTintClassName,
        };
  const recede = environmentConnected && shouldRecedeThreadRow({ status, selected });
  // The timestamp is precomputed on the list item (same stamps the done
  // tail sorts by) so a minute tick only re-renders rows that draw it.
  // List items keep marked text so they stay the same objects across a language switch.
  const timeLabel = props.timeLabel && m(props.timeLabel);
  const snoozeWakeLabelText =
    props.snoozeWakeLabelText === undefined ? undefined : m(props.snoozeWakeLabelText);
  const rowAccessibilityLabel = threadListV2RowAccessibilityLabel(
    {
      title: thread.title,
      variant,
      woke: showsWoke,
      statusLabel: statusLabel?.label,
      // A row whose environment is not connected shows that state where its time would be.
      timeLabel: environmentConnected ? timeLabel : (rowStatusLabel?.label ?? timeLabel),
      snoozeWakeLabel: environmentConnected && snoozedRow ? snoozeWakeLabelText : undefined,
      providerNameLabel,
      hasUnsentDraft,
      hasQueuedMessages: props.hasQueuedMessages === true,
      regeneratingTitle: isRegeneratingTitle,
    },
    m,
  );

  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const markThreadUnread = useAtomCommand(threadEnvironment.markUnread, { reportFailure: false });
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
      ...(showsWoke ? [{ name: "dismissWoke", label: gt("Dismiss Woke notification") }] : []),
    ],
    [gt, prBadgeLabel, showsWoke],
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
        ? resolveSnoozePresets(
            snoozePresetClock.now,
            props.snoozePresets ? { presets: props.snoozePresets } : {},
          )
        : ([] as const),
    [props.snoozePresets, snoozePresetClock.now, swipeActions.secondary],
  );
  const snoozePresetActions = useMemo<MenuAction[]>(
    () => [
      ...snoozePresets.map((preset) => ({
        id: `snooze:${preset.id}`,
        title: preset.label,
        subtitle: preset.whenLabel,
      })),
      { id: "snooze:custom", title: gt("Custom…", { $context: "custom snooze time" }) },
    ],
    [gt, snoozePresets],
  );
  const reorderMenuItems = useMemo<MenuAction[]>(
    () =>
      props.arrangeSupported === true
        ? [{ id: "arrange", title: gt("Arrange threads…"), image: "line.3.horizontal" }]
        : [],
    [gt, props.arrangeSupported],
  );
  const pinMenuItems = useMemo<MenuAction[]>(
    () =>
      props.pinningSupported
        ? [
            thread.pinnedAt != null
              ? {
                  id: "unpin",
                  title: gt("Unpin", { $context: "verb, thread action" }),
                  image: "pin.slash",
                }
              : { id: "pin", title: gt("Pin", { $context: "verb, thread action" }), image: "pin" },
          ]
        : [],
    [gt, props.pinningSupported, thread.pinnedAt],
  );
  const autoMarkDoneMenuItems = useMemo<MenuAction[]>(
    () =>
      props.autoMarkDoneOptOutSupported
        ? [
            {
              id: "auto-mark-done",
              title: gt("Automatic completion"),
              image: "timer",
              subactions: [
                {
                  id: "auto-mark-done:enabled",
                  title: gt("Follow settings"),
                  state: thread.autoMarkDoneDisabledAt == null ? "on" : "off",
                },
                {
                  id: "auto-mark-done:disabled",
                  title: gt("Never", { $context: "never auto-mark-done this thread" }),
                  state: thread.autoMarkDoneDisabledAt == null ? "off" : "on",
                },
              ],
            } satisfies MenuAction,
          ]
        : [],
    [gt, props.autoMarkDoneOptOutSupported, thread.autoMarkDoneDisabledAt],
  );
  const canTurnIntoProject = canTurnThreadIntoProject(thread);
  const titleMenuItems = useMemo<MenuAction[]>(
    () => [
      {
        id: "rename",
        title: gt("Rename", { $context: "verb, thread action" }),
        image: "square.and.pencil",
      },
      ...buildThreadTitleRegenerationMenuItems({
        supported: props.titleRegenerationSupported,
        isRegenerating: isRegeneratingTitle,
      }),
      ...(thread.latestRun?.completedAt != null && threadCanArchive(thread.runtime)
        ? [{ id: "mark-unread", title: gt("Mark unread"), image: "envelope.badge" }]
        : []),
      ...(canTurnIntoProject
        ? [
            {
              id: "turn-into-project",
              title: gt("Turn into project"),
              image: "folder.badge.plus",
              attributes: { disabled: !threadCanArchive(thread.runtime) },
            } satisfies MenuAction,
          ]
        : []),
    ],
    [
      canTurnIntoProject,
      props.titleRegenerationSupported,
      thread.latestRun,
      thread.runtime,
      isRegeneratingTitle,
      gt,
    ],
  );
  const menuActions = useMemo<MenuAction[]>(() => {
    const nested = Platform.OS === "ios";
    const localized = (action: MenuAction): MenuAction => ({ ...action, title: m(action.title) });
    const direct: MenuAction[] = [
      ...(thread.branch
        ? [
            {
              id: "new-thread-on-branch",
              title: getThreadListV2NewBranchMenuTitle(thread.branch, m),
              image: "square.and.pencil",
            },
          ]
        : []),
      { id: "copy-thread", title: gt("Copy thread"), image: "text.bubble" },
      { id: "copy-thread-id", title: gt("Copy thread ID"), image: "doc.on.doc" },
    ];
    if (snoozedRow) {
      return layoutThreadListV2RowMenuActions(
        {
          nested,
          direct: [
            ...direct,
            localized(SNOOZED_MENU_ACTIONS[0]!),
            ...(props.markDoneSupported ? [localized(MARK_DONE_MENU_ACTION)] : []),
          ],
          reorder: [],
          pin: [],
          secondary: [
            ...titleMenuItems,
            ...autoMarkDoneMenuItems,
            localized(LEGACY_MENU_ACTIONS[0]!),
            localized(SNOOZED_MENU_ACTIONS[1]!),
          ],
        },
        m,
      );
    }
    if (!props.markDoneSupported) {
      return layoutThreadListV2RowMenuActions(
        {
          nested,
          direct: [...direct, localized(LEGACY_MENU_ACTIONS[0]!)],
          reorder: reorderMenuItems,
          pin: pinMenuItems,
          secondary: [...titleMenuItems, localized(LEGACY_MENU_ACTIONS[1]!)],
        },
        m,
      );
    }
    if (canReopen) {
      return layoutThreadListV2RowMenuActions(
        {
          nested,
          direct: [...direct, localized(SLIM_MENU_ACTIONS[0]!)],
          reorder: reorderMenuItems,
          pin: pinMenuItems,
          secondary: [
            ...titleMenuItems,
            ...autoMarkDoneMenuItems,
            localized(LEGACY_MENU_ACTIONS[0]!),
            localized(SLIM_MENU_ACTIONS[1]!),
          ],
        },
        m,
      );
    }
    return layoutThreadListV2RowMenuActions(
      {
        nested,
        direct: [
          ...direct,
          localized(CARD_MENU_ACTIONS[0]!),
          ...(swipeActions.secondary === "snooze"
            ? [
                {
                  id: "snooze",
                  title: gt("Snooze", { $context: "verb, thread action" }),
                  image: "clock",
                  subactions: snoozePresetActions,
                },
              ]
            : []),
        ],
        reorder: reorderMenuItems,
        pin: pinMenuItems,
        secondary: [
          ...titleMenuItems,
          ...autoMarkDoneMenuItems,
          localized(LEGACY_MENU_ACTIONS[0]!),
          localized(CARD_MENU_ACTIONS[1]!),
        ],
      },
      m,
    );
  }, [
    autoMarkDoneMenuItems,
    canReopen,
    pinMenuItems,
    props.markDoneSupported,
    reorderMenuItems,
    snoozePresetActions,
    snoozedRow,
    swipeActions.secondary,
    thread.branch,
    titleMenuItems,
    gt,
    m,
  ]);
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
      if (nativeEvent.event === "turn-into-project") void turnThreadIntoProject(thread);
      if (nativeEvent.event === "mark-unread") {
        void markThreadUnread({
          environmentId: thread.environmentId,
          input: { threadId: thread.id },
        });
      }
      if (nativeEvent.event === "copy-thread") {
        const target = threadChipCopyTarget(
          { environmentId: thread.environmentId, threadId: thread.id },
          thread.title,
        );
        void copyThreadReference(target).then((didCopy) => {
          if (!didCopy) Dialog.alert(target.failureTitle, gt("Try copying this thread again."));
        });
      }
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
        presets: props.snoozePresets,
      });
      if (snoozeSelection._tag === "selected") {
        handleSnooze(snoozeSelection.preset.snoozedUntil);
      } else if (snoozeSelection._tag === "expired") {
        Dialog.alert(
          gt("Could not snooze thread"),
          gt("That snooze time has passed. Choose another time."),
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
      markThreadUnread,
      setCustomSnoozeOpen,
      snoozePresets,
      props.snoozePresets,
      gt,
    ],
  );
  const primaryAction = useMemo(() => {
    // Until the environment config loads, archive is the swipe action. (Slim
    // rows cannot occur here — unsupported environments never classify as
    // done.)
    if (swipeActions.primary === "archive") {
      return {
        accessibilityLabel: gt("Archive {title}", { title: thread.title }),
        icon: "archivebox" as const,
        label: gt("Archive", { $context: "verb, thread action" }),
        swipeHint: gt("Opens the thread. Swipe left for the archive action."),
        secondarySwipeHint: gt("Opens the thread. Swipe left for archive and snooze actions."),
        onPress: handleArchive,
      };
    }
    if (swipeActions.primary === "unsnooze") {
      return {
        accessibilityLabel: gt("Wake {title} now", { title: thread.title }),
        icon: "clock" as const,
        label: gt("Wake", { $context: "verb, thread action" }),
        swipeHint: gt("Opens the thread. Swipe left for the wake action."),
        secondarySwipeHint: gt("Opens the thread. Swipe left for wake and done actions."),
        onPress: handleUnsnooze,
      };
    }
    return swipeActions.primary === "reopen"
      ? {
          accessibilityLabel: gt("Reopen {title}", { title: thread.title }),
          icon: "arrow.uturn.backward" as const,
          label: gt("Reopen", { $context: "verb, thread action" }),
          swipeHint: gt("Opens the thread. Swipe left for the reopen action."),
          secondarySwipeHint: gt("Opens the thread. Swipe left for reopen and snooze actions."),
          onPress: handleReopen,
        }
      : {
          accessibilityLabel: gt("Mark as Done {title}", { title: thread.title }),
          icon: "checkmark" as const,
          label: gt("Done", { $context: "verb, marks the thread as Done" }),
          swipeHint: gt("Opens the thread. Swipe left for the done action."),
          secondarySwipeHint: gt("Opens the thread. Swipe left for done and snooze actions."),
          onPress: handleMarkDone,
        };
  }, [
    gt,
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
            accessibilityLabel: gt("Choose when to snooze {title}", { title: thread.title }),
            icon: "clock" as const,
            label: gt("Snooze", { $context: "verb, thread action" }),
            menu: {
              actions: snoozePresetActions,
              onPressAction: handleMenuAction,
              title: gt("Snooze until"),
            },
            onPress: () => undefined,
          }
        : swipeActions.secondary === "mark-done"
          ? {
              accessibilityLabel: gt("Mark as Done {title}", { title: thread.title }),
              icon: "checkmark" as const,
              label: gt("Done", { $context: "verb, marks the thread as Done" }),
              onPress: handleMarkDone,
            }
          : null,
    [
      handleMenuAction,
      handleMarkDone,
      snoozePresetActions,
      swipeActions.secondary,
      thread.title,
      gt,
    ],
  );
  const swipeAccessibilityHint = !canOperateThread
    ? gt("Opens the thread")
    : secondaryAction === null
      ? primaryAction.swipeHint
      : primaryAction.secondarySwipeHint;

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
            isRegeneratingTitle && "opacity-55",
          )}
          numberOfLines={2}
          onTextLayout={
            Platform.OS === "android"
              ? ({ nativeEvent }) => {
                  const firstLine = nativeEvent.lines[0];
                  if (firstLine && Math.abs(firstLine.height - titleLineHeight) > 0.5) {
                    setTitleLineHeight(firstLine.height);
                  }
                }
              : undefined
          }
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
              accessibilityLabel={gt("Dismiss Woke notification")}
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
                {gt("Woke", { $context: "thread came back from snooze" })}
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
                environmentId={thread.environmentId}
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
              {environmentConnected ? timeLabel : rowStatusLabel?.label}
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
        {(rawStatus === "failed" || rawStatus === "limited") && thread.runtime?.lastError ? (
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
                    : pullRequestStatus({ state: pr.state, isDraft: pr.isDraft }, m).icon
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
          <View className="flex-row items-center gap-1">
            {withOccurrenceKeys(providerDrivers.slice(0, -1), (driver) => driver).map(
              ({ item: driver, key }) => (
                <View key={key} className="opacity-30">
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
            {providerNameLabel ? (
              <Text
                className={cn(
                  "ml-1.5 text-xs",
                  selected
                    ? selectedThreadRowColors.mutedForegroundClassName
                    : rowAppearance.tertiaryForegroundClassName,
                )}
                ellipsizeMode="middle"
                numberOfLines={1}
                style={{ maxWidth: 140 }}
              >
                {providerNameLabel}
              </Text>
            ) : null}
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
              <View className={THREAD_LIST_V2_ROW_DIVIDER_CLASS_NAME} />
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
            THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME,
            "min-h-[44px] flex-row items-center gap-2 py-2",
            sidebarPane && "px-3",
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
                isRegeneratingTitle && "opacity-55",
              )}
              numberOfLines={1}
            >
              {thread.title}
            </Text>
            {providerNameLabel ? (
              <Text
                className={cn(
                  "text-xs",
                  selected
                    ? selectedThreadRowColors.mutedForegroundClassName
                    : rowAppearance.tertiaryForegroundClassName,
                )}
                ellipsizeMode="middle"
                numberOfLines={1}
              >
                {providerNameLabel}
              </Text>
            ) : null}
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
              ? rowStatusLabel?.label
              : snoozedRow && snoozeWakeLabelText !== undefined
                ? snoozeWakeLabelText
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
        listAnimatesLayout
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
            accessibilityLabel={rowAccessibilityLabel}
            actions={menuActions}
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
