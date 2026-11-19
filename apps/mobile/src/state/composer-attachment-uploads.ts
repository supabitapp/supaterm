import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import {
  attachmentUploadError,
  createAttachmentUploadRegistry,
} from "@supaterm/client-runtime/state/attachment-uploads";
import { verifyPersistedAttachmentUpload } from "@supaterm/client-runtime/state/attachments";
import { Atom } from "effect/reactivity";

import { uploadComposerAttachment } from "../lib/attachmentUpload";
import { retainComposerAttachmentFileForPreview } from "../lib/composerAttachmentPreviewRetention";
import {
  isFileBackedComposerAttachment,
  type DraftComposerAttachment,
} from "../lib/composerImages";
import {
  composerAttachmentUploadKey,
  composerDraftEnvironmentId,
  canUploadComposerAttachment,
  type ComposerAttachmentUploadState,
} from "../lib/composerAttachmentUploadQueue";
import { appAtomRegistry } from "./atom-registry";
import { assetEnvironment } from "./assets";
import { environmentServerConfigsAtom } from "./server";
import { recordQueuedAttachmentUploads } from "./queued-attachment-uploads";
import { flattenQueuedThreadMessages, threadOutboxManager } from "./thread-outbox";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import {
  ComposerDraftPersistenceError,
  type ComposerDraft,
  composerDraftsAtom,
  composerDraftUploadSourcesAtom,
  ensureComposerDraftsLoaded,
  flushComposerDrafts,
  setComposerDraftAttachmentUpload,
} from "./use-composer-drafts";
import { environmentSession, readEnvironmentScope, sessionHasScope } from "./session";
import { workspaceConnections } from "./workspace";

export {
  composerAttachmentUploadBlockReason,
  composerAttachmentsStillUploading,
} from "../lib/composerAttachmentUploadQueue";

export const composerAttachmentUploadsAtom = Atom.make<
  Readonly<Record<string, ComposerAttachmentUploadState>>
>({}).pipe(Atom.keepAlive);
const uploadStateAtom = Atom.family((key: string) =>
  Atom.map(composerAttachmentUploadsAtom, (states) => states[key]),
);
let uploadQueue: ReturnType<typeof createComposerUploadRegistry> | null = null;

export function useComposerAttachmentUploadState(
  environmentId: EnvironmentId | undefined,
  attachmentId: string,
) {
  return useAtomValue(
    uploadStateAtom(environmentId ? composerAttachmentUploadKey(environmentId, attachmentId) : ""),
  );
}

export function retryComposerAttachmentUpload(environmentId: EnvironmentId, attachmentId: string) {
  if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
  uploadQueue?.retry(composerAttachmentUploadKey(environmentId, attachmentId));
}

type ComposerAttachmentUploadRequest = {
  readonly environmentId: EnvironmentId;
  readonly attachment: DraftComposerAttachment;
};

export function composerAttachmentUploadRequests(input: {
  readonly drafts: Readonly<Record<string, Pick<ComposerDraft, "attachments" | "project">>>;
  readonly queuedMessagesByThreadKey: Parameters<typeof flattenQueuedThreadMessages>[0];
  /** An edited message's attachments upload through its editor draft. */
  readonly editingQueuedMessageIds: Readonly<Record<string, unknown>>;
  /** Every environment the client knows, so a draft key never resolves to a shorter connected prefix. */
  readonly knownEnvironmentIds: Iterable<EnvironmentId>;
  readonly connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly operableEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly serverConfigs: ReadonlyMap<
    EnvironmentId,
    Parameters<typeof canUploadComposerAttachment>[1]
  >;
}): ReadonlyArray<ComposerAttachmentUploadRequest> {
  const queued = flattenQueuedThreadMessages(input.queuedMessagesByThreadKey);
  const uploadable = (
    environmentId: EnvironmentId | null,
    attachments: ReadonlyArray<DraftComposerAttachment>,
  ): ReadonlyArray<ComposerAttachmentUploadRequest> =>
    environmentId === null ||
    !input.connectedEnvironmentIds.has(environmentId) ||
    !input.operableEnvironmentIds.has(environmentId)
      ? []
      : attachments.flatMap((attachment) =>
          canUploadComposerAttachment(attachment, input.serverConfigs.get(environmentId))
            ? [{ environmentId, attachment }]
            : [],
        );
  return [
    ...Object.entries(input.drafts).flatMap(([key, draft]) =>
      uploadable(
        composerDraftEnvironmentId(key, input.knownEnvironmentIds, queued, draft),
        draft.attachments,
      ),
    ),
    ...queued.flatMap((message) =>
      input.editingQueuedMessageIds[message.messageId]
        ? []
        : uploadable(
            message.environmentId,
            message.attachments.filter(
              (attachment) => attachment.uploadedAttachmentId === undefined,
            ),
          ),
    ),
  ];
}

const recordQueuedAttachmentUpload = Effect.fn("ComposerAttachments.recordQueuedUpload")(function* (
  environmentId: EnvironmentId,
  uploaded: DraftComposerAttachment,
) {
  const holders = flattenQueuedThreadMessages(
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  ).filter(
    (message) =>
      message.environmentId === environmentId &&
      message.attachments.some((attachment) => attachment.id === uploaded.id),
  );
  yield* Effect.forEach(
    holders,
    (message) =>
      Effect.tryPromise({
        try: () => recordQueuedAttachmentUploads(message.messageId, [uploaded]),
        catch: attachmentUploadError,
      }),
    { concurrency: "unbounded", discard: true },
  );
});

