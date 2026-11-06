import { TranscriptionError } from "@supaterm/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createServerVoiceTranscriber, VoiceUploadError } from "../state/transcription.ts";
import {
  resetVoiceInputGlobalsForTests,
  resolveTranscriptCommit,
  voiceInputSessionActive,
  VoiceInputController,
  voiceInputCue,
  VOICE_RECORDING_LIMIT_SECONDS,
  type VoiceDraftSnapshot,
  type VoiceInputControllerDependencies,
  type VoiceInputCue,
  type VoiceInputPhase,
  type VoiceRecorder,
} from "./controller.ts";
import { LiveDictation } from "./liveDictation.ts";
import {
  VoiceTranscriptionError,
  type PreparedVoiceTranscription,
  type VoiceTranscriber,
} from "./transcription.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class TestRecorder implements VoiceRecorder {
  uri: string | null = "file:///voice.m4a";
  readonly prepareToRecordAsync = vi.fn(async () => undefined);
  readonly record = vi.fn();
  readonly stop = vi.fn(async () => undefined);
}

function preparedTranscription(
  transcribe: PreparedVoiceTranscription["transcribe"] = async () => "new text",
): PreparedVoiceTranscription {
  return { locale: "en-US", transcribe };
}

function draft(overrides: Partial<VoiceDraftSnapshot> = {}): VoiceDraftSnapshot {
  return {
    ownerKey: "environment:thread",
    text: "hello world",
    selection: { start: 6, end: 11 },
    revision: 1,
    ...overrides,
  };
}

function createHarness(
  overrides: Partial<VoiceInputControllerDependencies> = {},
  initialDraft = draft(),
) {
  const recorder = new TestRecorder();
  let currentDraft: VoiceDraftSnapshot | null = initialDraft;
  const commits: Array<{ text: string; selection: { start: number; end: number } }> = [];
  const deleted: string[] = [];
  const dependencies: VoiceInputControllerDependencies = {
    recorder,
    getTranscriber: () => ({ prepare: async () => preparedTranscription() }),
    requestPermission: async () => ({ granted: true, canAskAgain: true }),
    configureRecording: async () => undefined,
    releaseRecording: async () => undefined,
    deleteRecording: (uri) => deleted.push(uri),
    readDraft: () => currentDraft,
    commitDraft: (text, selection) => commits.push({ text, selection }),
    onStateChange: vi.fn(),
    ...overrides,
  };
  return {
    controller: new VoiceInputController(dependencies),
    recorder,
    commits,
    deleted,
    setDraft: (next: VoiceDraftSnapshot | null) => {
      currentDraft = next;
    },
  };
}

function createCueHarness(overrides: Partial<VoiceInputControllerDependencies> = {}) {
  const cues: VoiceInputCue[] = [];
  let phase: VoiceInputPhase = "idle";
  const harness = createHarness({
    ...overrides,
    onStateChange: (state) => {
      const cue = voiceInputCue(phase, state.phase);
      phase = state.phase;
      if (cue) cues.push(cue);
    },
  });
  return { harness, cues };
}

