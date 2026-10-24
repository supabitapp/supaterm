import type { SavedRecordingEntry, VoiceInputState } from "@supaterm/client-runtime/voice-input";

export type VoiceComposerPresentation = {
  readonly leadingAction: "cancel" | "stop" | null;
  readonly trailingAction: "mic" | "confirm";
  readonly showsSend: boolean;
  readonly statusKind: "active" | "error" | null;
  readonly statusLabel: string | null;
  readonly confirmationEnabled: boolean;
};

export function resolveVoiceComposerPresentation(
  state: VoiceInputState,
  elapsedSeconds: number,
): VoiceComposerPresentation {
  switch (state.phase) {
    case "idle":
      return {
        leadingAction: null,
        trailingAction: "mic",
        showsSend: true,
        statusKind: null,
        statusLabel: null,
        confirmationEnabled: false,
      };
    case "error":
      return {
        leadingAction: null,
        trailingAction: "mic",
        showsSend: true,
        statusKind: "error",
        statusLabel: state.error,
        confirmationEnabled: false,
      };
    case "preparing":
      return {
        leadingAction: "cancel",
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: "Preparing",
        confirmationEnabled: false,
      };
    case "recording": {
      const seconds = Math.max(0, Math.floor(elapsedSeconds));
      return {
        leadingAction: "stop",
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: `Recording ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
        confirmationEnabled: true,
      };
    }
    case "transcribing":
      return {
        leadingAction: "cancel",
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: "Transcribing",
        confirmationEnabled: false,
      };
  }
}

type SavedRecordingState = Pick<SavedRecordingEntry, "status" | "error" | "persisted">;

export function voiceRecordingStatus(recording: SavedRecordingState, reachable: boolean): string {
  switch (recording.status) {
    case "transcribing":
      return "Transcribing…";
    case "ready":
      return "Transcript ready";
    case "failed":
      return recording.error ?? "Could not transcribe this recording.";
    case "waiting":
      if (!recording.persisted) return "Not saved on this device";
      if (!reachable) return "Saved — transcribes when connected";
      return recording.error ?? "Waiting to transcribe";
  }
}

export function voiceRecordingRetry(
  recording: Pick<SavedRecordingEntry, "status">,
  reachable: boolean,
): "enabled" | "disabled" | null {
  if (recording.status === "failed") return "enabled";
  if (recording.status !== "waiting") return null;
  return reachable ? "enabled" : "disabled";
}

export function formatVoiceRecordingDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
