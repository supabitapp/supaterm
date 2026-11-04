import { useAtomValue } from "@effect/atom-react";
import { createServerVoiceTranscriber } from "@supaterm/client-runtime/state/transcription";
import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  voiceInputCue,
  type VoiceDraftSnapshot,
  type VoiceInputState,
  type VoiceRecordingHandOff,
} from "@supaterm/client-runtime/voice-input";
import type { EnvironmentId, ProjectId, ThreadId, VoiceHoldToTalkKey } from "@supaterm/contracts";
import { unlock } from "cuelume";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ComposerSubmissionIntent } from "../composer-logic";
import type { ComposerDispatchMode } from "@supaterm/client-runtime/state/composer-dispatch";
import { getClientSettings } from "../hooks/useSettings";
import { useStableCallback } from "../hooks/useStableCallback";
import { threadOutboxDeliverableAtom } from "../state/threadOutbox";
import {
  environmentStreamsDictation,
  startLiveVoiceDictation,
  uploadVoiceAudio,
  useVoiceTranscriptionSource,
} from "../state/transcription";
import { followKeyHold, type KeyHold, type KeyHoldHandlers } from "./keyHold";
import { useDiscardOnEscape } from "./useDiscardOnEscape";
import { useHoldToTalk } from "./useHoldToTalk";
import { playVoiceInputCue } from "./voiceInputCues";
import { publishVoiceInputActivity } from "./voiceInputActivity";
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
  ) => (recording: VoiceRecording, handOff: VoiceRecordingHandOff | undefined) => Promise<void>;
  readonly submit: (submission: ComposerVoiceSubmission) => void;
  /** A recording is open or on its way, so its controls must stay on screen. */
  readonly onBusyChange: (busy: boolean) => void;
  /** Holding this key while focus is in `holdToTalkTarget` records. */
  readonly holdToTalkKey: VoiceHoldToTalkKey;
  readonly holdToTalkTarget: RefObject<HTMLElement | null>;
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
  let phase = IDLE_STATE.phase;
  const recorder: WebVoiceRecorder = new WebVoiceRecorder({
    onStatus: (status) => void controller.handleRecorderStatus(status),
    readMicrophone: () => {
      const settings = getClientSettings();
      return {
        chosen: settings.voiceMicrophone,
        avoidBluetooth: settings.voiceAvoidBluetoothMicrophone,
      };
    },
  });
  const controller: VoiceInputController = new VoiceInputController({
    recorder,
    getTranscriber: () => {
      const { environmentId, threadId, projectId, language } = read();
      const context = threadId ? { threadId } : projectId ? { projectId } : null;
      const request = { language, ...(context ? { context } : {}) };
      return createServerVoiceTranscriber({
        locale: language,
        startLive: environmentStreamsDictation(environmentId)
          ? () =>
              startLiveVoiceDictation({
                environmentId,
                request,
                subscribe: (push) => recorder.onPcm(push),
              })
          : undefined,
        transcribe: (uri, signal, dictation) => {
          const recording = readVoiceRecording(uri);
          return uploadVoiceAudio({
            environmentId,
            audio: recording.audio,
            request: { ...request, ...(dictation ? { uploadId: dictation.uploadId } : {}) },
            ...(dictation ? { streamed: dictation.streamed } : {}),
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
      publishVoiceInputActivity(recorder, state.phase);
      // The microphone opens while permission is asked, before the controller owns it.
      if (state.phase === "idle" || state.phase === "error") recorder.release();
      const cue = voiceInputCue(phase, state.phase);
      phase = state.phase;
      if (cue) playVoiceInputCue(cue);
      onStateChange(state);
      options?.onBusyChange(voiceInputBlocksSubmission(state));
    },
  });
  // One held key at a time; it never outlives its draft or composer.
  let heldKey: KeyHold | null = null;
  const releaseHeldKey = () => {
    heldKey?.cancel();
    heldKey = null;
  };
  return {
    controller,
    recorder,
    read,
    setOptions: (next: ComposerVoiceInputOptions) => {
      const ownerChanged = options !== null && options.ownerKey !== next.ownerKey;
      options = next;
      if (!ownerChanged) return;
      releaseHeldKey();
      controller.ownerChanged();
    },
    followKeyPress: (code: string, handlers: KeyHoldHandlers) => {
      releaseHeldKey();
      heldKey = followKeyHold(code, handlers);
      return heldKey;
    },
    releaseHeldKey,
  };
}

export function useComposerVoiceInput(options: ComposerVoiceInputOptions) {
  const availability = useAvailability(options);
  const [state, setState] = useState(IDLE_STATE);
  const [runtime] = useState(() => createVoiceRuntime(setState));
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- hands the latest composer options to the voice runtime, which reads them from recorder callbacks outside React
  useLayoutEffect(() => {
    runtime.setOptions(options);
  });

  const { controller, recorder } = runtime;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- disposes the voice controller and releases the microphone when the composer unmounts
  useEffect(
    () => () => {
      runtime.releaseHeldKey();
      controller.dispose();
      recorder.release();
    },
    [runtime, controller, recorder],
  );

  // Send with a draft submits once React has committed the transcript into it.
  const submitAfterReview = useRef<{
    readonly ownerKey: string;
    readonly prompt: string;
    readonly submission: ComposerVoiceSubmission;
  } | null>(null);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- submits a Send-with-draft only after React has committed the reviewed transcript into the editor
  useEffect(() => {
    const pending = submitAfterReview.current;
    if (pending === null || voiceInputBlocksSubmission(state)) return;
    submitAfterReview.current = null;
    const current = runtime.read();
    if (
      state.phase === "idle" &&
      current.ownerKey === pending.ownerKey &&
      current.readPrompt() !== pending.prompt
    ) {
      current.submit(pending.submission);
    }
  }, [runtime, state]);

  const canRecord = availability.canReview || availability.canSend;
  const start = useStableCallback(() => {
    if (!canRecord) return;
    // The start cue plays after the microphone opens, outside this gesture.
    void unlock();
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
      await controller.send((uri, handOff) => sendVoice(readVoiceRecording(uri), handOff));
      return;
    }
    if (!availability.canReview) return;
    const { ownerKey, readPrompt } = runtime.read();
    submitAfterReview.current = { ownerKey, prompt: readPrompt(), submission };
    await controller.stop();
  });
  const finish = useStableCallback(() => {
    if (availability.canReview) stop();
    else void send();
  });
  // Letting go while the microphone still opens, as at the permission prompt, keeps it recording.
  const finishHeld = useStableCallback(() => {
    if (controller.currentState.phase === "recording") finish();
  });
  /** `press` is the key that toggled, so holding it records until it comes up. */
  const toggle = useStableCallback((press?: { readonly code: string }) => {
    switch (controller.currentState.phase) {
      case "idle":
      case "error":
        start();
        if (press) runtime.followKeyPress(press.code, { onHeldRelease: finishHeld });
        return;
      case "preparing":
        cancel();
        return;
      case "recording":
        finish();
        return;
      case "transcribing":
      case "sending":
        return;
    }
  });
  useHoldToTalk(options.holdToTalkTarget, options.holdToTalkKey, {
    canStart: () => {
      const { phase } = controller.currentState;
      return canRecord && (phase === "idle" || phase === "error");
    },
    readDraft: () => {
      const { readPrompt, readSelection } = runtime.read();
      return { text: readPrompt(), selection: readSelection() };
    },
    restoreDraft: (draft) => runtime.read().commitPrompt(draft.text, draft.selection),
    opening: () => controller.currentState.phase === "preparing",
    start,
    finish: finishHeld,
    cancel,
    followPress: runtime.followKeyPress,
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
