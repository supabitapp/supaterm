import { useAtomValue } from "@effect/atom-react";
import { requestRecordingPermissionsAsync } from "expo-audio";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { Atom } from "effect/reactivity";
import { makeMutable } from "react-native-reanimated";

import { preferredMicrophoneInput } from "../../lib/microphonePriority";
import { createPcmVoiceRecorder } from "../../native/pcmVoiceRecorder";
import { getNativeShowcaseScene } from "../showcase/nativeShowcaseScene";
import {
  voiceInputBlocksSubmission,
  voiceInputCue,
  type VoiceInputCue,
} from "@supaterm/client-runtime/voice-input";
import { createDevFakeVoiceRecorder, devFakeMicrophoneSource } from "./devFakeVoiceRecorder";
import { createLazyVoiceRecorder, type VoiceRecordingStatusEvent } from "./lazyVoiceRecorder";
import { VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";
import { playVoiceInputCue } from "./voiceInputCues";
import { VoiceInputSession } from "./voiceInputSession";
import {
  acquireAudioSession,
  activateAudioSession,
  releaseAudioSession,
} from "../../lib/audioSession";

function keepScreenAwake(tag: string): () => void {
  const activation = activateKeepAwakeAsync(tag);
  void activation.catch(() => {});
  // Release after activation settles, even if the recording ends immediately.
  return () => void activation.then(() => deactivateKeepAwake(tag)).catch(() => {});
}

/**
 * The app has one microphone and one dictation at a time, so the session
 * lives for the registry's lifetime rather than any screen's.
 */
const voiceInputAtom = Atom.make((get) => {
  const audioLevels = makeMutable<ReadonlyArray<number>>(
    Array<number>(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0),
  );
  let keepAwakeSequence = 0;
  let audioToken: ReturnType<typeof acquireAudioSession> | null = null;
  let cueAfterRecording: VoiceInputCue | null = null;
  const recorder = createLazyVoiceRecorder({
    create: () => {
      const fakeMicrophone = devFakeMicrophoneSource();
      if (fakeMicrophone) return createDevFakeVoiceRecorder(fakeMicrophone);
      if (!createPcmVoiceRecorder) throw new Error("This device can't record voice input.");
      return createPcmVoiceRecorder();
    },
    onStatus: (status: VoiceRecordingStatusEvent) => {
      session.controller.handleRecorderStatus(status);
    },
    selectInput: preferredMicrophoneInput,
  });
  const session: VoiceInputSession = new VoiceInputSession({
    recorder,
    requestPermission: async () => {
      const permission = await requestRecordingPermissionsAsync();
      return { granted: permission.granted, canAskAgain: permission.canAskAgain };
    },
    configureRecording: async () => {
      const token = acquireAudioSession("recording");
      audioToken = token;
      try {
        await activateAudioSession(token);
      } catch (error) {
        audioToken = null;
        await releaseAudioSession(token).catch(() => {});
        throw error;
      }
    },
    releaseRecording: async () => {
      if (audioToken) {
        const cue = cueAfterRecording;
        cueAfterRecording = null;
        await playVoiceInputCue(cue, audioToken);
        await releaseAudioSession(audioToken);
      }
      audioToken = null;
    },
    deleteRecording: (uri) => new File(uri).delete(),
    sampleRecording: () => {
      const status = recorder.getStatus();
      return status?.isRecording
        ? { durationMillis: status.durationMillis, metering: status.metering }
        : null;
    },
    publishAudioLevels: (levels) => audioLevels.set(levels),
    keepAwake: () => keepScreenAwake(`voice-input:${++keepAwakeSequence}`),
  });
  // iOS reports `inactive` while its permission dialog is open. Only the real
  // background state cancels preparation; recorder status handles calls and
  // route interruptions during capture.
  const appStateSubscription = AppState.addEventListener("change", (nextState) => {
    if (nextState === "background") void session.controller.appMovedToBackground();
  });
  let phase = session.getSnapshot().state.phase;
  const finishSubscription = session.subscribe(() => {
    const next = session.getSnapshot().state.phase;
    // The audio session is released before transcription, so iOS plays this.
    if ((phase === "transcribing" || phase === "sending") && next === "idle") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const cue = voiceInputCue(phase, next);
    if (cue === "start" && audioToken) void playVoiceInputCue(cue, audioToken);
    else if (cue && audioToken) cueAfterRecording = cue;
    phase = next;
  });
  get.addFinalizer(() => {
    finishSubscription();
    appStateSubscription.remove();
    session.dispose();
    recorder.release();
  });
  return { session, audioLevels, subscribeFrames: recorder.subscribeFrames };
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:voice-input"));

export function useGlobalVoiceInput() {
  const { session, audioLevels, subscribeFrames } = useAtomValue(voiceInputAtom);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return {
    ...snapshot,
    isAvailable: createPcmVoiceRecorder !== null || getNativeShowcaseScene() !== null,
    audioLevels,
    subscribeFrames,
    isBusy: voiceInputBlocksSubmission(snapshot.state),
    session,
    stop: () => session.controller.stop(),
    cancel: () => session.controller.cancel(),
  };
}
