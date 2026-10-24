import { resolveThreadOutboxDispatchStep } from "@supaterm/client-runtime/thread-outbox";
import { createBrowserThreadOutbox, type ThreadOutboxEntry } from "./threadOutboxDelivery";
import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  deriveThreadTitleSeed,
  threadTitleTextFromPrompt,
  type StartThreadTurnInput,
} from "@supaterm/client-runtime/operations";
import { resolveTranscriptCommit } from "@supaterm/client-runtime/voice-input";
import { runAtomCommand, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import {
  runAttachmentUploadCycle,
  verifyPersistedAttachmentUpload,
} from "@supaterm/client-runtime/state/attachments";
import {
  CommandId,
  ChatAttachment,
  AttachmentCreateUploadUrlInput,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import { remapComposerContextAttachments } from "@supaterm/shared/composerContextReferences";
import { resolveDefaultWorktreeBaseBranch } from "@supaterm/shared/git";
import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { useSyncExternalStore } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  composerTargetKey,
  DraftId,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  restoreFailedBackgroundDraftThread,
  useComposerDraftStore,
} from "../composerDraftStore";
import { recordingConsumers, webRecordingRunner } from "../dictation/pendingClipRunner";
import { webRecordings } from "../dictation/pendingClips";
import { attachmentEnvironment } from "./attachments";
import { environmentPresentations } from "./presentation";
import { environmentShell } from "./shell";
import { environmentServerConfigsAtom } from "./server";
import { directThreadEnvironment } from "./threadCommands";
import { readPreparedConnection } from "./session";
import { OutboxTurn, OutboxAttachment, type OutboxTurnVoice } from "./threadOutboxSchema";
import { browserThreadOutboxStorage } from "./threadOutboxStorage";
import { randomUUID, newThreadId } from "../lib/utils";
import { assetEnvironment } from "./assets";
import { fetchVcsRefs } from "./vcs";

const decodeUpload = Schema.decodeUnknownSync(AttachmentCreateUploadUrlInput);
const decodeAttachment = Schema.decodeSync(ChatAttachment);
const decodeTurn = Schema.decodeSync(OutboxTurn);

export type PendingThreadTurn = ThreadOutboxEntry<OutboxTurn>;

async function command<A, E, Input>(
  operation: import("@supaterm/client-runtime/state/runtime").AtomCommand<Input, A, E>,
  input: Input,
) {
  const result = await runAtomCommand(appAtomRegistry, operation, input, { reportFailure: false });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

async function uploadAttachment(
  environmentId: EnvironmentId,
  attachment: typeof OutboxAttachment.Type,
) {
  if (attachment.bytes === null)
    throw new Error(`Attach '${attachment.name}' again before sending.`);
  const result = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId,
    upload: decodeUpload({
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    }),
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) => {
      const controller = new AbortController();
      return {
        abort: () => controller.abort(),
        done: (async () => {
          let response: Response;
          try {
            response = await fetch(url, {
              method: "POST",
              body: attachment.bytes,
              headers: { "Content-Type": attachment.mimeType },
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]),
            });
          } catch (error) {
            throw new Error("Attachment upload disconnected.", { cause: error });
          }
          if (!response.ok)
            throw new Error(
              response.status >= 500 || response.status === 408 || response.status === 429
                ? `Attachment upload (${response.status}) disconnected.`
                : `Attachment upload failed (${response.status}).`,
            );
        })(),
      };
    },
  });
  if (result.status === "failed") throw result.error;
  if (result.status !== "uploaded") throw new Error("Attachment upload disconnected.");
  return decodeAttachment({
    type: attachment.type,
    id: result.attachmentId,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.source ? { source: attachment.source } : {}),
  });
}

function isThreadOutboxDeliverable(
  environmentId: EnvironmentId,
  read: <A>(atom: Atom.Atom<A>) => A,
) {
  return (
    read(environmentPresentations.presentationAtom(environmentId))?.connection.phase ===
      "connected" &&
    read(environmentShell.stateValueAtom(environmentId)).status === "live" &&
    read(environmentServerConfigsAtom).has(environmentId)
  );
}

