// @effect-diagnostics globalTimers:off globalDate:off - The tracker runs in atom subscriptions, outside an Effect runtime.
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { parseThreadKey, threadKey } from "./entities.ts";
import { type AtomCommand, runAtomCommand } from "./runtime.ts";
import { claimThreadOpen } from "./threadSearch.ts";
import type { VisitThreadInput } from "../operations/commands.ts";

export const VISIT_DISPATCH_THROTTLE_MS = 10_000;

const IDLE_TRACKER: Atom.Atom<void> = Atom.make(undefined).pipe(
  Atom.withLabel("thread-visit-tracker:idle"),
);

interface VisitedShell {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly updatedAt: string;
  readonly lastVisitedAt?: string | null | undefined;
  readonly latestRun: { readonly completedAt: string | null } | null;
  readonly wokeAt?: string | null | undefined;
}

export interface ThreadVisitTrackerOptions {
  readonly threadShellAtom: (ref: ScopedThreadRef) => Atom.Atom<VisitedShell | null>;
  readonly visit: AtomCommand<
    { readonly environmentId: EnvironmentId; readonly input: VisitThreadInput },
    unknown,
    unknown
  >;
  readonly markLocalVisit?: (ref: ScopedThreadRef, visitedAt: string) => void;
}

export function createThreadVisitTracker(options: ThreadVisitTrackerOptions) {
  const family = Atom.family((key: string) => {
    const ref = parseThreadKey(key);
    return Atom.make((get) => {
      const registry = get.registry;
      let openPending = claimThreadOpen(ref.environmentId, ref.threadId, Date.now());
      let lastDispatchedUpdatedAt: string | null = null;
      let lastDispatchAt = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clearTimer = () => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
      };
      get.addFinalizer(clearTimer);

      const dispatch = (shell: VisitedShell, visitedAt: string, opened: boolean) => {
        clearTimer();
        lastDispatchedUpdatedAt = visitedAt;
        lastDispatchAt = Date.now();
        void runAtomCommand(
          registry,
          options.visit,
          {
            environmentId: shell.environmentId,
            input: {
              threadId: shell.id,
              visitedAt,
              ...(opened ? { opened: true } : {}),
            },
          },
          { reportFailure: false },
        );
      };

      const onShell = (shell: VisitedShell | null) => {
        clearTimer();
        if (shell === null) return;

        const shellUpdatedAtMs = Date.parse(shell.updatedAt);
        if (Number.isNaN(shellUpdatedAtMs)) return;
        const wokeAtMs = shell.wokeAt ? Date.parse(shell.wokeAt) : NaN;
        const wakeIsLatest = wokeAtMs > shellUpdatedAtMs;
        const visitedAt = wakeIsLatest && shell.wokeAt ? shell.wokeAt : shell.updatedAt;
        const updatedAtMs = wakeIsLatest ? wokeAtMs : shellUpdatedAtMs;
        if (shell.lastVisitedAt === undefined) {
          options.markLocalVisit?.(ref, visitedAt);
          return;
        }
        if (openPending) {
          openPending = false;
          dispatch(shell, visitedAt, true);
          return;
        }
        const lastVisitedAtMs = shell.lastVisitedAt ? Date.parse(shell.lastVisitedAt) : NaN;
        if (!Number.isNaN(lastVisitedAtMs) && lastVisitedAtMs >= updatedAtMs) return;
        if (lastDispatchedUpdatedAt !== null && Date.parse(lastDispatchedUpdatedAt) >= updatedAtMs)
          return;

        const completedAtMs = shell.latestRun?.completedAt
          ? Date.parse(shell.latestRun.completedAt)
          : NaN;
        const hasUnseenCompletion =
          !Number.isNaN(completedAtMs) &&
          (Number.isNaN(lastVisitedAtMs) || completedAtMs > lastVisitedAtMs);
        const elapsed = Date.now() - lastDispatchAt;
        if (hasUnseenCompletion || wakeIsLatest || elapsed >= VISIT_DISPATCH_THROTTLE_MS) {
          dispatch(shell, visitedAt, false);
          return;
        }
        timer = setTimeout(
          () => dispatch(shell, visitedAt, false),
          VISIT_DISPATCH_THROTTLE_MS - elapsed,
        );
      };

      get.subscribe(options.threadShellAtom(ref), onShell, { immediate: true });
    }).pipe(Atom.withLabel(`thread-visit-tracker:${key}`));
  });
  return (ref: ScopedThreadRef | null) => (ref === null ? IDLE_TRACKER : family(threadKey(ref)));
}
