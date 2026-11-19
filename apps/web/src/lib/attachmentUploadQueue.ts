import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type ChatAttachment,
  type EnvironmentId,
} from "@supaterm/contracts";
import { parseScopedThreadKey } from "@supaterm/client-runtime/environment";
import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import {
  attachmentUploadError,
  createAttachmentUploadRegistry,
} from "@supaterm/client-runtime/state/attachment-uploads";
import {
  deletePendingAttachmentUpload,
  runAttachmentUploadCycle,
  verifyPersistedAttachmentUpload,
  type PersistedAttachmentVerification,
} from "@supaterm/client-runtime/state/attachments";
import { create } from "zustand";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import {
  DraftId,
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerThreadTarget,
} from "../composerDraftStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentCatalog } from "../connection/catalog";
import { assetEnvironment } from "../state/assets";
import { attachmentEnvironment } from "../state/attachments";
import { readEnvironmentScope, readPreparedConnection } from "../state/session";
import type { AttachmentUploadState, ReadyAttachmentUpload } from "./attachmentUploadState";

const MAX_UPLOADS_PER_ENVIRONMENT = 3;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

interface AttachmentUploadStore {
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
}

export const useAttachmentUploadStore = create<AttachmentUploadStore>(() => ({
  uploadsByImageId: {},
}));

interface UploadJob {
  readonly image: ComposerImageAttachment | ComposerFileAttachment;
  readonly environmentId: EnvironmentId;
  readonly draftTarget?: ComposerThreadTarget;
  readonly previous?: ReadyAttachmentUpload;
  readonly persistedAttachmentId?: string;
}

type DraftFileOwner = Pick<UploadJob, "image" | "environmentId" | "draftTarget">;

interface HeldUpload {
  readonly job: UploadJob;
  readonly release: () => void;
  readonly stopWatchingConnection: () => void;
}

const heldUploads = new Map<string, HeldUpload>();
const jobKey = (job: UploadJob) => `${job.environmentId}:${job.image.id}`;

function setUploadState(imageId: string, upload: AttachmentUploadState): void {
  useAttachmentUploadStore.setState((state) => ({
    uploadsByImageId: { ...state.uploadsByImageId, [imageId]: upload },
  }));
}

function clearUploadState(imageId: string): void {
  useAttachmentUploadStore.setState((state) => {
    if (!(imageId in state.uploadsByImageId)) {
      return state;
    }
    const uploadsByImageId = { ...state.uploadsByImageId };
    delete uploadsByImageId[imageId];
    return { uploadsByImageId };
  });
}

export function readAttachmentUpload(imageId: string): AttachmentUploadState | undefined {
  return useAttachmentUploadStore.getState().uploadsByImageId[imageId];
}

function resolveCurrentFileDraftTarget(job: DraftFileOwner): ComposerThreadTarget | undefined {
  if (job.draftTarget === undefined || job.image.type !== "file") {
    return undefined;
  }
  const store = useComposerDraftStore.getState();
  for (const [key, draft] of Object.entries(store.draftsByThreadKey)) {
    if (!draft.files.some((file) => file.id === job.image.id)) {
      continue;
    }
    const draftSession = store.draftThreadsByThreadKey[key];
    if (draftSession !== undefined) {
      if (draftSession.environmentId === job.environmentId) {
        return DraftId.make(key);
      }
      continue;
    }
    if (typeof job.draftTarget === "string" && job.draftTarget === key) {
      return DraftId.make(key);
    }
    const threadRef = parseScopedThreadKey(key);
    if (threadRef?.environmentId === job.environmentId) {
      return threadRef;
    }
  }
  return undefined;
}

function stampDraftFileUpload(job: DraftFileOwner, attachmentId: string): void {
  const draftTarget = resolveCurrentFileDraftTarget(job);
  if (draftTarget === undefined) {
    return;
  }
  useComposerDraftStore
    .getState()
    .setFileUpload(draftTarget, job.image.id, job.environmentId, attachmentId);
}

