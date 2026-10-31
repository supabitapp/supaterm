import type { MessageId } from "@supaterm/contracts";

import { loadExpoFileSystem } from "../lib/expoFileSystem";
import { readVoiceRecording } from "../lib/voiceRecordingWav";
import { enqueueThreadOutboxMessage, threadOutboxManager } from "./thread-outbox";
import type { QueuedThreadMessage } from "./thread-outbox-model";

const THREAD_OUTBOX_AUDIO_DIRECTORY = "thread-outbox-audio";
const EXTENSION = ".wav";

async function audioDirectory() {
  const { Directory, Paths } = await loadExpoFileSystem();
  const directory = new Directory(Paths.document, THREAD_OUTBOX_AUDIO_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

export async function queuedVoiceRecordingFile(messageId: MessageId) {
  const { File } = await loadExpoFileSystem();
  return new File(await audioDirectory(), `${encodeURIComponent(messageId)}${EXTENSION}`);
}

/**
 * Moves the recorder's file into the outbox and queues its message in one synchronous step,
 * so the unused-recording sweep can never find the file without its owner.
 */
export async function enqueueVoiceThreadOutboxMessage(
  recordingUri: string,
  draft: Omit<QueuedThreadMessage, "voice">,
  language: string,
): Promise<void> {
  const recording = await readVoiceRecording(recordingUri);
  const message: QueuedThreadMessage = { ...draft, voice: { ...recording, language } };
  const { File } = await loadExpoFileSystem();
  const destination = await queuedVoiceRecordingFile(message.messageId);
  if (destination.exists) destination.delete();
  new File(recordingUri).moveSync(destination);
  try {
    await enqueueThreadOutboxMessage(message);
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export async function deleteQueuedVoiceRecording(messageId: MessageId): Promise<void> {
  const file = await queuedVoiceRecordingFile(messageId);
  if (file.exists) file.delete();
}

/** Deletes recordings that no queued voice message owns any more. */
export async function releaseUnusedQueuedVoiceRecordings(): Promise<void> {
  // An unreadable outbox record may still own a recording.
  if (!(await threadOutboxManager.load())) return;
  const { File } = await loadExpoFileSystem();
  const directory = await audioDirectory();
  const owners = new Set<string>(
    threadOutboxManager
      .getSnapshot()
      .flatMap((message: QueuedThreadMessage) => (message.voice ? [message.messageId] : [])),
  );
  for (const entry of directory.list()) {
    if (!(entry instanceof File) || !entry.name.endsWith(EXTENSION)) continue;
    let owner: string;
    try {
      owner = decodeURIComponent(entry.name.slice(0, -EXTENSION.length));
    } catch {
      owner = "";
    }
    if (!owners.has(owner)) entry.delete();
  }
}
