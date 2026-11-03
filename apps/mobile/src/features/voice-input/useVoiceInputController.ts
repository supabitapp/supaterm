import { useFocusEffect } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Keyboard } from "react-native";
import {
  voiceInputBlocksSubmission,
  type VoiceInputState,
  type VoiceRecordingHandOff,
} from "@supaterm/client-runtime/voice-input";

import type { EnvironmentId } from "@supaterm/contracts";

import type { ComposerEditorSelection } from "../../components/ComposerEditor";
import * as Dialog from "../../components/ui/Dialog";
import { resolveComposerVoiceEngine, type VoiceTranscriptionContext } from "./composerVoiceEngine";
import { useGlobalVoiceInput } from "./VoiceInputProvider";
import { createVoiceInputTarget } from "./voiceInputSession";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

export function useVoiceInputController(input: {
  readonly ownerKey: string | null;
  readonly label: string;
  readonly readDraftMessage: () => string | null;
  readonly subscribeToDraftChanges: (onChange: () => void) => () => void;
  readonly selection: ComposerEditorSelection;
  readonly disabled?: boolean;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly onChangeSelection: (selection: ComposerEditorSelection) => void;
  readonly onSubmit?: () => void;
  /** A transcript landed in this focused composer's draft for review, not to be sent. */
  readonly onTranscriptInserted?: () => void;
  /** Whose environment transcribes. */
  readonly environmentId: EnvironmentId | null;
  readonly context?: VoiceTranscriptionContext;
  /**
   * Where sending a recording from an empty draft makes it the message itself, which the
   * environment transcribes and sends even when this device is offline.
   */
  readonly voiceMessage?: {
    readonly accepts: () => boolean;
    readonly send: (
      recordingUri: string,
      language: string,
      handOff: VoiceRecordingHandOff | undefined,
    ) => Promise<void>;
  };
}) {
  const global = useGlobalVoiceInput();
  const { session, subscribeFrames } = global;
  const latestInput = useRef(input);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- publishes the committed composer input to a ref read by async voice session callbacks
  useLayoutEffect(() => {
    latestInput.current = input;
  });
  const mounted = useRef(true);
  const submission = useRef<{ ownerKey: string; text: string } | null>(null);
  const insertedOwnerKey = useRef<string | null>(null);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- tracks mount so async transcription results skip a composer that has unmounted
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      submission.current = null;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const ownerKey = input.ownerKey;
      if (!ownerKey) return;
      session.setOwnerFocused(ownerKey, true);
      return () => {
        submission.current = null;
        session.setOwnerFocused(ownerKey, false);
      };
    }, [input.ownerKey, session]),
  );

  const start = useCallback(() => {
    const captured = latestInput.current;
    if (!captured.ownerKey || captured.disabled) return;
    const resolution = resolveComposerVoiceEngine({
      environmentId: captured.environmentId,
      ...(captured.context ? { context: captured.context } : {}),
      subscribeFrames,
    });
    if (resolution.status === "unavailable") {
      Dialog.alert("Voice input unavailable", resolution.message);
      return;
    }
    submission.current = null;
    Keyboard.dismiss();
    // Played before the microphone opens; iOS mutes haptics while recording.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void session.start({
      ...createVoiceInputTarget(
        captured.ownerKey,
        captured.readDraftMessage,
        (text, selection) => {
          captured.onChangeDraftMessage(text);
          if (mounted.current && latestInput.current.ownerKey === captured.ownerKey) {
            latestInput.current.onChangeSelection(selection);
            insertedOwnerKey.current = captured.ownerKey;
          }
        },
        captured.selection,
        captured.subscribeToDraftChanges,
      ),
      label: captured.label,
      engine: resolution.engine,
    });
  }, [session, subscribeFrames]);
  const state = global.ownerKey === input.ownerKey ? global.state : IDLE_STATE;
  const isBusy = voiceInputBlocksSubmission(state);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- once the voice session leaves its busy phase, submits a stop-and-send transcript or hands a review transcript to the editor
  useEffect(() => {
    if (isBusy) return;
    const pending = submission.current;
    submission.current = null;
    const inserted = insertedOwnerKey.current;
    insertedOwnerKey.current = null;
    const current = latestInput.current;
    if (state.phase !== "idle") return;
    if (
      pending?.text &&
      pending.ownerKey === current.ownerKey &&
      !current.disabled &&
      current.readDraftMessage() === pending.text
    ) {
      current.onSubmit?.();
    } else if (
      inserted !== null &&
      inserted === current.ownerKey &&
      session.getSnapshot().focusedOwners.has(inserted)
    ) {
      current.onTranscriptInserted?.();
    }
  }, [isBusy, state.phase, session]);

  const stopAndSubmit = useCallback(() => {
    const current = latestInput.current;
    if (
      !current.ownerKey ||
      current.disabled ||
      session.ownerKey !== current.ownerKey ||
      session.controller.currentState.phase !== "recording"
    )
      return;
    const { engine } = session;
    const { voiceMessage } = current;
    if (engine && voiceMessage?.accepts()) {
      submission.current = null;
      void session.send((uri, handOff) => voiceMessage.send(uri, engine.language, handOff));
      return;
    }
    if (!current.onSubmit) return;
    const pending = { ownerKey: current.ownerKey, text: "" };
    submission.current = pending;
    void session.stop((text) => {
      if (submission.current === pending) pending.text = text;
    });
  }, [session]);
  return {
    isAvailable: global.isAvailable && (!global.isBusy || global.ownerKey === input.ownerKey),
    state,
    audioLevels: global.audioLevels,
    elapsedSeconds: global.elapsedSeconds,
    isBusy,
    freezesEditor: isBusy,
    blocksSubmission: isBusy,
    start,
    stop: global.stop,
    stopAndSubmit,
    cancel: global.cancel,
  };
}
