import type { ContextMenuItem, KeybindingCommand } from "@supaterm/contracts";
import {
  ArchiveIcon,
  CircleCheckIcon,
  ClockIcon,
  FolderIcon,
  GitBranchIcon,
  HashIcon,
  FolderPlusIcon,
  UserIcon,
  TextSearchIcon,
  MessageSquareIcon,
  type IconComponent,
  MailUnreadIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  RefreshCwIcon,
  TimerIcon,
  TrashIcon,
} from "@supaterm/icons";

import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import type { ThreadActionMenuId } from "./threadActionMenu.logic";

interface ThreadPaletteCommand {
  readonly icon: IconComponent;
  readonly searchTerms: ReadonlyArray<string>;
  /** Replaces a menu label that only reads right inside the thread's own menu. */
  readonly title?: string;
  readonly shortcutCommand?: KeybindingCommand;
}

type SnoozePresetAction = Extract<ThreadActionMenuId, `snooze:${string}`>;

const isSnoozePresetAction = (id: ThreadActionMenuId): id is SnoozePresetAction =>
  id.startsWith("snooze:");

// Keyed by every thread menu action so a new one cannot skip the palette by
// accident. null leaves an action out: the palette already offers it in its own
// form, it has no meaning for the thread being viewed, or it only groups
// choices that are listed on their own.
const THREAD_PALETTE_COMMANDS: Record<
  Exclude<ThreadActionMenuId, SnoozePresetAction>,
  ThreadPaletteCommand | null
> = {
  find: { icon: TextSearchIcon, searchTerms: ["find", "search", "thread"] },
  "turn-into-project": { icon: FolderPlusIcon, searchTerms: ["create", "project", "scratch"] },
  "share-guest": { icon: UserIcon, searchTerms: ["share", "guest"] },
  "copy-thread": { icon: MessageSquareIcon, searchTerms: ["copy", "thread", "link"] },
  "open-beside": null,
  "filter-by-project": null,
  "project-settings": null,
  "auto-mark-done": null,
  copy: null,
  "new-thread-on-branch": {
    icon: MessageSquarePlusIcon,
    searchTerms: ["new thread", "branch", "worktree", "same"],
  },
  pin: { icon: PinIcon, searchTerms: ["pin", "thread"], shortcutCommand: "thread.pin" },
  unpin: { icon: PinOffIcon, searchTerms: ["unpin", "thread"], shortcutCommand: "thread.pin" },
  "mark-done": {
    icon: CircleCheckIcon,
    searchTerms: ["done", "complete", "finish", "resolve", "thread"],
    shortcutCommand: "thread.mark-done",
  },
  reopen: {
    icon: CircleCheckIcon,
    searchTerms: ["reopen", "not done", "undo", "thread"],
    shortcutCommand: "thread.mark-done",
  },
  "auto-mark-done:enabled": {
    title: "Turn on automatic completion",
    icon: TimerIcon,
    searchTerms: ["automatic completion", "auto mark done", "enable"],
  },
  "auto-mark-done:disabled": {
    title: "Turn off automatic completion",
    icon: TimerIcon,
    searchTerms: ["automatic completion", "auto mark done", "disable", "long running"],
  },
  snooze: {
    title: "Snooze thread",
    icon: ClockIcon,
    searchTerms: ["snooze", "later", "remind", "defer"],
  },
  unsnooze: { icon: ClockIcon, searchTerms: ["wake", "unsnooze", "snooze"] },
  rename: { icon: PencilIcon, searchTerms: ["rename", "title", "name", "thread"] },
  "regenerate-title": {
    icon: RefreshCwIcon,
    searchTerms: ["regenerate", "title", "rename", "name", "thread"],
  },
  "mark-unread": {
    title: "Mark thread unread",
    icon: MailUnreadIcon,
    searchTerms: ["unread", "mark", "thread"],
  },
  "copy-path": {
    title: "Copy workspace path",
    icon: FolderIcon,
    searchTerms: ["copy", "path", "folder", "directory", "worktree", "cwd"],
  },
  "copy-branch": {
    title: "Copy branch name",
    icon: GitBranchIcon,
    searchTerms: ["copy", "branch", "git"],
  },
  "copy-thread-id": {
    title: "Copy thread ID",
    icon: HashIcon,
    searchTerms: ["copy", "thread id", "reference"],
  },
  archive: { icon: ArchiveIcon, searchTerms: ["archive", "hide", "thread"] },
  delete: {
    title: "Delete thread",
    icon: TrashIcon,
    searchTerms: ["delete", "remove", "trash", "thread"],
  },
};

export function buildThreadPaletteItems(
  items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>,
  run: (action: ThreadActionMenuId) => Promise<void>,
): Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> {
  return items.flatMap((item): Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> => {
    // A checked choice is the current setting; only the way to change it is a command.
    if (item.checked) return [];
    const command = isSnoozePresetAction(item.id) ? null : THREAD_PALETTE_COMMANDS[item.id];
    if (command === null) return item.children ? buildThreadPaletteItems(item.children, run) : [];
    const Icon = command.icon;
    const title = command.title ?? item.label;
    const shared = {
      value: `action:thread:${item.id}`,
      title,
      searchTerms: [title, ...command.searchTerms],
      icon: <Icon className={ITEM_ICON_CLASS} />,
      ...(item.disabled ? { disabled: true } : {}),
      ...(command.shortcutCommand ? { shortcutCommand: command.shortcutCommand } : {}),
    };
    if (!item.children) return [{ ...shared, kind: "action", run: () => run(item.id) }];
    return [
      {
        ...shared,
        kind: "submenu",
        addonIcon: <Icon className={ADDON_ICON_CLASS} />,
        groups: [
          {
            value: item.id,
            label: title,
            items: item.children.map((child) => ({
              kind: "action",
              value: `action:thread:${child.id}`,
              title: child.label,
              searchTerms: [child.label],
              icon: <Icon className={ITEM_ICON_CLASS} />,
              ...(child.disabled ? { disabled: true } : {}),
              run: () => run(child.id),
            })),
          },
        ],
      },
    ];
  });
}