export const threadOutboxDeliverableAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => isThreadOutboxDeliverable(environmentId, get)),
);

export const webThreadOutbox = createBrowserThreadOutbox<OutboxTurn>({
  storage: browserThreadOutboxStorage,
  registry: appAtomRegistry,
  identify: (payload) => ({
    environmentId: payload.environmentId,
    threadId: payload.input.threadId,
  }),
  now: () => Date.now(),
  canRemoveDelivered: (entry) => {
    if (!entry.payload.input.bootstrap?.createThread) return true;
    const snapshot = appAtomRegistry.get(
      directThreadEnvironment.snapshotAtom(entry.payload.environmentId),
    );
    if (!snapshot) return false;
    return (
      snapshot.threads.some((thread) => thread.id === entry.payload.input.threadId) ||
      snapshot.archivedThreads.some((thread) => thread.id === entry.payload.input.threadId)
    );
  },
  // A voice message waits for its recording's transcript before it can be sent.
  canDeliver: (entry) =>
    entry.payload.voice === undefined &&
    isThreadOutboxDeliverable(entry.payload.environmentId, (atom) => appAtomRegistry.get(atom)),
  deliver: async (entry, savePayload) => {
    if (entry.payload.voice)
      throw new Error("The voice message was not transcribed. Retry to transcribe it.");
    let payload = { ...entry.payload, localAttachments: [...entry.payload.localAttachments] };
    const { environmentId } = payload;
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
    if (!config) throw new Error("Environment is not connected.");
    if (payload.pendingWorktree) {
      const refs = await command(fetchVcsRefs, {
        environmentId,
        input: { cwd: payload.pendingWorktree.projectCwd, limit: 100, refresh: true },
      });
      const baseBranch = resolveDefaultWorktreeBaseBranch(refs.refs);
      if (!refs.isRepo || !baseBranch)
        throw new Error(
          refs.isRepo
            ? "No default or current branch is available. Choose a base branch for this worktree."
            : "This project is not a Git repository. Choose Current checkout to start the task.",
        );
      const { pendingWorktree, ...resolved } = payload;
      const bootstrap = payload.input.bootstrap;
      payload = {
        ...resolved,
        input: {
          ...payload.input,
          bootstrap: {
            ...bootstrap,
            ...(bootstrap?.createThread
              ? { createThread: { ...bootstrap.createThread, branch: baseBranch } }
              : {}),
            prepareWorktree: { ...pendingWorktree, baseBranch },
            runSetupScript: true,
          },
        },
      };
      await savePayload(payload);
    }
    for (let index = 0; index < payload.localAttachments.length; index++) {
      let attachment = payload.localAttachments[index]!;
      if (attachment.uploaded) {
        const verified = await verifyPersistedAttachmentUpload({
          registry: appAtomRegistry,
          createAssetUrl: assetEnvironment.createUrl,
          environmentId,
          attachmentId: attachment.uploaded.id,
        });
        if (verified.status === "failed") throw verified.error;
        if (verified.status === "verified") continue;
        const { uploaded: _, ...remaining } = attachment;
        attachment = remaining;
        payload.localAttachments[index] = attachment;
        await savePayload(payload);
      }
      if (attachment.type === "file") {
        const step = resolveThreadOutboxDispatchStep({
          deliveryAction: "send",
          fileAttachments: [attachment],
          serverConfig: {
            maxFileUploadBytes: config.environment.capabilities.fileAttachments?.maxUploadBytes,
          },
        });
        if (step.step === "restore") throw new Error(step.reason);
      }
      const uploaded = await uploadAttachment(environmentId, attachment);
      payload.localAttachments[index] = { ...attachment, uploaded };
      await savePayload(payload);
    }
    const local = payload.localAttachments;
    const attachments =
      local.length === 0
        ? payload.input.message.attachments
        : local.map((attachment) => {
            if (!attachment.uploaded)
              throw new Error(`Attach '${attachment.name}' again before sending.`);
            return attachment.uploaded;
          });
    const context =
      local.length === 0
        ? payload.input.message.context
        : remapComposerContextAttachments(
            payload.input.message.context,
            local.map((attachment) => ({
              type: attachment.type,
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            })),
            attachments.map((attachment, index) => ({ id: attachment.id ?? local[index]!.id })),
          );
    const thread = appAtomRegistry
      .get(directThreadEnvironment.snapshotAtom(environmentId))
      ?.threads.find((candidate) => candidate.id === payload.input.threadId);
    const target = { environmentId };
    if (thread && !payload.input.bootstrap?.createThread) {
      if (payload.branch !== undefined && payload.branch !== thread.branch) {
        await command(directThreadEnvironment.updateMetadata, {
          ...target,
          input: {
            threadId: thread.id,
            commandId: CommandId.make(`${payload.input.commandId}:branch`),
            branch: payload.branch,
          },
        });
      }
      if (thread.runtimeMode !== payload.input.runtimeMode) {
        await command(directThreadEnvironment.setRuntimeMode, {
          ...target,
          input: {
            threadId: thread.id,
            commandId: CommandId.make(`${payload.input.commandId}:runtime`),
            runtimeMode: payload.input.runtimeMode,
          },
        });
      }
      if (thread.interactionMode !== payload.input.interactionMode) {
        await command(directThreadEnvironment.setInteractionMode, {
          ...target,
          input: {
            threadId: thread.id,
            commandId: CommandId.make(`${payload.input.commandId}:interaction`),
            interactionMode: payload.input.interactionMode,
          },
        });
      }
    }
    if (!appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId))
      throw new Error("Environment is not connected.");
    const { context: _, ...message } = payload.input.message;
    await command(directThreadEnvironment.startTurn, {
      ...target,
      input: {
        ...payload.input,
        message: {
          ...message,
          attachments,
          ...(context ? { context } : {}),
        },
      },
    });
    if (payload.draftId) {
      const ref = scopeThreadRef(environmentId, payload.input.threadId);
      markPromotedDraftThreadByRef(ref);
      if (payload.background) finalizePromotedDraftThreadByRef(ref);
    }
  },
});