function deletePendingUpload(environmentId: EnvironmentId, attachmentId: string): void {
  if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
  deletePendingAttachmentUpload({
    registry: appAtomRegistry,
    remove: attachmentEnvironment.remove,
    environmentId,
    attachmentId,
  });
}

function uploadBytes(input: {
  readonly url: string;
  readonly file: File;
  readonly mimeType: string;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: number) => void;
}): Promise<void> {
  const xhr = new XMLHttpRequest();
  return new Promise<void>((resolve, reject) => {
    xhr.open("POST", input.url, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", input.mimeType);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload rejected (${xhr.status})`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    input.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(input.file);
  });
}

const canOperate = (environmentId: EnvironmentId) =>
  readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);

const failUpload = (job: UploadJob, reason: string, attachmentId?: string) =>
  Effect.sync(() =>
    setUploadState(job.image.id, {
      status: "failed",
      environmentId: job.environmentId,
      reason,
      ...(attachmentId ? { attachmentId } : {}),
      ...(job.previous ? { previous: job.previous } : {}),
    }),
  ).pipe(Effect.andThen(Effect.fail(attachmentUploadError(new Error(reason)))));

const uploadJob = Effect.fn("WebAttachmentUploads.upload")(function* (job: UploadJob) {
  if (!canOperate(job.environmentId)) {
    return yield* failUpload(job, "This connection cannot upload attachments.");
  }
  if (job.persistedAttachmentId) {
    const verification = yield* verifyPersistedAttachmentUpload({
      registry: appAtomRegistry,
      createAssetUrl: assetEnvironment.createUrl,
      environmentId: job.environmentId,
      attachmentId: job.persistedAttachmentId,
    });
    if (verification.status === "verified") {
      setUploadState(job.image.id, {
        status: "ready",
        environmentId: job.environmentId,
        attachmentId: job.persistedAttachmentId,
      });
      stampDraftFileUpload(job, job.persistedAttachmentId);
      return job.persistedAttachmentId;
    }
    if (verification.status === "missing" && !job.image.file && job.image.type === "file") {
      const draftTarget = resolveCurrentFileDraftTarget(job);
      if (
        draftTarget !== undefined &&
        useComposerDraftStore
          .getState()
          .markFileUploadMissing(
            draftTarget,
            job.image.id,
            job.environmentId,
            job.persistedAttachmentId,
          )
      ) {
        clearUploadState(job.image.id);
        return yield* attachmentUploadError(new Error("Uploaded file expired."));
      }
    }
    if (verification.status === "failed" || !job.image.file) {
      return yield* failUpload(
        job,
        verification.status === "missing"
          ? "Uploaded file expired. Remove it and attach it again."
          : "Uploaded file could not be verified. Retry when the server reconnects.",
      );
    }
  }

  const mimeType =
    job.image.type === "file"
      ? job.image.mimeType.toLowerCase()
      : PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
          (supportedMimeType) => supportedMimeType === job.image.mimeType.toLowerCase(),
        );
  if (!mimeType) return yield* failUpload(job, "Unsupported image type");
  const file = job.image.file;
  if (!file) return yield* failUpload(job, "Original file is no longer available");
  if (!canOperate(job.environmentId)) {
    return yield* failUpload(job, "This connection cannot upload attachments.");
  }

  let lastStep = -1;
  const result = yield* runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId: job.environmentId,
    upload: {
      ...(job.image.type === "file" ? { type: "file" as const } : {}),
      name: job.image.name,
      mimeType,
      sizeBytes: file.size,
    },
    resolveUploadUrl: (relativeUrl) => {
      if (!canOperate(job.environmentId)) return null;
      const connection = readPreparedConnection(job.environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) =>
      Effect.tryPromise({
        try: (signal) =>
          uploadBytes({
            url,
            file,
            mimeType,
            signal,
            onProgress: (progress) => {
              const step = Math.floor(progress * 20);
              if (step === lastStep || signal.aborted) return;
              lastStep = step;
              setUploadState(job.image.id, {
                status: "uploading",
                environmentId: job.environmentId,
                progress,
                ...(job.previous ? { previous: job.previous } : {}),
              });
            },
          }),
        catch: attachmentUploadError,
      }),
  });
  if (result.status === "uploaded") {
    setUploadState(job.image.id, {
      status: "ready",
      environmentId: job.environmentId,
      attachmentId: result.attachmentId,
    });
    stampDraftFileUpload(job, result.attachmentId);
    if (job.previous) {
      deletePendingUpload(job.previous.environmentId, job.previous.attachmentId);
    }
    return result.attachmentId;
  }
  return yield* failUpload(
    job,
    result.step === "mint"
      ? "Upload could not start"
      : result.step === "resolve-url"
        ? canOperate(job.environmentId)
          ? "Not connected"
          : "This connection cannot upload attachments."
        : result.error instanceof Error
          ? result.error.message
          : "Upload failed",
    result.attachmentId ?? undefined,
  );
});

