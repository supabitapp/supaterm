import type { LazyVoiceRecorder } from "./lazyVoiceRecorder";
import type { VoiceRecordingFormat } from "./voiceRoute";

/**
 * Presents one recorder to the voice controller while recordings switch between AAC and PCM.
 * Switch only between recordings: the controller reads `uri` from whichever recorder is active.
 */
export function createVoiceRecorderSet<TState>(recorders: {
  readonly aac: LazyVoiceRecorder<TState>;
  readonly pcm: LazyVoiceRecorder<TState> | null;
}) {
  let active = recorders.aac;
  return {
    use(encoding: VoiceRecordingFormat["encoding"]): boolean {
      const next = encoding === "pcm" ? recorders.pcm : recorders.aac;
      if (next === null) return false;
      active = next;
      return true;
    },
    get uri() {
      return active.uri;
    },
    prepareToRecordAsync: () => active.prepareToRecordAsync(),
    record: (options: { readonly forDuration: number }) => active.record(options),
    stop: () => active.stop(),
    getStatus: () => active.getStatus(),
    release() {
      recorders.aac.release();
      recorders.pcm?.release();
    },
  };
}
