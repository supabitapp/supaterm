import { DictationSourceId, EnvironmentId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";

import type { DictationAvailability, DictationHiddenReason } from "../state/dictation.ts";
import { classifyDictationFailure, type DictationClipFailure } from "../state/dictationFailure.ts";
import { threadOutboxRetryDelayMs } from "../threadOutboxPolicy.ts";
import { resolveParkedInsertion } from "./clips.ts";
import type { VoiceDraftSnapshot, VoiceTranscriptEdit } from "./controller.ts";

export const SavedRecording = Schema.Struct({
  id: Schema.String,
  ownerKey: Schema.String,
  environmentId: EnvironmentId,
  sourceId: DictationSourceId,
  mimeType: Schema.String,
  durationMs: Schema.Number,
  locale: Schema.String,
  createdAt: Schema.String,
  status: Schema.Literals(["waiting", "transcribing", "ready", "failed"]),
  transcript: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  attempts: Schema.Number,
  retryAt: Schema.Number,
});
export type SavedRecording = typeof SavedRecording.Type;

export interface SavedRecordingEntry extends SavedRecording {
  /** Memory only: a recording restored after a reload always waits for an explicit Insert. */
  readonly capturedDraft: VoiceDraftSnapshot | null;
  /** False when storage refused the recording; it then lives in memory until saved or discarded. */
  readonly persisted: boolean;
}

export type SavedRecordingPatch = Partial<
  Pick<SavedRecording, "ownerKey" | "status" | "transcript" | "error" | "attempts" | "retryAt">
>;

/**
 * Durable storage for recordings. Every method rejects when the write did not happen, so the
 * engine only shows state that is actually on disk.
 */
export interface SavedRecordingStorage<Audio> {
  readonly load: () => Promise<
    ReadonlyArray<{ readonly recording: SavedRecording; readonly audio: Audio }>
  >;
  /** Resolves with the audio as stored, which may differ from the input (a moved file). */
  readonly add: (recording: SavedRecording, audio: Audio) => Promise<Audio>;
  readonly update: (recording: SavedRecording) => Promise<void>;
  readonly remove: (recording: SavedRecording) => Promise<void>;
  /** Other tabs or processes changed storage. */
  readonly subscribe?: (onChange: () => void) => () => void;
}

type Stored<Audio> = { readonly entry: SavedRecordingEntry; readonly audio: Audio };

const EMPTY: ReadonlyArray<SavedRecordingEntry> = [];

export function createSavedRecordings<Audio>(storage: SavedRecordingStorage<Audio>) {
  let records = new Map<string, Stored<Audio>>();
  let snapshot: ReadonlyArray<SavedRecordingEntry> = EMPTY;
  const listeners = new Set<() => void>();
  const ownerSnapshots = new Map<
    string,
    {
      readonly source: ReadonlyArray<SavedRecordingEntry>;
      readonly entries: ReadonlyArray<SavedRecordingEntry>;
    }
  >();
  const aborters = new Map<string, AbortController>();
  let loading: Promise<void> | null = null;
  let unsubscribeStorage: (() => void) | null = null;

  const publish = (next: Map<string, Stored<Audio>>) => {
    records = next;
    snapshot = [...next.values()]
      .map(({ entry }) => entry)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const listener of listeners) listener();
  };

  const toStored = (entry: SavedRecordingEntry): SavedRecording => {
    const { capturedDraft: _, persisted: __, ...stored } = entry;
    return stored;
  };

  const reload = async (recover: boolean) => {
    const loaded = await storage.load();
    const next = new Map([...records].filter(([, { entry }]) => !entry.persisted));
    for (const { recording, audio } of loaded) {
      if (next.has(recording.id)) continue;
      next.set(recording.id, {
        audio,
        entry: {
          ...recording,
          status: recover && recording.status === "transcribing" ? "waiting" : recording.status,
          capturedDraft: records.get(recording.id)?.entry.capturedDraft ?? null,
          persisted: true,
        },
      });
    }
    for (const [id, { entry }] of records) {
      if (entry.persisted && !next.has(id)) aborters.get(id)?.abort();
    }
    publish(next);
  };

  const load = () => {
    unsubscribeStorage ??=
      storage.subscribe?.(() => void reload(false).catch(() => undefined)) ?? null;
    loading ??= reload(true).catch(() => undefined);
    return loading;
  };

  /**
   * Takes ownership of a finished recording. When storage refuses it the recording is still
   * kept, in memory, so the caller never has to delete audio the user has not given up on.
   */
  const save = async (input: {
    readonly id: string;
    readonly ownerKey: string;
    readonly environmentId: EnvironmentId;
    readonly sourceId: DictationSourceId;
    readonly mimeType: string;
    readonly durationMs: number;
    readonly locale: string;
    readonly capturedDraft: VoiceDraftSnapshot | null;
    readonly audio: Audio;
  }): Promise<SavedRecordingEntry> => {
    await load();
    const recording: SavedRecording = {
      id: input.id,
      ownerKey: input.ownerKey,
      environmentId: input.environmentId,
      sourceId: input.sourceId,
      mimeType: input.mimeType,
      durationMs: input.durationMs,
      locale: input.locale,
      // @effect-diagnostics-next-line globalDate:off
      createdAt: new Date().toISOString(),
      status: "waiting",
      transcript: null,
      error: null,
      attempts: 0,
      retryAt: 0,
    };
    let audio = input.audio;
    let persisted = true;
    try {
      audio = await storage.add(recording, input.audio);
    } catch {
      persisted = false;
    }
    const entry: SavedRecordingEntry = {
      ...recording,
      ...(persisted
        ? {}
        : { error: "This recording couldn't be saved on this device. Retry to save it." }),
      capturedDraft: input.capturedDraft,
      persisted,
    };
    publish(new Map(records).set(entry.id, { entry, audio }));
    return entry;
  };

  const update = async (id: string, patch: SavedRecordingPatch): Promise<boolean> => {
    const current = records.get(id);
    if (!current) return false;
    const entry = { ...current.entry, ...patch };
    if (entry.persisted) {
      try {
        await storage.update(toStored(entry));
      } catch {
        return false;
      }
    }
    if (!records.has(id)) return false;
    publish(new Map(records).set(id, { entry, audio: current.audio }));
    return true;
  };

  const retrySave = async (id: string): Promise<boolean> => {
    const current = records.get(id);
    if (!current || current.entry.persisted) return current !== undefined;
    let audio: Audio;
    try {
      audio = await storage.add(toStored({ ...current.entry, error: null }), current.audio);
    } catch {
      return false;
    }
    publish(
      new Map(records).set(id, {
        audio,
        entry: { ...current.entry, error: null, persisted: true },
      }),
    );
    return true;
  };

  /** Removes the recording from memory only once storage has removed it too. */
  const discard = async (id: string): Promise<boolean> => {
    const current = records.get(id);
    aborters.get(id)?.abort();
    aborters.delete(id);
    if (!current) return true;
    if (current.entry.persisted) {
      try {
        await storage.remove(toStored(current.entry));
      } catch {
        return false;
      }
    }
    const next = new Map(records);
    next.delete(id);
    publish(next);
    return true;
  };

  const reassign = async (fromOwnerKey: string, toOwnerKey: string): Promise<void> => {
    if (fromOwnerKey === toOwnerKey) return;
    await Promise.all(
      snapshot
        .filter((entry) => entry.ownerKey === fromOwnerKey)
        .map((entry) => update(entry.id, { ownerKey: toOwnerKey })),
    );
  };

  const owned = (ownerKey: string): ReadonlyArray<SavedRecordingEntry> => {
    const cached = ownerSnapshots.get(ownerKey);
    if (cached?.source === snapshot) return cached.entries;
    const entries = snapshot.filter((entry) => entry.ownerKey === ownerKey);
    const unchanged =
      cached?.entries.length === entries.length &&
      cached.entries.every((entry, index) => entry === entries[index]);
    const result = entries.length === 0 ? EMPTY : unchanged ? cached.entries : entries;
    ownerSnapshots.set(ownerKey, { source: snapshot, entries: result });
    return result;
  };

  return {
    load,
    reload: () => reload(false).catch(() => undefined),
    save,
    update,
    retrySave,
    discard,
    reassign,
    get: (id: string) => records.get(id)?.entry ?? null,
    audio: (id: string) => records.get(id)?.audio ?? null,
    all: () => snapshot,
    owned,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    registerWork: (id: string, controller: AbortController) => {
      aborters.set(id, controller);
      return () => {
        if (aborters.get(id) === controller) aborters.delete(id);
      };
    },
    resetForTests: () => {
      records = new Map();
      snapshot = EMPTY;
      loading = null;
      unsubscribeStorage?.();
      unsubscribeStorage = null;
      ownerSnapshots.clear();
      aborters.clear();
    },
  };
}

