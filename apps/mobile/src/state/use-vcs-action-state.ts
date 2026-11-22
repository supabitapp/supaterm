import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { type VcsActionState, type VcsActionTarget } from "@supaterm/client-runtime/state/vcs";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { playOutcomeHaptic } from "../lib/outcomeHaptic";
import { appAtomRegistry } from "./atom-registry";
import { vcsActionManager } from "./vcs";

export function useVcsActionState(target: VcsActionTarget): VcsActionState {
  return useAtomValue(vcsActionManager.stateAtom(target));
}

export interface GitActionResultNotification {
  readonly type: "success" | "error";
  readonly title: string;
  readonly description?: string;
  readonly prUrl?: string;
}

const RESULT_DISMISS_MS = 5_000;

interface PendingGitActionResult {
  readonly notification: GitActionResultNotification;
  readonly timer: ReturnType<typeof setTimeout>;
}

const gitActionResultsAtom = Atom.make<ReadonlyMap<string, PendingGitActionResult>>(new Map()).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:git-action-results"),
);

function gitActionResultKey({ environmentId, threadId }: ScopedThreadRef): string {
  return JSON.stringify([environmentId, threadId]);
}

export function showGitActionResult({
  threadRef,
  ...notification
}: GitActionResultNotification & { readonly threadRef: ScopedThreadRef }): void {
  playOutcomeHaptic(notification.type === "success");
  const key = gitActionResultKey(threadRef);
  const results = new Map(appAtomRegistry.get(gitActionResultsAtom));
  const previous = results.get(key);
  if (previous !== undefined) clearTimeout(previous.timer);
  results.set(key, {
    notification,
    timer: setTimeout(() => dismissGitActionResult(threadRef), RESULT_DISMISS_MS),
  });
  appAtomRegistry.set(gitActionResultsAtom, results);
}

export function dismissGitActionResult(threadRef: ScopedThreadRef | null): void {
  if (threadRef === null) return;
  const key = gitActionResultKey(threadRef);
  const results = appAtomRegistry.get(gitActionResultsAtom);
  const entry = results.get(key);
  if (entry === undefined) return;
  clearTimeout(entry.timer);
  const next = new Map(results);
  next.delete(key);
  appAtomRegistry.set(gitActionResultsAtom, next);
}

export type GitActionProgressPhase = "idle" | "running" | "success" | "error";

export interface GitActionProgress {
  readonly phase: GitActionProgressPhase;
  readonly label: string | null;
  readonly description: string | null;
  readonly prUrl?: string;
}

const EMPTY_PROGRESS: GitActionProgress = {
  phase: "idle",
  label: null,
  description: null,
};

function formatElapsedSeconds(ms: number | null, nowMs: number): string | null {
  if (ms === null) return null;
  const elapsed = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (elapsed < 2) return null;
  return `Running for ${elapsed}s`;
}

/** Checkout progress and the selected thread's own Git result. */
export function useGitActionProgress(
  target: VcsActionTarget,
  threadRef: ScopedThreadRef | null,
): GitActionProgress {
  const actionState = useVcsActionState(target);
  const resultKey = threadRef === null ? null : gitActionResultKey(threadRef);
  const result = useAtomValue(gitActionResultsAtom, (results) =>
    resultKey === null ? undefined : results.get(resultKey)?.notification,
  );

  const [nowMs, setNowMs] = useState(() => Date.now());
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- runs a one-second interval that refreshes the elapsed label while the git action runs
  useEffect(() => {
    if (!actionState.isRunning) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [actionState.isRunning]);

  if (actionState.isRunning) {
    const description =
      actionState.lastOutputLine ??
      formatElapsedSeconds(actionState.hookStartedAtMs ?? actionState.phaseStartedAtMs, nowMs);
    return {
      phase: "running",
      label: actionState.currentLabel,
      description,
    };
  }

  if (result) {
    return {
      phase: result.type,
      label: result.title,
      description: result.description ?? null,
      prUrl: result.prUrl,
    };
  }

  return EMPTY_PROGRESS;
}
