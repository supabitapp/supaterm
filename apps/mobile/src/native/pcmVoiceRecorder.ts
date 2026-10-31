import type {
  NativeVoiceRecorder,
  VoiceRecordingState,
  VoiceRecordingStatusEvent,
} from "../features/voice-input/lazyVoiceRecorder";

/** iOS records PCM through expo-audio; only Android ships a dedicated recorder. */
export const createPcmVoiceRecorder:
  | (() => NativeVoiceRecorder<VoiceRecordingStatusEvent, VoiceRecordingState>)
  | null = null;
