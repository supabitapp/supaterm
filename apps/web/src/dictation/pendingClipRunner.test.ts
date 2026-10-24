import { DictationSourceId, EnvironmentId } from "@supaterm/contracts";
import type { VoiceDraftSnapshot } from "@supaterm/client-runtime/voice-input";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  availability: { kind: "available", source: { id: "codex:work" } } as unknown,
  transcribe: vi.fn(),
  nextId: 0,
}));

vi.mock("../lib/utils", () => ({ randomUUID: () => `clip-${++harness.nextId}` }));
vi.mock("../state/dictation", () => ({ readDictationAvailability: () => harness.availability }));
vi.mock("./transcribeClip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transcribeClip")>()),
  transcribeDictationClip: harness.transcribe,
}));

import { registerDictationComposer, transcribePendingClip } from "./pendingClipRunner";
import { getPendingClips, parkPendingClip, resetPendingClipsForTests } from "./pendingClips";
import { DictationClipFailure } from "./transcribeClip";

const ENV = EnvironmentId.make("env");
const captured: VoiceDraftSnapshot = {
  ownerKey: "env:thread",
  text: "Fix the cache.",
  selection: { start: 14, end: 14 },
  revision: 2,
};

function park(capturedDraft: VoiceDraftSnapshot | null = captured) {
  return parkPendingClip({
    ownerKey: "env:thread",
    environmentId: ENV,
    threadInstanceId: null,
    blob: new Blob(["opus"], { type: "audio/webm" }),
    mimeType: "audio/webm",
    durationMs: 2_000,
    locale: "en-US",
    capturedDraft,
  });
}

function composer(current: VoiceDraftSnapshot) {
  const commits: string[] = [];
  const unregister = registerDictationComposer("env:thread", {
    readDraft: () => current,
    commitDraft: (text) => {
      commits.push(text);
      return true;
    },
  });
  return { commits, unregister };
}

beforeEach(() => {
  resetPendingClipsForTests();
  harness.availability = { kind: "available", source: { id: "codex:work" } };
  harness.transcribe
    .mockReset()
    .mockResolvedValue({ text: "Then run tests.", sourceId: DictationSourceId.make("codex:work") });
});

describe("transcribePendingClip", () => {
  it("keeps a clip in memory when the browser cannot store it", async () => {
    const clip = await park();
    expect(clip.persisted).toBe(false);
    expect(getPendingClips().map((candidate) => candidate.id)).toEqual([clip.id]);
  });

  it("inserts into the untouched draft it was recorded over and removes the clip", async () => {
    const { commits, unregister } = composer(captured);
    const clip = await park();
    await transcribePendingClip(clip.id);
    expect(commits).toEqual(["Fix the cache. Then run tests."]);
    expect(getPendingClips()).toEqual([]);
    unregister();
  });

  it("leaves the transcript ready when the draft changed meanwhile", async () => {
    const { commits, unregister } = composer({ ...captured, text: "Fix the cache!", revision: 3 });
    const clip = await park();
    await transcribePendingClip(clip.id);
    expect(commits).toEqual([]);
    expect(getPendingClips()).toMatchObject([{ status: "ready", transcript: "Then run tests." }]);
    unregister();
  });

  it("needs an explicit insert after recovery even when the draft matches", async () => {
    const { commits, unregister } = composer(captured);
    const clip = await park(null);
    await transcribePendingClip(clip.id);
    expect(commits).toEqual([]);
    expect(getPendingClips()).toMatchObject([{ status: "ready" }]);
    unregister();
  });

  it("schedules a retry for transient failures and stops on terminal ones", async () => {
    const clip = await park();
    harness.transcribe.mockRejectedValueOnce(
      new DictationClipFailure("transient", "Couldn't reach the transcription service."),
    );
    await transcribePendingClip(clip.id);
    expect(getPendingClips()[0]).toMatchObject({
      status: "waiting",
      attempts: 1,
      error: "Couldn't reach the transcription service.",
    });
    expect(getPendingClips()[0]!.retryAt).toBeGreaterThan(Date.now());

    harness.transcribe.mockRejectedValueOnce(
      new DictationClipFailure("terminal", "Sign in to the transcription account again."),
    );
    await transcribePendingClip(clip.id);
    expect(getPendingClips()[0]).toMatchObject({
      status: "failed",
      error: "Sign in to the transcription account again.",
    });
  });

  it("explains why an environment stopped offering dictation", async () => {
    harness.availability = { kind: "hidden", reason: "disabled" };
    const clip = await park();
    await transcribePendingClip(clip.id);
    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(getPendingClips()[0]).toMatchObject({
      status: "failed",
      error: "Dictation is turned off for this environment.",
    });
  });
});
