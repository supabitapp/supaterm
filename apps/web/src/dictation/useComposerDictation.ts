import { useAtomValue } from "@effect/atom-react";
import type { DictationAvailability } from "@supaterm/client-runtime/state/dictation";
import {
  VoiceInputSession,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputState,
  type VoiceRecordingHandoff,
} from "@supaterm/client-runtime/voice-input";
import type { DictationSourceId, EnvironmentId, ProviderInstanceId } from "@supaterm/contracts";
import { useEffect, useLayoutEffect, useState } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import { useDictationAvailability } from "../state/dictation";
import { threadOutboxDeliverableAtom } from "../state/threadOutbox";
import { registerDictationComposer } from "./pendingClipRunner";
import { parkPendingClip } from "./pendingClips";
import { createServerVoiceTranscriber } from "./serverVoiceTranscriber";
import type { DictationClip } from "./transcribeClip";
import {
  WebVoiceRecorder,
  describeRecording,
  readRecording,
  releaseRecording,
} from "./webVoiceRecorder";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

export interface ComposerVoiceMessage {
  readonly clip: DictationClip;

  readonly selection: { readonly start: number; readonly end: number };
  readonly sourceId: DictationSourceId | null;
  readonly capturedAt: string;
}

export interface ComposerDictationOptions {
  readonly ownerKey: string;
  readonly environmentId: EnvironmentId;
  readonly threadInstanceId: ProviderInstanceId | null;
  readonly readPrompt: () => string;
  readonly readSelection: () => { readonly start: number; readonly end: number };
  readonly commitPrompt: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => boolean;

  readonly canSendVoice: boolean;

  readonly sendVoice: (message: ComposerVoiceMessage) => Promise<boolean>;
}

interface LatestDictationInput {
  readonly options: ComposerDictationOptions;
  readonly availability: DictationAvailability;
}

interface RecordingContext {
  readonly environmentId: EnvironmentId;
  readonly threadInstanceId: ProviderInstanceId | null;
}

async function parkHandoff(
  handoff: VoiceRecordingHandoff,
  context: RecordingContext,
  failure: { readonly status: "waiting" | "failed"; readonly error: string | null },
): Promise<void> {
  const recording = readRecording(handoff.uri);
  releaseRecording(handoff.uri);
  if (!recording) return;
  await parkPendingClip({
    ownerKey: handoff.capturedDraft.ownerKey,
    environmentId: context.environmentId,
    threadInstanceId: context.threadInstanceId,
    blob: recording.blob,
    mimeType: recording.mimeType,
    durationMs: recording.durationMs,
    locale: handoff.locale,
    capturedDraft: handoff.capturedDraft,
    ...failure,
  });
}

function createDictationRuntime(onStateChange: (state: VoiceInputState) => void) {
  let input: LatestDictationInput | null = null;
  const read = (): LatestDictationInput => {
    if (input === null) throw new Error("Dictation was used before its composer mounted.");
    return input;
  };
  const recorder: WebVoiceRecorder = new WebVoiceRecorder({
    onStatus: (status) => void session.controller.handleRecorderStatus(status),
  });
  let lastText: string | null = null;
  let revision = 0;
  let context: RecordingContext | null = null;
  const readDraft = (): VoiceDraftSnapshot => {
    const { options } = read();
    const text = options.readPrompt();
    if (text !== lastText) {
      lastText = text;
      revision += 1;
    }
    return { ownerKey: options.ownerKey, text, selection: options.readSelection(), revision };
  };
  const session: VoiceInputSession = new VoiceInputSession({
    recorder,
    getTranscriber: () => {
      const { options, availability } = read();
      return availability.kind === "available"
        ? createServerVoiceTranscriber({
            environmentId: options.environmentId,
            threadInstanceId: options.threadInstanceId,
          })
        : null;
    },
    requestPermission: () => recorder.requestPermission(),
    configureRecording: async () => undefined,
    releaseRecording: async () => recorder.release(),
    deleteRecording: releaseRecording,
    describeRecording,
    onStateChange: (state) => {
      if (state.phase === "idle" || state.phase === "error") recorder.releaseIfUnused();
      onStateChange(state);
    },
  });
  const target = () => ({
    ownerKey: read().options.ownerKey,
    readDraft,
    commitDraft: (text: string, selection: { readonly start: number; readonly end: number }) => {
      read().options.commitPrompt(text, selection);
    },
    subscribe: () => () => undefined,
  });
  const take = async () => {
    const recordingContext = context;
    const handoff = await session.controller.takeRecording();
    return handoff && recordingContext ? { handoff, context: recordingContext } : null;
  };
  const park = async (failure: {
    readonly status: "waiting" | "failed";
    readonly error: string | null;
  }) => {
    const taken = await take();
    if (taken) await parkHandoff(taken.handoff, taken.context, failure);
  };
  return {
    session,
    recorder,
    readDraft,
    read,
    setInput: (next: LatestDictationInput) => {
      input = next;
    },
    start: () => {
      const { options } = read();
      context = {
        environmentId: options.environmentId,
        threadInstanceId: options.threadInstanceId,
      };
      return session.start(target());
    },
    take,
    park,
  };
}

