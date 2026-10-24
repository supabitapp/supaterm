import type { VoiceDraftSnapshot } from "@supaterm/client-runtime/voice-input";

/** A mounted composer that a recording finished in the background can write into. */
export interface VoiceComposerTarget {
  readonly readDraft: () => VoiceDraftSnapshot | null;
  readonly commitDraft: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => boolean;
}

const targets = new Map<string, VoiceComposerTarget>();
const revisions = new Map<string, { readonly text: string; readonly revision: number }>();

/**
 * Revisions outlive a composer mount so a recording captured before the composer remounted can
 * still prove its draft is unchanged.
 */
export function observeVoiceDraft(ownerKey: string, text: string): number {
  const previous = revisions.get(ownerKey);
  if (previous?.text === text) return previous.revision;
  const revision = previous === undefined ? 0 : previous.revision + 1;
  revisions.set(ownerKey, { text, revision });
  return revision;
}

export function registerVoiceComposerTarget(
  ownerKey: string,
  target: VoiceComposerTarget,
): () => void {
  targets.set(ownerKey, target);
  return () => {
    if (targets.get(ownerKey) === target) targets.delete(ownerKey);
  };
}

export function readVoiceComposerTarget(ownerKey: string): VoiceComposerTarget | null {
  return targets.get(ownerKey) ?? null;
}