const uploads = createAttachmentUploadRegistry<UploadJob>({
  key: jobKey,
  environmentId: (job) => job.environmentId,
  concurrencyPerEnvironment: MAX_UPLOADS_PER_ENVIRONMENT,
  upload: (job) =>
    uploadJob(job).pipe(
      Effect.catchDefect((defect) =>
        failUpload(job, "Upload failed").pipe(
          Effect.ensuring(Effect.logWarning("Composer attachment upload threw", defect)),
        ),
      ),
    ),
});

function awaitHeldUpload(imageId: string): Effect.Effect<void> {
  const held = heldUploads.get(imageId);
  const fiber = held === undefined ? undefined : uploads.current(jobKey(held.job));
  return fiber === undefined ? Effect.void : Effect.asVoid(Fiber.await(fiber));
}

export function startAttachmentUpload(input: {
  readonly environmentId: EnvironmentId;
  readonly image: ComposerImageAttachment | ComposerFileAttachment;
  readonly draftTarget?: ComposerThreadTarget;
  readonly force?: boolean;
}): void {
  if (!canOperate(input.environmentId)) return;
  const existingHold = heldUploads.get(input.image.id);
  if (existingHold?.job.environmentId === input.environmentId) {
    return;
  }

  const existing = readAttachmentUpload(input.image.id);
  if (
    !input.force &&
    existing?.status === "ready" &&
    existing.environmentId === input.environmentId
  ) {
    stampDraftFileUpload(input, existing.attachmentId);
    return;
  }
  if (existing?.status === "failed" && existing.environmentId === input.environmentId) {
    return;
  }
  if (
    existing &&
    "previous" in existing &&
    existing.previous?.environmentId === input.environmentId
  ) {
    cancelAttachmentUpload(input.image.id);
    if (existing.status === "failed" && existing.attachmentId) {
      deletePendingUpload(existing.environmentId, existing.attachmentId);
    }
    setUploadState(input.image.id, existing.previous);
    stampDraftFileUpload(input, existing.previous.attachmentId);
    return;
  }

  if (existingHold) {
    cancelAttachmentUpload(input.image.id);
  }
  const previous = existing?.status === "ready" ? existing : existing?.previous;
  const job: UploadJob = {
    image: input.image,
    environmentId: input.environmentId,
    ...(input.draftTarget !== undefined ? { draftTarget: input.draftTarget } : {}),
    ...(previous ? { previous } : {}),
    ...(!input.force &&
    input.image.type === "file" &&
    input.image.uploadEnvironmentId === input.environmentId &&
    input.image.uploadedAttachmentId
      ? { persistedAttachmentId: input.image.uploadedAttachmentId }
      : {}),
  };

  setUploadState(input.image.id, {
    status: "uploading",
    environmentId: input.environmentId,
    progress: 0,
    ...(previous ? { previous } : {}),
  });
  const connectionAtom = environmentCatalog.stateAtom(job.environmentId);
  const isConnected = () =>
    Option.exists(
      AsyncResult.value(appAtomRegistry.get(connectionAtom)),
      (state) => state.phase === "connected",
    );
  const ownsImage = () => heldUploads.get(input.image.id)?.job === job;
  let wasConnected = isConnected();
  const stopWatchingConnection = appAtomRegistry.subscribe(connectionAtom, () => {
    const connected = isConnected();
    const reconnected = connected && !wasConnected;
    wasConnected = connected;
    if (!reconnected) return;
    Effect.runFork(
      awaitHeldUpload(input.image.id).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (
              ownsImage() &&
              readAttachmentUpload(input.image.id)?.status === "failed" &&
              isConnected()
            ) {
              retryAttachmentUpload(input);
            }
          }),
        ),
      ),
    );
  });
  heldUploads.set(input.image.id, {
    job,
    release: uploads.hold(job),
    stopWatchingConnection,
  });
  uploads.current(jobKey(job))?.addObserver((exit) => {
    if (exit._tag !== "Success" || !ownsImage()) return;
    const held = heldUploads.get(input.image.id)!;
    heldUploads.delete(input.image.id);
    held.stopWatchingConnection();
    held.release();
  });
}

