import * as Dialog from "./ui/Dialog";
import { useContext, useEffect, useEffectEvent, useState } from "react";

import { loadLocalAttachmentPreview } from "../lib/localAttachmentPreview";
import {
  downloadAndShareAttachment,
  nativeViewerErrorMessage,
  shareLocalAttachment,
} from "../lib/attachmentDownload";
import { usePreviewPresentation } from "../lib/previewPresentation";
import { refreshAssetUrl } from "../state/assets";
import {
  filePreviewGallery,
  filePreviewKey,
  filePreviewName,
  settlePreviewGallery,
} from "../lib/filePreviewGallery";
import { FilePreviewGallery } from "./FilePreviewGallery";
import { FilePreview } from "./FilePreview";
import type {
  FilePreviewItem,
  FilePreviewSource,
  ResolvedFilePreviewSource,
} from "./FilePreviewModal.types";

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

interface ResolvedPreviewItem {
  readonly source: ResolvedFilePreviewSource;
  readonly dispose?: () => void;
}

async function resolvePreviewItem(
  item: FilePreviewItem,
  signal: AbortSignal,
): Promise<ResolvedPreviewItem | null> {
  const name = filePreviewName(item);
  if ("attachment" in item) {
    const file = await loadLocalAttachmentPreview(item.attachment, signal).catch(
      (error: unknown) => {
        throw new PreviewResolutionError(error, "Attach the file again and retry.");
      },
    );
    return file && { source: { ...item, name, uri: file.uri }, dispose: file.dispose };
  }
  if (!("environmentId" in item)) return { source: { ...item, name } };
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
  return { source: { ...item, name, uri: url + (item.srcFragment ?? "") } };
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
  const [resolved, setResolved] = useState<{
    readonly selected: ResolvedFilePreviewSource;
    readonly gallery: readonly ResolvedFilePreviewSource[];
  } | null>(() => {
    if (!items.every((item) => "uri" in item)) return null;
    const gallery = items.map((item) => ({ ...item, name: filePreviewName(item) }));
    const selected = gallery[selectedIndex];
    return selected ? { selected, gallery } : null;
  });
  const onResolutionError = useEffectEvent((error: unknown) => {
    const failure =
      error instanceof PreviewResolutionError
        ? error
        : new PreviewResolutionError(error, "Try again.");
    if (props.onOpenError) props.onOpenError(failure.cause);
    else Dialog.alert("Could not open preview", failure.fallbackMessage);
    props.onRequestClose();
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- resolves the frozen gallery once per presentation and holds its local file leases until it closes
  useEffect(() => {
    if (items.every((item) => "uri" in item)) return;
    const controller = new AbortController();
    const resolving = items.map((item) => resolvePreviewItem(item, controller.signal));
    void settlePreviewGallery(
      resolving.map((item) => item.then((value) => value?.source ?? null)),
      selectedIndex,
    ).then(
      (value) => {
        if (!controller.signal.aborted && value) setResolved(value);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        controller.abort();
        onResolutionError(error);
      },
    );
    return () => {
      controller.abort();
      void Promise.allSettled(resolving).then((settled) => {
        for (const item of settled) if (item.status === "fulfilled") item.value?.dispose?.();
      });
    };
  }, [items, selectedIndex]);
  if (!resolved) return null;
  const { selected, gallery } = resolved;
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
                    name: filePreviewName(selected),
                    mimeType: selected.mimeType ?? "application/octet-stream",
                  },
                  signal: new AbortController().signal,
                };
                const sharing = /^(file|content):/.test(selected.uri)
                  ? shareLocalAttachment({ ...input, uri: selected.uri })
                  : downloadAndShareAttachment({ ...input, url: selected.uri });
                void sharing.catch(() => Dialog.alert("Could not share file", "Please try again."));
              },
            },
          ]
        : []),
    ]);
  };
  return (
    <FilePreview
      source={{ ...selected, gallery }}
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
