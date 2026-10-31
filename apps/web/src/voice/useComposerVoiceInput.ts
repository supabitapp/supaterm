import { useAtomValue } from "@effect/atom-react";
import { createServerVoiceTranscriber } from "@supaterm/client-runtime/state/transcription";
import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputState,
} from "@supaterm/client-runtime/voice-input";
import type { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ComposerSubmissionIntent } from "../composer-logic";
import type { ComposerDispatchMode } from "@supaterm/client-runtime/state/composer-dispatch";
import { useStableCallback } from "../hooks/useStableCallback";
import { threadOutboxDeliverableAtom } from "../state/threadOutbox";
import { uploadVoiceAudio, useVoiceTranscriptionSource } from "../state/transcription";
import { useDiscardOnEscape } from "./useDiscardOnEscape";
import {
  canRecordVoice,
  readVoiceRecording,
  releaseVoiceRecording,
  WebVoiceRecorder,
  type VoiceRecording,
} from "./webVoiceRecorder";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

/** What the send shortcut asked for, so a recording goes out the way a typed draft would. */
export interface ComposerVoiceSubmission {
  readonly dispatchMode?: ComposerDispatchMode | undefined;
  readonly intent?: ComposerSubmissionIntent | undefined;
}

export interface ComposerVoiceInputOptions {
  readonly ownerKey: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  /** A draft has no thread yet; its project still names the jargon to listen for. */
  readonly projectId: ProjectId | null;
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
  /** Called when Send is pressed; the returned function sends the finished recording. */
  readonly prepareVoiceSend: (
    submission: ComposerVoiceSubmission,
  ) => (recording: VoiceRecording) => Promise<void>;
  readonly submit: (submission: ComposerVoiceSubmission) => void;
  /** A recording is open or on its way, so its controls must stay on screen. */
  readonly onBusyChange: (busy: boolean) => void;
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
      const { environmentId, threadId, projectId, language } = read();
      const context = threadId ? { threadId } : projectId ? { projectId } : null;
      return createServerVoiceTranscriber({
        locale: language,
        transcribe: (uri, signal) => {
          const recording = readVoiceRecording(uri);
          if (!recording) throw new Error("The recording is no longer available.");
          return uploadVoiceAudio({
            environmentId,
            audio: recording.audio,
            request: { language, ...(context ? { context } : {}) },
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
    onStateChange: (state) => {
      // The microphone opens while permission is asked, before the controller owns it.
      if (state.phase === "idle" || state.phase === "error") recorder.release();
      onStateChange(state);
      options?.onBusyChange(voiceInputBlocksSubmission(state));
    },
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

  // Send with a draft submits once React has committed the transcript into it.
  const submitAfterReview = useRef<{
    readonly ownerKey: string;
    readonly submission: ComposerVoiceSubmission;
  } | null>(null);
  useEffect(() => {
    const pending = submitAfterReview.current;
    if (pending === null || voiceInputBlocksSubmission(state)) return;
    submitAfterReview.current = null;
    const current = runtime.read();
    if (state.phase === "idle" && current.ownerKey === pending.ownerKey) {
      current.submit(pending.submission);
    }
  }, [runtime, state]);

  const start = useStableCallback(() => {
    if (!availability.canReview && !availability.canSend) return;
    void controller.start();
  });
  const stop = useStableCallback(() => {
    if (availability.canReview) void controller.stop();
  });
  const cancel = useStableCallback(() => {
    submitAfterReview.current = null;
    controller.cancel();
  });
  useDiscardOnEscape(state.phase === "preparing" || state.phase === "recording", cancel);
  const send = useStableCallback(async (submission: ComposerVoiceSubmission = {}) => {
    if (controller.currentState.phase !== "recording") return;
    if (availability.canSend) {
      const sendVoice = runtime.read().prepareVoiceSend(submission);
      await controller.send(async (uri) => {
        const recording = readVoiceRecording(uri);
        if (!recording) throw new Error("The recording is no longer available.");
        await sendVoice(recording);
      });
      return;
    }
    if (!availability.canReview) return;
    submitAfterReview.current = { ownerKey: runtime.read().ownerKey, submission };
    await controller.stop();
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
