import type { VoiceDraftSnapshot } from "@supaterm/client-runtime/voice-input";
import { EnvironmentId, ProviderInstanceId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import { randomUUID } from "../lib/utils";

export type PendingClipStatus = "waiting" | "transcribing" | "ready" | "failed";

const StoredPendingClip = Schema.Struct({
  id: Schema.String,
  ownerKey: Schema.String,
  environmentId: EnvironmentId,
  threadInstanceId: Schema.NullOr(ProviderInstanceId),
  mimeType: Schema.String,
  durationMs: Schema.Number,
  locale: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  status: Schema.Literals(["waiting", "transcribing", "ready", "failed"]),
  transcript: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  attempts: Schema.Number,
  retryAt: Schema.Number,
  blob: Schema.instanceOf(Blob),
});
const decodeStoredClip = Schema.decodeUnknownSync(StoredPendingClip);

export interface PendingClip extends Omit<typeof StoredPendingClip.Type, "blob"> {
  readonly sizeBytes: number;

  readonly capturedDraft: VoiceDraftSnapshot | null;

  readonly persisted: boolean;
}

interface ClipRecord {
  readonly clip: PendingClip;
  readonly blob: Blob;
}

const DATABASE_NAME = "supaterm-dictation-clips";
const STORE = "clips";

let records = new Map<string, ClipRecord>();
let snapshot: ReadonlyArray<PendingClip> = [];
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;
let database: Promise<IDBDatabase> | null = null;
let channel: BroadcastChannel | null = null;

function storageChannel() {
  if (typeof BroadcastChannel !== "undefined" && typeof indexedDB !== "undefined" && !channel) {
    channel = new BroadcastChannel(DATABASE_NAME);
    channel.addEventListener("message", () => void reloadPendingClips());
  }
  return channel;
}

function publish(next: Map<string, ClipRecord>) {
  records = next;
  snapshot = [...next.values()]
    .map((record) => record.clip)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const listener of listeners) listener();
}

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser cannot store recordings."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.addEventListener("versionchange", () => {
        request.result.close();
        database = null;
      });
      resolve(request.result);
    };
    request.addEventListener("error", () => {
      database = null;
      reject(request.error);
    });
    request.onblocked = () => {
      database = null;
      reject(new Error("Close other Supaterm tabs to open recording storage."));
    };
  });
  return database;
}

async function transaction<A>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, complete: (result: A) => void) => void,
): Promise<A> {
  const db = await openDatabase();
  return new Promise<A>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: A;
    tx.oncomplete = () => resolve(result);
    tx.addEventListener("error", () => reject(tx.error));
    tx.addEventListener("abort", () =>
      reject(tx.error ?? new Error("Recording storage transaction was aborted.")),
    );
    operation(tx.objectStore(STORE), (value) => {
      result = value;
    });
  });
}

function toStored(record: ClipRecord): typeof StoredPendingClip.Type {
  const { capturedDraft: _, persisted: __, sizeBytes: ___, ...stored } = record.clip;
  return { ...stored, blob: record.blob };
}

async function persist(record: ClipRecord, create = false): Promise<boolean> {
  try {
    const saved = await transaction<boolean>("readwrite", (store, complete) => {
      if (create) {
        store.add(toStored(record));
        complete(true);
        return;
      }
      const request = store.getKey(record.clip.id);
      request.onsuccess = () => {
        if (request.result === undefined) {
          complete(false);
          return;
        }
        store.put(toStored(record));
        complete(true);
      };
    });
    if (saved) storageChannel()?.postMessage("changed");
    else await reloadPendingClips();
    return saved;
  } catch {
    return false;
  }
}

export function reloadPendingClips(recover = false): Promise<void> {
  return transaction<unknown[]>("readonly", (store, complete) => {
    const request = store.getAll();
    request.onsuccess = () => complete(request.result);
  })
    .then((values) => {
      const next = new Map([...records].filter(([, record]) => !record.clip.persisted));
      for (const value of values) {
        let stored: typeof StoredPendingClip.Type;
        try {
          stored = decodeStoredClip(value);
        } catch {
          continue;
        }
        if (next.has(stored.id)) continue;
        const previous = records.get(stored.id);
        const { blob, ...fields } = stored;
        next.set(stored.id, {
          blob,
          clip: {
            ...fields,

            status: recover && fields.status === "transcribing" ? "waiting" : fields.status,
            sizeBytes: blob.size,
            capturedDraft: previous?.clip.capturedDraft ?? null,
            persisted: true,
          },
        });
      }
      for (const [id, record] of records) {
        if (record.clip.persisted && !next.has(id)) aborters.get(id)?.abort();
      }
      publish(next);
    })
    .catch(() => undefined);
}