export function useComposerDictation(options: ComposerDictationOptions) {
  const availability = useDictationAvailability(options.environmentId, options.threadInstanceId);
  const connected = useAtomValue(threadOutboxDeliverableAtom(options.environmentId));
  const [state, setState] = useState(IDLE_STATE);
  const [runtime] = useState(() => createDictationRuntime(setState));
  useLayoutEffect(() => {
    runtime.setInput({ options, availability });
    runtime.readDraft();
  });

  const ownerKey = options.ownerKey;
  useEffect(() => {
    const unregister = registerDictationComposer(ownerKey, {
      readDraft: () => (runtime.read().options.ownerKey === ownerKey ? runtime.readDraft() : null),
      commitDraft: (text, selection) =>
        runtime.read().options.ownerKey === ownerKey &&
        !voiceInputBlocksSubmission(runtime.session.controller.currentState) &&
        runtime.read().options.commitPrompt(text, selection),
    });
    return () => {
      unregister();

      void runtime.park({ status: "waiting", error: null });
    };
  }, [ownerKey, runtime]);
  useEffect(() => () => runtime.session.controller.dispose(), [runtime]);

  const capturing = state.phase === "preparing" || state.phase === "recording";
  useEffect(() => {
    if (!capturing) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      runtime.session.controller.cancel();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [capturing, runtime]);

  const start = useStableCallback(() => {
    if (runtime.read().availability.kind !== "available") return;
    void runtime.start();
  });
  const stop = useStableCallback(() => {
    void runtime.session.stop();
  });
  const cancel = useStableCallback(() => {
    if (runtime.session.controller.currentState.phase === "transcribing") {
      void runtime.park({ status: "failed", error: "Transcription was cancelled." });
      return;
    }
    runtime.session.controller.cancel();
  });
  const transcribeAndSend = useStableCallback(async () => {
    if (runtime.session.controller.currentState.phase !== "recording") return;
    if (!runtime.read().options.canSendVoice) {
      void runtime.session.stop();
      return;
    }
    const taken = await runtime.take();
    if (!taken) return;
    const { handoff } = taken;
    const recording = readRecording(handoff.uri);
    const current = runtime.readDraft();
    const unchanged =
      current.ownerKey === handoff.capturedDraft.ownerKey &&
      current.text === handoff.capturedDraft.text;
    const input = runtime.read();
    const sent =
      recording !== null &&
      unchanged &&
      input.options.canSendVoice &&
      (await input.options.sendVoice({
        clip: {
          blob: recording.blob,
          mimeType: recording.mimeType,
          durationMs: recording.durationMs,
          locale: handoff.locale,
        },
        selection: handoff.capturedDraft.selection,
        sourceId: input.availability.kind === "available" ? input.availability.source.id : null,
        capturedAt: new Date().toISOString(),
      }));
    if (sent) {
      releaseRecording(handoff.uri);
      return;
    }
    await parkHandoff(handoff, taken.context, { status: "waiting", error: null });
  });
  const toggle = useStableCallback(() => {
    switch (runtime.session.controller.currentState.phase) {
      case "idle":
      case "error":
        start();
        return;
      case "preparing":
        runtime.session.controller.cancel();
        return;
      case "recording":
        stop();
        return;
      case "transcribing":
        return;
    }
  });

  return {
    availability,
    connected,
    state,
    recorder: runtime.recorder,
    blocksSubmission: voiceInputBlocksSubmission(state),
    freezesEditor: voiceInputBlocksSubmission(state),
    start,
    stop,
    cancel,
    retry: start,
    toggle,
    transcribeAndSend,
  };
}

export type ComposerDictation = ReturnType<typeof useComposerDictation>;
