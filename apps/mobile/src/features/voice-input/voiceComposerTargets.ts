import {
  composerRecordingConsumer,
  createRecordingConsumers,
  type VoiceDraftSnapshot,
} from "@supaterm/client-runtime/voice-input";

/** A mounted composer that a saved recording's transcript can land in. */
export interface VoiceComposerTarget {
  readonly readDraft: () => VoiceDraftSnapshot | null;
  readonly commitDraft: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => boolean;
  /** Sends the draft once it shows `text`; only for a recording the user chose to send. */
  readonly submit: (text: string) => void;
}

export const voiceRecordingConsumers = createRecordingConsumers();

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

type VoiceSendIntent = { readonly ownerKey: string; recordingId: string | null };

// Memory only, so a recording restored after a relaunch never sends.
const sendIntents = new Set<VoiceSendIntent>();

/**
 * Remembers that the user chose "transcribe and send". The intent exists before the recording is
 * saved and is bound to it afterwards; forgetting it in between still wins.
 */
export function intendToSendVoiceRecording(ownerKey: string) {
  const intent: VoiceSendIntent = { ownerKey, recordingId: null };
  sendIntents.add(intent);
  return {
    bind: (recordingId: string) => {
      intent.recordingId = recordingId;
    },
    take: (): boolean => sendIntents.delete(intent),
  };
}

export function forgetVoiceSendIntents(ownerKey?: string): void {
  for (const intent of sendIntents) {
    if (ownerKey === undefined || intent.ownerKey === ownerKey) sendIntents.delete(intent);
  }
}

function takeSendIntent(recordingId: string, ownerKey: string): boolean {
  for (const intent of sendIntents) {
    if (intent.recordingId !== recordingId) continue;
    sendIntents.delete(intent);
    return intent.ownerKey === ownerKey;
  }
  return false;
}

export function registerVoiceComposerTarget(
  ownerKey: string,
  target: VoiceComposerTarget,
): () => void {
  return voiceRecordingConsumers.register(ownerKey, (recording, transcript) => {
    const sends = takeSendIntent(recording.id, ownerKey);
    return composerRecordingConsumer({
      readDraft: target.readDraft,
      commitDraft: (text, selection) => {
        if (!target.commitDraft(text, selection)) return false;
        if (sends) target.submit(text);
        return true;
      },
    })(recording, transcript);
  });
}
