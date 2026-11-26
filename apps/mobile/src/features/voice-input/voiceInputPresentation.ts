import type { VoiceInputState } from "@supaterm/client-runtime/voice-input";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../i18n/messages";

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
  resolve: MessageResolver = m,
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
        statusLabel: resolve(msg("Preparing", { $context: "voice input status" })),
        confirmationEnabled: false,
      };
    case "recording": {
      const seconds = Math.max(0, Math.floor(elapsedSeconds));
      return {
        leadingAction: "stop",
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: resolve(
          msg("Recording {time}", {
            time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
          }),
        ),
        confirmationEnabled: true,
      };
    }
    case "transcribing":
      return {
        leadingAction: "cancel",
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: resolve(msg("Transcribing", { $context: "voice input status" })),
        confirmationEnabled: false,
      };
    case "sending":
      return {
        leadingAction: null,
        trailingAction: "confirm",
        showsSend: false,
        statusKind: "active",
        statusLabel: resolve(msg("Saving", { $context: "voice input status" })),
        confirmationEnabled: false,
      };
  }
}
