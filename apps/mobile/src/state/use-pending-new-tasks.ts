import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope } from "@supaterm/contracts";
import * as Equal from "effect/Equal";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { appAtomRegistry } from "./atom-registry";
import {
  applyHeldNewTaskDraft,
  buildPendingDraftTasks,
  buildPendingQueuedTasks,
  isQueuedCreationSending,
  pendingDraftTask,
  type HeldNewTaskDraft,
  type PendingNewTask,
  type ThreadOutboxSendGate,
} from "./pending-new-tasks-model";
import { pendingThreadCreationOutcomesAtom, withLaunchingThreads } from "./pending-thread-creation";
import { flattenQueuedThreadMessages } from "./thread-outbox-model";
import { newTaskComposerDraftsAtom } from "./use-composer-drafts";
import {
  retryingQueuedMessageIdsAtom,
  threadOutboxShellStatusesAtom,
  useThreadOutboxMessages,
} from "./use-thread-outbox";
import { environmentSession, sessionHasScope } from "./session";
import { workspaceConnections } from "./workspace";

export type {
  PendingDraftTask,
  PendingNewTask,
  PendingQueuedTask,
} from "./pending-new-tasks-model";

const heldNewTaskDraftAtom = Atom.make<HeldNewTaskDraft | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:held-new-task-draft"),
);

export function holdNewTaskDraft(draftKey: string): () => void {
  const draft = appAtomRegistry.get(newTaskComposerDraftsAtom)[draftKey];
  const held: HeldNewTaskDraft = {
    draftKey,
    content:
      draft !== undefined && pendingDraftTask(draftKey, draft) !== null
        ? { text: draft.text, attachments: draft.attachments }
        : null,
  };
  appAtomRegistry.set(heldNewTaskDraftAtom, held);
  return () => {
    if (appAtomRegistry.get(heldNewTaskDraftAtom) === held) {
      appAtomRegistry.set(heldNewTaskDraftAtom, null);
    }
  };
}

const pendingDraftTasksAtom = Atom.make((get) =>
  buildPendingDraftTasks(
    applyHeldNewTaskDraft(get(newTaskComposerDraftsAtom), get(heldNewTaskDraftAtom)),
  ),
).pipe(
  Atom.withEquality(Equal.equals),
  Atom.keepAlive,
  Atom.withLabel("mobile:pending-draft-tasks"),
);

const threadOutboxSendGateAtom = Atom.make((get): ThreadOutboxSendGate => {
  const connected = get(workspaceConnections.environmentsAtom).flatMap((environment) =>
    environment.connectionState === "connected" ? [environment.environmentId] : [],
  );
  return {
    connectedEnvironmentIds: new Set(connected),
    operableEnvironmentIds: new Set(
      connected.filter((environmentId) =>
        sessionHasScope(
          get(environmentSession.sessionStateAtom(environmentId)),
          AuthOrchestrationOperateScope,
        ),
      ),
    ),
    shellStatuses: get(threadOutboxShellStatusesAtom),
    retryingMessageIds: get(retryingQueuedMessageIdsAtom),
  };
}).pipe(Atom.withLabel("mobile:pending-new-tasks:send-gate"));

export function usePendingNewTasks(): ReadonlyArray<PendingNewTask> {
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const draftTasks = useAtomValue(pendingDraftTasksAtom);
  const sendGate = useAtomValue(threadOutboxSendGateAtom);
  return [
    ...draftTasks,
    ...buildPendingQueuedTasks(flattenQueuedThreadMessages(queuedMessagesByThreadKey), sendGate),
  ];
}

/** The list's threads, with creations the outbox is sending placed as working. */
export function useLaunchingThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const outcomes = useAtomValue(pendingThreadCreationOutcomesAtom);
  const sendGate = useAtomValue(threadOutboxSendGateAtom);
  return useMemo(() => {
    const launches = [
      ...flattenQueuedThreadMessages(queuedMessagesByThreadKey).filter((message) =>
        isQueuedCreationSending(message, sendGate),
      ),
      ...Object.values(outcomes).flatMap((outcome) =>
        outcome.kind === "delivered" ? [outcome.message] : [],
      ),
    ];
    return withLaunchingThreads({ threads, launches });
  }, [threads, queuedMessagesByThreadKey, outcomes, sendGate]);
}