export type SavedRecordings<Audio> = ReturnType<typeof createSavedRecordings<Audio>>;

/**
 * Takes a finished transcript. Returns true when it consumed it, after which the recording is
 * discarded; otherwise the transcript waits on the recording for an explicit Insert.
 */
export type SavedRecordingConsumer = (
  recording: SavedRecordingEntry,
  transcript: string,
) => boolean | Promise<boolean>;

/** A composer that a recording can write into, guarded by the draft captured at recording. */
export function composerRecordingConsumer(target: {
  readonly readDraft: () => VoiceDraftSnapshot | null;
  readonly commitDraft: (
    text: string,
    selection: { readonly start: number; readonly end: number },
    edit: VoiceTranscriptEdit,
  ) => boolean;
}): SavedRecordingConsumer {
  return (recording, transcript) => {
    const insertion = resolveParkedInsertion({
      captured: recording.capturedDraft,
      current: target.readDraft(),
      transcript,
      locale: recording.locale,
    });
    return (
      insertion.kind === "commit" &&
      target.commitDraft(insertion.text, insertion.selection, insertion.edit)
    );
  };
}

export function createRecordingConsumers() {
  const exact = new Map<string, SavedRecordingConsumer>();
  const prefixes = new Map<string, SavedRecordingConsumer>();
  return {
    register: (ownerKey: string, consumer: SavedRecordingConsumer) => {
      exact.set(ownerKey, consumer);
      return () => {
        if (exact.get(ownerKey) === consumer) exact.delete(ownerKey);
      };
    },
    registerPrefix: (prefix: string, consumer: SavedRecordingConsumer) => {
      prefixes.set(prefix, consumer);
      return () => {
        if (prefixes.get(prefix) === consumer) prefixes.delete(prefix);
      };
    },
    resolve: (ownerKey: string): SavedRecordingConsumer | null => {
      const direct = exact.get(ownerKey);
      if (direct) return direct;
      for (const [prefix, consumer] of prefixes) if (ownerKey.startsWith(prefix)) return consumer;
      return null;
    },
  };
}

