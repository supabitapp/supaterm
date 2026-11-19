import type { SnapShotSource } from "@supaterm/contracts";

import type { ComposerFileAttachment } from "../../composerDraftStore";
import { type ChatFileAttachment, type ChatImageAttachment, isVideoAttachment } from "../../types";
import type {
  AssetCreateUrlResult,
  AssetResource,
  EnvironmentId,
  ScopedThreadRef,
} from "@supaterm/contracts";
import { videoMimeType } from "@supaterm/shared/video";
import { resolveMediaSource } from "@supaterm/client-runtime/media-source";
import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import { resolveExternalWebLinkHost } from "./externalLinkContextMenu";
import type { MediaActionSource } from "../media/MediaActions";
import { resolveProtocolRelativeMediaUrl } from "../media/mediaContent";

export interface ExpandedImageItem {
  src: string | null;
  name: string;
  mimeType?: string;
  type?: "video";
  /** Revoke this owned object URL; other blob URLs belong to the timeline. */
  ownsSrc?: boolean;
  source?: SnapShotSource;
  onCopySnapshot?: (() => Promise<void>) | undefined;
  autoPlay?: boolean;
  originalUrl?: string;
  srcFragment?: string;
  actionsSource?: MediaActionSource;
}

export interface ExpandedImagePreview {
  images: ExpandedImageItem[];
  index: number;
}

export async function resolveMarkdownMediaPreview(input: {
  source: string;
  resolvedFilePath?: string | undefined;
  cwd?: string | undefined;
  threadRef?: ScopedThreadRef | undefined;
  httpBaseUrl?: string | undefined;
  onOpenFile?: ((relativePath: string) => void) | undefined;
  createAssetUrl: (input: {
    environmentId: EnvironmentId;
    input: { resource: AssetResource };
  }) => Promise<AtomCommandResult<AssetCreateUrlResult, unknown>>;
}) {
  const media = resolveMediaSource(input.source, {
    threadId: input.threadRef?.threadId,
    workspaceRoot: input.cwd,
    resolvedFilePath: input.resolvedFilePath,
  });
  if (media === null) return null satisfies ExpandedImagePreview | null;
  const { kind, name, reference } = media;
  const relativePath = reference?.kind === "file" ? reference.relativePath : undefined;

  let src: string;
  let asset: MediaActionSource["asset"];
  if (media.access === "direct") {
    src = resolveProtocolRelativeMediaUrl(media.uri);
  } else {
    if (media.access === "unavailable" || !input.threadRef || !input.httpBaseUrl) {
      throw new Error("Reconnect to this environment and open the media again.");
    }
    asset = { environmentId: input.threadRef.environmentId, resource: media.resource };
    const result = await input.createAssetUrl({
      environmentId: asset.environmentId,
      input: { resource: asset.resource },
    });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    const assetUrl = resolveAssetUrl(input.httpBaseUrl, result.value.relativeUrl);
    if (assetUrl === null) throw new Error("The environment returned an invalid media URL.");
    src = assetUrl + media.srcFragment;
  }
  return {
    images: [
      {
        src,
        name,
        ...(kind === "video" ? { type: "video", autoPlay: false } : {}),
        ...(media.access === "direct" && resolveExternalWebLinkHost(media.uri) !== null
          ? { originalUrl: media.uri }
          : {}),
        ...(media.srcFragment ? { srcFragment: media.srcFragment } : {}),
        actionsSource: {
          kind,
          name,
          src,
          ...(reference ? { reference } : {}),
          ...(asset ? { asset } : {}),
          ...(relativePath && input.onOpenFile
            ? { onOpenFile: () => input.onOpenFile?.(relativePath) }
            : {}),
        },
      },
    ],
    index: 0,
  } satisfies ExpandedImagePreview | null;
}

export function buildAttachmentVideoAsset(
  environmentId: EnvironmentId,
  attachment: Pick<ChatFileAttachment, "id" | "name" | "mimeType">,
) {
  return {
    environmentId,
    resource: {
      _tag: "attachment" as const,
      attachmentId: attachment.id,
      fileName: attachment.name,
      mimeType: videoMimeType(attachment) ?? attachment.mimeType,
    },
  };
}

export function buildAttachmentVideoPreview(
  environmentId: EnvironmentId,
  attachment: ChatFileAttachment,
) {
  if (!isVideoAttachment(attachment)) return null satisfies ExpandedImagePreview | null;
  const src = attachment.previewUrl ?? null;
  const asset =
    attachment.downloadable === false
      ? undefined
      : buildAttachmentVideoAsset(environmentId, attachment);
  if (src === null && asset === undefined) return null satisfies ExpandedImagePreview | null;
  return {
    images: [
      {
        src,
        name: attachment.name,
        type: "video",
        actionsSource: {
          kind: "video",
          name: attachment.name,
          src,
          ...(asset ? { asset } : {}),
        },
      },
    ],
    index: 0,
  } satisfies ExpandedImagePreview | null;
}

export function expandedImageKey(preview: ExpandedImagePreview) {
  const item = preview.images[preview.index];
  const asset = item?.actionsSource?.asset;
  return `${item?.src ?? (asset ? JSON.stringify([asset.environmentId, asset.resource]) : "image")}:${preview.index}`;
}

export function attachVideoThumbnail(video: HTMLVideoElement, file: File) {
  const url = URL.createObjectURL(file);
  video.src = url;
  return () => URL.revokeObjectURL(url);
}

export function buildExpandedImagePreview(
  images: ReadonlyArray<ChatImageAttachment | ComposerFileAttachment>,
  selectedImageId: string,
  onCopySnapshot?: (id: string) => Promise<void>,
) {
  const selected = images.find((image) => image.id === selectedImageId);
  if (selected?.type === "file" && selected.file && isVideoAttachment(selected)) {
    return {
      images: [
        {
          src: URL.createObjectURL(selected.file),
          name: selected.name,
          type: "video",
          ownsSrc: true,
        },
      ],
      index: 0,
    } satisfies ExpandedImagePreview | null;
  }
  const previewableImages = images.flatMap((image) =>
    image.type === "image" && image.previewUrl
      ? [
          {
            id: image.id,
            src: image.previewUrl,
            name: image.name,
            mimeType: image.mimeType,
            source: image.source,
          },
        ]
      : [],
  );
  if (previewableImages.length === 0) {
    return null satisfies ExpandedImagePreview | null;
  }
  const selectedIndex = previewableImages.findIndex((image) => image.id === selectedImageId);
  if (selectedIndex < 0) {
    return null satisfies ExpandedImagePreview | null;
  }
  return {
    images: previewableImages.map((image) => ({
      src: image.src,
      name: image.name,
      mimeType: image.mimeType,
      ...(image.source?.kind === "snap-shot"
        ? {
            source: image.source,
            onCopySnapshot: onCopySnapshot ? () => onCopySnapshot(image.id) : undefined,
          }
        : {}),
    })),
    index: selectedIndex,
  } satisfies ExpandedImagePreview | null;
}