export function loadPendingClips(): Promise<void> {
  storageChannel();
  loadPromise ??= reloadPendingClips(true);
  return loadPromise;
}

export async function parkPendingClip(input: {
  readonly ownerKey: string;
  readonly environmentId: EnvironmentId;
  readonly threadInstanceId: ProviderInstanceId | null;
  readonly blob: Blob;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly locale: string | null;
  readonly capturedDraft: VoiceDraftSnapshot | null;
  readonly status?: "waiting" | "failed" | "ready";
  readonly transcript?: string;
  readonly error?: string | null;
  readonly retryAt?: number;
}): Promise<PendingClip> {
  const record: ClipRecord = {
    blob: input.blob,
    clip: {
      id: randomUUID(),
      ownerKey: input.ownerKey,
      environmentId: input.environmentId,
      threadInstanceId: input.threadInstanceId,
      mimeType: input.mimeType,
      durationMs: input.durationMs,
      locale: input.locale,
      createdAt: new Date().toISOString(),
      status: input.status ?? "waiting",
      transcript: input.transcript ?? null,
      error: input.error ?? null,
      attempts: 0,
      retryAt: input.retryAt ?? 0,
      sizeBytes: input.blob.size,
      capturedDraft: input.capturedDraft,
      persisted: true,
    },
  };
  const saved = await persist(record, true);
  const clip = { ...record.clip, persisted: saved };
  publish(new Map(records).set(clip.id, { ...record, clip }));
  return clip;
}

export function updatePendingClip(
  id: string,
  patch: Partial<Omit<PendingClip, "id" | "ownerKey" | "environmentId" | "createdAt">>,
): PendingClip | null {
  const record = records.get(id);
  if (!record) return null;
  const next = { blob: record.blob, clip: { ...record.clip, ...patch } };
  publish(new Map(records).set(id, next));
  if (next.clip.persisted && patch.persisted === undefined) void persist(next);
  return next.clip;
}

export async function retrySavingPendingClip(id: string): Promise<boolean> {
  const record = records.get(id);
  if (!record) return false;
  const saved = await persist(record, !record.clip.persisted);
  if (saved) updatePendingClip(id, { persisted: true });
  return saved;
}

const aborters = new Map<string, AbortController>();

export function registerPendingClipWork(id: string, controller: AbortController): () => void {
  aborters.set(id, controller);
  return () => {
    if (aborters.get(id) === controller) aborters.delete(id);
  };
}

export async function discardPendingClip(id: string): Promise<void> {
  aborters.get(id)?.abort();
  aborters.delete(id);
  if (!records.has(id)) return;
  const next = new Map(records);
  next.delete(id);
  publish(next);
  await transaction<void>("readwrite", (store, complete) => {
    store.delete(id);
    complete(undefined);
  }).catch(() => undefined);
  storageChannel()?.postMessage("changed");
}

export async function clearPendingClipsEnvironment(environmentId: EnvironmentId): Promise<void> {
  await Promise.all(
    snapshot
      .filter((clip) => clip.environmentId === environmentId)
      .map((clip) => discardPendingClip(clip.id)),
  );
}

export function readPendingClipBlob(id: string): Blob | null {
  return records.get(id)?.blob ?? null;
}

export function readPendingClip(id: string): PendingClip | null {
  return records.get(id)?.clip ?? null;
}

export function getPendingClips(): ReadonlyArray<PendingClip> {
  return snapshot;
}

export function subscribePendingClips(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: ReadonlyArray<PendingClip> = [];
const ownerSnapshots = new Map<
  string,
  { readonly source: ReadonlyArray<PendingClip>; readonly clips: ReadonlyArray<PendingClip> }
>();

function ownerClips(ownerKey: string): ReadonlyArray<PendingClip> {
  const cached = ownerSnapshots.get(ownerKey);
  if (cached?.source === snapshot) return cached.clips;
  const owned = snapshot.filter((clip) => clip.ownerKey === ownerKey);
  const unchanged =
    cached?.clips.length === owned.length &&
    cached.clips.every((clip, index) => clip === owned[index]);
  let clips: ReadonlyArray<PendingClip> = owned;
  if (owned.length === 0) clips = EMPTY;
  else if (unchanged) clips = cached.clips;
  ownerSnapshots.set(ownerKey, { source: snapshot, clips });
  return clips;
}

export function usePendingClips(ownerKey: string): ReadonlyArray<PendingClip> {
  return useSyncExternalStore(subscribePendingClips, () => ownerClips(ownerKey));
}

export function resetPendingClipsForTests(): void {
  records = new Map();
  snapshot = [];
  loadPromise = null;
  database = null;
  ownerSnapshots.clear();
  aborters.clear();
  channel?.close();
  channel = null;
}
