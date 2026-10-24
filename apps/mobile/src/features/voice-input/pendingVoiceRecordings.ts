import {
  createSavedRecordings,
  SavedRecording,
  type SavedRecordingEntry,
  type SavedRecordingStorage,
} from "@supaterm/client-runtime/voice-input";
import * as Schema from "effect/Schema";
import { Directory, File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";

// Documents survives cache eviction. Paths are resolved against the current container on every
// read because iOS may move the app container between launches. Every file operation here is
// synchronous, so a load never observes another operation half done.
const DIRECTORY_NAME = "supaterm-voice-recordings";
const SIDECAR_SUFFIX = ".json";
const STAGED_SUFFIX = ".json.tmp";

const decodeRecording = Schema.decodeUnknownSync(Schema.fromJsonString(SavedRecording));

function recordingsDirectory(): Directory {
  const directory = new Directory(Paths.document, DIRECTORY_NAME);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function sidecarFile(directory: Directory, id: string): File {
  return new File(directory, `${id}${SIDECAR_SUFFIX}`);
}

function deleteQuietly(file: File | undefined): void {
  try {
    if (file?.exists) file.delete();
  } catch (error) {
    console.warn("[voice-input] could not delete a saved recording file", error);
  }
}

function writeSidecar(directory: Directory, recording: SavedRecording): void {
  const staged = new File(directory, `${recording.id}${STAGED_SUFFIX}`);
  try {
    staged.create({ overwrite: true });
    staged.writeSync(JSON.stringify(recording));
    staged.moveSync(sidecarFile(directory, recording.id), { overwrite: true });
  } catch (error) {
    deleteQuietly(staged);
    throw error;
  }
}

function readSidecar(file: File | undefined): SavedRecording | null {
  if (!file) return null;
  try {
    return decodeRecording(file.textSync());
  } catch {
    return null;
  }
}

type RecordingFiles = { sidecar?: File; staged?: File; audio?: File };

function listRecordingFiles(directory: Directory): Map<string, RecordingFiles> {
  const groups = new Map<string, RecordingFiles>();
  for (const entry of directory.list()) {
    if (!(entry instanceof File)) continue;
    const id = entry.name.split(".", 1)[0] ?? entry.name;
    const group = groups.get(id) ?? {};
    groups.set(id, group);
    if (entry.name.endsWith(STAGED_SUFFIX)) group.staged = entry;
    else if (entry.name.endsWith(SIDECAR_SUFFIX)) group.sidecar = entry;
    else group.audio = entry;
  }
  return groups;
}

function storedAudioName(id: string, source: File): string {
  const dot = source.name.lastIndexOf(".");
  return dot < 0 ? id : `${id}${source.name.slice(dot)}`;
}

/** One audio file and one JSON sidecar per recording; the audio is addressed by file URI. */
export const voiceRecordingStorage: SavedRecordingStorage<string> = {
  load: async () => {
    const directory = recordingsDirectory();
    const loaded: Array<{ readonly recording: SavedRecording; readonly audio: string }> = [];
    for (const [id, files] of listRecordingFiles(directory)) {
      const sidecar = readSidecar(files.sidecar);
      // Moving staged details over the old ones removes the old file first, so a staged copy
      // without a readable sidecar is the latest complete write.
      const recording = sidecar ?? readSidecar(files.staged);
      if (recording?.id !== id || !files.audio) {
        deleteQuietly(files.sidecar);
        deleteQuietly(files.staged);
        deleteQuietly(files.audio);
        continue;
      }
      if (files.staged && sidecar) deleteQuietly(files.staged);
      else if (files.staged) {
        try {
          files.staged.moveSync(sidecarFile(directory, id), { overwrite: true });
        } catch {}
      }
      loaded.push({ recording, audio: files.audio.uri });
    }
    return loaded;
  },
  add: async (recording, uri) => {
    const directory = recordingsDirectory();
    const source = new File(uri);
    const destination = new File(directory, storedAudioName(recording.id, source));
    // Details land first so the audio only moves out of the recorder's cache once it can be
    // restored; until the move succeeds the original stays where it was.
    writeSidecar(directory, recording);
    try {
      source.moveSync(destination);
    } catch (error) {
      deleteQuietly(sidecarFile(directory, recording.id));
      throw error;
    }
    return destination.uri;
  },
  update: async (recording) => {
    writeSidecar(recordingsDirectory(), recording);
  },
  remove: async (recording) => {
    const files = listRecordingFiles(recordingsDirectory()).get(recording.id);
    for (const file of [files?.audio, files?.staged, files?.sidecar]) {
      if (file?.exists) file.delete();
    }
  },
  release: (uri) => deleteQuietly(new File(uri)),
};

export const savedVoiceRecordings = createSavedRecordings(voiceRecordingStorage);

const EMPTY: ReadonlyArray<SavedRecordingEntry> = [];

export function useAllPendingVoiceRecordings(): ReadonlyArray<SavedRecordingEntry> {
  return useSyncExternalStore(savedVoiceRecordings.subscribe, savedVoiceRecordings.all);
}

export function usePendingVoiceRecordings(
  ownerKey: string | null,
): ReadonlyArray<SavedRecordingEntry> {
  return useSyncExternalStore(savedVoiceRecordings.subscribe, () =>
    ownerKey === null ? EMPTY : savedVoiceRecordings.owned(ownerKey),
  );
}

export function discardAllPendingVoiceRecordings(): void {
  for (const recording of savedVoiceRecordings.all()) {
    void savedVoiceRecordings.discard(recording.id);
  }
}
