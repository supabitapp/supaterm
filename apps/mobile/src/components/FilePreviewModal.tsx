import * as Dialog from "./ui/Dialog";
import { useCallback, useContext, useEffect, useEffectEvent, useState, useMemo } from "react";

import { usePreviewPresentation } from "../lib/previewPresentation";
import { loadLocalAttachmentPreview } from "../lib/localAttachmentPreview";
import { useRefreshAssetUrl } from "../state/assets";
import {
  filePreviewGallery,
  filePreviewKey,
  filePreviewName,
  settledPreviewGallery,
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

function PreviewItemResolver(props: {
  readonly source: FilePreviewItem;
  readonly onResolved: (source: ResolvedFilePreviewSource) => void;
  readonly onFailed: (error: unknown, fallbackMessage: string) => void;
}) {
  const { source } = props;
  const environmentId = "environmentId" in source ? source.environmentId : null;
  const refreshAssetUrl = useRefreshAssetUrl(
    environmentId,
    "resource" in source ? source.resource : null,
  );
  const onResolutionError = useEffectEvent(props.onFailed);
  const onResolved = useEffectEvent(props.onResolved);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- resolves and leases the native preview URL for this keyed presentation
  useEffect(() => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const resolve = async () => {
      if ("uri" in source) return source.uri;
      if ("attachment" in source) {
        const file = await loadLocalAttachmentPreview(source.attachment, controller.signal);
        if (!file) throw new Error("Attach the file again and retry.");
        release = file.dispose;
        return file.uri;
      }
      const url = await refreshAssetUrl();
      if (!url) throw new Error("Reconnect to this environment and try again.");
      return url + (source.srcFragment ?? "");
    };
    void resolve().then(
      (uri) => {
        if (controller.signal.aborted) {
          release?.();
          return;
        }
        onResolved({ ...source, name: filePreviewName(source), uri });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          onResolutionError(error, "Reconnect to this environment or attach the file again.");
      },
    );
    return () => {
      controller.abort();
      release?.();
    };
  }, [source, refreshAssetUrl]);
  return null;
}

function ResolvedFilePreview(props: {
  readonly source: FilePreviewSource;
  readonly onRequestClose: () => void;
  readonly onOpenError?: (error: unknown) => void;
}) {
  const [items] = useState(() => filePreviewGallery(props.source, []));
  const [resolved, setResolved] = useState<Record<string, ResolvedFilePreviewSource>>({});
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const onResolved = useCallback((item: ResolvedFilePreviewSource, key: string) => {
    setResolved((current) => ({ ...current, [key]: item }));
  }, []);
  const selectedKey = filePreviewKey(props.source);

  const onFailed = (key: string, error: unknown, fallbackMessage: string) => {
    if (key !== selectedKey) {
      setFailedKeys((current) => new Set(current).add(key));
      return;
    }
    if (props.onOpenError) props.onOpenError(error);
    else Dialog.alert("Could not open preview", fallbackMessage);
    props.onRequestClose();
  };
  const selected = resolved[selectedKey];
  const gallery = useMemo(
    () => settledPreviewGallery(items, resolved, failedKeys),
    [items, resolved, failedKeys],
  );
  return (
    <>
      {items.map((item) => {
        const key = filePreviewKey(item);
        return (
          <PreviewItemResolver
            key={key}
            source={item}
            onResolved={(value) => onResolved(value, key)}
            onFailed={(error, fallbackMessage) => onFailed(key, error, fallbackMessage)}
          />
        );
      })}
      {selected && gallery ? (
        <FilePreview
          source={{ ...selected, gallery }}
          onRequestClose={props.onRequestClose}
          onOpenError={props.onOpenError}
        />
      ) : null}
    </>
  );
}

export function FilePreviewModal(props: {
  readonly source: FilePreviewSource | null;
  readonly onRequestClose: () => void;

  readonly onOpenError?: (error: unknown) => void;
}) {
  const group = useContext(FilePreviewGallery);
  const source = useMemo(
    () =>
      props.source === null
        ? null
        : {
            ...props.source,
            gallery: filePreviewGallery(props.source, group),
          },
    [props.source, group],
  );
  usePreviewPresentation(source ? filePreviewKey(source) : null, props.onRequestClose);
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
