import { GUEST_RENDER_ROUTE, GUEST_SHARE_PARAM } from "@supaterm/contracts";
import {
  type HtmlRenderReference,
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFrameHeight,
  htmlRenderResult,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  readHtmlRenderContentHeight,
  readHtmlRenderLinkRequest,
} from "@supaterm/shared/htmlRender";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useGuestTransport } from "./GuestTransportContext";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { observeResize } from "~/lib/observeResize";

export function GuestHtmlRender({
  itemId,
  reference,
  shareId,
}: {
  readonly itemId: string;
  readonly reference: HtmlRenderReference;
  readonly shareId: string;
}) {
  const theme = useHtmlRenderTheme();
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(HTML_RENDER_COLUMN_WIDTH);
  const [contentHeight, setContentHeight] = useState<number>();
  const transport = useGuestTransport();
  const [src, setSrc] = useState<string>();
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- fetches the HTML through the encrypted guest transport and revokes its sandboxed blob on cleanup
  useEffect(() => {
    const abort = new AbortController();
    let url: string | undefined;
    const load = async () => {
      try {
        const response = await transport.request(
          `${GUEST_RENDER_ROUTE}?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}&item=${encodeURIComponent(itemId)}`,
          { signal: abort.signal },
        );
        if (!response.ok) return;
        const html = await response.text();
        if (abort.signal.aborted) return;
        const policy =
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";
        url = URL.createObjectURL(
          new Blob([`<meta http-equiv="Content-Security-Policy" content="${policy}">`, html], {
            type: "text/html",
          }),
        );
        setSrc(url);
      } catch {}
    };
    void load();
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [itemId, shareId, transport]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- measures the frame box and follows its width with a ResizeObserver before paint
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    setWidth(box.clientWidth);
    return observeResize(box, ([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
  }, []);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- posts theme changes to the iframe's window
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*");
  }, [theme]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- window message listener for the iframe's height reports and link requests
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (frame === null || event.source !== frame.contentWindow) return;
      const height = readHtmlRenderContentHeight(event.data);
      if (height !== undefined) {
        setContentHeight(height);
        return;
      }
      const link = readHtmlRenderLinkRequest(event.data);
      if (
        link === undefined ||
        document.activeElement !== frame ||
        navigator.userActivation?.isActive === false
      ) {
        return;
      }
      window.open(link.url, "_blank", "noopener,noreferrer");
      frame.contentWindow?.postMessage(htmlRenderResult(link.id), "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div
      ref={boxRef}
      style={{
        height: htmlRenderFrameHeight(reference, width, contentHeight),
      }}
    >
      <iframe
        ref={frameRef}
        src={src ? `${src}${htmlRenderThemeFragment(theme)}` : undefined}
        title={reference.title}
        sandbox="allow-scripts allow-forms allow-popups allow-downloads"
        className="block size-full rounded-lg border border-border"
      />
    </div>
  );
}
