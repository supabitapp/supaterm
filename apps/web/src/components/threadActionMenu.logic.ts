import type { ContextMenuItem } from "@supaterm/contracts";
import type { SnoozePreset } from "@supaterm/client-runtime/state/thread-snooze";

export type ThreadActionMenuId =
  | "open-beside"
  | "new-thread-on-branch"
  | "filter-by-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "mark-done"
  | "reopen"
  | "auto-mark-done"
  | "auto-mark-done:enabled"
  | "auto-mark-done:disabled"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread-id"
  | "archive"
  | "delete";

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(options: {
  readonly hasPath: boolean;
  readonly hasBranch: boolean;
  readonly hasProject: boolean;
}): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath ? [{ id: "copy-path" as const, label: "Path", icon: "folder" }] : []),
        ...(options.hasBranch
          ? [{ id: "copy-branch" as const, label: "Branch", icon: "git-branch" }]
          : []),
      ],
    },
    ...(options.hasProject
      ? [{ id: "project-settings" as const, label: "Project settings", icon: "settings" }]
      : []),
    {
      id: "discard",
      label: "Discard draft",
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly branch: string | null;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isDone: boolean;
  readonly autoMarkDoneEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects a thread with an attached provider, so disable it here rather than let the action fail. */
  readonly isRunning: boolean;
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** The thread can open in a new chat pane beside the focused one. */
  readonly canOpenBeside?: boolean;
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "open-beside",
    "new-thread-on-branch",
    "project-settings",
    "mark-unread",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread-id",
  ].includes(action);
}

/**
 * Single source for the per-thread action menu: the sidebar row's right-click
 * menu and the chat header menu share labels and ordering.
 * Each surface supplies state for the actions it supports.
 */
export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.canOpenBeside
      ? [{ id: "open-beside" as const, label: "Open to the side", icon: "columns-2" }]
      : []),
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: `New thread on ${state.branch}`,
            icon: "message-square-plus",
          },
        ]
      : []),
    state.isPinned
      ? { id: "unpin" as const, label: "Unpin thread", icon: "pin-off" }
      : { id: "pin" as const, label: "Pin thread", icon: "pin" },
    state.isDone
      ? { id: "reopen" as const, label: "Reopen thread", icon: "circle-check" }
      : { id: "mark-done" as const, label: "Mark thread as Done", icon: "circle-check" },
    state.isSnoozed
      ? { id: "unsnooze" as const, label: "Wake thread", icon: "clock" }
      : {
          id: "snooze" as const,
          label: "Snooze",
          icon: "clock",
          disabled: !state.canSnoozeNow,
          children: [
            ...state.snoozePresets.map((preset) => ({
              id: `snooze:${preset.id}` as const,
              label: `${preset.label} (${preset.whenLabel})`,
            })),
            { id: "snooze:custom" as const, label: "Custom…", separatorBefore: true },
          ],
        },
    { id: "rename", label: "Rename thread", icon: "pencil", separatorBefore: true },
    {
      id: "regenerate-title",
      label: state.isRegeneratingTitle ? "Regenerating…" : "Regenerate title",
      icon: "refresh-cw",
      disabled: state.isRegeneratingTitle,
    },
    { id: "mark-unread", label: "Mark unread", icon: "mail-open" },
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? "Show all projects"
              : `Filter by ${state.projectFilter.label}`,
            icon: "folder-tree",
          },
        ]
      : []),
    // A submenu with the current option checked, not a one-shot action:
    // this is a setting, and it sits with the other per-thread settings
    // rather than the lifecycle verbs above. Disabled keeps long-running
    // threads out of the done shelf no matter how quiet they get.
    {
      id: "auto-mark-done",
      label: "Automatic completion",
      icon: "timer",
      children: [
        { id: "auto-mark-done:enabled", label: "Enabled", checked: state.autoMarkDoneEnabled },
        { id: "auto-mark-done:disabled", label: "Disabled", checked: !state.autoMarkDoneEnabled },
      ],
    },
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      separatorBefore: true,
      children: [
        { id: "copy-path", label: "Path", icon: "folder" },
        ...(state.branch
          ? [{ id: "copy-branch" as const, label: "Branch", icon: "git-branch" }]
          : []),
        { id: "copy-thread-id", label: "Thread ID", icon: "hash" },
      ],
    },
    { id: "project-settings", label: "Project settings", icon: "settings" },
    // Archive removes the thread from the sidebar while keeping its
    // conversation under Settings > Archived threads — distinct from Mark as done
    // (stays visible in the Done shelf) and Delete (clears history for
    // good), so it sits beside Delete without borrowing its destructive
    // styling.
    {
      id: "archive",
      label: "Archive thread",
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id)
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}
