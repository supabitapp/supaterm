import type { ClientSettings } from "@supaterm/contracts";

// Ids are stored in client settings, so never rename one.
export const THREAD_DETAILS_ITEMS = [
  { id: "environment", label: "Environment and worktree", defaultVisible: true },
  { id: "openIn", label: "Open in editor", defaultVisible: true },
  { id: "scripts", label: "Project scripts", defaultVisible: true },
  { id: "branch", label: "Branch and pull request", defaultVisible: true },
  { id: "gitActions", label: "Git actions", defaultVisible: true },
  { id: "changes", label: "Changes", defaultVisible: true },
  { id: "servers", label: "Servers", defaultVisible: true },
  { id: "automations", label: "Automations", defaultVisible: true },
  { id: "lineage", label: "Lineage", defaultVisible: true },
  { id: "usage", label: "Context and cost", defaultVisible: true },
  { id: "limits", label: "Provider limits", defaultVisible: false },
] as const;

export type ThreadDetailsItemId = (typeof THREAD_DETAILS_ITEMS)[number]["id"];
export type ThreadDetailsVisibility = Readonly<Record<ThreadDetailsItemId, boolean>>;

type ThreadDetailsItem = (typeof THREAD_DETAILS_ITEMS)[number];
type ThreadDetailsItemSettings = Pick<ClientSettings, "threadDetailsItems">;

export function resolveThreadDetailsVisibility(
  settings: ThreadDetailsItemSettings,
): ThreadDetailsVisibility {
  return Object.fromEntries(
    THREAD_DETAILS_ITEMS.map((item) => [
      item.id,
      settings.threadDetailsItems[item.id] ?? item.defaultVisible,
    ]),
  ) as Record<ThreadDetailsItemId, boolean>;
}

/** Stores only choices that differ from the default, so a later default change reaches everyone else. */
export function setThreadDetailsItem(
  settings: ThreadDetailsItemSettings,
  item: ThreadDetailsItem,
  visible: boolean,
): ClientSettings["threadDetailsItems"] {
  const { [item.id]: _previous, ...rest } = settings.threadDetailsItems;
  return visible === item.defaultVisible ? rest : { ...rest, [item.id]: visible };
}

export function isDefaultThreadDetailsVisibility(visibility: ThreadDetailsVisibility) {
  return THREAD_DETAILS_ITEMS.every((item) => visibility[item.id] === item.defaultVisible);
}

export const RESET_THREAD_DETAILS_ITEMS = {
  threadDetailsItems: {},
} satisfies Partial<ClientSettings>;
