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

type StopIntent = {
  readonly outcome: "submit" | "review";
  readonly ownerKey: string;
  committed: { readonly text: string; readonly selection: ComposerEditorSelection } | null;
};

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
  /** A stop for review committed the transcript into the draft. */
  readonly onReviewTranscript?: () => void;
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
  const stopIntent = useRef<StopIntent | null>(null);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- tracks mount so async transcription results skip a composer that has unmounted
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopIntent.current = null;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const ownerKey = input.ownerKey;
      if (!ownerKey) return;
      session.setOwnerFocused(ownerKey, true);
      return () => {
        stopIntent.current = null;
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
    stopIntent.current = null;
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
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- once the voice session leaves its busy phase, hands the committed transcript to review or submits it while the draft still holds it
  useEffect(() => {
    if (isBusy) return;
    const intent = stopIntent.current;
    stopIntent.current = null;
    const current = latestInput.current;
    if (state.phase !== "idle" || !intent?.committed || intent.ownerKey !== current.ownerKey) {
      return;
    }
    const { committed } = intent;
    if (intent.outcome === "review") {
      current.onChangeSelection(committed.selection);
      current.onReviewTranscript?.();
    } else if (!current.disabled && current.readDraftMessage() === committed.text) {
      current.onSubmit?.();
    }
  }, [isBusy, state.phase]);

  const stopWithIntent = useCallback(
    (outcome: StopIntent["outcome"]) => {
      const ownerKey = latestInput.current.ownerKey;
      if (
        !ownerKey ||
        session.ownerKey !== ownerKey ||
        session.controller.currentState.phase !== "recording"
      )
        return;
      const intent: StopIntent = { outcome, ownerKey, committed: null };
      stopIntent.current = intent;
      void session.stop((text, selection) => {
        if (stopIntent.current === intent) intent.committed = { text, selection };
      });
    },
    [session],
  );

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
      stopIntent.current = null;
      void session.send((uri, handOff) => voiceMessage.send(uri, engine.language, handOff));
      return;
    }
    if (current.onSubmit) stopWithIntent("submit");
  }, [session, stopWithIntent]);
  const stop = useCallback(() => stopWithIntent("review"), [stopWithIntent]);
  return {
    isAvailable: global.isAvailable && (!global.isBusy || global.ownerKey === input.ownerKey),
    state,
    audioLevels: global.audioLevels,
    elapsedSeconds: global.elapsedSeconds,
    isBusy,
    freezesEditor: isBusy,
    blocksSubmission: isBusy,
    start,
    stop,
    stopAndSubmit,
    cancel: global.cancel,
  };
}
