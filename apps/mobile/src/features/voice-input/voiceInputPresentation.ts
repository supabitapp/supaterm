import type { VoiceInputState } from "@supaterm/client-runtime/voice-input";

export type VoiceComposerPresentation = {
  readonly leadingAction: "cancel" | "stop" | null;
  readonly trailingAction: "mic" | "confirm";
  readonly showsSend: boolean;
  readonly statusKind: "active" | "error" | null;
  readonly statusLabel: string | null;
  readonly confirmationEnabled: boolean;
};

export function resolveVoiceComposerPresentation(state: VoiceInputState, elapsedSeconds: number) {
  switch (state.phase) {
    case "idle":
      return {
        leadingAction: null,
        trailingAction: "mic",
        showsSend: true,
        statusKind: null,
        statusLabel: null,
        confirmationEnabled: false,
      } satisfies VoiceComposerPresentation;
    case "error":
      return {
        leadingAction: null,
        trailingAction: "mic",
        showsSend: true,
        statusKind: "error",
        statusLabel: state.error,
        confirmationEnabled: false,
      } satisfies VoiceComposerPresentation;
    case "preparing":
      return {
        leadingAction: "cancel",
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: "Preparing",
        confirmationEnabled: false,
      } satisfies VoiceComposerPresentation;
    case "recording": {
      const seconds = Math.max(0, Math.floor(elapsedSeconds));
      return {
        leadingAction: "stop",
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: `Recording ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
        confirmationEnabled: true,
      } satisfies VoiceComposerPresentation;
    }
    case "transcribing":
      return {
        leadingAction: "cancel",
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: "Transcribing",
        confirmationEnabled: false,
      } satisfies VoiceComposerPresentation;
    case "sending":
      return {
        leadingAction: null,
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: "Saving",
        confirmationEnabled: false,
      } satisfies VoiceComposerPresentation;
  }
}
