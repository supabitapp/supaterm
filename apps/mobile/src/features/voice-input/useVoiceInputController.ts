import { useFocusEffect, useNavigation } from "@react-navigation/native";
import {
  resolveTranscriptCommit,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputState,
  type VoiceInputTarget,
} from "@supaterm/client-runtime/voice-input";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import type { ComposerEditorSelection } from "../../components/ComposerEditor";
import { readVoiceRoute, useVoiceRoute } from "../../state/dictation";
import { useGlobalVoiceInput } from "./VoiceInputProvider";
import { voiceInputLocale } from "./voiceInputLocale";
import {
  forgetVoiceSendIntents,
  intendToSendVoiceRecording,
  observeVoiceDraft,
  registerVoiceComposerTarget,
} from "./voiceComposerTargets";
import type { VoiceRoute } from "./voiceRoute";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

export type VoiceInputSetup = "needs-source" | "unavailable" | null;

function voiceInputSetup(route: VoiceRoute): VoiceInputSetup {
  return route.kind === "needs-source" || route.kind === "unavailable" ? route.kind : null;
}

export function useVoiceInputController(input: {
  readonly ownerKey: string | null;
  readonly label: string;
  /** The draft's environment; Automatic routing transcribes there. */
  readonly environmentId: EnvironmentId | null;
  readonly readDraftMessage: () => string | null;
  readonly subscribeToDraftChanges: (onChange: () => void) => () => void;
  readonly selection: ComposerEditorSelection;
  readonly disabled?: boolean;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly onChangeSelection: (selection: ComposerEditorSelection) => void;
  readonly onSubmit?: () => void;
}) {
  const global = useGlobalVoiceInput();
  const { canSubmitTranscript, setOwnerFocused, session, start: startSession } = global;
  const route = useVoiceRoute(input.environmentId);
  const navigation = useNavigation();
  const latestInput = useRef(input);
  useLayoutEffect(() => {
    latestInput.current = input;
  });
  const mounted = useRef(true);
  const [submitRequest, setSubmitRequest] = useState<{
    readonly ownerKey: string;
    readonly text: string;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const ownerKey = input.ownerKey;
  useEffect(() => {
    if (!ownerKey) return;
    const observe = () => {
      const current = latestInput.current;
      const text = current.ownerKey === ownerKey ? current.readDraftMessage() : null;
      if (text !== null) observeVoiceDraft(ownerKey, text);
    };
    observe();
    const unsubscribe = latestInput.current.subscribeToDraftChanges(observe);
    const unregister = registerVoiceComposerTarget(ownerKey, {
      readDraft: () => {
        const current = latestInput.current;
        const text = current.ownerKey === ownerKey ? current.readDraftMessage() : null;
        if (text === null) return null;
        const revision = observeVoiceDraft(ownerKey, text);
        return { ownerKey, text, selection: current.selection, revision };
      },
      commitDraft: (text, selection) => {
        const current = latestInput.current;
        if (
          current.ownerKey !== ownerKey ||
          current.disabled ||
          (session.ownerKey === ownerKey &&
            voiceInputBlocksSubmission(session.controller.currentState))
        ) {
          return false;
        }
        current.onChangeDraftMessage(text);
        current.onChangeSelection(selection);
        return true;
      },
      submit: (text) => setSubmitRequest({ ownerKey, text }),
    });
    return () => {
      unregister();
      unsubscribe();
      forgetVoiceSendIntents(ownerKey);
    };
  }, [ownerKey, session]);

  useFocusEffect(
    useCallback(() => {
      if (!ownerKey) return;
      setOwnerFocused(ownerKey, true);
      return () => {
        forgetVoiceSendIntents(ownerKey);
        setOwnerFocused(ownerKey, false);
      };
    }, [ownerKey, setOwnerFocused]),
  );

  const openSetup = useCallback(
    (setupRoute: Extract<VoiceRoute, { readonly kind: "needs-source" | "unavailable" }>) => {
      const open = () =>
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: {
            screen: "SettingsEnvironmentDetail",
            params: { environmentId: setupRoute.environmentId },
          },
        });
      if (setupRoute.kind === "needs-source") {
        open();
        return;
      }
      Dialog.alert(
        `${setupRoute.source.label} can't transcribe`,
        setupRoute.source.unavailableReason ?? "Choose another account in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: open },
        ],
      );
    },
    [navigation],
  );

  const start = useCallback(() => {
    const captured = latestInput.current;
    const capturedOwnerKey = captured.ownerKey;
    if (!capturedOwnerKey || captured.disabled) return;
    const resolveRoute = () => readVoiceRoute(captured.environmentId);
    const startRoute = resolveRoute();
    if (startRoute.kind === "needs-source" || startRoute.kind === "unavailable") {
      openSetup(startRoute);
      return;
    }
    if (startRoute.kind === "hidden") return;
    Keyboard.dismiss();
    // Played before the microphone opens; iOS mutes haptics while recording.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const selection = captured.selection;
    const target: VoiceInputTarget = {
      ownerKey: capturedOwnerKey,
      label: captured.label,
      readDraft: (): VoiceDraftSnapshot | null => {
        const text = captured.readDraftMessage();
        if (text === null) return null;
        const revision = observeVoiceDraft(capturedOwnerKey, text);
        return { ownerKey: capturedOwnerKey, text, selection, revision };
      },
      commitDraft: (text, nextSelection) => {
        captured.onChangeDraftMessage(text);
        if (mounted.current && latestInput.current.ownerKey === capturedOwnerKey) {
          latestInput.current.onChangeSelection(nextSelection);
        }
      },
      subscribe: () => () => undefined,
    };
    void startSession(target, resolveRoute);
  }, [openSetup, startSession]);

  const state = global.ownerKey === input.ownerKey ? global.state : IDLE_STATE;
  const isBusy = voiceInputBlocksSubmission(state);
  useEffect(() => {
    const current = latestInput.current;
    if (
      submitRequest &&
      submitRequest.ownerKey === current.ownerKey &&
      !current.disabled &&
      current.readDraftMessage() === submitRequest.text
    ) {
      current.onSubmit?.();
    }
  }, [submitRequest]);

  const stop = global.stop;
  const globalCancel = global.cancel;
  const cancel = useCallback(() => {
    const currentOwnerKey = latestInput.current.ownerKey;
    if (currentOwnerKey) forgetVoiceSendIntents(currentOwnerKey);
    globalCancel();
  }, [globalCancel]);
  const stopAndSubmit = useCallback(() => {
    const current = latestInput.current;
    const currentOwnerKey = current.ownerKey;
    if (
      !currentOwnerKey ||
      !current.onSubmit ||
      current.disabled ||
      session.ownerKey !== currentOwnerKey ||
      session.controller.currentState.phase !== "recording"
    )
      return;
    // An unreachable environment keeps the recording for review instead of sending later.
    if (!canSubmitTranscript()) {
      void stop();
      return;
    }
    // On-device transcripts land before stop resolves; saved recordings land when the runner
    // finishes them, through this composer's registered target.
    const intent = intendToSendVoiceRecording(currentOwnerKey);
    void session
      .stop((text) => {
        if (intent.take()) setSubmitRequest({ ownerKey: currentOwnerKey, text });
      })
      .then((outcome) => {
        if (outcome.kind === "saved") intent.bind(outcome.recordingId);
        else intent.take();
      });
  }, [canSubmitTranscript, session, stop]);

  const insertTranscript = useCallback((transcript: string): boolean => {
    const current = latestInput.current;
    const currentOwnerKey = current.ownerKey;
    const text = current.readDraftMessage();
    if (!currentOwnerKey || text === null || current.disabled) return false;
    const snapshot = { ownerKey: currentOwnerKey, text, selection: current.selection, revision: 0 };
    const result = resolveTranscriptCommit(snapshot, snapshot, transcript, voiceInputLocale());
    if (result.kind !== "commit") return false;
    current.onChangeDraftMessage(result.text);
    current.onChangeSelection(result.selection);
    return true;
  }, []);

  const ownsSession = global.ownerKey === input.ownerKey;
  return {
    isAvailable:
      (route.kind !== "hidden" || (ownsSession && state.phase !== "idle")) &&
      (!global.isBusy || ownsSession),
    setup: voiceInputSetup(route),
    state,
    audioLevels: global.audioLevels,
    elapsedSeconds: global.elapsedSeconds,
    isBusy,
    freezesEditor: isBusy,
    blocksSubmission: isBusy,
    submitsTranscript: !ownsSession || global.submitsTranscript,
    start,
    stop,
    stopAndSubmit,
    cancel,
    insertTranscript,
  };
}
