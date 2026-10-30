import type { EnvironmentId, ScopedThreadRef } from "@supaterm/contracts";
import {
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFileName,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
} from "@supaterm/shared/htmlRender";
import { ExpandIcon, PanelRightIcon } from "@supaterm/icons";
import { useEffect, useState } from "react";

import { useAssetUrlRefresh } from "~/assets/assetUrls";
import { useLongLivedAssetUrl } from "~/assets/longLivedAssetUrls";
import type { ChatFileAttachment } from "~/types";

import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HtmlRenderDialog } from "./HtmlRenderDialog";
import { observeResize } from "~/lib/observeResize";

const MIN_URL_LIFE_MS = 5 * 60_000;

export function HtmlRenderFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly htmlRender: HtmlRenderReference;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly onOpen: (attachment: ChatFileAttachment) => void;
  readonly onFullscreenChange?: (fullscreen: boolean) => void;
}) {
  const { attachmentId, title } = props.htmlRender;
  const [width, setWidth] = useState(HTML_RENDER_COLUMN_WIDTH);
  const observeBox = (box: HTMLDivElement) => {
    setWidth(box.clientWidth);
    return observeResize(box, ([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
  };
  // Client fonts can wrap a page taller than the server measured it; a frame
  // left short would scroll inside the thread and take the reader's scroll.
  const [contentHeight, setContentHeight] = useState<number>();
  const height = htmlRenderFrameHeight(props.htmlRender, width, contentHeight);
  const fileName = htmlRenderFileName(title);
  const resource = {
    _tag: "attachment" as const,
    attachmentId,
    fileName,
    mimeType: "text/html",
    disposition: "inline" as const,
  };
  const [loaded, setLoaded] = useState<{ src: string; expiresAt: number } | null>(null);
  const assetUrl = useLongLivedAssetUrl(loaded === null ? props.environmentId : null, resource);
  if (loaded === null && assetUrl._tag === "Success")
    setLoaded({ src: assetUrl.url, expiresAt: assetUrl.expiresAt });
  const src = loaded?.src ?? null;
  const failed = loaded === null && assetUrl._tag === "Failure";
  const refresh = useAssetUrlRefresh(props.environmentId, resource);
  const [expandedSrc, setExpandedSrc] = useState<string | null>(null);
  const { onFullscreenChange } = props;
  const expanded = expandedSrc !== null;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Hold the timeline's fullscreen pin until the dialog closes or the row unmounts.
  useEffect(() => {
    if (!expanded) return;
    onFullscreenChange?.(true);
    return () => onFullscreenChange?.(false);
  }, [expanded, onFullscreenChange]);

  return (
    <div ref={observeBox} className="group/html-render relative" style={{ height }}>
      {src !== null ? (
        <>
          <HtmlRenderDocument
            src={src}
            title={title}
            threadRef={props.threadRef}
            className="block size-full"
            onContentHeight={setContentHeight}
            onFullscreenChange={onFullscreenChange}
          />
          <div className="absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/html-render:opacity-100 pointer-coarse:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Open in panel"
                    size="icon-xs"
                    variant="glass"
                    onClick={() =>
                      props.onOpen({
                        type: "file",
                        id: attachmentId,
                        name: fileName,
                        mimeType: "text/html",
                        // Unknown here; the preview leaves it out.
                        sizeBytes: 0,
                        htmlRender: true,
                      })
                    }
                  />
                }
              >
                <PanelRightIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">Open in panel</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Open full screen"
                    size="icon-xs"
                    variant="glass"
                    onClick={async () => {
                      const url =
                        loaded !== null && loaded.expiresAt - Date.now() > MIN_URL_LIFE_MS
                          ? src
                          : await refresh().catch(() => null);
                      if (url !== null) setExpandedSrc(url);
                      else
                        toastManager.add({
                          type: "error",
                          title: "Page unavailable",
                          description: "Reconnect to the environment and try again.",
                        });
                    }}
                  />
                }
              >
                <ExpandIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">Open full screen</TooltipPopup>
            </Tooltip>
          </div>
          {expandedSrc !== null ? (
            <HtmlRenderDialog
              src={expandedSrc}
              title={title}
              threadRef={props.threadRef}
              onClose={() => setExpandedSrc(null)}
            />
          ) : null}
        </>
      ) : failed ? (
        <p className="flex size-full items-center justify-center text-muted-foreground text-xs">
          Unable to load {title}
        </p>
      ) : null}
    </div>
  );
}