function cancelAttachmentUpload(imageId: string): void {
  const held = heldUploads.get(imageId);
  if (!held) {
    return;
  }
  heldUploads.delete(imageId);
  held.stopWatchingConnection();
  held.release();
}

export function releaseAttachmentUpload(imageId: string): void {
  const upload = readAttachmentUpload(imageId);
  cancelAttachmentUpload(imageId);
  if (upload?.status === "ready") {
    deletePendingUpload(upload.environmentId, upload.attachmentId);
  } else if (upload) {
    if (upload.status === "failed" && upload.attachmentId) {
      deletePendingUpload(upload.environmentId, upload.attachmentId);
    }
    if (upload.previous) {
      deletePendingUpload(upload.previous.environmentId, upload.previous.attachmentId);
    }
  }
  clearUploadState(imageId);
}

export function releasePersistedAttachmentUpload(input: {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly attachmentId: string;
}): void {
  const upload = readAttachmentUpload(input.id);
  if (
    upload?.status === "ready" &&
    upload.environmentId === input.environmentId &&
    upload.attachmentId === input.attachmentId
  ) {
    releaseAttachmentUpload(input.id);
    return;
  }
  const held = heldUploads.get(input.id);
  if (
    held?.job.environmentId === input.environmentId &&
    held.job.persistedAttachmentId === input.attachmentId
  ) {
    releaseAttachmentUpload(input.id);
  }
  deletePendingUpload(input.environmentId, input.attachmentId);
}

export function retryAttachmentUpload(input: {
  readonly environmentId: EnvironmentId;
  readonly image: ComposerImageAttachment | ComposerFileAttachment;
  readonly draftTarget?: ComposerThreadTarget;
}): void {
  if (!canOperate(input.environmentId)) return;
  const previous = readAttachmentUpload(input.image.id);
  const held = heldUploads.get(input.image.id);
  cancelAttachmentUpload(input.image.id);
  if (held) uploads.invalidate(jobKey(held.job));
  if (previous?.status === "failed" && previous.attachmentId) {
    deletePendingUpload(previous.environmentId, previous.attachmentId);
  }
  if (previous && "previous" in previous && previous.previous) {
    setUploadState(input.image.id, previous.previous);
  } else {
    clearUploadState(input.image.id);
  }
  startAttachmentUpload(input);
}

/** Verifies uploads before stash restore; pending uploads expire after 24 hours. */
export function verifyStashedAttachmentUpload(input: {
  readonly environmentId: EnvironmentId;
  readonly attachmentId: string;
}): Promise<PersistedAttachmentVerification> {
  return Effect.runPromise(
    verifyPersistedAttachmentUpload({
      registry: appAtomRegistry,
      createAssetUrl: assetEnvironment.createUrl,
      environmentId: input.environmentId,
      attachmentId: input.attachmentId,
    }),
  );
}

