import { RegistryContext, useAtomMount, useAtomValue } from "@effect/atom-react";
import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from "expo-audio";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import { AsyncResult, Atom } from "effect/reactivity";
import { useSharedValue } from "react-native-reanimated";

import { uuidv4 } from "../../lib/uuid";
import {
  microphoneOrder,
  preferredMicrophoneInput,
  rememberMicrophones,
} from "../../lib/microphonePriority";
import { createPcmVoiceRecorder } from "../../native/pcmVoiceRecorder";
import { getLocalVoiceTranscriber } from "../../native/voiceTranscription";
import { dictationReachableAtom, readDictationReachable } from "../../state/dictation";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  VOICE_RECORDING_LIMIT_SECONDS,
  voiceInputBlocksSubmission,
  VoiceInputSession,
  type VoiceInputState,
  type VoiceInputTarget,
} from "@supaterm/client-runtime/voice-input";
import {
  createLazyVoiceRecorder,
  type VoiceRecordingInput,
  type VoiceRecordingStatusEvent,
} from "./lazyVoiceRecorder";
import { PendingVoiceRecordingsCoordinator } from "./PendingVoiceRecordingsCoordinator";
import { parkPendingVoiceRecording } from "./pendingVoiceRecordings";
import { createServerVoiceTranscriber } from "./serverVoiceTranscriber";
import { normalizeVoiceInputDecibels, VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";
import { createVoiceRecorderSet } from "./voiceRecorderSet";
import { DEVICE_RECORDING_FORMAT, type VoiceEnvironmentRoute, type VoiceRoute } from "./voiceRoute";

const INITIAL_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };
const VOICE_METERING_INTERVAL_MS = 80;
// The native constructor takes platform-flattened options, as `useAudioRecorder`
// builds them with expo-audio's internal `createRecordingOptions`.
const { ios: IOS_RECORDING_OPTIONS, android: ANDROID_RECORDING_OPTIONS } =
  RecordingPresets.HIGH_QUALITY;
const AAC_RECORDING_OPTIONS = {
  extension: RecordingPresets.HIGH_QUALITY.extension,
  sampleRate: RecordingPresets.HIGH_QUALITY.sampleRate,
  numberOfChannels: RecordingPresets.HIGH_QUALITY.numberOfChannels,
  bitRate: RecordingPresets.HIGH_QUALITY.bitRate,
  isMeteringEnabled: true,
  ...(Platform.OS === "ios" ? IOS_RECORDING_OPTIONS : ANDROID_RECORDING_OPTIONS),
};
// The WAV layout the Claude source reads: 16 kHz mono 16-bit little-endian PCM.
const IOS_PCM_RECORDING_OPTIONS = {
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

type ActiveVoiceRoute = Extract<VoiceRoute, { readonly kind: "device" | "available" }>;

const DEVICE_ROUTE_SUBMITS_ATOM = Atom.make(true).pipe(
  Atom.withLabel("mobile:voice-input:device-route"),
);

async function releaseVoiceRecordingAudio(): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording: false });
  } finally {
    // Expo does not deactivate AVAudioSession when recording stops or its
    // category changes. Explicit deactivation resumes interrupted app audio.
    await setIsAudioActiveAsync(false);
  }
}

async function configureVoiceRecordingAudio(): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    });
    await setIsAudioActiveAsync(true);
  } catch (error) {
    try {
      await releaseVoiceRecordingAudio();
    } catch {}
    throw error;
  }
}

function deleteRecording(uri: string): void {
  new File(uri).delete();
}

const VoiceInputContext = createContext<ReturnType<typeof useVoiceInputRuntime> | null>(null);

export function VoiceInputProvider({ children }: { readonly children: ReactNode }) {
  const runtime = useVoiceInputRuntime();
  return (
    <VoiceInputContext value={runtime}>
      <PendingVoiceRecordingsCoordinator />
      {children}
    </VoiceInputContext>
  );
}

export function useGlobalVoiceInput() {
  const context = use(VoiceInputContext);
  if (!context) throw new Error("Voice input provider is missing.");
  return context;
}

