import { DictationClipFailure } from "@supaterm/client-runtime/state/dictation-failure";
import { DictationSourceId, EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  pendingVoiceRecordingAfterFailure,
  pendingVoiceRecordingRetry,
  pendingVoiceRecordingStatus,
  planPendingVoiceRecordingRuns,
  restoredPendingVoiceRecording,
  type PendingVoiceRecording,
} from "./pendingVoiceRecordingModel";

const ONLINE = EnvironmentId.make("online");
const OFFLINE = EnvironmentId.make("offline");

function recording(overrides: Partial<PendingVoiceRecording> = {}): PendingVoiceRecording {
  return {
    id: "recording-1",
    ownerKey: "draft",
    environmentId: ONLINE,
    sourceId: DictationSourceId.make("claude:me"),
    fileName: "recording-1.wav",
    mimeType: "audio/wav",
    durationMs: 4_000,
    locale: "en-US",
    createdAt: "2026-10-24T00:00:00.000Z",
    status: "waiting",
    transcript: null,
    error: null,
    attempts: 0,
    retryAt: 0,
    capturedDraft: null,
    ...overrides,
  };
}

describe("pendingVoiceRecordingAfterFailure", () => {
  it("waits with backoff after a transient failure", () => {
    const failure = new DictationClipFailure("transient", "Transcribes once connected.");
    expect(pendingVoiceRecordingAfterFailure({ attempts: 1 }, failure, 10_000)).toEqual({
      status: "waiting",
      error: "Transcribes once connected.",
      attempts: 2,
      retryAt: 12_000,
    });
  });

  it("keeps a terminal failure for an explicit retry", () => {
    const failure = new DictationClipFailure("terminal", "Sign in again.");
    expect(pendingVoiceRecordingAfterFailure({ attempts: 0 }, failure, 0)).toEqual({
      status: "failed",
      error: "Sign in again.",
    });
  });

  it("returns a cancelled attempt to waiting without counting it", () => {
    const failure = new DictationClipFailure("cancelled", "Transcription was cancelled.");
    expect(pendingVoiceRecordingAfterFailure({ attempts: 3 }, failure, 0)).toEqual({
      status: "waiting",
    });
  });
});

describe("planPendingVoiceRecordingRuns", () => {
  it("runs waiting recordings whose environment is reachable and whose backoff has passed", () => {
    const plan = planPendingVoiceRecordingRuns({
      recordings: [
        recording({ id: "due" }),
        recording({ id: "offline", environmentId: OFFLINE }),
        recording({ id: "later", retryAt: 5_000 }),
        recording({ id: "sooner", retryAt: 3_000 }),
        recording({ id: "running" }),
        recording({ id: "ready", status: "ready", transcript: "hi" }),
        recording({ id: "failed", status: "failed", error: "Sign in again." }),
      ],
      reachable: new Set([ONLINE]),
      isRunning: (id) => id === "running",
      now: 1_000,
    });
    expect(plan).toEqual({ due: ["due"], nextRetryAt: 3_000 });
  });
});

describe("restoredPendingVoiceRecording", () => {
  it("waits again after an interrupted attempt and never auto-inserts", () => {
    const { capturedDraft: _, ...stored } = recording({ status: "transcribing" });
    expect(restoredPendingVoiceRecording(stored)).toMatchObject({
      status: "waiting",
      capturedDraft: null,
    });
  });
});

describe("pending recording presentation", () => {
  it("explains a saved recording while its environment is unreachable", () => {
    const saved = recording({ error: "Recording upload disconnected." });
    expect(pendingVoiceRecordingStatus(saved, false)).toBe("Saved — transcribes when connected");
    expect(pendingVoiceRecordingStatus(saved, true)).toBe("Recording upload disconnected.");
    expect(pendingVoiceRecordingRetry(saved, false)).toBe("disabled");
    expect(pendingVoiceRecordingRetry(saved, true)).toBe("enabled");
  });

  it("offers retry for failures and nothing for a ready transcript", () => {
    expect(pendingVoiceRecordingRetry(recording({ status: "failed" }), false)).toBe("enabled");
    expect(pendingVoiceRecordingRetry(recording({ status: "ready" }), true)).toBeNull();
    expect(pendingVoiceRecordingRetry(recording({ status: "transcribing" }), true)).toBeNull();
  });
});
