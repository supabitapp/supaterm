export {
  resolveTranscriptCommit,
  VoiceInputController,
  VOICE_RECORDING_LIMIT_SECONDS,
  voiceInputBlocksSubmission,
  voiceInputFreezesEditor,
  type VoiceDraftSnapshot,
  type VoiceInputControllerDependencies,
  type VoiceInputPhase,
  type VoiceInputState,
  type VoiceRecorder,
  type VoiceRecorderStatus,
  type VoiceRecordingDescription,
  type VoiceRecordingHandoff,
} from "./controller.ts";
export { createVoiceInputTarget, VoiceInputSession, type VoiceInputTarget } from "./session.ts";
export { resolveParkedInsertion, type ParkedInsertion } from "./clips.ts";
export { extractVoiceSlot, placeVoiceSlot, spliceTranscriptAt, VOICE_SLOT } from "./voiceSlot.ts";
export {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type PreparedVoiceTranscription,
  type VoiceTranscribeOptions,
  type VoiceTranscriber,
  type VoiceTranscriptionErrorCode,
  type VoiceTranscriptionOptions,
} from "./transcription.ts";
