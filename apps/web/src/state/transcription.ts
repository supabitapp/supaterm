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
  uploadVoiceRecording,
  type VoiceTranscriptionSource,
} from "@supaterm/client-runtime/state/transcription";
import type { EnvironmentId, TranscriptionPrepareUploadInput } from "@supaterm/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
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

/** Posts through the environment's own connection, so remote and tunnelled environments work. */
export function uploadVoiceAudio(input: {
  readonly environmentId: EnvironmentId;
  readonly audio: Blob;
  readonly request: Omit<TranscriptionPrepareUploadInput, "sizeBytes">;
  readonly signal?: AbortSignal;
}) {
  const { environmentId } = input;
  return uploadVoiceRecording({
    request: { ...input.request, sizeBytes: input.audio.size },
    prepare: (request) =>
      command(transcriptionEnvironment.prepareUpload, { environmentId, input: request }),
    cancel: (uploadId) =>
      command(transcriptionEnvironment.cancelUpload, { environmentId, input: { uploadId } }),
    post: async (relativeUrl, signal) => {
      const connection = readPreparedConnection(environmentId);
      const url = connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
      if (!url) throw new Error("Environment is not connected.");
      const response = await fetch(url, {
        method: "POST",
        body: input.audio,
        headers: { "Content-Type": "audio/wav" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)]),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

/** Null while the environment has never been reached, so recording can still queue offline. */
export function useVoiceTranscriptionSource(
  environmentId: EnvironmentId,
): VoiceTranscriptionSource | null {
  const config = useAtomValue(environmentServerConfigsAtom).get(environmentId);
  return config ? resolveVoiceTranscriptionSource(config) : null;
}