/** Resolves once these images' uploads finish, fail or are cancelled. */
export function awaitAttachmentUploads(imageIds: ReadonlyArray<string>): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(imageIds, awaitHeldUpload, { concurrency: "unbounded", discard: true }),
  );
}

/** Revalidate ready uploads at send time; a long-lived draft can outlive server cleanup. */
export async function refreshExpiredAttachmentUploads(input: {
  readonly environmentId: EnvironmentId;
  readonly images: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>;
  readonly draftTarget?: ComposerThreadTarget;
}): Promise<void> {
  const canVerify = readEnvironmentScope(input.environmentId, AuthOrchestrationReadScope);
  await Promise.all(
    input.images.map(async (image) => {
      const upload = readAttachmentUpload(image.id);
      if (upload?.status !== "ready" || upload.environmentId !== input.environmentId) return;
      if (!canVerify) {
        if (image.file) {
          startAttachmentUpload({
            environmentId: input.environmentId,
            image,
            force: true,
            ...(input.draftTarget !== undefined ? { draftTarget: input.draftTarget } : {}),
          });
        } else {
          setUploadState(image.id, {
            status: "failed",
            environmentId: input.environmentId,
            previous: upload,
            reason: "Uploaded attachment could not be verified. Attach the file again.",
          });
        }
        return;
      }
      const verification = await verifyStashedAttachmentUpload({
        environmentId: input.environmentId,
        attachmentId: upload.attachmentId,
      }).catch((error: unknown): PersistedAttachmentVerification => ({ status: "failed", error }));
      if (readAttachmentUpload(image.id) !== upload) return;
      if (verification.status === "verified") return;
      if (verification.status === "missing" && image.file) {
        clearUploadState(image.id);
        startAttachmentUpload({
          environmentId: input.environmentId,
          image,
          force: true,
          ...(input.draftTarget !== undefined ? { draftTarget: input.draftTarget } : {}),
        });
        return;
      }
      setUploadState(image.id, {
        status: "failed",
        environmentId: input.environmentId,
        previous: upload,
        reason:
          verification.status === "missing"
            ? "Uploaded attachment expired. Remove it and attach it again."
            : "Uploaded attachment could not be verified. Retry when the server reconnects.",
      });
    }),
  );
  await awaitAttachmentUploads(input.images.map((image) => image.id));
}

export function getUploadedAttachments(input: {
  readonly environmentId: EnvironmentId;
  readonly images: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>;
}): ChatAttachment[] | null {
  const attachments: ChatAttachment[] = [];
  for (const image of input.images) {
    const upload = readAttachmentUpload(image.id);
    if (upload?.status !== "ready" || upload.environmentId !== input.environmentId) {
      return null;
    }
    attachments.push({
      type: image.type,
      id: upload.attachmentId,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      ...(image.source ? { source: image.source } : {}),
    });
  }
  return attachments;
}

/** In-memory queue releases miss uploads after reload; every draft discard must use this path. */
export function releaseDraftAttachment(
  attachment: ComposerImageAttachment | ComposerFileAttachment,
): void {
  if (
    attachment.type === "file" &&
    attachment.uploadedAttachmentId !== undefined &&
    attachment.uploadEnvironmentId !== undefined
  ) {
    releasePersistedAttachmentUpload({
      id: attachment.id,
      environmentId: attachment.uploadEnvironmentId,
      attachmentId: attachment.uploadedAttachmentId,
    });
    if (heldUploads.has(attachment.id) || readAttachmentUpload(attachment.id)) {
      releaseAttachmentUpload(attachment.id);
    }
    return;
  }
  releaseAttachmentUpload(attachment.id);
}

export function releaseDraftAttachments(
  attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>,
): void {
  for (const attachment of attachments) {
    releaseDraftAttachment(attachment);
  }
}
