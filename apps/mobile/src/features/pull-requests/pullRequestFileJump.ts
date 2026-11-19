import type { PullRequestDiffParams } from "./usePullRequestDiff";
import { pullRequestReviewKey } from "./pullRequestReviewDrafts";

type Listener = (path: string) => void;
const listeners = new Map<string, Set<Listener>>();

export function pullRequestFileJumpScope(params: PullRequestDiffParams): string {
  return JSON.stringify([pullRequestReviewKey(params), params.commit ?? null]);
}

export function requestPullRequestFileJump(scope: string, path: string): void {
  for (const listener of listeners.get(scope) ?? []) listener(path);
}

export function subscribePullRequestFileJump(scope: string, listener: Listener): () => void {
  let scoped = listeners.get(scope);
  if (!scoped) listeners.set(scope, (scoped = new Set()));
  scoped.add(listener);
  return () => {
    scoped.delete(listener);
    if (scoped.size === 0) listeners.delete(scope);
  };
}