function prepareThreadOutboxTurn(target: {
  readonly environmentId: EnvironmentId;
  readonly input: StartThreadTurnInput;
  readonly localAttachments?: ReadonlyArray<typeof OutboxAttachment.Type>;
  readonly pendingWorktree?: OutboxTurn["pendingWorktree"];
  readonly branch?: string;
  readonly draftId?: DraftId;
  readonly background?: boolean;

  readonly voice?: typeof OutboxTurnVoice.Type;
}) {
  const commandId = target.input.commandId ?? CommandId.make(randomUUID());
  const payload = decodeTurn({
    environmentId: target.environmentId,
    input: { ...target.input, commandId },
    localAttachments: target.localAttachments ?? [],
    ...(target.pendingWorktree ? { pendingWorktree: target.pendingWorktree } : {}),
    ...(target.branch === undefined ? {} : { branch: target.branch }),
    ...(target.draftId === undefined ? {} : { draftId: target.draftId }),
    ...(target.background === undefined ? {} : { background: target.background }),
    ...(target.voice ? { voice: target.voice } : {}),
  });
  return {
    id: payload.input.message.messageId,
    scope: scopedThreadKey(scopeThreadRef(target.environmentId, target.input.threadId)),
    createdAt: target.input.createdAt ?? new Date().toISOString(),
    payload,
  };
}

export function enqueueThreadOutboxTurn(target: Parameters<typeof prepareThreadOutboxTurn>[0]) {
  return webThreadOutbox.enqueue(prepareThreadOutboxTurn(target));
}

export function enqueueThreadOutboxTurns(
  targets: ReadonlyArray<Parameters<typeof prepareThreadOutboxTurn>[0]>,
) {
  return webThreadOutbox.enqueueMany(targets.map(prepareThreadOutboxTurn));
}

function queuedBehind(entry: PendingThreadTurn): ReadonlyArray<PendingThreadTurn> {
  return webThreadOutbox
    .getSnapshot()
    .filter(
      (candidate) =>
        candidate.scope === entry.scope &&
        candidate.id !== entry.id &&
        candidate.createdAt.localeCompare(entry.createdAt) >= 0,
    );
}

