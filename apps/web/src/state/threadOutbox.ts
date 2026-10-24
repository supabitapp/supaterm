import {
  resolveThreadOutboxDispatchStep,
  shouldRetryThreadOutboxDelivery,
} from "@supaterm/client-runtime/thread-outbox";
import { createBrowserThreadOutbox, type ThreadOutboxEntry } from "./threadOutboxDelivery";
import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  deriveThreadTitleSeed,
  threadTitleTextFromPrompt,
  type StartThreadTurnInput,
} from "@supaterm/client-runtime/operations";
import type { DictationHiddenReason } from "@supaterm/client-runtime/state/dictation";
import {
  extractVoiceSlot,
  spliceTranscriptAt,
  VOICE_SLOT,
} from "@supaterm/client-runtime/voice-input";
import { runAtomCommand, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import {
  runAttachmentUploadCycle,
  verifyPersistedAttachmentUpload,
} from "@supaterm/client-runtime/state/attachments";
import {
  CommandId,
  ChatAttachment,
  AttachmentCreateUploadUrlInput,
  DictationSourceId,
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
import { parkPendingClip } from "../dictation/pendingClips";
import { DictationClipFailure, transcribeDictationClip } from "../dictation/transcribeClip";
import { attachmentEnvironment } from "./attachments";
import { readDictationAvailability } from "./dictation";
import { environmentPresentations } from "./presentation";
import { environmentShell } from "./shell";
import { environmentServerConfigsAtom } from "./server";
import { directThreadEnvironment } from "./threadCommands";
import { readPreparedConnection } from "./session";
import { OutboxTurn, OutboxAttachment, OutboxTurnVoice } from "./threadOutboxSchema";
import { browserThreadOutboxStorage } from "./threadOutboxStorage";
import { randomUUID, newThreadId } from "../lib/utils";
import { assetEnvironment } from "./assets";
import { fetchVcsRefs } from "./vcs";

const decodeUpload = Schema.decodeUnknownSync(AttachmentCreateUploadUrlInput);
const decodeAttachment = Schema.decodeSync(ChatAttachment);
const decodeTurn = Schema.decodeSync(OutboxTurn);
const isDictationSourceId = Schema.is(DictationSourceId);

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

const DICTATION_UNAVAILABLE = {
  disabled: "Dictation is turned off for this environment.",
  unsupported: "This environment can't transcribe recordings.",
  "no-capture": "This environment can't transcribe recordings.",
  forbidden: "This connection can't use dictation.",
  "no-source": "No transcription model is available.",
} satisfies Record<Exclude<DictationHiddenReason, "unknown">, string>;

function noSpeechDetected() {
  return new DictationClipFailure("empty", "No speech was detected. Nothing was sent.");
}

async function transcribeOutboxVoice(
  payload: OutboxTurn,
  voice: typeof OutboxTurnVoice.Type,
  signal: AbortSignal,
) {
  if (voice.bytes === null)
    throw new DictationClipFailure("terminal", "The recording is no longer available.");
  const availability = readDictationAvailability(
    payload.environmentId,
    payload.input.modelSelection?.instanceId ?? null,
  );
  let sourceId: DictationSourceId;
  if (availability.kind === "available") sourceId = availability.source.id;
  else if (availability.reason !== "unknown")
    throw new DictationClipFailure("terminal", DICTATION_UNAVAILABLE[availability.reason]);
  else if (voice.sourceId !== null && isDictationSourceId(voice.sourceId))
    sourceId = voice.sourceId;
  else throw new DictationClipFailure("transient", "Transcribes once connected.");
  const result = await transcribeDictationClip({
    environmentId: payload.environmentId,
    sourceId,
    clip: {
      blob: voice.bytes,
      mimeType: voice.mimeType,
      durationMs: voice.durationMs,
      locale: voice.locale,
    },
    signal,
  }).catch((error: unknown) => {
    throw error instanceof DictationClipFailure && error.kind === "empty"
      ? noSpeechDetected()
      : error;
  });
  return result.text;
}

async function prepareOutboxVoice(payload: OutboxTurn, signal: AbortSignal): Promise<OutboxTurn> {
  const { voice, ...turn } = payload;
  if (!voice) return payload;
  const transcript = voice.transcript ?? (await transcribeOutboxVoice(payload, voice, signal));
  const { message, bootstrap } = turn.input;
  const text = spliceTranscriptAt(message.text, voice.insertAt, transcript, voice.locale ?? "en");
  if (text === null) throw noSpeechDetected();

  const title =
    threadTitleTextFromPrompt(message.text).length === 0
      ? deriveThreadTitleSeed({ text, attachments: turn.localAttachments })
      : null;
  return {
    ...turn,
    input: {
      ...turn.input,
      message: { ...message, text },
      ...(title !== null && turn.input.titleSeed !== undefined ? { titleSeed: title } : {}),
      ...(title !== null && bootstrap?.createThread
        ? { bootstrap: { ...bootstrap, createThread: { ...bootstrap.createThread, title } } }
        : {}),
    },
  };
}

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
  canDeliver: (entry) =>
    isThreadOutboxDeliverable(entry.payload.environmentId, (atom) => appAtomRegistry.get(atom)),
  needsPreparation: (payload) => payload.voice !== undefined,
  prepare: (entry, signal) => prepareOutboxVoice(entry.payload, signal),
  shouldRetryPreparation: (error) =>
    error instanceof DictationClipFailure
      ? error.kind === "transient"
      : shouldRetryThreadOutboxDelivery(error),
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

function titleWithoutVoiceSlot(title: string) {
  return title.includes(VOICE_SLOT)
    ? deriveThreadTitleSeed({ text: title.replaceAll(VOICE_SLOT, ""), attachments: [] })
    : title;
}

function prepareThreadOutboxTurn(target: {
  readonly environmentId: EnvironmentId;
  readonly input: StartThreadTurnInput;
  readonly localAttachments?: ReadonlyArray<typeof OutboxAttachment.Type>;
  readonly pendingWorktree?: OutboxTurn["pendingWorktree"];
  readonly branch?: string;
  readonly draftId?: DraftId;
  readonly background?: boolean;

  readonly voice?: Omit<typeof OutboxTurnVoice.Type, "insertAt">;
}) {
  const commandId = target.input.commandId ?? CommandId.make(randomUUID());
  const { text, insertAt } = extractVoiceSlot(target.input.message.text);
  const { titleSeed, bootstrap } = target.input;
  const createThread = bootstrap?.createThread;
  const payload = decodeTurn({
    environmentId: target.environmentId,
    input: {
      ...target.input,
      commandId,
      message: { ...target.input.message, text },
      ...(titleSeed === undefined ? {} : { titleSeed: titleWithoutVoiceSlot(titleSeed) }),
      ...(createThread
        ? {
            bootstrap: {
              ...bootstrap,
              createThread: { ...createThread, title: titleWithoutVoiceSlot(createThread.title) },
            },
          }
        : {}),
    },
    localAttachments: target.localAttachments ?? [],
    ...(target.pendingWorktree ? { pendingWorktree: target.pendingWorktree } : {}),
    ...(target.branch === undefined ? {} : { branch: target.branch }),
    ...(target.draftId === undefined ? {} : { draftId: target.draftId }),
    ...(target.background === undefined ? {} : { background: target.background }),
    ...(target.voice ? { voice: { ...target.voice, insertAt } } : {}),
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

/** Cancelling a pending task also cancels the follow-ups queued behind it. */
export async function cancelThreadOutboxTurn(entry: PendingThreadTurn) {
  const cancelled = entry.payload.input.bootstrap?.createThread
    ? await webThreadOutbox.cancelWithFollowing(entry.id)
    : await webThreadOutbox.cancel(entry.id);
  if (!cancelled) throw new Error("Delivery has already started.");
}

export function threadOutboxComposerTarget(entry: PendingThreadTurn) {
  if (entry.payload.draftId) return DraftId.make(entry.payload.draftId);
  if (entry.payload.input.bootstrap?.createThread) return null;
  return scopeThreadRef(entry.payload.environmentId, entry.payload.input.threadId);
}

export async function moveThreadOutboxTurnToComposer(entry: PendingThreadTurn) {
  const target = threadOutboxComposerTarget(entry);
  if (target === null) throw new Error("This message has no draft to return to.");
  await cancelThreadOutboxTurn(entry);
  const { payload } = entry;
  const typed = payload.input.message.text.trim();
  if (typed.length > 0) {
    const store = useComposerDraftStore.getState();
    const existing = store.getComposerDraft(target)?.prompt.trimEnd() ?? "";
    store.setPrompt(target, existing.length > 0 ? `${existing}\n\n${typed}` : typed);
  }
  const { voice } = payload;
  if (!voice?.bytes) return;
  await parkPendingClip({
    ownerKey: composerTargetKey(target),
    environmentId: payload.environmentId,
    threadInstanceId: payload.input.modelSelection?.instanceId ?? null,
    blob: voice.bytes,
    mimeType: voice.mimeType,
    durationMs: voice.durationMs,
    locale: voice.locale,
    capturedDraft: null,
    ...(voice.transcript === undefined
      ? { status: "waiting" as const }
      : { status: "ready" as const, transcript: voice.transcript }),
  });
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
