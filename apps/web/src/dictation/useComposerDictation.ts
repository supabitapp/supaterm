import { useAtomValue } from "@effect/atom-react";
import type { DictationAvailability } from "@supaterm/client-runtime/state/dictation";
import {
  VoiceInputSession,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputState,
  type VoiceTranscriptEdit,
} from "@supaterm/client-runtime/voice-input";
import type { DictationSourceId, EnvironmentId, MessageId } from "@supaterm/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useState } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import { newMessageId } from "../lib/utils";
import { useDictationRoute } from "../state/dictation";
import { outboxRecordingOwnerKey, threadOutboxDeliverableAtom } from "../state/threadOutbox";
import { registerDictationComposer } from "./pendingClipRunner";
import { webRecordings } from "./pendingClips";
import { createServerVoiceTranscriber } from "./serverVoiceTranscriber";
import { WebVoiceRecorder, releaseRecording } from "./webVoiceRecorder";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

/** A saved recording that a queued message will be transcribed from before it is delivered. */
export interface ComposerVoiceMessage {
  readonly messageId: MessageId;
  readonly recordingId: string;
  readonly durationMs: number;
}

export interface ComposerDictationOptions {
  readonly ownerKey: string;
  readonly environmentId: EnvironmentId;
  readonly readPrompt: () => string;
  readonly readSelection: () => { readonly start: number; readonly end: number };
  readonly commitPrompt: (edit: VoiceTranscriptEdit) => boolean;

  readonly canSendVoice: boolean;

  readonly sendVoice: (message: ComposerVoiceMessage) => Promise<boolean>;
}

interface LatestDictationInput {
  readonly options: ComposerDictationOptions;
  readonly availability: DictationAvailability;
}

interface RecordingContext {
  readonly environmentId: EnvironmentId;
  readonly sourceId: DictationSourceId;
  ownerKey: string | null;
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
      const current = context;
      return current === null
        ? null
        : createServerVoiceTranscriber({ ...current, ownerKey: () => current.ownerKey });
    },
    requestPermission: () => recorder.requestPermission(),
    configureRecording: async () => undefined,
    releaseRecording: async () => recorder.release(),
    deleteRecording: releaseRecording,
    onStateChange: (state) => {
      if (state.phase === "idle" || state.phase === "error") recorder.releaseIfUnused();
      onStateChange(state);
    },
  });
  const target = () => ({
    ownerKey: read().options.ownerKey,
    readDraft,
    commitDraft: (
      _text: string,
      _selection: { readonly start: number; readonly end: number },
      edit: VoiceTranscriptEdit,
    ) => {
      read().options.commitPrompt(edit);
    },
    subscribe: () => () => undefined,
  });
  return {
    session,
    recorder,
    readDraft,
    read,
    context: () => context,
    setInput: (next: LatestDictationInput) => {
      input = next;
    },
    start: () => {
      const { availability } = read();
      if (availability.kind !== "available") return Promise.resolve();
      context = {
        environmentId: availability.environmentId,
        sourceId: availability.source.id,
        ownerKey: null,
      };
      return session.start(target());
    },
  };
}

export function useComposerDictation(options: ComposerDictationOptions) {
  const availability = useDictationRoute(options.environmentId);
  const connected = useAtomValue(
    threadOutboxDeliverableAtom(
      availability.kind === "hidden" ? options.environmentId : availability.environmentId,
    ),
  );
  const [state, setState] = useState(IDLE_STATE);
  const [runtime] = useState(() => createDictationRuntime(setState));
  const navigate = useNavigate();
  useLayoutEffect(() => {
    runtime.setInput({ options, availability });
    runtime.readDraft();
  });

  const ownerKey = options.ownerKey;
  useEffect(() => {
    const unregister = registerDictationComposer(ownerKey, {
      readDraft: () => (runtime.read().options.ownerKey === ownerKey ? runtime.readDraft() : null),
      commitDraft: (_text, _selection, edit) =>
        runtime.read().options.ownerKey === ownerKey &&
        !voiceInputBlocksSubmission(runtime.session.controller.currentState) &&
        runtime.read().options.commitPrompt(edit),
    });
    return unregister;
  }, [ownerKey, runtime]);
  // Stopping saves a recording that is still running, so leaving the composer keeps it.
  useEffect(
    () => () => {
      void runtime.session.stop().finally(() => runtime.session.controller.dispose());
    },
    [runtime],
  );

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
    runtime.session.controller.cancel();
  });
  const transcribeAndSend = useStableCallback(async () => {
    const context = runtime.context();
    if (runtime.session.controller.currentState.phase !== "recording" || context === null) return;
    if (!runtime.read().options.canSendVoice) {
      void runtime.session.stop();
      return;
    }
    const messageId = newMessageId();
    context.ownerKey = outboxRecordingOwnerKey(messageId);
    const outcome = await runtime.session.stop();
    if (outcome.kind !== "saved") return;
    const recording = webRecordings.get(outcome.recordingId);
    const { options } = runtime.read();
    const sent =
      recording !== null &&
      options.canSendVoice &&
      recording.capturedDraft?.text === runtime.readDraft().text &&
      (await options.sendVoice({
        messageId,
        recordingId: outcome.recordingId,
        durationMs: recording.durationMs,
      }));
    if (!sent) await webRecordings.update(outcome.recordingId, { ownerKey: options.ownerKey });
  });
  const openSetup = useStableCallback(() => {
    const current = runtime.read().availability;
    if (current.kind === "hidden") return;
    void navigate({
      to: "/settings/integrations",
      search: { machine: current.environmentId },
    });
  });
  const toggle = useStableCallback(() => {
    switch (runtime.session.controller.currentState.phase) {
      case "idle":
      case "error":
        if (runtime.read().availability.kind === "available") start();
        else openSetup();
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
    openSetup,
    toggle,
    transcribeAndSend,
  };
}

export type ComposerDictation = ReturnType<typeof useComposerDictation>;
