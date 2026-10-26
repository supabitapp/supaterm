import {
  createSavedRecordings,
  SavedRecording,
  type SavedRecordingEntry,
  type SavedRecordingStorage,
} from "@supaterm/client-runtime/voice-input";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

const DATABASE_NAME = "supaterm-dictation-clips";
const STORE = "clips";

const StoredClip = Schema.Struct({ ...SavedRecording.fields, blob: Schema.instanceOf(Blob) });
const decodeStoredClip = Schema.decodeUnknownOption(StoredClip);

let database: Promise<IDBDatabase> | null = null;
let channel: BroadcastChannel | null = null;

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

function broadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== "undefined" && typeof indexedDB !== "undefined") {
    channel ??= new BroadcastChannel(DATABASE_NAME);
  }
  return channel;
}

function announce() {
  broadcastChannel()?.postMessage("changed");
}

const indexedDbStorage: SavedRecordingStorage<Blob> = {
  load: async () => {
    const values = await transaction<unknown[]>("readonly", (store, complete) => {
      const request = store.getAll();
      request.onsuccess = () => complete(request.result);
    });
    return values.flatMap((value) => {
      const decoded = decodeStoredClip(value);
      if (decoded._tag === "None") return [];
      const { blob, ...recording } = decoded.value;
      return [{ recording, audio: blob }];
    });
  },
  add: async (recording, blob) => {
    await transaction<void>("readwrite", (store, complete) => {
      store.add({ ...recording, blob });
      complete(undefined);
    });
    announce();
    return blob;
  },
  update: async (recording) => {
    await transaction<void>("readwrite", (store, complete) => {
      const request = store.get(recording.id);
      request.onsuccess = () => {
        const decoded = decodeStoredClip(request.result);
        if (decoded._tag === "None") {
          request.transaction?.abort();
          return;
        }
        store.put({ ...recording, blob: decoded.value.blob });
        complete(undefined);
      };
    });
    announce();
  },
  remove: async (recording) => {
    await transaction<void>("readwrite", (store, complete) => {
      store.delete(recording.id);
      complete(undefined);
    });
    announce();
  },
  subscribe: (onChange) => {
    const current = broadcastChannel();
    current?.addEventListener("message", onChange);
    return () => current?.removeEventListener("message", onChange);
  },
};

export type PendingClip = SavedRecordingEntry;

export const webRecordings = createSavedRecordings(indexedDbStorage);

export function usePendingClips(ownerKey: string): ReadonlyArray<PendingClip> {
  return useSyncExternalStore(webRecordings.subscribe, () => webRecordings.owned(ownerKey));
}

export function useAllPendingClips(): ReadonlyArray<PendingClip> {
  return useSyncExternalStore(webRecordings.subscribe, webRecordings.all);
}

export async function clearPendingClipsEnvironment(environmentId: EnvironmentId): Promise<void> {
  await Promise.all(
    webRecordings
      .all()
      .filter((clip) => clip.environmentId === environmentId)
      .map((clip) => webRecordings.discard(clip.id)),
  );
}
