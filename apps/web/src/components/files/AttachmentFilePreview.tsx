import { filePreviewDelimiter } from "@supaterm/shared/delimitedPreview";
import type { AssetResource, EnvironmentId, ScopedThreadRef } from "@supaterm/contracts";
import { formatAttachmentSize } from "@supaterm/client-runtime/state/attachments";
import { readFilePreviewResponse } from "@supaterm/client-runtime/file-preview";
import { settlePromise } from "@supaterm/client-runtime/state/runtime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Cause from "effect/Cause";
import {
  filePreviewKind,
  officePreviewKind,
  FILE_TEXT_PREVIEW_MAX_BYTES,
  type FilePreviewKind,
} from "@supaterm/shared/filePreview";
import { ChevronRightIcon, DownloadIcon, TrashIcon, WrapTextIcon, XIcon } from "@supaterm/icons";
import { Check, CodeXml, Copy, Eye, Table } from "@supaterm/icons/nodes";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useAssetUrlRefresh } from "~/assets/assetUrls";
import ChatMarkdown from "~/components/ChatMarkdown";
import { maskMarkdownFrontmatter } from "@supaterm/shared/markdownFrontmatter";
import { MorphIcon } from "~/components/MorphIcon";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";

import { BinaryFilePreview } from "./BinaryFilePreview";
import { PreviewImage } from "./PreviewImage";
import { AudioPreview } from "./AudioPreview";
import { BrowserDocumentFrame } from "./BrowserDocumentFrame";
import { DelimitedTablePreview } from "./DelimitedTablePreview";
import {
  FILE_SURFACE_SUBHEADER_CLASS,
  FileSurfaceAction,
  FileSurfaceFailure,
  FileSurfaceLoading,
  FileSurfaceNotice,
} from "./fileSurfaceChrome";

const LargeTextViewer = lazy(() => import("./LargeTextViewer"));

const OfficeFilePreview = lazy(() =>
  import("./OfficeFilePreview").then((module) => ({ default: module.OfficeFilePreview })),
);

const FontFilePreview = lazy(() =>
  import("./FontFilePreview").then((module) => ({ default: module.FontFilePreview })),
);

const MermaidFilePreview = lazy(() =>
  import("./MermaidFilePreview").then((module) => ({ default: module.MermaidFilePreview })),
);

const SourcePreview = lazy(() => import("./ReadOnlySourcePreview"));

const STALE_URL_MS = 5 * 60_000;

const objectUrlLeases = new Map<Blob, { readonly url: string; users: number }>();

function leaseObjectUrl(blob: Blob, onChange: () => void): () => void {
  let lease = objectUrlLeases.get(blob);
  if (!lease) {
    lease = { url: URL.createObjectURL(blob), users: 0 };
    objectUrlLeases.set(blob, lease);
    onChange();
  }
  const activeLease = lease;
  activeLease.users += 1;
  return () => {
    activeLease.users -= 1;
    if (activeLease.users > 0) return;
    objectUrlLeases.delete(blob);
    URL.revokeObjectURL(activeLease.url);
  };
}

function readObjectUrl(blob: Blob | null | undefined): string | null {
  return blob ? (objectUrlLeases.get(blob)?.url ?? null) : null;
}

const objectUrlSubscribers = new WeakMap<Blob, (onChange: () => void) => () => void>();

function subscribeToObjectUrl(blob: Blob | null | undefined) {
  if (!blob) return subscribeToNothing;
  let subscribe = objectUrlSubscribers.get(blob);
  if (!subscribe) {
    subscribe = (onChange) => leaseObjectUrl(blob, onChange);
    objectUrlSubscribers.set(blob, subscribe);
  }
  return subscribe;
}

function subscribeToNothing() {
  return () => {};
}

export function ReadOnlySourcePreview(props: { name: string; text: string; wordWrap?: boolean }) {
  return (
    <Suspense fallback={<FileSurfaceLoading className="p-4" />}>
      <SourcePreview {...props} />
    </Suspense>
  );
}

function renderedToggleLabel(
  mode: "markdown" | "mermaid" | "html" | "table",
  rendered: boolean,
): string {
  if (mode === "mermaid") return rendered ? "Show Mermaid source" : "Show rendered diagram";
  if (mode === "markdown") return rendered ? "Show markdown source" : "Show rendered markdown";
  if (mode === "table") return rendered ? "Show source" : "Show table";
  return rendered ? "Show HTML source" : "Show rendered page";
}

