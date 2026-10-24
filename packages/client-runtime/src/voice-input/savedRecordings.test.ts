import { DictationSourceId, EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { DictationAvailability } from "../state/dictation.ts";
import { DictationClipFailure } from "../state/dictationFailure.ts";
import type { VoiceDraftSnapshot } from "./controller.ts";
import {
  composerRecordingConsumer,
  createRecordingConsumers,
  createSavedRecordingRunner,
  createSavedRecordings,
  type SavedRecording,
  type SavedRecordingStorage,
} from "./savedRecordings.ts";

const ENV = EnvironmentId.make("env");
const SOURCE = DictationSourceId.make("claude:work");
const available: DictationAvailability = {
  kind: "available",
  environmentId: ENV,
  source: {
    id: SOURCE,
    kind: "claude",
    runsOn: "environment",
    label: "Claude",
    serviceLabel: "Claude",
    accountLabel: null,
    eligible: true,
    audioFormats: ["wav"],
  },
  capability: { maxClipBytes: 1_000_000, maxDurationMs: 300_000 },
};

function memoryStorage() {
  const rows = new Map<string, { recording: SavedRecording; audio: string }>();
  const failing = { add: false, update: false, remove: false };
  const storage: SavedRecordingStorage<string> = {
    load: async () => [...rows.values()],
    add: async (recording, audio) => {
      if (failing.add) throw new Error("disk full");
      rows.set(recording.id, { recording, audio: `stored:${audio}` });
      return `stored:${audio}`;
    },
    update: async (recording) => {
      if (failing.update) throw new Error("disk full");
      const row = rows.get(recording.id);
      if (row) rows.set(recording.id, { ...row, recording });
    },
    remove: async (recording) => {
      if (failing.remove) throw new Error("disk full");
      rows.delete(recording.id);
    },
  };
  return { storage, rows, failing };
}

function captured(text = "hello"): VoiceDraftSnapshot {
  return { ownerKey: "composer", text, selection: { start: 5, end: 5 }, revision: 0 };
}

function saveInput(overrides: { id?: string; ownerKey?: string } = {}) {
  return {
    id: overrides.id ?? "recording-1",
    ownerKey: overrides.ownerKey ?? "composer",
    environmentId: ENV,
    sourceId: SOURCE,
    mimeType: "audio/wav",
    durationMs: 2_000,
    locale: "en-US",
    capturedDraft: captured(),
    audio: "blob",
  };
}

describe("saved recordings", () => {
  it("keeps a recording in memory when storage refuses it, and can save it later", async () => {
    const { storage, rows, failing } = memoryStorage();
    const recordings = createSavedRecordings(storage);
    failing.add = true;
    const entry = await recordings.save(saveInput());
    expect(entry).toMatchObject({ persisted: false, status: "waiting" });
    expect(recordings.audio(entry.id)).toBe("blob");
    expect(rows.size).toBe(0);

    failing.add = false;
    await expect(recordings.retrySave(entry.id)).resolves.toBe(true);
    expect(recordings.get(entry.id)).toMatchObject({ persisted: true, error: null });
    expect(recordings.audio(entry.id)).toBe("stored:blob");
  });

  it("only shows changes that storage accepted", async () => {
    const { storage, failing } = memoryStorage();
    const recordings = createSavedRecordings(storage);
    await recordings.save(saveInput());
    failing.update = true;
    await expect(recordings.update("recording-1", { status: "ready" })).resolves.toBe(false);
    expect(recordings.get("recording-1")?.status).toBe("waiting");

    failing.remove = true;
    await expect(recordings.discard("recording-1")).resolves.toBe(false);
    expect(recordings.get("recording-1")).not.toBeNull();
  });

  it("restores interrupted work as waiting without the draft it was captured from", async () => {
    const { storage } = memoryStorage();
    await createSavedRecordings(storage).save(saveInput());
    await storage.update({
      ...(await storage.load())[0]!.recording,
      status: "transcribing",
    });
    const restored = createSavedRecordings(storage);
    await restored.load();
    expect(restored.get("recording-1")).toMatchObject({
      status: "waiting",
      capturedDraft: null,
      persisted: true,
    });
  });
});

function runnerHarness(options: {
  readonly transcribe: () => Promise<string>;
  readonly availability?: DictationAvailability;
  readonly draft?: VoiceDraftSnapshot | null;
}) {
  const { storage } = memoryStorage();
  const recordings = createSavedRecordings(storage);
  const consumers = createRecordingConsumers();
  const commits: string[] = [];
  let draft = options.draft === undefined ? captured() : options.draft;
  consumers.register(
    "composer",
    composerRecordingConsumer({
      readDraft: () => draft,
      commitDraft: (text) => {
        commits.push(text);
        return true;
      },
    }),
  );
  const runner = createSavedRecordingRunner({
    recordings,
    consumers,
    availability: () => options.availability ?? available,
    transcribe: options.transcribe,
    now: () => 1_000,
  });
  return {
    recordings,
    consumers,
    runner,
    commits,
    setDraft: (next: VoiceDraftSnapshot | null) => {
      draft = next;
    },
  };
}

describe("saved recording runner", () => {
  it("inserts into an unchanged draft and then drops the recording", async () => {
    const h = runnerHarness({ transcribe: async () => "world" });
    await h.recordings.save(saveInput());
    await h.runner.run("recording-1");
    expect(h.commits).toEqual(["hello world"]);
    expect(h.recordings.get("recording-1")).toBeNull();
  });

  it("keeps the transcript for Insert when the draft changed", async () => {
    const h = runnerHarness({ transcribe: async () => " world " });
    await h.recordings.save(saveInput());
    h.setDraft({ ...captured("edited"), revision: 1 });
    await h.runner.run("recording-1");
    expect(h.commits).toEqual([]);
    expect(h.recordings.get("recording-1")).toMatchObject({
      status: "ready",
      transcript: "world",
    });
  });

  it("waits to retry a transient failure and fails a terminal one", async () => {
    const transient = runnerHarness({
      transcribe: async () => {
        throw new DictationClipFailure("transient", "Recording upload disconnected.");
      },
    });
    await transient.recordings.save(saveInput());
    await transient.runner.run("recording-1");
    expect(transient.recordings.get("recording-1")).toMatchObject({
      status: "waiting",
      attempts: 1,
      error: "Recording upload disconnected.",
    });
    expect(transient.recordings.get("recording-1")!.retryAt).toBeGreaterThan(1_000);
    expect(transient.runner.plan(new Set([ENV])).due).toEqual([]);

    const terminal = runnerHarness({
      transcribe: async () => {
        throw new DictationClipFailure("terminal", "Sign in again.");
      },
    });
    await terminal.recordings.save(saveInput());
    await terminal.runner.run("recording-1");
    expect(terminal.recordings.get("recording-1")).toMatchObject({
      status: "failed",
      error: "Sign in again.",
    });
  });

  it("fails without uploading when the environment can no longer transcribe", async () => {
    let calls = 0;
    const h = runnerHarness({
      availability: { kind: "hidden", reason: "disabled" },
      transcribe: async () => {
        calls += 1;
        return "never";
      },
    });
    await h.recordings.save(saveInput());
    await h.runner.run("recording-1");
    expect(calls).toBe(0);
    expect(h.recordings.get("recording-1")).toMatchObject({
      status: "failed",
      error: "Dictation is turned off for this environment.",
    });
  });

  it("hands a transcript to a prefix owner such as a queued message", async () => {
    const h = runnerHarness({ transcribe: async () => "spoken" });
    const handed: string[] = [];
    h.consumers.registerPrefix("outbox:", (recording, transcript) => {
      handed.push(`${recording.ownerKey}=${transcript}`);
      return true;
    });
    await h.recordings.save(saveInput({ ownerKey: "outbox:message-1" }));
    await h.runner.run("recording-1");
    expect(handed).toEqual(["outbox:message-1=spoken"]);
    expect(h.recordings.get("recording-1")).toBeNull();
  });

  it("plans only waiting recordings on reachable environments", async () => {
    const h = runnerHarness({ transcribe: async () => "x" });
    await h.recordings.save(saveInput());
    expect(h.runner.plan(new Set()).due).toEqual([]);
    expect(h.runner.plan(new Set([ENV])).due).toEqual(["recording-1"]);
  });
});