describe("resolveTranscriptCommit", () => {
  it("replaces the recorded UTF-16 selection around emoji and composer tokens", () => {
    const text = "Fix 🧪 then $review please";
    const tokenStart = text.indexOf("$review");
    const captured = draft({
      text,
      selection: { start: tokenStart, end: tokenStart + "$review".length },
    });

    expect(resolveTranscriptCommit(captured, captured, "use the mobile skill", "en-US")).toEqual({
      kind: "commit",
      text: "Fix 🧪 then use the mobile skill please",
      selection: { start: tokenStart + "use the mobile skill".length, end: tokenStart + 20 },
    });
  });

  it("does not replace text after the owner, text, or revision changes", () => {
    const captured = draft();
    expect(
      resolveTranscriptCommit(captured, draft({ ownerKey: "other" }), "text", "en-US"),
    ).toEqual({
      kind: "stale",
    });
    expect(resolveTranscriptCommit(captured, draft({ text: "newer" }), "text", "en-US")).toEqual({
      kind: "stale",
    });
    expect(resolveTranscriptCommit(captured, draft({ revision: 2 }), "text", "en-US")).toEqual({
      kind: "stale",
    });
  });

  it.each([
    ["English", "Hello", 5, "world", "en-US", "Hello world"],
    ["Korean", "코드를", 3, "검토해 주세요", "ko_KR", "코드를 검토해 주세요"],
    ["a supplementary letter", "𞤀", 2, "𞤦", "ff-Adlm", "𞤀 𞤦"],
    ["a trailing combining mark", "नमस्ते", 6, "दुनिया", "hi-IN", "नमस्ते दुनिया"],
    ["a non-ASCII word after the caret", "Änderungen", 0, "Weitere", "de_DE", "Weitere Änderungen"],
    ["spaceless Japanese", "修正キャッシュ", 7, "テストも", "ja-JP", "修正キャッシュテストも"],
    ["spaceless Thai", "โลก", 0, "สวัสดี", "th-TH", "สวัสดีโลก"],
  ])(
    "inserts at a caret with the recorded language's word spacing: %s",
    (_case, text, caret, spoken, locale, expected) => {
      const captured = draft({ text, selection: { start: caret, end: caret } });
      expect(resolveTranscriptCommit(captured, captured, spoken, locale)).toMatchObject({
        kind: "commit",
        text: expected,
      });
    },
  );

  it("reports an empty or whitespace-only transcript without committing anything", () => {
    const captured = draft();
    expect(resolveTranscriptCommit(captured, captured, "", "en-US")).toEqual({ kind: "empty" });
    expect(resolveTranscriptCommit(captured, captured, " \n\t ", "en-US")).toEqual({
      kind: "empty",
    });
  });
});

