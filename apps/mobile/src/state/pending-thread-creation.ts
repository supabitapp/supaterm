import {
  buildPendingThreadShell,
  type PendingThreadCreation as SharedPendingThreadCreation,
  type PendingThreadCreationOutcome as SharedPendingThreadCreationOutcome,
} from "@supaterm/client-runtime/pending-thread-creation";
import { DEFAULT_PROVIDER_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { deriveThreadTitleFromPrompt } from "../lib/projectThreadStartTurn";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import type { QueuedThreadMessage } from "./thread-outbox-model";

export {
  isPendingThreadCreationVisible,
  pendingThreadCreationMessage,
  resolvePendingThreadCreation,
} from "@supaterm/client-runtime/pending-thread-creation";

export type PendingThreadCreationOutcome = SharedPendingThreadCreationOutcome<QueuedThreadMessage>;
export type PendingThreadCreation = SharedPendingThreadCreation<QueuedThreadMessage>;

export const pendingThreadCreationOutcomesAtom = Atom.make<
  Readonly<Record<string, PendingThreadCreationOutcome>>
>({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:pending-thread-creation:outcomes"));

export function recordPendingThreadCreationOutcome(outcome: PendingThreadCreationOutcome): void {
  const key = scopedThreadKey(outcome.message.environmentId, outcome.message.threadId);
  appAtomRegistry.set(pendingThreadCreationOutcomesAtom, {
    ...appAtomRegistry.get(pendingThreadCreationOutcomesAtom),
    [key]: outcome,
  });
}

export function clearPendingThreadCreationOutcome(threadKey: string): void {
  const current = appAtomRegistry.get(pendingThreadCreationOutcomesAtom);
  if (!current[threadKey]) {
    return;
  }
  const next = { ...current };
  delete next[threadKey];
  appAtomRegistry.set(pendingThreadCreationOutcomesAtom, next);
}

/** Adapt the native queue format to the shared pending-thread presentation. */
export function pendingThreadCreationShell(message: QueuedThreadMessage) {
  const creation = message.creation;
  if (!creation || !message.modelSelection) return null;
  return buildPendingThreadShell({
    environmentId: message.environmentId,
    threadId: message.threadId,
    projectId: creation.projectId,
    title: deriveThreadTitleFromPrompt(message.text),
    modelSelection: message.modelSelection,
    runtimeMode: message.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode: message.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: creation.branch,
    worktreePath: creation.workspaceMode === "worktree" ? null : creation.worktreePath,
    createdAt: message.createdAt,
    creationSource: "mobile",
  });
}
