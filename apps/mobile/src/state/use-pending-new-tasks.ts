import { useAtomValue } from "@effect/atom-react";
import * as Equal from "effect/Equal";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";
import { appAtomRegistry } from "./atom-registry";
import {
  applyHeldNewTaskDraft,
  buildPendingDraftTasks,
  buildPendingQueuedTasks,
  pendingDraftTask,
  type HeldNewTaskDraft,
  type PendingNewTask,
} from "./pending-new-tasks-model";
import { flattenQueuedThreadMessages } from "./thread-outbox-model";
import { newTaskComposerDraftsAtom } from "./use-composer-drafts";
import { useThreadOutboxMessages } from "./use-thread-outbox";

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

export function usePendingNewTasks(): ReadonlyArray<PendingNewTask> {
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const draftTasks = useAtomValue(pendingDraftTasksAtom);
  return useMemo(
    () => [
      ...draftTasks,
      ...buildPendingQueuedTasks(flattenQueuedThreadMessages(queuedMessagesByThreadKey)),
    ],
    [queuedMessagesByThreadKey, draftTasks],
  );
}
