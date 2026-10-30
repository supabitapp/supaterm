import * as Dialog from "./ui/Dialog";
import { useCallback, useContext, useEffect, useEffectEvent, useState, useMemo } from "react";
import { Keyboard } from "react-native";

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
  // Resolve once per presentation; background URL refreshes must not reopen the native viewer.
  const [uri, setUri] = useState<string | null>("uri" in source ? source.uri : null);
  const onResolutionError = useEffectEvent(props.onFailed);
  useEffect(() => Keyboard.dismiss(), []);
  useEffect(() => {
    if (environmentId === null || uri !== null) return;
    let cancelled = false;
    // A cached URL may have expired while the app was suspended. Await reauthorization
    // before handing a URL to Quick Look or ACTION_VIEW, which retain that URL.
    void refreshAssetUrl()
      .then((url) => {
        if (cancelled) return;
        if (!url) throw new Error("Reconnect to this environment and try again.");
        setUri(url + (source.srcFragment ?? ""));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onResolutionError(
          error,
          "Reconnect to this environment and try again. The file may have been moved or deleted.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [environmentId, uri, refreshAssetUrl, source.srcFragment]);
  useEffect(() => {
    if (!("attachment" in source)) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    void loadLocalAttachmentPreview(source.attachment, controller.signal)
      .then((file) => {
        if (!file) return;
        if (controller.signal.aborted) {
          file.dispose();
          return;
        }
        release = file.dispose;
        setUri(file.uri);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        onResolutionError(error, "Attach the file again and retry.");
      });
    return () => {
      controller.abort();
      release?.();
    };
  }, [source]);

  const onResolved = useEffectEvent(props.onResolved);
  useEffect(() => {
    if (uri !== null) onResolved({ ...source, name: filePreviewName(source), uri });
  }, [uri, source]);
  return null;
}

function ResolvedFilePreview(props: {
  readonly source: FilePreviewSource;
  readonly onRequestClose: () => void;
  readonly onOpenError?: (error: unknown) => void;
}) {
  // Freeze the group at opening; streaming messages and URL refreshes must not reopen the viewer.
  const [items] = useState(() => filePreviewGallery(props.source, []));
  const [resolved, setResolved] = useState<Record<string, ResolvedFilePreviewSource>>({});
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const onResolved = useCallback((item: ResolvedFilePreviewSource, key: string) => {
    setResolved((current) => ({ ...current, [key]: item }));
  }, []);
  const selectedKey = filePreviewKey(props.source);
  // A sibling that moved or was deleted drops out of the gallery; only the tapped item closes it.
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