function useVoiceInputRuntime() {
  const registry = use(RegistryContext);
  useAtomMount(mobilePreferencesAtom);
  useAtomMount(updateMobilePreferencesAtom);
  const [{ state, ownerKey, label, route }, setState] = useState({
    state: INITIAL_STATE,
    ownerKey: null as string | null,
    label: null as string | null,
    route: null as ActiveVoiceRoute | null,
  });
  const [focusedOwners, setFocusedOwners] = useState<ReadonlySet<string>>(new Set());
  const setOwnerFocused = useCallback((key: string, focused: boolean) => {
    setFocusedOwners((current) => {
      const next = new Set(current);
      if (focused) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const keepAwakeId = useId();
  const keepAwakeSessionRef = useRef(0);
  const elapsedSecondsRef = useRef(0);
  const [initialAudioLevels] = useState(() => Array<number>(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0));
  const audioLevelsRef = useRef(initialAudioLevels);
  const audioLevels = useSharedValue(initialAudioLevels);
  const [runtime] = useState(() => {
    let activeRoute: ActiveVoiceRoute | null = null;
    let resolveRoute: (() => VoiceRoute) | null = null;
    let durationMs = 0;
    // Android pauses the activity, reported as `background`, while its permission dialog is up.
    let requestingPermission = false;
    const onStatus = (status: VoiceRecordingStatusEvent) => {
      void session.controller.handleRecorderStatus({
        isFinished: status.isFinished,
        hasError: status.hasError || status.mediaServicesDidReset === true,
        error: status.error,
        url: status.url,
      });
    };
    // Read when recording starts so preference changes do not re-render every composer.
    const selectInput = (inputs: ReadonlyArray<VoiceRecordingInput>) => {
      const preferences = registry.get(mobilePreferencesAtom);
      if (!AsyncResult.isSuccess(preferences)) return null;
      const known = microphoneOrder(preferences.value.microphones);
      const order = rememberMicrophones(known, inputs);
      if (order !== known) {
        registry.set(updateMobilePreferencesAtom, {
          transform: (current) => ({
            microphones: rememberMicrophones(microphoneOrder(current.microphones), inputs),
          }),
        });
      }
      return preferredMicrophoneInput(inputs, order);
    };
    const inputSelection = Platform.OS === "ios" ? { selectInput } : {};
    const createPcm =
      Platform.OS === "ios"
        ? () => new AudioModule.AudioRecorder(IOS_PCM_RECORDING_OPTIONS)
        : createPcmVoiceRecorder;
    const recorder = createVoiceRecorderSet({
      aac: createLazyVoiceRecorder({
        create: () => new AudioModule.AudioRecorder(AAC_RECORDING_OPTIONS),
        onStatus,
        ...inputSelection,
      }),
      pcm: createPcm
        ? createLazyVoiceRecorder({ create: createPcm, onStatus, ...inputSelection })
        : null,
    });
    let phase = INITIAL_STATE.phase;
    const session: VoiceInputSession = new VoiceInputSession({
      recorder,
      getTranscriber: () => {
        if (activeRoute === null) return null;
        return activeRoute.kind === "device"
          ? getLocalVoiceTranscriber()
          : createServerVoiceTranscriber({ route: activeRoute, readDurationMs: () => durationMs });
      },
      requestPermission: async () => {
        requestingPermission = true;
        try {
          const permission = await requestRecordingPermissionsAsync();
          return { granted: permission.granted, canAskAgain: permission.canAskAgain };
        } finally {
          requestingPermission = false;
        }
      },
      configureRecording: configureVoiceRecordingAudio,
      releaseRecording: releaseVoiceRecordingAudio,
      deleteRecording,
      describeRecording: () => ({
        mimeType:
          activeRoute?.kind === "available"
            ? activeRoute.format.mimeType
            : DEVICE_RECORDING_FORMAT.mimeType,
        durationMs,
      }),
      onStateChange: (nextState) => {
        // The audio session is released before transcription, so iOS plays this.
        if (phase === "transcribing" && nextState.phase === "idle") {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        if (nextState.phase === "preparing") durationMs = 0;
        phase = nextState.phase;
        setState({
          state: nextState,
          ownerKey: session.ownerKey,
          label: session.label,
          route: activeRoute,
        });
      },
    });

    // The route and recording format are frozen when a recording starts.
    const applyRoute = (next: VoiceRoute): boolean => {
      if (next.kind !== "device" && next.kind !== "available") return false;
      const encoding =
        next.kind === "device" ? DEVICE_RECORDING_FORMAT.encoding : next.format.encoding;
      if (!recorder.use(encoding)) return false;
      activeRoute = next;
      return true;
    };

    const keepRecording = async (environmentRoute: VoiceEnvironmentRoute) => {
      const handoff = await session.controller.takeRecording();
      if (!handoff) return;
      try {
        await parkPendingVoiceRecording({
          id: uuidv4(),
          uri: handoff.uri,
          ownerKey: handoff.capturedDraft.ownerKey,
          environmentId: environmentRoute.environmentId,
          sourceId: environmentRoute.source.id,
          format: environmentRoute.format,
          durationMs: handoff.durationMs,
          locale: handoff.locale,
          capturedDraft: handoff.capturedDraft,
          state: { status: "waiting" },
        });
      } catch (error) {
        console.warn("[voice-input] could not keep a recording", error);
        try {
          deleteRecording(handoff.uri);
        } catch {}
      }
    };

    return {
      session,
      recorder,
      recordDuration: (next: number) => {
        durationMs = Math.max(durationMs, next);
      },
      start: (target: VoiceInputTarget, resolve: () => VoiceRoute): Promise<void> => {
        if (voiceInputBlocksSubmission(session.controller.currentState)) return Promise.resolve();
        if (!applyRoute(resolve())) return Promise.resolve();
        resolveRoute = resolve;
        return session.start(target);
      },
      retry: (): Promise<void> => {
        if (resolveRoute === null || !applyRoute(resolveRoute())) return Promise.resolve();
        return session.retry();
      },
      canSubmitTranscript: (): boolean =>
        activeRoute?.kind === "device" ||
        (activeRoute?.kind === "available" && readDictationReachable(activeRoute.environmentId)),
      appMovedToBackground: () => {
        if (requestingPermission) return;
        const environmentRoute = activeRoute?.kind === "available" ? activeRoute : null;
        if (session.controller.currentState.phase !== "recording" || activeRoute === null) {
          void session.controller.appMovedToBackground();
          return;
        }
        // Keep what was said: a server recording waits to transcribe on return, and an
        // on-device one finishes now.
        if (environmentRoute) void keepRecording(environmentRoute);
        else void session.controller.stop();
      },
    };
  });
  const { session, recorder, recordDuration } = runtime;
  const controller = session.controller;
  const submitsTranscript = useAtomValue(
    route?.kind === "available"
      ? dictationReachableAtom(route.environmentId)
      : DEVICE_ROUTE_SUBMITS_ATOM,
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      // iOS reports `inactive` while its permission dialog is open. Only the
      // real background state cancels preparation; recorder status handles
      // calls and route interruptions during capture.
      if (nextState === "background") runtime.appMovedToBackground();
    });
    return () => subscription.remove();
  }, [runtime]);

  useEffect(
    () => () => {
      controller.dispose();
      recorder.release();
    },
    [controller, recorder],
  );

  useEffect(() => {
    if (state.phase !== "recording") return;

    const tag = `voice-input:${keepAwakeId}:${++keepAwakeSessionRef.current}`;
    const activation = activateKeepAwakeAsync(tag);
    void activation.catch(() => {});
    return () => {
      // Release after activation settles, even if the recording ends immediately.
      void activation.then(() => deactivateKeepAwake(tag)).catch(() => {});
    };
  }, [keepAwakeId, state.phase]);

  useEffect(() => {
    if (state.phase !== "preparing" && state.phase !== "recording") return;

    if (audioLevelsRef.current.some((level) => level !== 0)) {
      audioLevelsRef.current = Array<number>(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0);
      audioLevels.set(audioLevelsRef.current);
    }
    if (elapsedSecondsRef.current !== 0) {
      elapsedSecondsRef.current = 0;
      setElapsedSeconds(0);
    }
    if (state.phase !== "recording") return;

    const sampleRecording = () => {
      if (controller.currentState.phase !== "recording") return;
      const status = recorder.getStatus();
      if (!status?.isRecording) return;
      recordDuration(status.durationMillis);

      const level = normalizeVoiceInputDecibels(status.metering);
      const history = audioLevelsRef.current;
      if (level !== 0 || history.some((sample) => sample !== 0)) {
        const nextLevels = [...history.slice(1), level];
        audioLevelsRef.current = nextLevels;
        audioLevels.set(nextLevels);
      }

      const nextElapsedSeconds = Math.min(
        VOICE_RECORDING_LIMIT_SECONDS,
        Math.max(0, Math.floor(status.durationMillis / 1_000)),
      );
      if (nextElapsedSeconds !== elapsedSecondsRef.current) {
        elapsedSecondsRef.current = nextElapsedSeconds;
        setElapsedSeconds(nextElapsedSeconds);
      }
    };

    sampleRecording();
    const intervalId = setInterval(sampleRecording, VOICE_METERING_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [audioLevels, controller, recordDuration, recorder, state.phase]);

  const stop = useCallback(() => controller.stop(), [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);

  return {
    canRetry: route !== null,
    state,
    audioLevels,
    elapsedSeconds,
    isBusy: voiceInputBlocksSubmission(state),
    ownerKey,
    label,
    focusedOwners,
    setOwnerFocused,
    session,
    start: runtime.start,
    retry: runtime.retry,
    canSubmitTranscript: runtime.canSubmitTranscript,
    submitsTranscript,
    stop,
    cancel,
  };
}
