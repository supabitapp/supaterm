import { useAtomValue } from "@effect/atom-react";
import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { Atom } from "effect/reactivity";
import { makeMutable } from "react-native-reanimated";

import { preferredMicrophoneInput } from "../../lib/microphonePriority";
import { createPcmVoiceRecorder } from "../../native/pcmVoiceRecorder";
import { getNativeShowcaseScene } from "../showcase/nativeShowcaseScene";
import { voiceInputBlocksSubmission } from "@supaterm/client-runtime/voice-input";
import { createDevFakeVoiceRecorder, devFakeMicrophoneSource } from "./devFakeVoiceRecorder";
import {
  createLazyVoiceRecorder,
  type NativeVoiceRecorder,
  type VoiceRecordingState,
  type VoiceRecordingStatusEvent,
} from "./lazyVoiceRecorder";
import { VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";
import { VoiceInputSession } from "./voiceInputSession";
import {
  acquireAudioSession,
  activateAudioSession,
  releaseAudioSession,
} from "../../lib/audioSession";

// The format environments transcribe. The native constructor takes the platform-flattened
// options `useAudioRecorder` would build.
const IOS_VOICE_RECORDING_OPTIONS = {
  extension: ".wav",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 256_000,
  isMeteringEnabled: true,
  outputFormat: IOSOutputFormat.LINEARPCM,
  audioQuality: AudioQuality.HIGH,
  linearPCMBitDepth: 16,
  linearPCMIsBigEndian: false,
  linearPCMIsFloat: false,
};

const createNativeVoiceRecorder =
  Platform.OS === "ios"
    ? (): NativeVoiceRecorder<VoiceRecordingStatusEvent, VoiceRecordingState> =>
        new AudioModule.AudioRecorder(IOS_VOICE_RECORDING_OPTIONS)
    : createPcmVoiceRecorder;

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
  const recorder = createLazyVoiceRecorder({
    create: () => {
      const fakeMicrophone = devFakeMicrophoneSource();
      if (fakeMicrophone) return createDevFakeVoiceRecorder(fakeMicrophone);
      if (!createNativeVoiceRecorder) throw new Error("This device can't record voice input.");
      return createNativeVoiceRecorder();
    },
    onStatus: (status: VoiceRecordingStatusEvent) => {
      session.controller.handleRecorderStatus({
        isFinished: status.isFinished,
        hasError: status.hasError || status.mediaServicesDidReset === true,
        error: status.error,
        url: status.url,
      });
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
        await releaseAudioSession(token).catch(() => {});
        throw error;
      }
    },
    releaseRecording: async () => {
      if (audioToken) await releaseAudioSession(audioToken);
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
    phase = next;
  });
  get.addFinalizer(() => {
    finishSubscription();
    appStateSubscription.remove();
    session.dispose();
    recorder.release();
  });
  return { session, audioLevels };
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:voice-input"));

export function useGlobalVoiceInput() {
  const { session, audioLevels } = useAtomValue(voiceInputAtom);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return {
    ...snapshot,
    isAvailable: createNativeVoiceRecorder !== null || getNativeShowcaseScene() !== null,
    audioLevels,
    isBusy: voiceInputBlocksSubmission(snapshot.state),
    session,
    stop: () => session.controller.stop(),
    cancel: () => session.controller.cancel(),
  };
}
