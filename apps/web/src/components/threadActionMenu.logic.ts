import type { ContextMenuItem } from "@supaterm/contracts";
import type { SnoozePreset } from "@supaterm/client-runtime/state/thread-snooze";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

export type ThreadActionMenuId =
  | "find"
  | "open-beside"
  | "new-thread-on-branch"
  | "filter-by-project"
  | "turn-into-project"
  | "project-settings"
  | "pin-project"
  | "unpin-project"
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
  | "copy-thread"
  | "copy-thread-id"
  | "archive"
  | "delete";

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(
  options: {
    readonly hasPath: boolean;
    readonly hasBranch: boolean;
    readonly hasProject: boolean;
  },
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: resolve(msg("Copy", { $context: "submenu of things to copy" })),
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath
          ? [
              {
                id: "copy-path" as const,
                label: resolve(msg("Path", { $context: "copy the file path" })),
                icon: "folder",
              },
            ]
          : []),
        ...(options.hasBranch
          ? [
              {
                id: "copy-branch" as const,
                label: resolve(msg("Branch", { $context: "copy the git branch name" })),
                icon: "git-branch",
              },
            ]
          : []),
      ],
    },
    ...(options.hasProject
      ? [
          {
            id: "project-settings" as const,
            label: resolve(msg("Project settings")),
            icon: "settings",
          },
        ]
      : []),
    {
      id: "discard",
      label: resolve(msg("Discard draft")),
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly canFind?: boolean;
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
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  /** The server marks unread against the latest run's completion, so in-flight runs cannot be. */
  readonly hasCompletedRun: boolean;
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** The thread can open in a new chat pane beside the focused one. */
  readonly canOpenBeside?: boolean;
  /** A No project thread with its own folder. */
  readonly canTurnIntoProject?: boolean;
  /** Whether the thread's project is pinned; absent where this surface cannot pin it. */
  readonly projectPinned?: boolean | null;
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "find",
    "open-beside",
    "new-thread-on-branch",
    "project-settings",
    "mark-unread",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread",
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
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.canFind
      ? [{ id: "find" as const, label: resolve(msg("Find in thread")), icon: "text-search" }]
      : []),
    ...(state.canOpenBeside
      ? [{ id: "open-beside" as const, label: resolve(msg("Open to the side")), icon: "columns-2" }]
      : []),
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: resolve(msg("New thread on {branch}", { branch: state.branch })),
            icon: "message-square-plus",
          },
        ]
      : []),
    state.isPinned
      ? { id: "unpin" as const, label: resolve(msg("Unpin thread")), icon: "pin-off" }
      : { id: "pin" as const, label: resolve(msg("Pin thread")), icon: "pin" },
    state.isDone
      ? { id: "reopen" as const, label: resolve(msg("Reopen thread")), icon: "circle-check" }
      : {
          id: "mark-done" as const,
          label: resolve(msg("Mark thread as Done")),
          icon: "circle-check",
        },
    state.isSnoozed
      ? { id: "unsnooze" as const, label: resolve(msg("Wake thread")), icon: "clock" }
      : {
          id: "snooze" as const,
          label: resolve(msg("Snooze", { $context: "verb, snooze the thread" })),
          icon: "clock",
          disabled: !state.canSnoozeNow,
          children: [
            ...state.snoozePresets.map((preset) => ({
              id: `snooze:${preset.id}` as const,
              label: preset.label,
              detail: preset.whenLabel,
            })),
            {
              id: "snooze:custom" as const,
              label: resolve(msg("Custom…")),
              separatorBefore: state.snoozePresets.length > 0,
            },
          ],
        },
    { id: "rename", label: resolve(msg("Rename thread")), icon: "pencil", separatorBefore: true },
    {
      id: "regenerate-title",
      label: state.isRegeneratingTitle
        ? resolve(msg("Regenerating…"))
        : resolve(msg("Regenerate title")),
      icon: "refresh-cw",
      disabled: state.isRegeneratingTitle,
    },
    ...(state.hasCompletedRun && !state.isRunning
      ? [{ id: "mark-unread" as const, label: resolve(msg("Mark unread")), icon: "mail-open" }]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? resolve(msg("Show all projects"))
              : resolve(msg("Filter by {project}", { project: state.projectFilter.label })),
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.canTurnIntoProject
      ? [
          {
            id: "turn-into-project" as const,
            label: resolve(msg("Turn into project")),
            icon: "folder-plus",
            disabled: state.isRunning,
          },
        ]
      : []),
    // A submenu with the current option checked, not a one-shot action:
    // this is a setting, and it sits with the other per-thread settings
    // rather than the lifecycle verbs above. Never keeps long-running
    // threads out of the done shelf no matter how quiet they get.
    {
      id: "auto-mark-done",
      label: resolve(msg("Automatic completion")),
      icon: "timer",
      children: [
        {
          id: "auto-mark-done:enabled",
          label: resolve(msg("Follow settings")),
          checked: state.autoMarkDoneEnabled,
        },
        {
          id: "auto-mark-done:disabled",
          label: resolve(msg("Never", { $context: "auto-mark-done never" })),
          checked: !state.autoMarkDoneEnabled,
        },
      ],
    },
    {
      id: "copy",
      label: resolve(msg("Copy", { $context: "submenu of things to copy" })),
      icon: "copy",
      separatorBefore: true,
      children: [
        {
          id: "copy-path",
          label: resolve(msg("Path", { $context: "copy the file path" })),
          icon: "folder",
        },
        ...(state.branch
          ? [
              {
                id: "copy-branch" as const,
                label: resolve(msg("Branch", { $context: "copy the git branch name" })),
                icon: "git-branch",
              },
            ]
          : []),
        {
          id: "copy-thread",
          label: resolve(msg("Thread", { $context: "copy the thread contents" })),
          icon: "message-square",
        },
        { id: "copy-thread-id", label: resolve(msg("Thread ID")), icon: "hash" },
      ],
    },
    { id: "project-settings", label: resolve(msg("Project settings")), icon: "settings" },
    ...(state.projectPinned == null
      ? []
      : [
          state.projectPinned
            ? {
                id: "unpin-project" as const,
                label: resolve(msg("Unpin project")),
                icon: "pin-off",
              }
            : { id: "pin-project" as const, label: resolve(msg("Pin project")), icon: "pin" },
        ]),
    // Archive keeps the conversation under Settings > Archived threads, unlike Delete, so it
    // sits beside Delete without borrowing its destructive styling.
    {
      id: "archive",
      label: resolve(msg("Archive thread")),
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: resolve(msg("Delete", { $context: "verb, delete the thread" })),
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
