/** Keep edit keys separate to preserve original drafts. */
const QUEUED_EDIT_DRAFT_MARKER = "~queued-edit~";

export function queuedEditDraftKey(threadKey: string, runId: string): string {
  return `${threadKey}${QUEUED_EDIT_DRAFT_MARKER}${runId}`;
}

export function isQueuedEditDraftKey(draftKey: string): boolean {
  return draftKey.includes(QUEUED_EDIT_DRAFT_MARKER);
}

export function queuedEditThreadKey(draftKey: string): string | null {
  const marker = draftKey.indexOf(QUEUED_EDIT_DRAFT_MARKER);
  return marker === -1 ? null : draftKey.slice(0, marker);
}
