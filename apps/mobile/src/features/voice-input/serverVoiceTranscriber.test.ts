import { DictationClipFailure } from "@supaterm/client-runtime/state/dictation-failure";
import type { VoiceDraftSnapshot } from "@supaterm/client-runtime/voice-input";
import {
  DictationSourceId,
  DictationUpstreamError,
  EnvironmentId,
  type DictationSourceDescriptor,
} from "@supaterm/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  reachable: true,
  park: vi.fn(async (_input: unknown) => undefined),
  transcribe: vi.fn(async (_input: unknown): Promise<{ text: string }> => ({ text: "" })),
}));

vi.mock("../../lib/uuid", () => ({ uuidv4: () => "recording-1" }));
vi.mock("../../state/dictation", () => ({ readDictationReachable: () => harness.reachable }));
vi.mock("./pendingVoiceRecordings", () => ({ parkPendingVoiceRecording: harness.park }));
vi.mock("./transcribeVoiceRecording", () => ({ transcribeVoiceRecording: harness.transcribe }));

import { createServerVoiceTranscriber } from "./serverVoiceTranscriber";
import { registerVoiceComposerTarget } from "./voiceComposerTargets";

const ENV = EnvironmentId.make("env");
const SOURCE: DictationSourceDescriptor = {
  id: DictationSourceId.make("claude:me"),
  kind: "claude",
  runsOn: "environment",
  label: "Claude",
  serviceLabel: "Claude",
  accountLabel: "me@example.com",
  eligible: true,
  audioFormats: ["wav"],
};
const CAPTURED: VoiceDraftSnapshot = {
  ownerKey: "draft",
  text: "Hello",
  selection: { start: 5, end: 5 },
  revision: 0,
};

let draft: VoiceDraftSnapshot;

async function transcribe() {
  const transcriber = createServerVoiceTranscriber({
    route: {
      kind: "available",
      environmentId: ENV,
      source: SOURCE,
      capability: { maxClipBytes: 20 * 1024 * 1024, maxDurationMs: 300_000 },
      format: { encoding: "pcm", extension: "wav", mimeType: "audio/wav" },
    },
    readDurationMs: () => 4_000,
  });
  const signal = new AbortController().signal;
  const prepared = await transcriber.prepare({ signal });
  return prepared.transcribe("file:///cache/recording.wav", { signal, capturedDraft: CAPTURED });
}

function parked() {
  return harness.park.mock.calls[0]?.[0] as { readonly id: string; readonly state: unknown };
}

beforeEach(() => {
  harness.reachable = true;
  harness.park.mockClear();
  harness.transcribe.mockReset();
  draft = CAPTURED;
  registerVoiceComposerTarget("draft", { readDraft: () => draft, commitDraft: () => true });
});

describe("createServerVoiceTranscriber", () => {
  it("returns the transcript for an unchanged draft", async () => {
    harness.transcribe.mockResolvedValue({ text: "world" });
    await expect(transcribe()).resolves.toBe("world");
    expect(harness.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "recording-1", extension: "wav", durationMs: 4_000 }),
    );
    expect(harness.park).not.toHaveBeenCalled();
  });

  it("saves the recording without uploading while the environment is unreachable", async () => {
    harness.reachable = false;
    await expect(transcribe()).rejects.toMatchObject({ code: "deferred" });
    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(parked()).toMatchObject({ id: "recording-1", state: { status: "waiting" } });
  });

  it("keeps a transcript for an edited draft instead of dropping it", async () => {
    harness.transcribe.mockResolvedValue({ text: " world " });
    draft = { ...CAPTURED, text: "Hello there", revision: 1 };
    await expect(transcribe()).rejects.toMatchObject({ code: "deferred" });
    expect(parked().state).toEqual({ status: "ready", transcript: "world" });
  });

  it("saves the recording under the same request id after a transient failure", async () => {
    harness.transcribe.mockRejectedValue(
      new DictationUpstreamError({ category: "network", status: null }),
    );
    await expect(transcribe()).rejects.toMatchObject({ code: "deferred" });
    expect(parked()).toMatchObject({
      id: "recording-1",
      state: { status: "waiting", attempts: 1, error: expect.any(String) },
    });
  });

  it("saves the recording for an explicit retry after a terminal failure", async () => {
    harness.transcribe.mockRejectedValue(
      new DictationClipFailure("terminal", "Sign in to the transcription account again."),
    );
    await expect(transcribe()).rejects.toMatchObject({ code: "deferred" });
    expect(parked().state).toEqual({
      status: "failed",
      error: "Sign in to the transcription account again.",
    });
  });

  it("lets the controller report silence and cancellation itself", async () => {
    harness.transcribe.mockRejectedValueOnce(new DictationClipFailure("empty", "No speech."));
    await expect(transcribe()).resolves.toBe("");
    harness.transcribe.mockRejectedValueOnce(new DictationClipFailure("cancelled", "Cancelled."));
    await expect(transcribe()).rejects.toMatchObject({ code: "cancelled" });
    expect(harness.park).not.toHaveBeenCalled();
  });
});