/** Cancelling a pending task also cancels the follow-ups queued behind it. */
export async function cancelThreadOutboxTurn(entry: PendingThreadTurn) {
  const createsThread = entry.payload.input.bootstrap?.createThread !== undefined;
  const cancelledEntries = createsThread ? [entry, ...queuedBehind(entry)] : [entry];
  const cancelled = createsThread
    ? await webThreadOutbox.cancelWithFollowing(entry.id)
    : await webThreadOutbox.cancel(entry.id);
  if (!cancelled) throw new Error("Delivery has already started.");
  for (const cancelledEntry of cancelledEntries) {
    const { voice } = cancelledEntry.payload;
    if (voice) await webRecordings.discard(voice.recordingId);
  }
}

export function outboxRecordingOwnerKey(messageId: string): string {
  return `${OUTBOX_RECORDING_OWNER_PREFIX}${messageId}`;
}

const OUTBOX_RECORDING_OWNER_PREFIX = "outbox:";

function appendTranscript(text: string, transcript: string, locale: string): string | null {
  const end = { start: text.length, end: text.length };
  const draft = { ownerKey: "", text, selection: end, revision: 0 };
  const result = resolveTranscriptCommit(draft, draft, transcript, locale);
  return result.kind === "commit" ? result.text : null;
}

/** Completes a queued voice message with its transcript so it can be delivered. */
async function applyOutboxTranscript(
  messageId: string,
  recordingId: string,
  transcript: string,
  locale: string,
): Promise<boolean> {
  await webThreadOutbox.load();
  const entry = webThreadOutbox.getSnapshot().find((candidate) => candidate.id === messageId);
  if (entry?.payload.voice?.recordingId !== recordingId) return false;
  const { voice: _, ...turn } = entry.payload;
  const { message, bootstrap } = turn.input;
  const text = appendTranscript(message.text, transcript, locale);
  if (text === null) return false;
  const title =
    threadTitleTextFromPrompt(message.text).length === 0
      ? deriveThreadTitleSeed({ text, attachments: turn.localAttachments })
      : null;
  const completed = decodeTurn({
    ...turn,
    input: {
      ...turn.input,
      message: { ...message, text },
      ...(title !== null && turn.input.titleSeed !== undefined ? { titleSeed: title } : {}),
      ...(title !== null && bootstrap?.createThread
        ? { bootstrap: { ...bootstrap, createThread: { ...bootstrap.createThread, title } } }
        : {}),
    },
  });
  if (!(await webThreadOutbox.edit(entry.id, completed))) return false;
  void webThreadOutbox.drain();
  return true;
}

recordingConsumers.registerPrefix(OUTBOX_RECORDING_OWNER_PREFIX, (recording, transcript) =>
  applyOutboxTranscript(
    recording.ownerKey.slice(OUTBOX_RECORDING_OWNER_PREFIX.length),
    recording.id,
    transcript,
    recording.locale,
  ),
);

/** The recording a queued voice message is waiting on, for its status in the queue. */
export function threadOutboxRecording(entry: PendingThreadTurn) {
  const recordingId = entry.payload.voice?.recordingId;
  return recordingId === undefined ? null : webRecordings.get(recordingId);
}

export function retryThreadOutboxRecording(entry: PendingThreadTurn) {
  const recordingId = entry.payload.voice?.recordingId;
  if (recordingId !== undefined) void webRecordingRunner.retry(recordingId);
}

export function threadOutboxComposerTarget(entry: PendingThreadTurn) {
  if (entry.payload.draftId) return DraftId.make(entry.payload.draftId);
  if (entry.payload.input.bootstrap?.createThread) return null;
  return scopeThreadRef(entry.payload.environmentId, entry.payload.input.threadId);
}

