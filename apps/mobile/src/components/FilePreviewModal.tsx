import * as Dialog from "./ui/Dialog";
import { useContext, useEffect, useEffectEvent, useState } from "react";
import { Platform } from "react-native";

import { loadLocalAttachmentPreview } from "../lib/localAttachmentPreview";
import {
  downloadAndShareAttachment,
  nativeViewerErrorMessage,
  shareLocalAttachment,
} from "../lib/attachmentDownload";
import { usePreviewPresentation } from "../lib/previewPresentation";
import { refreshAssetUrl } from "../state/assets";
import { filePreviewGallery, filePreviewKey, filePreviewName } from "../lib/filePreviewGallery";
import { FilePreviewGallery } from "./FilePreviewGallery";
import { FilePreview } from "./FilePreview";
import type { FilePreviewItem, FilePreviewSource } from "./FilePreviewModal.types";

export type {
  FilePreviewItem,
  FilePreviewSource,
  ResolvedFilePreviewSource,
} from "./FilePreviewModal.types";

class PreviewResolutionError extends Error {
  constructor(
    override readonly cause: unknown,
    readonly fallbackMessage: string,
  ) {
    super(fallbackMessage, { cause });
  }
}

interface ResolvedPreviewUri {
  readonly uri: string;
  readonly dispose?: () => void;
}

async function resolvePreviewUri(
  item: FilePreviewItem,
  signal: AbortSignal,
): Promise<ResolvedPreviewUri | null> {
  if ("uri" in item) return { uri: item.uri };
  if ("attachment" in item) {
    return loadLocalAttachmentPreview(item.attachment, signal).catch((error: unknown) => {
      throw new PreviewResolutionError(error, "Attach the file again and retry.");
    });
  }
  // Refresh expired URLs before handing them to Quick Look or ACTION_VIEW, which retain them.
  const url = await refreshAssetUrl(item.environmentId, item.resource, signal)
    .then((value) => {
      if (!value) throw new Error("Reconnect to this environment and try again.");
      return value;
    })
    .catch((error: unknown) => {
      throw new PreviewResolutionError(
        error,
        "Reconnect to this environment and try again. The file may have been moved or deleted.",
      );
    });
  return { uri: url + (item.srcFragment ?? "") };
}

function ResolvedFilePreview(props: {
  readonly source: FilePreviewSource;
  readonly onRequestClose: () => void;
  readonly onOpenError?: (error: unknown) => void;
}) {
  // Freeze the group at opening; streaming messages and URL refreshes must not reopen the viewer.
  const [items] = useState(() => filePreviewGallery(props.source, []));
  const selectedIndex = items.findIndex(
    (item) => filePreviewKey(item) === filePreviewKey(props.source),
  );
  const progressiveGallery = Platform.OS === "ios";
  // Undefined while resolving, null once it cannot be.
  const [uris, setUris] = useState<readonly (string | null | undefined)[]>(() =>
    items.map((item) => ("uri" in item ? item.uri : undefined)),
  );
  const onResolutionError = useEffectEvent((error: unknown) => {
    const failure =
      error instanceof PreviewResolutionError
        ? error
        : new PreviewResolutionError(error, "Try again.");
    if (props.onOpenError) props.onOpenError(failure.cause);
    else Dialog.alert("Could not open preview", failure.fallbackMessage);
    props.onRequestClose();
  });
  // A sibling that cannot resolve only loses its own page; the selected item closes the preview.
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- resolves the frozen gallery once per presentation and holds its local file leases until it closes
  useEffect(() => {
    const controller = new AbortController();
    const leases: (() => void)[] = [];
    const resolveAt = (index: number, uri: string | null) =>
      setUris((current) => current.map((value, at) => (at === index ? uri : value)));
    items.forEach((item, index) => {
      if ("uri" in item) return;
      void resolvePreviewUri(item, controller.signal).then(
        (resolved) => {
          if (controller.signal.aborted) return resolved?.dispose?.();
          if (resolved?.dispose) leases.push(resolved.dispose);
          resolveAt(index, resolved?.uri ?? null);
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          if (index !== selectedIndex) return resolveAt(index, null);
          controller.abort();
          onResolutionError(error);
        },
      );
    });
    return () => {
      controller.abort();
      for (const dispose of leases) dispose();
    };
  }, [items, selectedIndex]);
  const selectedItem = items[selectedIndex];
  if (!selectedItem) return null;
  const selected = { ...selectedItem, name: filePreviewName(selectedItem) };
  if (selected.kind === "image") {
    const images = items.map((item, index) => {
      const uri = uris[index];
      return {
        ...item,
        name: filePreviewName(item),
        ...(uri ? { uri } : uri === null ? { failed: true } : {}),
      };
    });
    if (progressiveGallery) {
      return (
        <FilePreview
          source={{ kind: "image", images, selectedIndex }}
          onRequestClose={props.onRequestClose}
          {...(props.onOpenError ? { onOpenError: props.onOpenError } : {})}
        />
      );
    }
    // Android's viewer resets image gestures when its sources change during a presentation.
    if (uris.some((uri) => uri === undefined) || uris[selectedIndex] === null) return null;
    const shown = images.filter((_, index) => uris[index] !== null);
    return (
      <FilePreview
        source={{
          kind: "image",
          images: shown,
          selectedIndex: shown.indexOf(images[selectedIndex]!),
        }}
        onRequestClose={props.onRequestClose}
        {...(props.onOpenError ? { onOpenError: props.onOpenError } : {})}
      />
    );
  }
  const uri = uris[selectedIndex];
  if (!uri) return null;
  const onOpenError = (error: unknown) => {
    if (props.onOpenError) return props.onOpenError(error);
    Dialog.alert("Could not open preview", nativeViewerErrorMessage(error), [
      { text: "Cancel", style: "cancel" },
      ...(selected.kind === "document"
        ? [
            {
              text: "Save or share",
              onPress: () => {
                const input = {
                  attachment: {
                    name: selected.name,
                    mimeType: selected.mimeType ?? "application/octet-stream",
                  },
                  signal: new AbortController().signal,
                };
                const sharing = /^(file|content):/.test(uri)
                  ? shareLocalAttachment({ ...input, uri })
                  : downloadAndShareAttachment({ ...input, url: uri });
                void sharing.catch(() => Dialog.alert("Could not share file", "Please try again."));
              },
            },
          ]
        : []),
    ]);
  };
  return (
    <FilePreview
      source={{ ...selected, kind: selected.kind, uri }}
      onRequestClose={props.onRequestClose}
      onOpenError={onOpenError}
    />
  );
}

export function FilePreviewModal(props: {
  readonly source: FilePreviewSource | null;
  readonly onRequestClose: () => void;

  readonly onOpenError?: (error: unknown) => void;
}) {
  const group = useContext(FilePreviewGallery);
  const source =
    props.source === null
      ? null
      : { ...props.source, gallery: filePreviewGallery(props.source, group) };
  usePreviewPresentation(source && filePreviewKey(source), props.onRequestClose);

  if (!source) return null;
  return (
    <ResolvedFilePreview
      key={filePreviewKey(source)}
      source={source}
      onRequestClose={props.onRequestClose}
      {...(props.onOpenError ? { onOpenError: props.onOpenError } : {})}
    />
  );
}