const composerAttachmentUploadRequestsAtom = Atom.make((get) => {
  const environments = get(workspaceConnections.environmentsAtom);
  const connected = environments.filter(
    (environment) => environment.connectionState === "connected",
  );
  const operableEnvironmentIds = new Set<EnvironmentId>();
  for (const { environmentId } of connected) {
    if (
      sessionHasScope(
        get(environmentSession.sessionStateAtom(environmentId)),
        AuthOrchestrationOperateScope,
      )
    ) {
      operableEnvironmentIds.add(environmentId);
    }
  }
  return composerAttachmentUploadRequests({
    drafts: get(composerDraftUploadSourcesAtom),
    queuedMessagesByThreadKey: get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
    editingQueuedMessageIds: get(editingQueuedMessageIdsAtom),
    knownEnvironmentIds: environments.map((environment) => environment.environmentId),
    connectedEnvironmentIds: new Set(connected.map((environment) => environment.environmentId)),
    operableEnvironmentIds,
    serverConfigs: get(environmentServerConfigsAtom),
  });
}).pipe(Atom.withLabel("mobile:composer-attachment-upload-requests"));

const recordComposerAttachmentUpload = Effect.fn("ComposerAttachments.recordUpload")(function* (
  request: ComposerAttachmentUploadRequest,
  uploadedId: string,
) {
  const { environmentId, attachment } = request;
  const uploaded: DraftComposerAttachment = {
    ...attachment,
    uploadedAttachmentId: uploadedId,
    uploadEnvironmentId: environmentId,
  };
  const queued = flattenQueuedThreadMessages(
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  );
  const knownEnvironmentIds = appAtomRegistry
    .get(workspaceConnections.environmentsAtom)
    .map((environment) => environment.environmentId);
  let draftsChanged = false;
  for (const [key, draft] of Object.entries(appAtomRegistry.get(composerDraftsAtom))) {
    if (
      composerDraftEnvironmentId(key, knownEnvironmentIds, queued, draft) === environmentId &&
      draft.attachments.some((candidate) => candidate.id === attachment.id)
    ) {
      draftsChanged = setComposerDraftAttachmentUpload(key, uploaded) || draftsChanged;
    }
  }
  yield* recordQueuedAttachmentUpload(environmentId, uploaded);
  if (!draftsChanged) return;
  yield* Effect.tryPromise({ try: () => flushComposerDrafts(), catch: attachmentUploadError }).pipe(
    Effect.catchIf(
      (error) => error.cause instanceof ComposerDraftPersistenceError,
      (error) =>
        Effect.logWarning(
          "[composer-attachments] could not save the uploaded reference",
          error.cause,
        ),
    ),
  );
});

const createComposerUploadRegistry = () =>
  createAttachmentUploadRegistry<ComposerAttachmentUploadRequest>({
    key: (request) => composerAttachmentUploadKey(request.environmentId, request.attachment.id),
    environmentId: (request) => request.environmentId,
    concurrencyPerEnvironment: 3,
    onChange: (states) => appAtomRegistry.set(composerAttachmentUploadsAtom, states),
    upload: ({ environmentId, attachment }, reportProgress) =>
      Effect.acquireUseRelease(
        Effect.sync(() =>
          isFileBackedComposerAttachment(attachment)
            ? retainComposerAttachmentFileForPreview(attachment)
            : undefined,
        ),
        () => uploadComposerAttachment(environmentId, attachment, reportProgress),
        (release) => Effect.sync(() => release?.()),
      ),
    onUploaded: recordComposerAttachmentUpload,
  });

function composerAttachmentUploads() {
  uploadQueue ??= createComposerUploadRegistry();
  return uploadQueue;
}

/** Every send uploads through here, so it joins the composer's upload of the same attachment. */
export const uploadComposerAttachmentShared = Effect.fn("ComposerAttachments.uploadForSend")(
  function* (environmentId: EnvironmentId, attachment: DraftComposerAttachment) {
    const uploads = composerAttachmentUploads();
    const request = { environmentId, attachment };
    const key = composerAttachmentUploadKey(environmentId, attachment.id);
    const finishedEarlier = uploads.status(key)?.status === "ready";
    const uploadedId = yield* uploads.upload(request);
    if (!finishedEarlier) return uploadedId;
    const verification = yield* verifyPersistedAttachmentUpload({
      registry: appAtomRegistry,
      createAssetUrl: assetEnvironment.createUrl,
      environmentId,
      attachmentId: uploadedId,
    });
    if (verification.status === "verified") return uploadedId;
    if (verification.status === "failed") return yield* attachmentUploadError(verification.error);
    uploads.restart(key);
    return yield* uploads.upload(request);
  },
);

/**
 * Uploads draft and queued attachments to their environment as soon as it is connected and
 * operable. The queue follows the requests atom for its whole lifetime.
 */
export function createComposerAttachmentUploadWorker(
  requestsAtom: Atom.Atom<
    ReadonlyArray<ComposerAttachmentUploadRequest>
  > = composerAttachmentUploadRequestsAtom,
) {
  ensureComposerDraftsLoaded();
  const queue = composerAttachmentUploads();
  const unsubscribe = appAtomRegistry.subscribe(requestsAtom, (requests) => queue.sync(requests), {
    immediate: true,
  });
  return {
    queue,
    dispose: () => {
      unsubscribe();
      queue.dispose();
      if (uploadQueue === queue) uploadQueue = null;
    },
  };
}

export function installComposerAttachmentUploads(): () => void {
  return createComposerAttachmentUploadWorker().dispose;
}
