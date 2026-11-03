import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import {
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@supaterm/client-runtime/state/runtime";
import {
  createTranscriptionEnvironmentAtoms,
  resolveVoiceTranscriptionSource,
  type StartedLiveDictation,
  uploadVoiceRecording,
  type VoiceTranscriptionSource,
} from "@supaterm/client-runtime/state/transcription";
import { LiveDictation, openLiveDictationSocket } from "@supaterm/client-runtime/voice-input";
import type {
  EnvironmentId,
  TranscriptionPrepareStreamInput,
  TranscriptionPrepareUploadInput,
} from "@supaterm/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "./server";
import { readPreparedConnection } from "./session";

const transcriptionEnvironment = createTranscriptionEnvironmentAtoms(connectionAtomRuntime);

// A recording upload stays open until the environment has transcribed, and sent, it.
const UPLOAD_TIMEOUT_MS = 7 * 60_000;

async function command<A, E, Input>(operation: AtomCommand<Input, A, E>, input: Input) {
  const result = await runAtomCommand(appAtomRegistry, operation, input, { reportFailure: false });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

const environmentUrl = (environmentId: EnvironmentId, relativeUrl: string) => {
  const connection = readPreparedConnection(environmentId);
  const url = connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
  if (!url) throw new Error("Environment is not connected.");
  return url;
};

/**
 * Posts through the environment's own connection, so remote and tunnelled environments work.
 * `uploadId` names a dictation that streamed, so the environment joins what it already has.
 */
export function uploadVoiceAudio(input: {
  readonly environmentId: EnvironmentId;
  readonly audio: Blob;
  readonly request: Omit<TranscriptionPrepareUploadInput, "sizeBytes">;
  readonly streamed?: boolean;
  readonly signal?: AbortSignal;
}) {
  const { environmentId } = input;
  return uploadVoiceRecording({
    request: { ...input.request, sizeBytes: input.audio.size },
    prepare: (request) =>
      command(transcriptionEnvironment.prepareUpload, { environmentId, input: request }),
    cancel: (uploadId) => cancelVoiceUpload(environmentId, uploadId),
    post: async (relativeUrl, signal, withAudio) => {
      const response = await fetch(environmentUrl(environmentId, relativeUrl), {
        method: "POST",
        body: withAudio ? input.audio : null,
        headers: { "Content-Type": "audio/wav" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)]),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    ...(input.streamed === undefined ? {} : { streamed: input.streamed }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

function cancelVoiceUpload(environmentId: EnvironmentId, uploadId: string) {
  return command(transcriptionEnvironment.cancelUpload, { environmentId, input: { uploadId } });
}

/** Streams a recording to the environment while it is made. */
export function startLiveVoiceDictation(input: {
  readonly environmentId: EnvironmentId;
  readonly request: Omit<TranscriptionPrepareStreamInput, "uploadId">;
  readonly subscribe: (push: (pcm: Uint8Array) => void) => () => void;
}): StartedLiveDictation {
  const { environmentId } = input;
  const uploadId = randomUUID();
  const live = new LiveDictation({
    prepare: async () => {
      const prepared = await command(transcriptionEnvironment.prepareStream, {
        environmentId,
        input: { ...input.request, uploadId },
      });
      const url = new URL(environmentUrl(environmentId, prepared.relativeUrl));
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.toString();
    },
    openSocket: openLiveDictationSocket,
    subscribe: input.subscribe,
  });
  return { uploadId, live, cancel: () => cancelVoiceUpload(environmentId, uploadId) };
}

/** Read when recording starts, so a dictation keeps the choice its environment allowed then. */
export function environmentStreamsDictation(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.transcriptionStreams ===
    true
  );
}

/** Null while the environment has never been reached, so recording can still queue offline. */
export function useVoiceTranscriptionSource(
  environmentId: EnvironmentId,
): VoiceTranscriptionSource | null {
  const config = useAtomValue(environmentServerConfigsAtom).get(environmentId);
  return config ? resolveVoiceTranscriptionSource(config) : null;
}
