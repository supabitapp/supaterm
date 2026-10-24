import { describe, expect, it } from "vite-plus/test";
import { voiceInputFreezesEditor } from "@supaterm/client-runtime/voice-input";

import {
  resolveVoiceComposerPresentation,
  voiceRecordingRetry,
  voiceRecordingStatus,
} from "./voiceInputPresentation";

describe("resolveVoiceComposerPresentation", () => {
  it("maps voice states to stable composer actions and editor read-only state", () => {
    expect(
      resolveVoiceComposerPresentation({ phase: "idle", error: null, errorAction: null }, 0),
    ).toEqual({
      leadingAction: null,
      trailingAction: "mic",
      showsSend: true,
      statusKind: null,
      statusLabel: null,
      confirmationEnabled: false,
    });
    expect(
      resolveVoiceComposerPresentation({ phase: "preparing", error: null, errorAction: null }, 0),
    ).toMatchObject({
      leadingAction: "cancel",
      trailingAction: "confirm",
      showsSend: false,
      statusLabel: "Preparing",
      confirmationEnabled: false,
    });
    expect(
      resolveVoiceComposerPresentation({ phase: "recording", error: null, errorAction: null }, 64),
    ).toMatchObject({
      leadingAction: "stop",
      trailingAction: "confirm",
      showsSend: false,
      statusLabel: "Recording 1:04",
      confirmationEnabled: true,
    });
    expect(
      resolveVoiceComposerPresentation(
        { phase: "transcribing", error: null, errorAction: null },
        0,
      ),
    ).toMatchObject({
      statusLabel: "Transcribing",
      confirmationEnabled: false,
    });
    expect(
      resolveVoiceComposerPresentation(
        { phase: "error", error: "Microphone unavailable", errorAction: "retry" },
        0,
      ),
    ).toMatchObject({
      leadingAction: null,
      trailingAction: "mic",
      showsSend: true,
      statusKind: "error",
      statusLabel: "Microphone unavailable",
    });

    expect(voiceInputFreezesEditor({ phase: "preparing", error: null, errorAction: null })).toBe(
      true,
    );
    expect(voiceInputFreezesEditor({ phase: "recording", error: null, errorAction: null })).toBe(
      true,
    );
    expect(voiceInputFreezesEditor({ phase: "transcribing", error: null, errorAction: null })).toBe(
      true,
    );
    expect(voiceInputFreezesEditor({ phase: "idle", error: null, errorAction: null })).toBe(false);
  });
});

describe("saved recording presentation", () => {
  const waiting = { status: "waiting", error: null, persisted: true } as const;

  it("explains a saved recording while its environment is unreachable", () => {
    const saved = { ...waiting, error: "Recording upload disconnected." };
    expect(voiceRecordingStatus(saved, false)).toBe("Saved — transcribes when connected");
    expect(voiceRecordingStatus(saved, true)).toBe("Recording upload disconnected.");
    expect(voiceRecordingRetry(saved, false)).toBe("disabled");
    expect(voiceRecordingRetry(saved, true)).toBe("enabled");
  });

  it("never calls a recording saved when this device refused it", () => {
    const unsaved = { ...waiting, persisted: false };
    expect(voiceRecordingStatus(unsaved, false)).toBe("Not saved on this device");
    expect(voiceRecordingStatus(unsaved, true)).toBe("Not saved on this device");
  });

  it("offers retry for failures and nothing for a ready transcript", () => {
    expect(voiceRecordingRetry({ status: "failed" }, false)).toBe("enabled");
    expect(voiceRecordingRetry({ status: "ready" }, true)).toBeNull();
    expect(voiceRecordingRetry({ status: "transcribing" }, true)).toBeNull();
  });
});
