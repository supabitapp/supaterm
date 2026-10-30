import type { EnvironmentId, ProjectId } from "@supaterm/contracts";

import { deriveThreadTitleFromPrompt } from "../lib/projectThreadStartTurn";
import type { QueuedThreadCreation, QueuedThreadMessage } from "./thread-outbox-model";
import { isNewTaskDraftKey } from "./new-task-draft-key";
import type { ComposerDraft } from "./use-composer-drafts";

export type PendingNewTask = PendingQueuedTask | PendingDraftTask;

export interface PendingQueuedTask {
  readonly kind: "pending";
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectTitle: string | undefined;
  readonly projectCwd: string | undefined;
  readonly branch: string | null;
  readonly title: string;
  readonly createdAt: string;
  readonly message: QueuedThreadMessage;
  readonly creation: QueuedThreadCreation;
}

export interface PendingDraftTask {
  readonly kind: "draft";
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectTitle: undefined;
  readonly projectCwd: undefined;
  readonly branch: string | null;
  readonly title: string;
  readonly createdAt: string;
  readonly draftKey: string;
}

export function composerDraftHasUserContent(draft: ComposerDraft): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}

function draftTitle(draft: ComposerDraft): string {
  if (draft.text.trim().length > 0) {
    return deriveThreadTitleFromPrompt(draft.text);
  }
  const count = draft.attachments.length;
  return count === 1 ? "1 attachment" : `${count} attachments`;
}

export function pendingDraftTask(draftKey: string, draft: ComposerDraft): PendingDraftTask | null {
  if (!isNewTaskDraftKey(draftKey) || !draft.project || !composerDraftHasUserContent(draft)) {
    return null;
  }
  return {
    kind: "draft",
    key: `draft-task:${draftKey}`,
    environmentId: draft.project.environmentId,
    projectId: draft.project.projectId,
    projectTitle: undefined,
    projectCwd: undefined,
    branch: draft.workspaceSelection?.branch ?? null,
    title: draftTitle(draft),
    createdAt: draft.project.createdAt,
    draftKey,
  };
}

function newestFirst(left: PendingNewTask, right: PendingNewTask): number {
  return right.createdAt.localeCompare(left.createdAt) || left.key.localeCompare(right.key);
}

export function buildPendingDraftTasks(
  drafts: Readonly<Record<string, ComposerDraft>>,
): ReadonlyArray<PendingDraftTask> {
  const tasks: PendingDraftTask[] = [];
  for (const [draftKey, draft] of Object.entries(drafts)) {
    const task = pendingDraftTask(draftKey, draft);
    if (task) tasks.push(task);
  }
  return tasks.sort(newestFirst);
}

export function buildPendingQueuedTasks(
  queuedMessages: ReadonlyArray<QueuedThreadMessage>,
): ReadonlyArray<PendingQueuedTask> {
  const tasks: PendingQueuedTask[] = [];
  for (const message of queuedMessages) {
    if (!message.creation) {
      continue;
    }
    tasks.push({
      kind: "pending",
      key: `pending-task:${message.messageId}`,
      environmentId: message.environmentId,
      projectId: message.creation.projectId,
      projectTitle: message.creation.projectTitle,
      projectCwd: message.creation.projectCwd,
      branch: message.creation.branch,
      title: deriveThreadTitleFromPrompt(message.text),
      createdAt: message.createdAt,
      message,
      creation: message.creation,
    });
  }
  return tasks.sort(newestFirst);
}

export interface HeldNewTaskDraft {
  readonly draftKey: string;
  readonly content: Pick<ComposerDraft, "text" | "attachments"> | null;
}

export function applyHeldNewTaskDraft(
  drafts: Readonly<Record<string, ComposerDraft>>,
  held: HeldNewTaskDraft | null,
): Readonly<Record<string, ComposerDraft>> {
  if (held === null) return drafts;
  const live = drafts[held.draftKey];
  if (live === undefined) return drafts;
  const next = { ...drafts };
  if (held.content === null || !live.project) {
    delete next[held.draftKey];
  } else {
    next[held.draftKey] = { ...live, ...held.content };
  }
  return next;
}
