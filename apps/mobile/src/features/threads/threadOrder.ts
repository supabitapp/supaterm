import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { planPinnedReorder } from "@supaterm/client-runtime/state/thread-sort";
import { effectiveSnoozed } from "@supaterm/client-runtime/state/thread-snooze";
import type { EnvironmentId } from "@supaterm/contracts";

export type ThreadMoveDestination =
  | "up"
  | "down"
  | {
      readonly targetId: string | null;
      readonly section?: "pinned" | "active" | "done";
      readonly placement: "before" | "after";
    };

export function threadOrderAfterMove(
  orderedIds: readonly string[],
  movedId: string,
  destination: ThreadMoveDestination,
): string[] | null {
  if (typeof destination === "object" && destination.section === "done") return null;
  const from = orderedIds.indexOf(movedId);
  if (from < 0 && (typeof destination === "string" || destination.section === undefined))
    return null;
  const result = orderedIds.filter((id) => id !== movedId);
  let to: number;
  if (typeof destination === "string") {
    to = from + (destination === "up" ? -1 : 1);
    if (to < 0 || to >= orderedIds.length) return null;
  } else {
    if (destination.targetId === null) {
      if (destination.section === undefined) return null;
      to = destination.placement === "before" ? 0 : result.length;
    } else {
      const target = result.indexOf(destination.targetId);
      if (target < 0) return null;
      to = target + (destination.placement === "after" ? 1 : 0);
    }
  }
  if (to === from) return null;
  result.splice(to, 0, movedId);
  return result;
}

export type OrderRow = Pick<
  EnvironmentThreadShell,
  | "id"
  | "environmentId"
  | "pinOrderKey"
  | "activeOrderKey"
  | "createdAt"
  | "reopenedAt"
  | "pinnedAt"
>;

export interface PendingThreadOrder {
  readonly section: "pinned" | "active";
  readonly orderedIds: readonly string[];
  readonly before: ReadonlyMap<string, { readonly key: string | null; readonly anchor: string }>;
  readonly assignments: ReadonlyMap<string, string>;
  readonly confirmed: ReadonlySet<string>;
  readonly commandsComplete: boolean;
}

function rowId(row: OrderRow): string {
  return `${row.environmentId}:${row.id}`;
}

function rowOrder(row: OrderRow, section: PendingThreadOrder["section"]) {
  return {
    key: (section === "pinned" ? row.pinOrderKey : row.activeOrderKey) ?? null,
    anchor: section === "pinned" ? (row.pinnedAt ?? "") : (row.reopenedAt ?? row.createdAt),
  };
}

export function createThreadMovePlanner(input: {
  readonly ordered: readonly OrderRow[];
  readonly allThreads?: readonly OrderRow[];
  readonly section: PendingThreadOrder["section"];
  readonly reorderableEnvironmentIds: ReadonlySet<EnvironmentId>;
}) {
  const orderedIds = input.ordered.map(rowId);
  const keysById = new Map(
    (input.allThreads ?? input.ordered).map((row) => [
      rowId(row),
      rowOrder(row, input.section).key,
    ]),
  );
  const writableIds = new Set(
    (input.allThreads ?? input.ordered)
      .filter((row) => input.reorderableEnvironmentIds.has(row.environmentId))
      .map(rowId),
  );
  return (movedId: string, direction: ThreadMoveDestination) => {
    if (!writableIds.has(movedId)) return null;
    const nextIds = threadOrderAfterMove(orderedIds, movedId, direction);
    if (nextIds === null) return null;
    const assignments = planPinnedReorder({ orderedIds: nextIds, keysById, movedId });
    return assignments === null ||
      assignments.length === 0 ||
      assignments.some((assignment) => !writableIds.has(assignment.id))
      ? null
      : assignments;
  };
}

export function createPendingThreadOrder(input: {
  readonly section: PendingThreadOrder["section"];
  readonly ordered: readonly OrderRow[];
  readonly movedId: string;
  readonly direction: ThreadMoveDestination;
  readonly assignments: readonly { readonly id: string; readonly orderKey: string }[];
}): PendingThreadOrder {
  const orderedIds = threadOrderAfterMove(input.ordered.map(rowId), input.movedId, input.direction);
  if (orderedIds === null) throw new Error("Cannot begin an invalid thread move");
  return {
    section: input.section,
    orderedIds,
    before: new Map(input.ordered.map((row) => [rowId(row), rowOrder(row, input.section)])),
    assignments: new Map(input.assignments.map(({ id, orderKey }) => [id, orderKey])),
    confirmed: new Set(),
    commandsComplete: false,
  };
}

/** Receipts and shell updates arrive independently. Only our own key writes
 * may pass through the hold; membership and other arrangement changes win. */
export function reconcilePendingThreadOrder(
  pending: PendingThreadOrder,
  ordered: readonly OrderRow[],
): PendingThreadOrder | null {
  if (ordered.length !== pending.before.size) return null;
  const confirmed = new Set(pending.confirmed);
  for (const row of ordered) {
    const id = rowId(row);
    const before = pending.before.get(id);
    const current = rowOrder(row, pending.section);
    if (before === undefined || current.anchor !== before.anchor) return null;
    const assigned = pending.assignments.get(id);
    if (assigned !== undefined && current.key === assigned) confirmed.add(id);
    else if (current.key !== before.key || confirmed.has(id)) return null;
  }
  if (pending.commandsComplete && confirmed.size === pending.assignments.size) return null;
  return confirmed.size === pending.confirmed.size ? pending : { ...pending, confirmed };
}

export function applyPendingThreadOrder<T extends OrderRow>(
  rows: readonly T[],
  section: PendingThreadOrder["section"],
  pending: PendingThreadOrder | null | undefined,
): T[] {
  if (pending == null || pending.section !== section) return [...rows];
  const rank = new Map(pending.orderedIds.map((id, index) => [id, index]));
  return [...rows].sort(
    (left, right) => (rank.get(rowId(left)) ?? Infinity) - (rank.get(rowId(right)) ?? Infinity),
  );
}

/** Match desktop re-entry: a pin wakes the thread on the server; Active clears
 * each underlying parked state. */
export function threadDropLifecycle(
  thread: EnvironmentThreadShell,
  section: "pinned" | "active",
  now: string,
) {
  if (section === "pinned") return { pin: true, unpin: false, reopen: false, unsnooze: false };
  return {
    pin: false,
    unpin: thread.pinnedAt != null,
    reopen: thread.doneOverride === "done",
    unsnooze: effectiveSnoozed(thread, { now }),
  };
}

export type ThreadDragSection = "pinned" | "active" | "snoozed" | "done";

/** The inbox is time-ordered, so entering Active only unpins, reopens, or
 * wakes the thread, which needs the environment's config. */
export function canMoveThreadToActive(source: ThreadDragSection, loaded: boolean) {
  return loaded && source !== "active";
}

export function threadDragAction(source: ThreadDragSection, destination: ThreadDragSection) {
  if (destination === "snoozed") return null;
  if (destination === "done") return source === "done" ? null : "Mark as Done";
  if (source === destination) return "Reorder";
  if (destination === "pinned") return "Pin";
  if (source === "pinned") return "Unpin";
  if (source === "done") return "Reopen";
  return "Unsnooze";
}
