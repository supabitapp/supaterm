import type { AtomCommandResult } from "@supaterm/client-runtime/state/runtime";
import type { VcsListRefsInput, VcsListRefsResult } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { resolveDefaultWorktreeBaseBranch } from "../lib/worktree-base-branch";
import { appAtomRegistry } from "./atom-registry";
import {
  confirmThreadOutboxMessageQueued,
  threadOutboxRevision,
  updateThreadOutboxMessage,
} from "./thread-outbox";
import type { QueuedThreadCreation, QueuedThreadMessage } from "./thread-outbox-model";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";

export async function prepareQueuedThreadCreation<E>(
  message: QueuedThreadMessage,
  projectCwd: string,
  fetchRefs: (target: {
    readonly environmentId: QueuedThreadMessage["environmentId"];
    readonly input: VcsListRefsInput;
  }) => Promise<AtomCommandResult<VcsListRefsResult, E>>,
): Promise<
  AtomCommandResult<
    { readonly message: QueuedThreadMessage; readonly creation: QueuedThreadCreation } | null,
    E | Error
  >
> {
  const canUpdate = () => !appAtomRegistry.get(editingQueuedMessageIdsAtom)[message.messageId];
  if (!(await confirmThreadOutboxMessageQueued(message)) || !canUpdate()) {
    return AsyncResult.success(null);
  }
  const creation = message.creation;
  if (!creation) {
    return AsyncResult.failure(Cause.fail(new Error("The queued task has no workspace.")));
  }
  if (creation.workspaceMode !== "worktree" || creation.branch || !creation.useDefaultBranch) {
    return AsyncResult.success({ message, creation });
  }
  const revision = threadOutboxRevision(message.messageId);
  const result = await fetchRefs({
    environmentId: message.environmentId,
    input: { cwd: projectCwd, limit: 100, refresh: true },
  });
  if (
    !canUpdate() ||
    threadOutboxRevision(message.messageId) !== revision ||
    !(await confirmThreadOutboxMessageQueued(message))
  ) {
    return AsyncResult.success(null);
  }
  if (AsyncResult.isFailure(result)) {
    return AsyncResult.failure(result.cause);
  }
  const branch = resolveDefaultWorktreeBaseBranch(result.value.refs);
  if (!result.value.isRepo || !branch) {
    return AsyncResult.failure(
      Cause.fail(
        new Error(
          result.value.isRepo
            ? "No default or current branch is available. Choose a base branch for this worktree."
            : "This project is not a Git repository. Choose Current checkout to start the task.",
        ),
      ),
    );
  }
  const { useDefaultBranch: _, ...workspace } = creation;
  const resolvedCreation = { ...workspace, branch };
  const resolvedMessage = { ...message, creation: resolvedCreation };
  if (!(await updateThreadOutboxMessage(resolvedMessage, revision, canUpdate))) {
    return AsyncResult.success(null);
  }
  return AsyncResult.success({ message: resolvedMessage, creation: resolvedCreation });
}