describe("VoiceInputController", () => {
  beforeEach(() => resetVoiceInputGlobalsForTests());

  it("hands a sent recording over before deleting its own copy, without transcribing", async () => {
    const transcribe = vi.fn(async () => "never");
    const handedOver: string[] = [];
    const saving = deferred<void>();
    const harness = createHarness({
      getTranscriber: () => ({ prepare: async () => preparedTranscription(transcribe) }),
    });
    await harness.controller.start();
    const sending = harness.controller.send(async (uri) => {
      handedOver.push(uri);
      await saving.promise;
    });
    await vi.waitFor(() => expect(handedOver).toEqual(["file:///voice.m4a"]));

    expect(harness.controller.currentState.phase).toBe("sending");
    harness.controller.cancel();
    expect(harness.deleted).toEqual([]);
    saving.resolve();
    await sending;

    expect(harness.controller.currentState.phase).toBe("idle");
    expect(harness.deleted).toEqual(["file:///voice.m4a"]);
    expect(transcribe).not.toHaveBeenCalled();
    expect(harness.commits).toEqual([]);
  });

  it("delivers to the destination bound when Send was pressed, after the draft moves on", async () => {
    const stopping = deferred<undefined>();
    const harness = createHarness();
    harness.recorder.stop.mockImplementation(() => stopping.promise);
    await harness.controller.start();
    const delivered: string[] = [];
    const sending = harness.controller.send(async () => {
      delivered.push("thread A");
    });
    harness.controller.ownerChanged();
    stopping.resolve(undefined);
    await sending;

    expect(delivered).toEqual(["thread A"]);
    expect(harness.controller.currentState.phase).toBe("idle");
  });

  it("reports a recording it could not save, and stops at the time limit for review instead", async () => {
    const failing = createHarness();
    await failing.controller.start();
    await failing.controller.send(async () => {
      throw new Error("quota");
    });
    expect(failing.controller.currentState).toEqual({
      phase: "error",
      error: "Could not save this recording.",
      errorAction: "retry",
    });

    resetVoiceInputGlobalsForTests();
    const tap = createHarness();
    await tap.controller.start();
    await tap.controller.send(async () => {
      throw new VoiceTranscriptionError("tooShort", "too short");
    });
    expect(tap.controller.currentState).toEqual({ phase: "idle", error: null, errorAction: null });
    expect(tap.deleted).toEqual(["file:///voice.m4a"]);

    resetVoiceInputGlobalsForTests();
    const limited = createHarness();
    await limited.controller.start();
    await limited.controller.handleRecorderStatus({
      isFinished: true,
      hasError: false,
      error: null,
      url: "file:///voice.m4a",
    });
    expect(limited.commits).toHaveLength(1);
  });

  it.each([
    [{ text: " " }, { phase: "idle", error: null, errorAction: null }],
    ["audioTooShort", { phase: "idle", error: null, errorAction: null }],
    [
      "rateLimited",
      {
        phase: "error",
        error: "Transcription is rate limited. Try again soon.",
        errorAction: "retry",
      },
    ],
  ] as const)("ends a review the environment answered with %j in %j", async (answer, state) => {
    const harness = createHarness({
      getTranscriber: () =>
        createServerVoiceTranscriber({
          locale: "en-US",
          transcribe: async () => {
            if (typeof answer !== "string") return answer;
            const message = new TranscriptionError({ reason: answer }).message;
            throw new VoiceUploadError(answer, message, false);
          },
        }),
    });
    await harness.controller.start();
    await harness.controller.stop();

    expect(harness.controller.currentState).toEqual(state);
    expect(harness.commits).toEqual([]);
    expect(harness.deleted).toEqual(["file:///voice.m4a"]);
  });

  it("checks support and permission before recording", async () => {
    const unsupported = createHarness({ getTranscriber: () => null });
    await unsupported.controller.start();
    expect(unsupported.controller.currentState.error).toContain("not available");
    expect(unsupported.recorder.record).not.toHaveBeenCalled();

    const denied = createHarness({
      requestPermission: async () => ({ granted: false, canAskAgain: false }),
    });
    await denied.controller.start();
    expect(denied.controller.currentState.errorAction).toBe("settings");
    expect(denied.recorder.record).not.toHaveBeenCalled();

    const missing = createHarness({
      requestPermission: async () => ({
        granted: false,
        canAskAgain: true,
        reason: "No microphone was found.",
      }),
    });
    await missing.controller.start();
    expect(missing.controller.currentState).toMatchObject({
      error: "No microphone was found.",
      errorAction: "retry",
    });
  });

  it("drops a dictation stream the recording never used, and leaves a finished one alone", async () => {
    const streaming = (prepare: () => Promise<string>) => {
      const calls = { subscribed: 0, unsubscribed: 0, cancelled: 0 };
      const transcriber = createServerVoiceTranscriber({
        locale: "en-US",
        startLive: () => ({
          uploadId: "dictation-1",
          live: new LiveDictation({
            prepare,
            openSocket: () => {
              throw new Error("not opened in this test");
            },
            subscribe: () => {
              calls.subscribed += 1;
              return () => {
                calls.unsubscribed += 1;
              };
            },
          }),
          cancel: async () => {
            calls.cancelled += 1;
          },
        }),
        transcribe: async () => ({ text: "kept" }),
      });
      return { calls, transcriber };
    };

    const abandoned = streaming(() => new Promise(() => undefined));
    const failing = createHarness({ getTranscriber: () => abandoned.transcriber });
    failing.recorder.prepareToRecordAsync.mockRejectedValueOnce(new Error("no input"));
    await failing.controller.start();
    expect(failing.controller.currentState.phase).toBe("error");
    expect(abandoned.calls).toEqual({ subscribed: 1, unsubscribed: 1, cancelled: 1 });
    failing.controller.dispose();
    expect(abandoned.calls.cancelled).toBe(1);

    const used = streaming(() => Promise.reject(new Error("old server")));
    const finished = createHarness({ getTranscriber: () => used.transcriber });
    await finished.controller.start();
    await finished.controller.stop();
    expect(finished.commits).toHaveLength(1);
    expect(used.calls.cancelled).toBe(0);
  });

  it.each(["permission", "transcription"] as const)(
    "clears %s errors when switching to another draft",
    async (failure) => {
      const harness = createHarness(
        failure === "permission"
          ? { requestPermission: async () => ({ granted: false, canAskAgain: false }) }
          : {
              getTranscriber: () => ({
                prepare: async () =>
                  preparedTranscription(async () => {
                    throw new Error("Transcription failed");
                  }),
              }),
            },
      );
      await harness.controller.start();
      await harness.controller.stop();
      expect(harness.controller.currentState).toMatchObject({
        phase: "error",
        error: expect.any(String),
        errorAction: failure === "permission" ? "settings" : "retry",
      });

      harness.setDraft(draft({ ownerKey: "environment:other-thread" }));
      harness.controller.ownerChanged();

      expect(harness.controller.currentState).toEqual({
        phase: "idle",
        error: null,
        errorAction: null,
      });
      expect(harness.commits).toEqual([]);
    },
  );

  it.each(["permission", "preparation", "recording"] as const)(
    "keeps the selected transcriber when preferences change during %s",
    async (changeDuring) => {
      const permission = deferred<{ granted: boolean; canAskAgain: boolean }>();
      const permissionEntered = deferred<void>();
      const preparation = deferred<void>();
      const preparationEntered = deferred<void>();
      const preparationSignals: AbortSignal[] = [];
      const transcriptionSignals: AbortSignal[] = [];
      const transcriber = (text: string): VoiceTranscriber => ({
        prepare: async ({ signal }) => {
          preparationSignals.push(signal);
          preparationEntered.resolve(undefined);
          await preparation.promise;
          return preparedTranscription(async (_uri, { signal }) => {
            transcriptionSignals.push(signal);
            return text;
          });
        },
      });
      const first = transcriber("first choice");
      const second = transcriber("second choice");
      let selected = first;
      const harness = createHarness({
        getTranscriber: () => selected,
        requestPermission: () => {
          permissionEntered.resolve(undefined);
          return permission.promise;
        },
      });

      const starting = harness.controller.start();
      await permissionEntered.promise;
      if (changeDuring === "permission") selected = second;
      permission.resolve({ granted: true, canAskAgain: true });
      await preparationEntered.promise;
      if (changeDuring === "preparation") selected = second;
      preparation.resolve(undefined);
      await starting;
      if (changeDuring === "recording") selected = second;
      await harness.controller.stop();

      expect(harness.commits.map((commit) => commit.text)).toEqual(["hello first choice"]);

      await harness.controller.start();
      await harness.controller.stop();

      expect(harness.commits.map((commit) => commit.text)).toEqual([
        "hello first choice",
        "hello second choice",
      ]);
      expect(preparationSignals).toHaveLength(2);
      expect(transcriptionSignals).toHaveLength(2);
      expect(transcriptionSignals[0]).toBe(preparationSignals[0]);
      expect(transcriptionSignals[1]).toBe(preparationSignals[1]);
      expect(preparationSignals[1]).not.toBe(preparationSignals[0]);
    },
  );

  it("uses the native five-minute cap and commits one final transcript", async () => {
    const harness = createHarness();
    await harness.controller.start();
    expect(harness.recorder.record).toHaveBeenCalledWith({
      forDuration: VOICE_RECORDING_LIMIT_SECONDS,
    });

    const stopping = harness.controller.stop();
    harness.controller.handleRecorderStatus({
      isFinished: true,
      hasError: false,
      error: null,
      url: "file:///voice.m4a",
    });
    await stopping;

    expect(harness.commits).toEqual([
      { text: "hello new text", selection: { start: 14, end: 14 } },
    ]);
    expect(harness.deleted).toEqual(["file:///voice.m4a"]);
  });

  it.each(["cancel", "dispose", "ownerChanged"] as const)(
    "queues the next recording after %s until transcription and audio cleanup settle",
    async (action) => {
      const transcription = deferred<string>();
      const transcriptionEntered = deferred<AbortSignal>();
      const audioRelease = deferred<void>();
      const audioReleaseEntered = deferred<void>();
      const releaseRecording = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("busy"))
        .mockImplementationOnce(() => {
          audioReleaseEntered.resolve(undefined);
          return audioRelease.promise;
        });
      const harness = createHarness({
        releaseRecording,
        getTranscriber: () => ({
          prepare: async () =>
            preparedTranscription((_uri, { signal }) => {
              transcriptionEntered.resolve(signal);
              return transcription.promise;
            }),
        }),
      });
      await harness.controller.start();
      const stopping = harness.controller.stop();
      const signal = await transcriptionEntered.promise;
      expect(signal.aborted).toBe(false);
      if (action === "ownerChanged") {
        harness.setDraft(draft({ ownerKey: "environment:other-thread" }));
      }
      harness.controller[action]();
      expect(signal.aborted).toBe(true);

      const prepare = vi.fn(async () => preparedTranscription());
      const next = createHarness({ getTranscriber: () => ({ prepare }) });
      const nextStart = next.controller.start();
      expect(next.controller.currentState).toEqual({
        phase: "preparing",
        error: null,
        errorAction: null,
      });
      expect(prepare).not.toHaveBeenCalled();
      expect(next.recorder.record).not.toHaveBeenCalled();

      transcription.resolve("late text");
      await audioReleaseEntered.promise;
      expect(prepare).not.toHaveBeenCalled();
      expect(next.recorder.prepareToRecordAsync).not.toHaveBeenCalled();
      audioRelease.resolve(undefined);
      await stopping;
      await nextStart;

      expect(harness.commits).toEqual([]);
      expect(harness.deleted).toEqual(["file:///voice.m4a"]);
      expect(harness.controller.currentState.phase).toBe("idle");

      expect(next.controller.currentState.phase).toBe("recording");
      expect(prepare).toHaveBeenCalledTimes(1);
      await next.controller.interruptRecording();
    },
  );

  it("releases the microphone before transcription starts", async () => {
    const events: string[] = [];
    const harness = createHarness({
      releaseRecording: async () => {
        events.push("released");
      },
      getTranscriber: () => ({
        prepare: async () =>
          preparedTranscription(async () => {
            events.push("transcribed");
            return "done";
          }),
      }),
    });
    await harness.controller.start();
    await harness.controller.stop();

    expect(events).toEqual(["released", "transcribed"]);
  });

  it("ignores a late transcript after the draft owner changes", async () => {
    const transcription = deferred<string>();
    const transcriptionEntered = deferred<void>();
    const harness = createHarness({
      getTranscriber: () => ({
        prepare: async () =>
          preparedTranscription(() => {
            transcriptionEntered.resolve(undefined);
            return transcription.promise;
          }),
      }),
    });
    await harness.controller.start();
    const stopping = harness.controller.stop();
    await transcriptionEntered.promise;
    harness.setDraft(draft({ ownerKey: "environment:other-thread" }));
    transcription.resolve("late text");
    await stopping;

    expect(harness.commits).toEqual([]);
    expect(harness.controller.currentState.error).toContain("draft changed");
  });

  it("queues the next recording until canceled preparation settles", async () => {
    const preparation = deferred<PreparedVoiceTranscription>();
    const preparationEntered = deferred<AbortSignal>();
    const first = createHarness({
      getTranscriber: () => ({
        prepare: ({ signal }) => {
          preparationEntered.resolve(signal);
          return preparation.promise;
        },
      }),
    });
    const firstStart = first.controller.start();
    const signal = await preparationEntered.promise;
    first.controller.cancel();
    expect(signal.aborted).toBe(true);

    const next = createHarness();
    const nextStart = next.controller.start();
    expect(next.controller.currentState.phase).toBe("preparing");
    expect(next.recorder.prepareToRecordAsync).not.toHaveBeenCalled();

    preparation.resolve(preparedTranscription());
    await firstStart;
    expect(first.recorder.record).not.toHaveBeenCalled();
    await nextStart;
    expect(next.controller.currentState.phase).toBe("recording");
    await next.controller.interruptRecording();
  });

  it("still rejects a second start while the first recording is active", async () => {
    expect(voiceInputSessionActive()).toBe(false);
    const first = createHarness();
    await first.controller.start();
    expect(voiceInputSessionActive()).toBe(true);
    const next = createHarness();
    await next.controller.start();
    expect(next.controller.currentState.error).toContain("already active");
    expect(next.recorder.record).not.toHaveBeenCalled();
    // A cancelled recording still releases its microphone, but no longer holds the shortcut.
    const discarding = first.controller.interruptRecording();
    expect(voiceInputSessionActive()).toBe(false);
    await discarding;
  });

  it("does not start a canceled waiter or let it release another recording", async () => {
    const preparation = deferred<PreparedVoiceTranscription>();
    const preparationEntered = deferred<void>();
    const first = createHarness({
      getTranscriber: () => ({
        prepare: () => {
          preparationEntered.resolve(undefined);
          return preparation.promise;
        },
      }),
    });
    const firstStart = first.controller.start();
    await preparationEntered.promise;
    first.controller.dispose();

    const next = createHarness();
    const canceledStart = next.controller.start();
    next.controller.cancel();
    const nextStart = next.controller.start();
    preparation.resolve(preparedTranscription());
    await Promise.all([firstStart, canceledStart, nextStart]);

    expect(next.recorder.record).toHaveBeenCalledTimes(1);
    expect(next.deleted).toEqual([]);
    const blocked = createHarness();
    await blocked.controller.start();
    expect(blocked.controller.currentState.error).toContain("already active");
    await next.controller.interruptRecording();
  });

  it("releases an abandoned recording even if its native recorder was already disposed", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.recorder.stop.mockRejectedValueOnce(new Error("recorder released"));
    Object.defineProperty(harness.recorder, "uri", {
      get() {
        throw new Error("recorder released");
      },
    });

    await expect(harness.controller.interruptRecording()).resolves.toBeUndefined();
    expect(harness.deleted).toEqual(["file:///voice.m4a"]);
    const next = createHarness();
    await next.controller.start();
    expect(next.controller.currentState.phase).toBe("recording");
    await next.controller.interruptRecording();
  });

  it("keeps the new abort controller when restarting the same composer after cancellation", async () => {
    const transcription = deferred<string>();
    const transcriptionEntered = deferred<void>();
    const prepare = vi
      .fn<VoiceTranscriber["prepare"]>()
      .mockResolvedValueOnce(
        preparedTranscription(() => {
          transcriptionEntered.resolve(undefined);
          return transcription.promise;
        }),
      )
      .mockResolvedValue(preparedTranscription());
    const harness = createHarness({ getTranscriber: () => ({ prepare }) });
    await harness.controller.start();
    const stopping = harness.controller.stop();
    await transcriptionEntered.promise;
    harness.controller.cancel();
    const restarting = harness.controller.start();
    transcription.resolve("late text");
    await Promise.all([stopping, restarting]);
    await harness.controller.stop();

    expect(harness.commits).toEqual([
      { text: "hello new text", selection: { start: 14, end: 14 } },
    ]);
    expect(harness.controller.currentState.phase).toBe("idle");
  });

  it("does not start the microphone for an owner that changed during preparation", async () => {
    const preparation = deferred<PreparedVoiceTranscription>();
    const preparationEntered = deferred<void>();
    const harness = createHarness({
      getTranscriber: () => ({
        prepare: () => {
          preparationEntered.resolve(undefined);
          return preparation.promise;
        },
      }),
    });
    const starting = harness.controller.start();
    await preparationEntered.promise;
    harness.setDraft(draft({ ownerKey: "environment:other-thread", text: "other draft" }));
    preparation.resolve(preparedTranscription());
    await starting;

    expect(harness.recorder.record).not.toHaveBeenCalled();
    expect(harness.controller.currentState.error).toContain("no longer available");
  });

  it("discards recorder errors and audio interruptions without transcribing", async () => {
    const transcribe = vi.fn(async () => "ignored");
    const preparationEntered = deferred<AbortSignal>();
    const harness = createHarness({
      getTranscriber: () => ({
        prepare: async ({ signal }) => {
          preparationEntered.resolve(signal);
          return preparedTranscription(transcribe);
        },
      }),
    });
    await harness.controller.start();
    const signal = await preparationEntered.promise;
    harness.recorder.uri = "file:///reset-empty.m4a";
    await harness.controller.handleRecorderStatus({
      isFinished: true,
      hasError: true,
      error: "Audio route changed",
      url: "file:///voice.m4a",
    });

    expect(harness.commits).toEqual([]);
    expect(transcribe).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(true);
    expect(harness.controller.currentState.error).toBe("Audio route changed");
    expect(harness.deleted).toEqual(["file:///voice.m4a", "file:///reset-empty.m4a"]);
  });

  it("cancels preparation when the app reaches the background", async () => {
    const preparation = deferred<PreparedVoiceTranscription>();
    const preparationEntered = deferred<AbortSignal>();
    const harness = createHarness({
      getTranscriber: () => ({
        prepare: ({ signal }) => {
          preparationEntered.resolve(signal);
          return preparation.promise;
        },
      }),
    });
    const starting = harness.controller.start();
    const signal = await preparationEntered.promise;
    harness.controller.appMovedToBackground();
    expect(signal.aborted).toBe(true);
    preparation.resolve(preparedTranscription());
    await starting;

    expect(harness.recorder.record).not.toHaveBeenCalled();
    expect(harness.controller.currentState.error).toContain("background");
  });

  it("keeps preparing while the system asks for microphone access", async () => {
    const permission = deferred<{ granted: boolean; canAskAgain: boolean }>();
    const harness = createHarness({ requestPermission: () => permission.promise });
    const starting = harness.controller.start();
    harness.controller.appMovedToBackground();
    permission.resolve({ granted: true, canAskAgain: true });
    await starting;

    expect(harness.recorder.record).toHaveBeenCalled();
    expect(harness.controller.currentState.phase).toBe("recording");
  });

  it.each([
    [
      "a reviewed recording",
      {},
      async ({ controller, commits }: ReturnType<typeof createHarness>) => {
        await controller.start();
        await controller.stop();
        expect(commits).toHaveLength(1);
      },
      ["start", "stop"],
    ],
    [
      "a sent recording",
      {},
      async ({ controller }: ReturnType<typeof createHarness>) => {
        await controller.start();
        await controller.send(async () => undefined);
      },
      ["start", "stop"],
    ],
    [
      "a discarded recording",
      {},
      async ({ controller }: ReturnType<typeof createHarness>) => {
        await controller.start();
        controller.cancel();
      },
      ["start", "discard"],
    ],
    [
      "a failed transcription",
      {
        getTranscriber: () => ({
          prepare: async () =>
            preparedTranscription(async () => {
              throw new Error("upload failed");
            }),
        }),
      },
      async ({ controller }: ReturnType<typeof createHarness>) => {
        await controller.start();
        await controller.stop();
      },
      ["start", "stop", "error"],
    ],
    [
      "an interrupted recording",
      {},
      async ({ controller }: ReturnType<typeof createHarness>) => {
        await controller.start();
        await controller.interruptRecording();
      },
      ["start", "error"],
    ],
    [
      "denied microphone access",
      {
        requestPermission: async () => ({ granted: false, canAskAgain: true }),
      },
      async ({ controller }: ReturnType<typeof createHarness>) => {
        await controller.start();
      },
      ["error"],
    ],
  ] as const)(
    "cues the microphone opening and closing for %s",
    async (_name, overrides, run, expected) => {
      const { harness, cues } = createCueHarness(overrides);
      await run(harness);

      expect(cues).toEqual(expected);
    },
  );

  it("stays silent when preparation is canceled before the microphone opens", async () => {
    const permission = deferred<{ granted: boolean; canAskAgain: boolean }>();
    const { harness, cues } = createCueHarness({ requestPermission: () => permission.promise });
    const starting = harness.controller.start();
    harness.controller.cancel();
    permission.resolve({ granted: true, canAskAgain: true });
    await starting;

    expect(harness.recorder.record).not.toHaveBeenCalled();
    expect(cues).toEqual([]);
  });
});