// The composer takes back text and the recording, but not queued files, message
// context, or the follow-ups a new task's cancellation would remove with it.
export function canMoveThreadOutboxTurnToComposer(entry: PendingThreadTurn): boolean {
  const { input, localAttachments } = entry.payload;
  return (
    threadOutboxComposerTarget(entry) !== null &&
    localAttachments.length === 0 &&
    input.message.attachments.length === 0 &&
    input.message.context === undefined &&
    (input.bootstrap?.createThread === undefined || queuedBehind(entry).length === 0)
  );
}

export async function moveThreadOutboxTurnToComposer(entry: PendingThreadTurn) {
  const target = threadOutboxComposerTarget(entry);
  if (target === null || !canMoveThreadOutboxTurnToComposer(entry)) {
    throw new Error("This message can't move back to the composer.");
  }
  const { payload } = entry;
  const cancelled = payload.input.bootstrap?.createThread
    ? await webThreadOutbox.cancelWithFollowing(entry.id)
    : await webThreadOutbox.cancel(entry.id);
  if (!cancelled) throw new Error("Delivery has already started.");
  if (payload.voice) {
    await webRecordings.update(payload.voice.recordingId, { ownerKey: composerTargetKey(target) });
  }
  const typed = payload.input.message.text.trim();
  if (typed.length > 0) {
    const store = useComposerDraftStore.getState();
    const existing = store.getComposerDraft(target)?.prompt.trimEnd() ?? "";
    store.setPrompt(target, existing.length > 0 ? `${existing}\n\n${typed}` : typed);
  }
}

/** Rejected thread creation needs fresh identifiers; uncertain sends cannot be edited. */
export async function replaceThreadOutboxTurn(entry: PendingThreadTurn, payload: OutboxTurn) {
  const threadId =
    entry.status === "failed" && payload.input.bootstrap?.createThread
      ? newThreadId()
      : payload.input.threadId;
  const scope = scopedThreadKey(scopeThreadRef(payload.environmentId, threadId));
  const edited = decodeTurn({
    ...payload,
    input: { ...payload.input, threadId, commandId: CommandId.make(randomUUID()) },
  });
  // Follow-ups queued behind a rejected task move with it to its new thread.
  const changed =
    scope === entry.scope
      ? await webThreadOutbox.edit(entry.id, edited, scope)
      : await webThreadOutbox.editWithFollowing(entry.id, edited, scope, (followUp) => ({
          ...followUp,
          input: { ...followUp.input, threadId },
        }));
  if (!changed) throw new Error("Delivery has already started. Reconnect to confirm the message.");
  if (threadId !== entry.payload.input.threadId && payload.draftId) {
    const draftId = DraftId.make(payload.draftId);
    const draft = useComposerDraftStore.getState().getDraftSession(draftId);
    if (draft) restoreFailedBackgroundDraftThread(draftId, draft, threadId);
  }
  return threadId !== entry.payload.input.threadId
    ? scopeThreadRef(payload.environmentId, threadId)
    : null;
}

export function useThreadOutbox() {
  return useSyncExternalStore(webThreadOutbox.subscribe, webThreadOutbox.getSnapshot);
}

export function usePendingThreadCreation(ref: ScopedThreadRef | null) {
  const scope = ref ? scopedThreadKey(ref) : null;
  const snapshot = () =>
    webThreadOutbox
      .getSnapshot()
      .find(
        (entry) =>
          entry.scope === scope && entry.payload.input.bootstrap?.createThread !== undefined,
      ) ?? null;
  return useSyncExternalStore(webThreadOutbox.subscribe, snapshot);
}

export function readPendingThreadCreation(ref: ScopedThreadRef) {
  const scope = scopedThreadKey(ref);
  return (
    webThreadOutbox
      .getSnapshot()
      .find(
        (entry) =>
          entry.scope === scope && entry.payload.input.bootstrap?.createThread !== undefined,
      ) ?? null
  );
}

export function useThreadOutboxLoaded() {
  return useSyncExternalStore(webThreadOutbox.subscribe, webThreadOutbox.isLoaded);
}

export async function clearThreadOutboxEnvironment(environmentId: EnvironmentId) {
  await webThreadOutbox.clearEnvironment(environmentId);
}
