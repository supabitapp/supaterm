import type { SavedRecording } from "@supaterm/client-runtime/voice-input";
import { DictationSourceId, EnvironmentId } from "@supaterm/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failWrite: false,
  failMove: (_from: string): boolean => false,
}));

vi.mock("expo-file-system", () => {
  const resolve = (parent: string | { readonly uri: string }, name?: string) => {
    const base = typeof parent === "string" ? parent : parent.uri;
    return name ? `${base}/${name}` : base;
  };
  class File {
    uri: string;
    constructor(parent: string | { readonly uri: string }, name?: string) {
      this.uri = resolve(parent, name);
    }
    get name() {
      return this.uri.slice(this.uri.lastIndexOf("/") + 1);
    }
    get exists() {
      return fs.files.has(this.uri);
    }
    create() {
      fs.files.set(this.uri, "");
    }
    writeSync(text: string) {
      if (fs.failWrite) {
        fs.files.set(this.uri, text.slice(0, 8));
        throw new Error("disk full");
      }
      fs.files.set(this.uri, text);
    }
    textSync() {
      const text = fs.files.get(this.uri);
      if (text === undefined) throw new Error("missing file");
      return text;
    }
    moveSync(destination: { readonly uri: string }, options?: { readonly overwrite?: boolean }) {
      const text = fs.files.get(this.uri);
      if (fs.failMove(this.uri) || text === undefined) throw new Error("move failed");
      if (fs.files.has(destination.uri) && !options?.overwrite) throw new Error("exists");
      fs.files.delete(this.uri);
      fs.files.set(destination.uri, text);
      this.uri = destination.uri;
    }
    delete() {
      if (!fs.files.delete(this.uri)) throw new Error("missing file");
    }
  }
  class Directory {
    readonly uri: string;
    constructor(parent: string | { readonly uri: string }, name?: string) {
      this.uri = resolve(parent, name);
    }
    get exists() {
      return true;
    }
    create() {}
    list() {
      return [...fs.files.keys()].flatMap((uri) =>
        uri.startsWith(`${this.uri}/`) ? [new File(uri)] : [],
      );
    }
  }
  return { Directory, File, Paths: { document: new Directory("file:///documents") } };
});

import { savedVoiceRecordings, voiceRecordingStorage } from "./pendingVoiceRecordings";

const DIRECTORY = "file:///documents/supaterm-voice-recordings";
const CACHE_AUDIO = "file:///cache/recording-abc.wav";

function recording(id: string, overrides: Partial<SavedRecording> = {}): SavedRecording {
  return {
    id,
    ownerKey: "draft",
    environmentId: EnvironmentId.make("env"),
    sourceId: DictationSourceId.make("claude:me"),
    mimeType: "audio/wav",
    durationMs: 4_000,
    locale: "en-US",
    createdAt: "2026-10-24T00:00:00.000Z",
    status: "waiting",
    transcript: null,
    error: null,
    attempts: 0,
    retryAt: 0,
    ...overrides,
  };
}

function stored(): ReadonlyArray<string> {
  return [...fs.files.keys()]
    .flatMap((uri) => (uri.startsWith(`${DIRECTORY}/`) ? [uri.slice(DIRECTORY.length + 1)] : []))
    .sort();
}

beforeEach(() => {
  fs.files.clear();
  fs.files.set(CACHE_AUDIO, "audio");
  fs.failWrite = false;
  fs.failMove = () => false;
  savedVoiceRecordings.resetForTests();
});