export function AttachmentFilePreview(props: {
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind?: FilePreviewKind;
  file?: Blob | null;
  asset?:
    | { environmentId: EnvironmentId; attachmentId: string }
    | {
        environmentId: EnvironmentId;
        resource: Extract<AssetResource, { _tag: "media-file" | "draft-workspace-file" }>;
      };
  htmlRender?: boolean;
  threadRef?: ScopedThreadRef;
  origin?: string;
  onRemove?: () => void;
  onClose?: () => void;
}) {
  const kind = props.kind ?? filePreviewKind(props);
  const officeKind = officePreviewKind(props);
  const delimiter = kind === "text" ? filePreviewDelimiter(props) : null;
  const renderedMode =
    kind === "mermaid"
      ? "mermaid"
      : kind === "markdown"
        ? "markdown"
        : kind === "html"
          ? "html"
          : delimiter
            ? "table"
            : null;
  const attachmentId =
    props.asset && "attachmentId" in props.asset ? props.asset.attachmentId : undefined;
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: props.name });

  const resource =
    props.asset && "resource" in props.asset
      ? props.asset.resource
      : attachmentId
        ? {
            _tag: "attachment" as const,
            attachmentId,
            fileName: props.name,
            mimeType: props.mimeType,
            disposition: "inline" as const,
          }
        : null;
  const downloadResource = resource
    ? resource._tag === "draft-workspace-file"
      ? resource
      : { ...resource, disposition: "attachment" as const }
    : null;
  const refresh = useAssetUrlRefresh(
    props.file ? null : (props.asset?.environmentId ?? null),
    props.file ? null : resource,
  );
  const prepareDownload = useAssetUrlRefresh(props.asset?.environmentId ?? null, downloadResource);
  const [saving, setSaving] = useState(false);
  const localFile = props.file;
  const localUrl = useSyncExternalStore(subscribeToObjectUrl(localFile), () =>
    readObjectUrl(localFile),
  );
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [rendered, setRendered] = useState(true);
  const [revision, setRevision] = useState(0);
  const [content, setContent] = useState<{ text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const copyContents = useRef<(() => Promise<string>) | null>(null);
  const authorizedAt = useRef(0);
  const [remoteUrlRequest, setRemoteUrlRequest] = useState({
    file: props.file,
    refresh,
    revision,
  });
  if (
    remoteUrlRequest.file !== props.file ||
    remoteUrlRequest.refresh !== refresh ||
    remoteUrlRequest.revision !== revision
  ) {
    setRemoteUrlRequest({ file: props.file, refresh, revision });
    if (!props.file) {
      setRemoteUrl(null);
      setError(null);
    }
  }
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Authorize this file and discard a superseded response on cleanup.
  useEffect(() => {
    if (remoteUrlRequest.file) return;
    let cancelled = false;
    void remoteUrlRequest
      .refresh()
      .then((url) => {
        if (cancelled) return;
        if (!url) throw new Error("Reconnect to the environment and try again.");
        authorizedAt.current = Date.now();
        setRemoteUrl(url);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "The attachment is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [remoteUrlRequest]);
  const url = props.file ? localUrl : remoteUrl;
  const streamsText =
    kind === "text" &&
    (props.sizeBytes > FILE_TEXT_PREVIEW_MAX_BYTES ||
      (props.sizeBytes === 0 && (!resource || resource._tag === "attachment")));
  const needsText =
    kind === "text" || kind === "markdown" || kind === "mermaid" || (kind === "html" && !rendered);
  const [contentRequest, setContentRequest] = useState({
    url,
    needsText,
    streamsText,
    revision,
    sizeBytes: props.sizeBytes,
    file: props.file,
    refresh,
  });
  if (
    contentRequest.url !== url ||
    contentRequest.needsText !== needsText ||
    contentRequest.streamsText !== streamsText ||
    contentRequest.revision !== revision ||
    contentRequest.sizeBytes !== props.sizeBytes ||
    contentRequest.file !== props.file ||
    contentRequest.refresh !== refresh
  ) {
    setContentRequest({
      url,
      needsText,
      streamsText,
      revision,
      sizeBytes: props.sizeBytes,
      file: props.file,
      refresh,
    });
    if (needsText && !streamsText && url) {
      setContent(null);
      setContentError(null);
    }
  }
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Read the selected text source and abort its request when the source changes.
  useEffect(() => {
    if (!needsText || streamsText || !url) return;
    const controller = new AbortController();
    const file = props.file;
    void (async () => {
      if (!file && Date.now() - authorizedAt.current > STALE_URL_MS) {
        const target = await refresh();
        if (controller.signal.aborted) return;
        if (!target) throw new Error("Reconnect to the environment and try again.");
        authorizedAt.current = Date.now();
        if (target !== url) {
          setRemoteUrl(target);
          return;
        }
      }
      const response = file
        ? { ok: true, body: file.stream() }
        : await fetch(url, {
            signal: controller.signal,
            ...(props.sizeBytes > 0
              ? { headers: { Range: `bytes=0-${FILE_TEXT_PREVIEW_MAX_BYTES}` } }
              : {}),
            cache: revision === 0 ? "default" : "reload",
          });
      const result = await readFilePreviewResponse(response, controller.signal);
      if (!controller.signal.aborted) setContent(result);
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted)
        setContentError(cause instanceof Error ? cause.message : "Could not load this file.");
    });
    return () => controller.abort();
  }, [url, needsText, streamsText, revision, props.sizeBytes, props.file, refresh]);
  const failure = error ?? (needsText ? contentError : null);
  const defaultWordWrap = useClientSettings((settings) => settings.wordWrap);
  const [wordWrapOverride, setWordWrapOverride] = useState<boolean | null>(null);
  const wordWrap = wordWrapOverride ?? defaultWordWrap;
  const showsRawText =
    failure === null &&
    needsText &&
    (content !== null || streamsText) &&
    !(delimiter && rendered) &&
    !((kind === "markdown" || kind === "mermaid") && rendered);

  const save = () => {
    setSaving(true);
    void settlePromise(async () => {
      let file = props.file;
      if (!file) {
        const target = await prepareDownload();
        if (!target) throw new Error("Reconnect to the environment and try again.");
        const response = await fetch(target);
        if (!response.ok) throw new Error("The file could not be loaded. Try again.");
        file = await response.blob();
      }

      const downloadUrl = URL.createObjectURL(file);

      setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = props.name;
      anchor.click();
    }).then((result) => {
      if (!AsyncResult.isSuccess(result)) {
        const cause = Cause.squash(result.cause);
        toastManager.add({
          type: "error",
          title: "Could not save file",
          description: cause instanceof Error ? cause.message : "Please try again.",
        });
      }
      setSaving(false);
    });
  };

  const body = failure ? (
    <FileSurfaceFailure
      message={failure}
      onRetry={() => {
        setError(null);
        setRevision((value) => value + 1);
      }}
    />
  ) : streamsText && url ? (
    <Suspense fallback={<FileSurfaceLoading />}>
      <LargeTextViewer
        key={`${url}:${rendered}:${revision}`}
        name={props.name}
        src={url}
        sizeBytes={props.sizeBytes}
        onRetry={() => setRevision((value) => value + 1)}
        delimiter={rendered ? delimiter : null}
        copyContents={copyContents}
        wordWrap={wordWrap}
      />
    </Suspense>
  ) : !url || (needsText && !content) ? (
    <FileSurfaceLoading />
  ) : needsText && content ? (
    delimiter && rendered ? (
      <DelimitedTablePreview name={props.name} text={content.text} delimiter={delimiter} />
    ) : kind === "mermaid" && rendered ? (
      <Suspense fallback={<FileSurfaceLoading />}>
        <MermaidFilePreview text={content.text} />
      </Suspense>
    ) : kind === "markdown" && rendered ? (
      <ScrollArea className="min-h-0 flex-1">
        <ChatMarkdown
          text={maskMarkdownFrontmatter(content.text)}
          cwd={undefined}
          className="mx-auto max-w-4xl px-6 py-5"
        />
      </ScrollArea>
    ) : (
      <ReadOnlySourcePreview name={props.name} text={content.text} wordWrap={wordWrap} />
    )
  ) : kind === "archive" || kind === "sqlite" ? (
    <BinaryFilePreview
      key={revision}
      src={url}
      name={props.name}
      kind={kind}
      onRetry={() => setRevision((value) => value + 1)}
    />
  ) : kind === "font" ? (
    <Suspense fallback={<FileSurfaceLoading />}>
      <FontFilePreview src={url} name={props.name} />
    </Suspense>
  ) : officeKind ? (
    <Suspense fallback={<FileSurfaceLoading />}>
      <OfficeFilePreview
        src={url}
        name={props.name}
        kind={officeKind}
        sizeBytes={props.sizeBytes}
      />
    </Suspense>
  ) : kind === "pdf" || kind === "html" ? (
    <BrowserDocumentFrame
      src={url}
      title={props.name}
      pdf={kind === "pdf"}
      htmlRender={props.htmlRender === true}
      threadRef={props.threadRef}
    />
  ) : kind === "audio" ? (
    <AudioPreview src={url} name={props.name} onError={() => setError("Unable to load audio.")} />
  ) : kind === "video" ? (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
      <video
        controls
        playsInline
        src={url}
        aria-label={props.name}
        className="max-h-full max-w-full"
        onError={() => setError("Unable to load video.")}
      />
    </div>
  ) : kind === "image" ? (
    <PreviewImage
      key={url}
      src={url}
      name={props.name}
      mimeType={props.mimeType}
      onError={() => setError("Unable to load image.")}
    />
  ) : (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium">No preview for this file</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Save it to open in an app that supports {props.name.split(".").at(-1) || "this format"}{" "}
          files.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={saving} onClick={save}>
        <DownloadIcon />
        {saving ? "Preparing file…" : "Save file"}
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className={cn(FILE_SURFACE_SUBHEADER_CLASS)} data-surface-subheader>
        <div className="flex min-w-0 flex-1 items-center text-xs">
          <span className="shrink-0 px-0.5 text-muted-foreground">
            {props.origin ?? "Attachment"}
          </span>
          <ChevronRightIcon className="mx-1 size-3.5 shrink-0 text-muted-foreground/60" />
          <span aria-current="page" className="min-w-0 truncate px-0.5 font-medium text-foreground">
            {props.name}
          </span>
          {props.sizeBytes > 0 ? (
            <span className="ml-2 shrink-0 text-muted-foreground">
              {formatAttachmentSize(props.sizeBytes)}
            </span>
          ) : null}
        </div>
        {renderedMode ? (
          <FileSurfaceAction
            label={renderedToggleLabel(renderedMode, rendered)}
            pressed={rendered}
            onPress={() => setRendered((value) => !value)}
          >
            <MorphIcon
              className="size-3.5"
              icon={rendered ? CodeXml : renderedMode === "table" ? Table : Eye}
            />
          </FileSurfaceAction>
        ) : null}
        {showsRawText ? (
          <FileSurfaceAction
            label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
            pressed={wordWrap}
            onPress={() => setWordWrapOverride(!wordWrap)}
          >
            <WrapTextIcon className="size-3.5" />
          </FileSurfaceAction>
        ) : null}
        {content || streamsText ? (
          <FileSurfaceAction
            label={isCopied ? "Copied" : content?.truncated ? "Copy preview" : "Copy contents"}
            onPress={() => {
              if (content) {
                void copyToClipboard(content.text, undefined);
                return;
              }
              const copy = copyContents.current;
              if (!copy) {
                toastManager.add({
                  type: "error",
                  title: "Could not copy file",
                  description: "Wait for the file to finish loading before copying.",
                });
                return;
              }
              void copy()
                .then((text) => copyToClipboard(text, undefined))
                .catch((cause: unknown) =>
                  toastManager.add({
                    type: "error",
                    title: "Could not copy file",
                    description: cause instanceof Error ? cause.message : "Try again.",
                  }),
                );
            }}
          >
            <MorphIcon className="size-3.5" icon={isCopied ? Check : Copy} />
          </FileSurfaceAction>
        ) : null}
        {url && kind !== "unsupported" ? (
          <FileSurfaceAction
            label={saving ? "Preparing file…" : "Save file"}
            disabled={saving}
            onPress={save}
          >
            <DownloadIcon className="size-3.5" />
          </FileSurfaceAction>
        ) : null}
        {props.onRemove ? (
          <FileSurfaceAction label="Remove from draft" onPress={props.onRemove}>
            <TrashIcon className="size-3.5" />
          </FileSurfaceAction>
        ) : null}
        {props.onClose ? (
          <FileSurfaceAction label="Close" onPress={props.onClose}>
            <XIcon className="size-3.5" />
          </FileSurfaceAction>
        ) : null}
      </div>
      {content?.truncated ? (
        <FileSurfaceNotice>
          Preview limited to the first 1 MB
          {props.sizeBytes > 0 ? ` of a ${props.sizeBytes.toLocaleString()} byte file` : ""}. Save
          the file to read it in full.
        </FileSurfaceNotice>
      ) : null}
      {body}
    </div>
  );
}
