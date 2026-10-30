import { useFocusEffect } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Keyboard } from "react-native";
import {
  voiceInputBlocksSubmission,
  type VoiceInputState,
} from "@supaterm/client-runtime/voice-input";

import type { ComposerEditorSelection } from "../../components/ComposerEditor";
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
}) {
  const global = useGlobalVoiceInput();
  const { setOwnerFocused, session } = global;
  const latestInput = useRef(input);
  useLayoutEffect(() => {
    latestInput.current = input;
  });
  const mounted = useRef(true);
  const submission = useRef<{ ownerKey: string; text: string } | null>(null);
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
      setOwnerFocused(ownerKey, true);
      return () => {
        submission.current = null;
        setOwnerFocused(ownerKey, false);
      };
    }, [input.ownerKey, setOwnerFocused]),
  );

  const start = useCallback(() => {
    const captured = latestInput.current;
    if (!captured.ownerKey || captured.disabled) return;
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
          }
        },
        captured.selection,
        captured.subscribeToDraftChanges,
      ),
      label: captured.label,
    });
  }, [session]);
  const state = global.ownerKey === input.ownerKey ? global.state : IDLE_STATE;
  const isBusy = voiceInputBlocksSubmission(state);
  useEffect(() => {
    if (isBusy) return;
    const pending = submission.current;
    submission.current = null;
    const current = latestInput.current;
    if (
      state.phase === "idle" &&
      pending?.text &&
      pending.ownerKey === current.ownerKey &&
      !current.disabled &&
      current.readDraftMessage() === pending.text
    ) {
      current.onSubmit?.();
    }
  }, [isBusy, state.phase]);

  const stopAndSubmit = useCallback(() => {
    const current = latestInput.current;
    if (
      !current.ownerKey ||
      !current.onSubmit ||
      current.disabled ||
      session.ownerKey !== current.ownerKey ||
      session.controller.currentState.phase !== "recording"
    )
      return;
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
