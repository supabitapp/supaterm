import type { EnvironmentId } from "@supaterm/contracts";
import { msg } from "gt-react";
import { m, type MessageResolver } from "../i18n/messages";

export type ReadyAttachmentUpload = {
  readonly status: "ready";
  readonly environmentId: EnvironmentId;
  readonly attachmentId: string;
};

export type AttachmentUploadState =
  | {
      readonly status: "uploading";
      readonly environmentId: EnvironmentId;
      readonly progress: number;
      readonly previous?: ReadyAttachmentUpload;
    }
  | ReadyAttachmentUpload
  | {
      readonly status: "failed";
      readonly environmentId: EnvironmentId;
      readonly reason: string;
      /** Retry/release deletes this id; never use a persisted draft attachment id. */
      readonly attachmentId?: string;
      readonly previous?: ReadyAttachmentUpload;
    };

export function attachmentUploadBlockReason(
  input: {
    readonly imageIds: ReadonlyArray<string>;
    readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
    readonly environmentId: EnvironmentId;
  },
  resolve: MessageResolver = m,
): string | null {
  let pending = 0;
  let failed = 0;

  for (const imageId of input.imageIds) {
    const upload = input.uploadsByImageId[imageId];
    if (upload?.status === "failed" && upload.environmentId === input.environmentId) {
      failed += 1;
    } else if (upload?.status !== "ready" || upload.environmentId !== input.environmentId) {
      pending += 1;
    }
  }

  if (failed > 0) {
    return failed === 1
      ? resolve(msg("Retry or remove the failed attachment"))
      : resolve(msg("Retry or remove the failed attachments"));
  }
  if (pending > 0) {
    return pending === 1
      ? resolve(msg("Attachment still uploading"))
      : resolve(msg("Attachments still uploading"));
  }
  return null;
}

export function formatAttachmentUploadProgress(progress: number): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return `${Math.floor(bounded * 100)}%`;
}
