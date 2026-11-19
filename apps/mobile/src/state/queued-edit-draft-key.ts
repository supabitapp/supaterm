const QUEUED_EDIT_DRAFT_MARKER = "~queued-edit~";

export function queuedEditDraftKey(threadKey: string, runId: string) {
  return `${threadKey}${QUEUED_EDIT_DRAFT_MARKER}${runId}`;
}

export function isQueuedEditDraftKey(draftKey: string) {
  return draftKey.includes(QUEUED_EDIT_DRAFT_MARKER);
}

export function queuedEditThreadKey(draftKey: string) {
  const marker = draftKey.indexOf(QUEUED_EDIT_DRAFT_MARKER);
  return marker === -1 ? null : draftKey.slice(0, marker);
}
