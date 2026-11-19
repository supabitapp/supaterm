const NEW_TASK_DRAFT_PREFIX = "new-task:";

export function newTaskDraftKey(draftId: string) {
  return `${NEW_TASK_DRAFT_PREFIX}${draftId}`;
}

export function isNewTaskDraftKey(draftKey: string) {
  return draftKey.startsWith(NEW_TASK_DRAFT_PREFIX);
}

export function restoredNewTaskDraftKey(messageId: string) {
  return newTaskDraftKey(`restored-${messageId}`);
}
