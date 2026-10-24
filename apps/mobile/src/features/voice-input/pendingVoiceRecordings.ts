import type { VoiceDraftSnapshot } from "@supaterm/client-runtime/voice-input";
import type { DictationSourceId, EnvironmentId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { Directory, File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";

import {
  restoredPendingVoiceRecording,
  StoredPendingVoiceRecording,
  type PendingVoiceRecording,
  type PendingVoiceRecordingPatch,
} from "./pendingVoiceRecordingModel";
import type { VoiceRecordingFormat } from "./voiceRoute";

// Documents survives cache eviction. Paths are resolved against the current container on every
// read because iOS may move the app container between launches.
const DIRECTORY_NAME = "supaterm-voice-recordings";
const SIDECAR_EXTENSION = ".json";

const decodeStored = Schema.decodeUnknownSync(Schema.fromJsonString(StoredPendingVoiceRecording));

let records = new Map<string, PendingVoiceRecording>();
let snapshot: ReadonlyArray<PendingVoiceRecording> = [];
const listeners = new Set<() => void>();
const aborters = new Map<string, AbortController>();
let loading: Promise<void> | null = null;

function recordingsDirectory(): Directory {
  const directory = new Directory(Paths.document, DIRECTORY_NAME);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function publish(next: Map<string, PendingVoiceRecording>): void {
  records = next;
  snapshot = [...next.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  for (const listener of listeners) listener();
}

function sidecarFile(id: string): File {
  return new File(recordingsDirectory(), `${id}${SIDECAR_EXTENSION}`);
}

function writeSidecar(recording: PendingVoiceRecording): void {
  const { capturedDraft: _, ...stored } = recording;
  const sidecar = sidecarFile(recording.id);
  if (!sidecar.exists) sidecar.create();
  sidecar.writeSync(JSON.stringify(stored));
}

function persist(recording: PendingVoiceRecording): void {
  try {
    writeSidecar(recording);
  } catch (error) {
    console.warn("[voice-input] could not save a recording's details", error);
  }
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch (error) {
    console.warn("[voice-input] could not delete a saved recording", error);
  }
}

function restore(): void {
  const entries = recordingsDirectory()
    .list()
    .filter((entry): entry is File => entry instanceof File);
  const next = new Map(records);
  const names = new Set(entries.map((entry) => entry.name));
  for (const entry of entries) {
    if (!entry.name.endsWith(SIDECAR_EXTENSION)) continue;
    let stored: StoredPendingVoiceRecording | null = null;
    try {
      stored = decodeStored(entry.textSync());
    } catch {}
    if (stored === null || !names.has(stored.fileName)) {
      deleteQuietly(entry);
      continue;
    }
    if (!next.has(stored.id)) next.set(stored.id, restoredPendingVoiceRecording(stored));
  }
  const referenced = new Set([...next.values()].map((recording) => recording.fileName));
  for (const entry of entries) {
    if (!entry.name.endsWith(SIDECAR_EXTENSION) && !referenced.has(entry.name)) {
      deleteQuietly(entry);
    }
  }
  publish(next);
}

export function loadPendingVoiceRecordings(): Promise<void> {
  loading ??= Promise.resolve()
    .then(restore)
    .catch((error: unknown) => {
      console.warn("[voice-input] could not restore saved recordings", error);
    });
  return loading;
}

/** Moves the recording out of the recorder's cache so the controller no longer owns it. */
export async function parkPendingVoiceRecording(input: {
  readonly id: string;
  readonly uri: string;
  readonly ownerKey: string;
  readonly environmentId: EnvironmentId;
  readonly sourceId: DictationSourceId;
  readonly format: VoiceRecordingFormat;
  readonly durationMs: number;
  readonly locale: string;
  readonly capturedDraft: VoiceDraftSnapshot | null;
  readonly state: PendingVoiceRecordingPatch & { readonly status: "waiting" | "ready" | "failed" };
}): Promise<PendingVoiceRecording> {
  await loadPendingVoiceRecordings();
  const fileName = `${input.id}.${input.format.extension}`;
  const recording: PendingVoiceRecording = {
    id: input.id,
    ownerKey: input.ownerKey,
    environmentId: input.environmentId,
    sourceId: input.sourceId,
    fileName,
    mimeType: input.format.mimeType,
    durationMs: input.durationMs,
    locale: input.locale,
    createdAt: new Date().toISOString(),
    transcript: null,
    error: null,
    attempts: 0,
    retryAt: 0,
    ...input.state,
    capturedDraft: input.capturedDraft,
  };
  // Restoring deletes audio without details, so the details land first and the
  // recording only counts as saved once both are on disk.
  writeSidecar(recording);
  try {
    new File(input.uri).moveSync(new File(recordingsDirectory(), fileName));
  } catch (error) {
    deleteQuietly(sidecarFile(recording.id));
    throw error;
  }
  publish(new Map(records).set(recording.id, recording));
  return recording;
}

export function updatePendingVoiceRecording(
  id: string,
  patch: PendingVoiceRecordingPatch,
): PendingVoiceRecording | null {
  const current = records.get(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  persist(next);
  publish(new Map(records).set(id, next));
  return next;
}

export function discardPendingVoiceRecording(id: string): void {
  aborters.get(id)?.abort();
  aborters.delete(id);
  const recording = records.get(id);
  if (!recording) return;
  const next = new Map(records);
  next.delete(id);
  publish(next);
  const directory = recordingsDirectory();
  deleteQuietly(new File(directory, recording.fileName));
  deleteQuietly(new File(directory, `${id}${SIDECAR_EXTENSION}`));
}

export function discardAllPendingVoiceRecordings(): void {
  for (const recording of snapshot) discardPendingVoiceRecording(recording.id);
}

export function pendingVoiceRecordingUri(recording: Pick<PendingVoiceRecording, "fileName">) {
  return new File(recordingsDirectory(), recording.fileName).uri;
}

export function registerPendingVoiceRecordingWork(
  id: string,
  controller: AbortController,
): () => void {
  aborters.set(id, controller);
  return () => {
    if (aborters.get(id) === controller) aborters.delete(id);
  };
}

export function readPendingVoiceRecording(id: string): PendingVoiceRecording | null {
  return records.get(id) ?? null;
}

export function getPendingVoiceRecordings(): ReadonlyArray<PendingVoiceRecording> {
  return snapshot;
}

function subscribePendingVoiceRecordings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAllPendingVoiceRecordings(): ReadonlyArray<PendingVoiceRecording> {
  return useSyncExternalStore(subscribePendingVoiceRecordings, getPendingVoiceRecordings);
}

const EMPTY: ReadonlyArray<PendingVoiceRecording> = [];
const ownerSnapshots = new Map<
  string,
  {
    readonly source: ReadonlyArray<PendingVoiceRecording>;
    readonly owned: ReadonlyArray<PendingVoiceRecording>;
  }
>();

function ownerRecordings(ownerKey: string): ReadonlyArray<PendingVoiceRecording> {
  const cached = ownerSnapshots.get(ownerKey);
  if (cached?.source === snapshot) return cached.owned;
  const owned = snapshot.filter((recording) => recording.ownerKey === ownerKey);
  const unchanged =
    cached !== undefined &&
    cached.owned.length === owned.length &&
    cached.owned.every((recording, index) => recording === owned[index]);
  const next = owned.length === 0 ? EMPTY : unchanged ? cached.owned : owned;
  ownerSnapshots.set(ownerKey, { source: snapshot, owned: next });
  return next;
}

export function usePendingVoiceRecordings(
  ownerKey: string | null,
): ReadonlyArray<PendingVoiceRecording> {
  return useSyncExternalStore(subscribePendingVoiceRecordings, () =>
    ownerKey === null ? EMPTY : ownerRecordings(ownerKey),
  );
}
