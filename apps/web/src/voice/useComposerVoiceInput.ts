import { useAtomValue } from "@effect/atom-react";
import { createServerVoiceTranscriber } from "@supaterm/client-runtime/state/transcription";
import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputState,
} from "@supaterm/client-runtime/voice-input";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { useEffect, useLayoutEffect, useState } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import { threadOutboxDeliverableAtom } from "../state/threadOutbox";
import { uploadVoiceAudio, useVoiceTranscriptionSource } from "../state/transcription";
import {
  canRecordVoice,
  readVoiceRecording,
  releaseVoiceRecording,
  WebVoiceRecorder,
  type VoiceRecording,
} from "./webVoiceRecorder";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

// Read fresh after an await, where a narrowed `currentState.phase` would be stale.
const readPhase = (controller: VoiceInputController) => controller.currentState.phase;

export interface ComposerVoiceInputOptions {
  readonly ownerKey: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly language: string;
  readonly languageLabel: string;
  readonly readPrompt: () => string;
  readonly readSelection: () => { readonly start: number; readonly end: number };
  readonly commitPrompt: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => void;
  /** The recording would be the whole message, so the environment can send it by itself. */
  readonly canSendVoice: boolean;
  readonly sendVoice: (recording: VoiceRecording) => Promise<void>;
  readonly submit: () => void;
}

export interface ComposerVoiceAvailability {
  /** Transcribing into the draft needs the environment now. */
  readonly canReview: boolean;
  /** A voice message can wait in the outbox until the environment is reachable. */
  readonly canSend: boolean;
  readonly label: string | null;
  readonly unavailableReason: string | null;
  readonly opensSettings: boolean;
}

function useAvailability(options: ComposerVoiceInputOptions): ComposerVoiceAvailability {
  const source = useVoiceTranscriptionSource(options.environmentId);
  const connected = useAtomValue(threadOutboxDeliverableAtom(options.environmentId));
  if (!canRecordVoice()) {
    return {
      canReview: false,
      canSend: false,
      label: null,
      unavailableReason: "Voice input needs HTTPS or localhost.",
      opensSettings: false,
    };
  }
  if (source?.status === "unavailable") {
    return {
      canReview: false,
      canSend: false,
      label: null,
      unavailableReason: source.message,
      opensSettings: true,
    };
  }
  const providerName = source ? (source.provider.displayName ?? source.provider.instanceId) : null;
  const canReview = connected && source !== null;
  const canSend = options.canSendVoice;
  return {
    canReview,
    canSend,
    label: providerName ? `${providerName} · ${options.languageLabel}` : options.languageLabel,
    unavailableReason:
      canReview || canSend
        ? null
        : "Reconnect to transcribe, or clear the draft to send a voice message.",
    opensSettings: false,
  };
}

function createVoiceRuntime(onStateChange: (state: VoiceInputState) => void) {
  let options: ComposerVoiceInputOptions | null = null;
  const read = () => {
    if (options === null) throw new Error("Voice input was used before its composer mounted.");
    return options;
  };
  let lastText: string | null = null;
  let revision = 0;
  const readDraft = (): VoiceDraftSnapshot => {
    const current = read();
    const text = current.readPrompt();
    if (text !== lastText) {
      lastText = text;
      revision += 1;
    }
    return { ownerKey: current.ownerKey, text, selection: current.readSelection(), revision };
  };
  const recorder: WebVoiceRecorder = new WebVoiceRecorder({
    onStatus: (status) => void controller.handleRecorderStatus(status),
  });
  const controller: VoiceInputController = new VoiceInputController({
    recorder,
    getTranscriber: () => {
      const { environmentId, threadId, language } = read();
      return createServerVoiceTranscriber({
        locale: language,
        transcribe: (uri, signal) => {
          const recording = readVoiceRecording(uri);
          if (!recording) throw new Error("The recording is no longer available.");
          return uploadVoiceAudio({
            environmentId,
            audio: recording.audio,
            request: { language, ...(threadId ? { context: { threadId } } : {}) },
            signal,
          });
        },
      });
    },
    requestPermission: () => recorder.requestPermission(),
    configureRecording: async () => undefined,
    releaseRecording: async () => recorder.release(),
    deleteRecording: releaseVoiceRecording,
    readDraft,
    commitDraft: (text, selection) => read().commitPrompt(text, selection),
    sendRecording: async (uri) => {
      const recording = readVoiceRecording(uri);
      if (!recording) throw new Error("The recording is no longer available.");
      await read().sendVoice(recording);
    },
    onStateChange,
  });
  return {
    controller,
    recorder,
    read,
    setOptions: (next: ComposerVoiceInputOptions) => {
      const ownerChanged = options !== null && options.ownerKey !== next.ownerKey;
      options = next;
      if (ownerChanged) controller.ownerChanged();
    },
  };
}

export function useComposerVoiceInput(options: ComposerVoiceInputOptions) {
  const availability = useAvailability(options);
  const [state, setState] = useState(IDLE_STATE);
  const [runtime] = useState(() => createVoiceRuntime(setState));
  useLayoutEffect(() => {
    runtime.setOptions(options);
  });

  const { controller, recorder } = runtime;
  useEffect(
    () => () => {
      controller.dispose();
      recorder.release();
    },
    [controller, recorder],
  );

  const capturing = state.phase === "preparing" || state.phase === "recording";
  useEffect(() => {
    if (!capturing) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      controller.cancel();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [capturing, controller]);

  const start = useStableCallback(() => {
    if (!availability.canReview && !availability.canSend) return;
    void controller.start();
  });
  const stop = useStableCallback(() => {
    if (availability.canReview) void controller.stop();
  });
  const cancel = useStableCallback(() => controller.cancel());
  const send = useStableCallback(async () => {
    if (controller.currentState.phase !== "recording") return;
    if (availability.canSend) {
      await controller.send();
      return;
    }
    if (!availability.canReview) return;
    await controller.stop();
    // The composer re-rendered with the transcript; its latest submit sends the whole draft.
    if (readPhase(controller) === "idle") runtime.read().submit();
  });
  const toggle = useStableCallback(() => {
    switch (controller.currentState.phase) {
      case "idle":
      case "error":
        start();
        return;
      case "preparing":
        cancel();
        return;
      case "recording":
        if (availability.canReview) stop();
        else void send();
        return;
      case "transcribing":
      case "sending":
        return;
    }
  });

  return {
    availability,
    state,
    recorder,
    busy: voiceInputBlocksSubmission(state),
    start,
    stop,
    send,
    cancel,
    toggle,
  };
}

export type ComposerVoiceInput = ReturnType<typeof useComposerVoiceInput>;
