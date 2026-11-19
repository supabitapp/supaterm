const currentActions = new Map<string, symbol>();
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

export function begin(kind: string, threadKey: string) {
  const key = JSON.stringify([kind, threadKey]);
  const token = Symbol();
  currentActions.set(key, token);
  notify();
  const isCurrent = () => currentActions.get(key) === token;
  return {
    isCurrent,
    finish: () => {
      if (isCurrent()) {
        currentActions.delete(key);
        notify();
      }
    },
  };
}

export function invalidate(kind: string, threadKey: string) {
  currentActions.delete(JSON.stringify([kind, threadKey]));
  notify();
}

export type ThreadUndoStep =
  | { readonly action: "reopen"; readonly restoreReopenedAt?: string | null }
  | { readonly action: "unsnooze" }
  | { readonly action: "pin"; readonly orderKey?: string }
  | { readonly action: "reorderActive"; readonly orderKey: string }
  | { readonly action: "snooze"; readonly snoozedUntil: string };

export type ThreadUndoPlan = readonly [ThreadUndoStep, ...ThreadUndoStep[]];

export function planThreadUndo(
  action: "mark-done" | "snooze" | "unpin",
  thread?: {
    readonly pinnedAt?: string | null;
    readonly pinOrderKey?: string | null;
    readonly activeOrderKey?: string | null;
    readonly reopenedAt?: string | null;
    readonly snoozedUntil?: string | null;
    readonly doneOverride?: string | null;
  } | null,
) {
  if (action === "snooze") return [{ action: "unsnooze" }] satisfies ThreadUndoPlan;
  const pin: ThreadUndoStep = {
    action: "pin",
    ...(thread?.pinOrderKey != null ? { orderKey: thread.pinOrderKey } : {}),
  };
  const snooze =
    thread?.snoozedUntil != null
      ? [{ action: "snooze" as const, snoozedUntil: thread.snoozedUntil }]
      : [];
  if (action === "unpin") return [pin, ...snooze] satisfies ThreadUndoPlan;
  if (thread?.doneOverride === "done" && thread.snoozedUntil != null) {
    return [{ action: "snooze", snoozedUntil: thread.snoozedUntil }] satisfies ThreadUndoPlan;
  }
  const placement: ThreadUndoStep[] =
    thread?.pinnedAt != null
      ? [pin]
      : thread?.activeOrderKey != null
        ? [{ action: "reorderActive", orderKey: thread.activeOrderKey }]
        : [];
  const reopen: ThreadUndoStep =
    thread == null
      ? { action: "reopen" }
      : { action: "reopen", restoreReopenedAt: thread.reopenedAt ?? null };
  return [reopen, ...placement, ...snooze] satisfies ThreadUndoPlan;
}

/** Resolves to undefined when every step was an expired snooze, leaving nothing to restore. */
export async function executeThreadUndo<Result>(
  plan: ThreadUndoPlan,
  execute: (step: ThreadUndoStep) => Promise<Result>,
  succeeded: (result: Result) => boolean,
) {
  let result: Result | undefined;
  for (const step of plan) {
    if (result !== undefined && !succeeded(result)) return result;
    // @effect-diagnostics-next-line globalDate:off
    if (step.action === "snooze" && Date.parse(step.snoozedUntil) <= Date.now()) continue;
    result = await execute(step);
  }
  return result;
}
