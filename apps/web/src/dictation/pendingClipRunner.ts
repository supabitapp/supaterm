import { threadOutboxRetryDelayMs } from "@supaterm/client-runtime/thread-outbox";
import {
  resolveParkedInsertion,
  type VoiceDraftSnapshot,
} from "@supaterm/client-runtime/voice-input";

import { readDictationAvailability } from "../state/dictation";
import { browserThreadOutboxStorage } from "../state/threadOutboxStorage";
import {
  discardPendingClip,
  readPendingClip,
  readPendingClipBlob,
  registerPendingClipWork,
  reloadPendingClips,
  updatePendingClip,
} from "./pendingClips";
import { classifyDictationFailure, transcribeDictationClip } from "./transcribeClip";

export interface DictationComposerTarget {
  readonly readDraft: () => VoiceDraftSnapshot | null;
  readonly commitDraft: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => boolean;
}

const composerTargets = new Map<string, DictationComposerTarget>();

export function registerDictationComposer(
  ownerKey: string,
  target: DictationComposerTarget,
): () => void {
  composerTargets.set(ownerKey, target);
  return () => {
    if (composerTargets.get(ownerKey) === target) composerTargets.delete(ownerKey);
  };
}

const UNAVAILABLE_COPY = {
  unsupported: "This environment can't transcribe recordings.",
  forbidden: "This connection can't use dictation.",
  disabled: "Dictation is turned off for this environment.",
  "no-source": "No transcription model is available.",
  "no-capture": "No transcription model is available.",
} as const;

const running = new Set<string>();
const lockRetries = new Map<string, ReturnType<typeof setTimeout>>();

export function isPendingClipRunning(id: string): boolean {
  return running.has(id) || lockRetries.has(id);
}

export async function transcribePendingClip(id: string): Promise<void> {
  if (running.has(id)) return;
  clearTimeout(lockRetries.get(id));
  lockRetries.delete(id);
  running.add(id);
  try {
    if (!readPendingClip(id)?.persisted) {
      await runPendingClip(id);
      return;
    }
    const claimed = await browserThreadOutboxStorage.withLock(`dictation:${id}`, async () => {
      await reloadPendingClips();
      await runPendingClip(id);
      return true;
    });
    if (claimed === null) {
      lockRetries.set(
        id,
        setTimeout(() => void transcribePendingClip(id), 60_000),
      );
    }
  } catch {
    updatePendingClip(id, {
      status: "failed",
      error: "Recording storage is unavailable. Retry to transcribe.",
    });
  } finally {
    running.delete(id);
  }
}

async function runPendingClip(id: string): Promise<void> {
  const clip = readPendingClip(id);
  const blob = readPendingClipBlob(id);
  if (!clip || !blob || clip.status === "ready" || clip.status === "failed") return;
  const availability = readDictationAvailability(clip.environmentId, clip.threadInstanceId);
  if (availability.kind === "hidden") {
    if (availability.reason !== "unknown") {
      updatePendingClip(id, { status: "failed", error: UNAVAILABLE_COPY[availability.reason] });
    }
    return;
  }
  const controller = new AbortController();
  const unregister = registerPendingClipWork(id, controller);
  updatePendingClip(id, { status: "transcribing", error: null });
  const outcome = await transcribeDictationClip({
    environmentId: clip.environmentId,
    sourceId: availability.source.id,
    clip: {
      blob,
      mimeType: clip.mimeType,
      durationMs: clip.durationMs,
      locale: clip.locale,
    },
    signal: controller.signal,
  }).then(
    (result) => ({ ok: true as const, text: result.text }),
    (error: unknown) => ({ ok: false as const, failure: classifyDictationFailure(error) }),
  );
  unregister();
  if (clip.persisted) await reloadPendingClips();
  const current = readPendingClip(id);
  if (!current) return;
  if (!outcome.ok) {
    if (outcome.failure.kind === "cancelled") {
      updatePendingClip(id, { status: "waiting" });
    } else if (outcome.failure.kind === "transient") {
      updatePendingClip(id, {
        status: "waiting",
        error: outcome.failure.message,
        attempts: current.attempts + 1,
        retryAt: Date.now() + threadOutboxRetryDelayMs(current.attempts + 1),
      });
    } else {
      updatePendingClip(id, { status: "failed", error: outcome.failure.message });
    }
    return;
  }
  const target = composerTargets.get(current.ownerKey);
  const insertion = resolveParkedInsertion({
    captured: current.capturedDraft,
    current: target?.readDraft() ?? null,
    transcript: outcome.text,
    locale: current.locale ?? "en",
  });
  if (insertion.kind === "commit" && target?.commitDraft(insertion.text, insertion.selection)) {
    await discardPendingClip(id);
    return;
  }
  updatePendingClip(
    id,
    insertion.kind === "empty"
      ? { status: "failed", error: "No speech was detected." }
      : { status: "ready", transcript: outcome.text.trim(), error: null },
  );
}