describe("voice recording storage", () => {
  it("moves the audio beside its details and removes both", async () => {
    const saved = recording("one");
    await expect(voiceRecordingStorage.add(saved, CACHE_AUDIO)).resolves.toBe(
      `${DIRECTORY}/one.wav`,
    );
    expect(stored()).toEqual(["one.json", "one.wav"]);
    expect(fs.files.has(CACHE_AUDIO)).toBe(false);
    await expect(voiceRecordingStorage.load()).resolves.toEqual([
      { recording: saved, audio: `${DIRECTORY}/one.wav` },
    ]);

    await voiceRecordingStorage.remove(saved);
    expect(stored()).toEqual([]);
  });

  it("leaves the recorder's audio in place when saving fails", async () => {
    fs.failMove = (from) => from === CACHE_AUDIO;
    await expect(voiceRecordingStorage.add(recording("one"), CACHE_AUDIO)).rejects.toThrow();
    expect(fs.files.get(CACHE_AUDIO)).toBe("audio");
    expect(stored()).toEqual([]);

    fs.failMove = () => false;
    fs.failWrite = true;
    await expect(voiceRecordingStorage.add(recording("one"), CACHE_AUDIO)).rejects.toThrow();
    expect(fs.files.get(CACHE_AUDIO)).toBe("audio");
    expect(stored()).toEqual([]);
  });

  it("keeps an unsaved recording's audio so it can be saved later", async () => {
    fs.failMove = (from) => from === CACHE_AUDIO;
    const entry = await savedVoiceRecordings.save({
      ...recording("one"),
      capturedDraft: null,
      audio: CACHE_AUDIO,
    });
    expect(entry.persisted).toBe(false);
    expect(savedVoiceRecordings.audio("one")).toBe(CACHE_AUDIO);
    expect(fs.files.get(CACHE_AUDIO)).toBe("audio");

    fs.failMove = () => false;
    await expect(savedVoiceRecordings.retrySave("one")).resolves.toBe(true);
    expect(savedVoiceRecordings.audio("one")).toBe(`${DIRECTORY}/one.wav`);
    expect(stored()).toEqual(["one.json", "one.wav"]);
  });

  it("keeps the previous details when writing new ones fails", async () => {
    const saved = recording("one");
    await voiceRecordingStorage.add(saved, CACHE_AUDIO);
    fs.failWrite = true;
    await expect(
      voiceRecordingStorage.update({ ...saved, status: "ready", transcript: "Hello" }),
    ).rejects.toThrow();
    fs.failWrite = false;
    expect(stored()).toEqual(["one.json", "one.wav"]);
    await expect(voiceRecordingStorage.load()).resolves.toEqual([
      { recording: saved, audio: `${DIRECTORY}/one.wav` },
    ]);
  });

  it("recovers the latest complete details after an interrupted write", async () => {
    const before = recording("partial");
    const after = recording("swapped", { status: "ready", transcript: "Hello" });
    fs.files.set(`${DIRECTORY}/partial.json`, JSON.stringify(before));
    fs.files.set(`${DIRECTORY}/partial.json.tmp`, '{"id":"par');
    fs.files.set(`${DIRECTORY}/partial.wav`, "audio");
    fs.files.set(`${DIRECTORY}/swapped.json.tmp`, JSON.stringify(after));
    fs.files.set(`${DIRECTORY}/swapped.m4a`, "audio");

    const loaded = await voiceRecordingStorage.load();
    expect(loaded.map((entry) => entry.recording)).toEqual([before, after]);
    expect(stored()).toEqual(["partial.json", "partial.wav", "swapped.json", "swapped.m4a"]);
  });

  it("deletes details without audio, audio without details, and unreadable details", async () => {
    const kept = recording("kept");
    fs.files.set(`${DIRECTORY}/kept.json`, JSON.stringify(kept));
    fs.files.set(`${DIRECTORY}/kept.m4a`, "audio");
    fs.files.set(`${DIRECTORY}/no-details.wav`, "audio");
    fs.files.set(`${DIRECTORY}/no-audio.json`, JSON.stringify(recording("no-audio")));
    fs.files.set(`${DIRECTORY}/unreadable.json`, "{");
    fs.files.set(`${DIRECTORY}/unreadable.wav`, "audio");
    fs.files.set(`${DIRECTORY}/misfiled.json`, JSON.stringify(recording("other")));
    fs.files.set(`${DIRECTORY}/misfiled.wav`, "audio");

    await expect(voiceRecordingStorage.load()).resolves.toEqual([
      { recording: kept, audio: `${DIRECTORY}/kept.m4a` },
    ]);
    expect(stored()).toEqual(["kept.json", "kept.m4a"]);
  });
});