export type RecordingConsumers = ReturnType<typeof createRecordingConsumers>;

export const DICTATION_UNAVAILABLE_MESSAGE = {
  unsupported: "This environment can't transcribe recordings.",
  forbidden: "This connection can't use dictation.",
  disabled: "Dictation is turned off for this environment.",
  "no-source": "No transcription account is available.",
  "no-capture": "No transcription account is available.",
} satisfies Record<Exclude<DictationHiddenReason, "unknown">, string>;

export function savedRecordingAfterFailure(
  recording: Pick<SavedRecording, "attempts">,
  failure: Pick<DictationClipFailure, "kind" | "message">,
  now: number,
): SavedRecordingPatch {
  switch (failure.kind) {
    case "cancelled":
      return { status: "waiting" };
    case "transient": {
      const attempts = recording.attempts + 1;
      return {
        status: "waiting",
        error: failure.message,
        attempts,
        retryAt: now + threadOutboxRetryDelayMs(attempts),
      };
    }
    case "empty":
    case "terminal":
      return { status: "failed", error: failure.message };
  }
}

export const RETRY_SAVED_RECORDING: SavedRecordingPatch = {
  status: "waiting",
  error: null,
  retryAt: 0,
};

export function planSavedRecordingRuns(input: {
  readonly recordings: ReadonlyArray<SavedRecordingEntry>;
  readonly reachable: ReadonlySet<EnvironmentId>;
  readonly isRunning: (id: string) => boolean;
  readonly now: number;
}): { readonly due: ReadonlyArray<string>; readonly nextRetryAt: number | null } {
  const due: string[] = [];
  let nextRetryAt: number | null = null;
  for (const recording of input.recordings) {
    if (
      recording.status !== "waiting" ||
      !input.reachable.has(recording.environmentId) ||
      input.isRunning(recording.id)
    ) {
      continue;
    }
    if (recording.retryAt > input.now) {
      nextRetryAt = Math.min(nextRetryAt ?? recording.retryAt, recording.retryAt);
      continue;
    }
    due.push(recording.id);
  }
  return { due, nextRetryAt };
}

