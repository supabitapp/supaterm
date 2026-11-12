import {
  htmlRenderClearSelectionMessage,
  htmlRenderSelectionActionMessage,
  injectHtmlRenderBootstrap,
} from "@supaterm/shared/htmlRender";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";

import { HtmlRenderDocument } from "./BrowserDocumentFrame";

const sizeChanged = (height: number) => ({
  jsonrpc: "2.0",
  method: "ui/notifications/size-changed",
  params: { height },
});

describe("HtmlRenderDocument", () => {
  it("reports the page's first height and ignores messages from other windows", async () => {
    using pageUrl = (() => {
      const page = `<script>parent.postMessage(${JSON.stringify(sizeChanged(321))}, "*");</script>`;
      const url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
      return { url, [Symbol.dispose]: () => URL.revokeObjectURL(url) };
    })();
    const onContentHeight = vi.fn();
    await using _screen = await render(
      <HtmlRenderDocument src={pageUrl.url} title="Report" onContentHeight={onContentHeight} />,
    );

    await vi.waitFor(() => expect(onContentHeight).toHaveBeenCalledWith(321));

    // Listeners run in registration order, so once this one sees the message the frame's has too.
    const delivered = new Promise<void>((resolve) =>
      window.addEventListener("message", () => resolve(), { once: true }),
    );
    window.postMessage(sizeChanged(999), "*");
    await delivered;
    expect(onContentHeight).toHaveBeenCalledTimes(1);
  });

  it("reports a dragged selection once, only from a focused frame, and hands Tab to an offered action", async () => {
    const box = { left: 0, top: 0, right: 10, bottom: 10 };
    const forged = {
      jsonrpc: "2.0",
      method: "supaterm/notifications/selection-changed",
      params: { text: "Forged", rect: box, bounds: box },
    };
    const html = injectHtmlRenderBootstrap(`<!doctype html><p id="quote">Quoted words</p><script>
      window.addEventListener("message", function(event) {
        if (event.source !== window.parent || event.data !== "forge") return;
        parent.postMessage(${JSON.stringify(forged)}, "*");
        parent.postMessage("forged", "*");
      });
    </script>`);
    const src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    using _url = { [Symbol.dispose]: () => URL.revokeObjectURL(src) };
    const listeners = new AbortController();
    using _listeners = { [Symbol.dispose]: () => listeners.abort() };
    const onContentHeight = vi.fn();
    const onSelection = vi.fn();
    await using screen = await render(
      <HtmlRenderDocument
        src={src}
        title="Quote"
        onContentHeight={onContentHeight}
        onSelection={onSelection}
      />,
    );
    await vi.waitFor(() => expect(onContentHeight).toHaveBeenCalled());
    const frame = screen.getByTitle("Quote").element() as HTMLIFrameElement;

    // A page can post any selection it likes. Without focus it is not the reader's.
    const forgedDelivered = new Promise<void>((resolve) =>
      window.addEventListener(
        "message",
        (event) => {
          if (event.source === frame.contentWindow && event.data === "forged") resolve();
        },
        { signal: listeners.signal },
      ),
    );
    frame.contentWindow?.postMessage("forge", "*");
    await forgedDelivered;
    expect(onSelection).not.toHaveBeenCalled();

    const quote = page.frameLocator(screen.getByTitle("Quote")).getByText("Quoted words");
    await userEvent.dragAndDrop(quote, quote, {
      sourcePosition: { x: 0, y: 5 },
      targetPosition: { x: 250, y: 5 },
    });
    await vi.waitFor(() => expect(onSelection).toHaveBeenCalled());
    expect(onSelection).toHaveBeenCalledTimes(1);
    const [reportedFrame, event] = onSelection.mock.calls[0]!;
    expect(reportedFrame).toBe(frame);
    expect(event._tag).toBe("selected");
    const { selection } = event;
    expect(selection.text).toBe("Quoted words");
    for (const reported of [selection.rect, selection.bounds]) {
      expect(reported.left).toBeGreaterThanOrEqual(0);
      expect(reported.top).toBeGreaterThanOrEqual(0);
      expect(reported.right).toBeGreaterThan(reported.left);
      expect(reported.bottom).toBeGreaterThan(reported.top);
      expect(reported.right).toBeLessThanOrEqual(frame.clientWidth);
      expect(reported.bottom).toBeLessThanOrEqual(frame.clientHeight);
    }

    // Tab is the page's own until the host offers an action for the selection.
    frame.contentWindow?.postMessage(htmlRenderSelectionActionMessage(true), "*");
    await userEvent.keyboard("{Tab}");
    await vi.waitFor(() =>
      expect(onSelection).toHaveBeenLastCalledWith(frame, { _tag: "focus-action" }),
    );
    expect(document.activeElement).toBe(frame);

    // The host clears the page's selection once it is quoted, and the page reports that.
    frame.contentWindow?.postMessage(htmlRenderClearSelectionMessage(), "*");
    await vi.waitFor(() =>
      expect(onSelection).toHaveBeenLastCalledWith(frame, { _tag: "cleared" }),
    );
    expect(onSelection).toHaveBeenCalledTimes(3);
  });

  it("opens a clicked image with the other images of its block in the viewer", async () => {
    const swatch = (color: string) =>
      `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="${color}"/></svg>`,
      )}`;
    const html = injectHtmlRenderBootstrap(
      `<!doctype html><html><body><div>${["Red", "Green", "Blue"]
        .map((name) => `<img alt="${name}" src="${swatch(name.toLowerCase())}">`)
        .join("")}</div></body></html>`,
    );
    const src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    using _url = { [Symbol.dispose]: () => URL.revokeObjectURL(src) };
    await using screen = await render(<HtmlRenderDocument src={src} title="Swatches" />);

    await page.frameLocator(screen.getByTitle("Swatches")).getByAltText("Green").click();

    const viewer = page.getByRole("dialog", { name: "Expanded image preview" });
    await expect.element(viewer.getByAltText("Green")).toBeVisible();
    await expect.element(viewer.getByRole("button", { name: "Next media" })).toBeVisible();
    await expect.element(viewer.getByRole("button", { name: "Previous media" })).toBeVisible();
  });
});

it("keeps the first and last selected card rings inside the fitted renderer frame", async () => {
  const html = injectHtmlRenderBootstrap(`<!doctype html><html><head><style>
    main { display: grid; gap: 12px; }
    button { box-sizing: border-box; width: 100%; height: 72px; border: 0; }
    button[aria-pressed="true"] { outline: 3px solid blue; outline-offset: 2px; }
  </style></head><body><main>
    <button id="first" aria-pressed="false">Meadow</button>
    <button id="middle" aria-pressed="false">Harbor</button>
    <button id="last" aria-pressed="false">Orchid</button>
  </main><script>
    document.querySelectorAll("button").forEach(function(button) {
      button.addEventListener("click", function() {
        document.querySelectorAll("button").forEach(function(card) {
          card.setAttribute("aria-pressed", String(card === button));
        });
      });
    });
    window.addEventListener("message", function(event) {
      if (event.source !== window.parent || event.data.type !== "select-card") return;
      var button = document.getElementById(event.data.id);
      button.click();
      var rect = button.getBoundingClientRect();
      var style = getComputedStyle(button);
      var ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      window.parent.postMessage({
        type: "selected-card-bounds",
        id: button.id,
        selected: button.getAttribute("aria-pressed") === "true",
        ring: ring,
        left: rect.left - ring,
        right: rect.right + ring,
        top: rect.top - ring,
        bottom: rect.bottom + ring,
        pageHeight: document.documentElement.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth
      }, "*");
    });
  </script></body></html>`);
  const src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  using _url = { [Symbol.dispose]: () => URL.revokeObjectURL(src) };
  const container = document.createElement("div");
  container.style.width = "728px";
  const reports = new Map<
    string,
    {
      selected: boolean;
      ring: number;
      left: number;
      right: number;
      top: number;
      bottom: number;
      pageHeight: number;
      viewportHeight: number;
      viewportWidth: number;
      scrollWidth: number;
    }
  >();
  const messages = new AbortController();
  using _messages = { [Symbol.dispose]: () => messages.abort() };
  window.addEventListener(
    "message",
    (event) => {
      const frame = container.querySelector("iframe");
      if (event.source === frame?.contentWindow && event.data?.type === "selected-card-bounds") {
        reports.set(event.data.id, event.data);
      }
    },
    { signal: messages.signal },
  );
  const contentHeight = vi.fn((height: number) => {
    container.style.setProperty("--content-height", `${height}px`);
  });
  await using screen = await render(
    <>
      <style>{`iframe[title="Edge cards"] {
        display: block; width: 100%; height: var(--content-height, 120px); border: 0;
      }`}</style>
      <HtmlRenderDocument src={src} title="Edge cards" onContentHeight={contentHeight} />
    </>,
    { container },
  );

  await vi.waitFor(() => expect(contentHeight).toHaveBeenCalled());
  const frame = screen.getByTitle("Edge cards").element() as HTMLIFrameElement;
  await vi.waitFor(() => {
    expect(frame.getBoundingClientRect().height).toBe(contentHeight.mock.lastCall?.[0]);
  });

  for (const id of ["first", "last"]) {
    frame.contentWindow?.postMessage({ type: "select-card", id }, "*");
    await vi.waitFor(() => expect(reports.get(id)?.selected).toBe(true));
    const bounds = reports.get(id)!;
    expect(bounds.ring).toBe(5);
    expect(bounds.viewportWidth).toBe(728);
    expect(bounds.pageHeight).toBe(contentHeight.mock.lastCall?.[0]);
    expect(bounds.viewportHeight).toBe(bounds.pageHeight);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewportWidth);
  }
});