/** Transcribes saved recordings and hands each transcript to whoever owns the recording. */
export function createSavedRecordingRunner<Audio>(input: {
  readonly recordings: SavedRecordings<Audio>;
  readonly consumers: RecordingConsumers;
  readonly availability: (environmentId: EnvironmentId) => DictationAvailability;
  readonly transcribe: (
    recording: SavedRecordingEntry,
    audio: Audio,
    signal: AbortSignal,
  ) => Promise<string>;
  /** Serialises work on one recording across tabs; resolves null when another holder has it. */
  readonly withLock?: <A>(id: string, run: () => Promise<A>) => Promise<A | null>;
  readonly now?: () => number;
}) {
  const { recordings } = input;
  const now = input.now ?? Date.now;
  const running = new Set<string>();

  const runOnce = async (id: string) => {
    const recording = recordings.get(id);
    const audio = recordings.audio(id);
    if (!recording || audio === null || recording.status !== "waiting") return;
    const availability = input.availability(recording.environmentId);
    if (availability.kind === "hidden") {
      if (availability.reason !== "unknown") {
        await recordings.update(id, {
          status: "failed",
          error: DICTATION_UNAVAILABLE_MESSAGE[availability.reason],
        });
      }
      return;
    }
    if (!(await recordings.update(id, { status: "transcribing", error: null }))) return;
    const controller = new AbortController();
    const unregister = recordings.registerWork(id, controller);
    const outcome = await input.transcribe(recording, audio, controller.signal).then(
      (text) => ({ ok: true as const, text }),
      (error: unknown) => ({ ok: false as const, failure: classifyDictationFailure(error) }),
    );
    unregister();
    if (recording.persisted) await recordings.reload();
    const current = recordings.get(id);
    if (!current) return;
    if (!outcome.ok) {
      await recordings.update(id, savedRecordingAfterFailure(current, outcome.failure, now()));
      return;
    }
    const consumed = await (input.consumers.resolve(current.ownerKey)?.(current, outcome.text) ??
      false);
    if (consumed) {
      await recordings.discard(id);
      return;
    }
    await recordings.update(id, { status: "ready", transcript: outcome.text.trim(), error: null });
  };

  const run = async (id: string): Promise<void> => {
    if (running.has(id)) return;
    running.add(id);
    try {
      const recording = recordings.get(id);
      if (input.withLock && recording?.persisted) {
        await input.withLock(id, async () => {
          await recordings.reload();
          await runOnce(id);
        });
      } else {
        await runOnce(id);
      }
    } finally {
      running.delete(id);
    }
  };

  const isRunning = (id: string) => running.has(id);

  return {
    run,
    isRunning,
    plan: (reachable: ReadonlySet<EnvironmentId>) =>
      planSavedRecordingRuns({ recordings: recordings.all(), reachable, isRunning, now: now() }),
    retry: async (id: string) => {
      if (await recordings.update(id, RETRY_SAVED_RECORDING)) await run(id);
    },
    /** Hands a ready transcript to an owner that may not have existed when it finished. */
    offer: async (id: string) => {
      const recording = recordings.get(id);
      if (recording?.status !== "ready" || recording.transcript === null) return;
      const consumer = input.consumers.resolve(recording.ownerKey);
      if (consumer && (await consumer(recording, recording.transcript))) {
        await recordings.discard(id);
      }
    },
  };
}

export type SavedRecordingRunner = ReturnType<typeof createSavedRecordingRunner>;
