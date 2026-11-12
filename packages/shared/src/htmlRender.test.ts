import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  htmlRenderTheme,
  injectHtmlRenderBootstrap,
  readHtmlRenderImageRequest,
  readHtmlRenderLinkRequest,
  readHtmlRenderSelectionEvent,
} from "./htmlRender.ts";
import { SUPATERM_DARK_THEME_COLORS, SUPATERM_LIGHT_THEME_COLORS } from "./themePalettes.ts";
import { htmlRenderFromToolItem } from "./toolOutput.ts";

const reference = { attachmentId: "thread-abc-123.html", title: "Chart", height: 420 };

describe("injectHtmlRenderBootstrap", () => {
  it("puts the theme ahead of the page's own head content", () => {
    const html =
      "<!doctype html><html><head><style>:root{--background:red}</style></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    const themeAt = injected.indexOf('<style id="supaterm-theme">');
    expect(themeAt).toBeGreaterThan(injected.indexOf("<head>"));
    expect(themeAt).toBeLessThan(injected.indexOf(":root{--background:red}"));
    expect(injected).toContain('<meta charset="utf-8">');
    expect(injected).toContain('name="viewport"');
  });

  it.each([
    "<html><head data-condition='x > 0'>",
    '<html><head data-condition="x > 0" data-label=\'it "works"\'>',
    "<html data-condition='x > 0'>",
    '<html data-condition="x > 0" data-label="it \'works\'">',
  ])("keeps the bootstrap after the complete opening tag: %s", (opening) => {
    const prefix = `<!doctype html>${opening}`;
    const head = opening.startsWith("<html><head") ? "" : "<head>";
    const content = `${head ? "" : "<title>Report</title></head>"}<body><p>Report</p></body></html>`;
    const injected = injectHtmlRenderBootstrap(prefix + content);
    expect(injected.startsWith(`${prefix}${head}<meta charset="utf-8">`)).toBe(true);
    expect(injected.indexOf('<style id="supaterm-theme">')).toBeGreaterThan(prefix.length);
    expect(injected).toContain("<script>");
    expect(injected.endsWith(content)).toBe(true);
  });

  it("wraps fragments without a head and keeps existing meta tags", () => {
    const fragment =
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><p>hi</p>';
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.match(/charset/g)).toHaveLength(1);
    expect(injected.match(/name="viewport"/g)).toHaveLength(1);
    expect(injected.endsWith("<p>hi</p>")).toBe(true);
  });

  it.each(["textarea", "iframe", "plaintext"])("keeps the bootstrap outside %s content", (tag) => {
    const fragment = `<${tag}><head><meta name="viewport"></head></${tag}>`;
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.indexOf('<style id="supaterm-theme">')).toBeLessThan(
      injected.indexOf(`<${tag}>`),
    );
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it.each([
    '<template><head><meta name="viewport"></head></template>',
    '<template><template>inner</template><head><meta name="viewport"></head></template>',
  ])("keeps the bootstrap outside inert template content: %s", (fragment) => {
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.indexOf('<style id="supaterm-theme">')).toBeLessThan(
      injected.indexOf("<template>"),
    );
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it("ignores tags written inside comments and scripts", () => {
    const html =
      '<!-- copy <head> and <meta name="viewport"> here --><html><head>' +
      "<script>const tag = '<meta name=\"viewport\">';</script></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    expect(injected.indexOf('<style id="supaterm-theme">')).toBeGreaterThan(
      injected.indexOf("<html><head>"),
    );
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
  });
});

describe("htmlRenderTheme", () => {
  it.each([
    ["light", SUPATERM_LIGHT_THEME_COLORS],
    ["dark", SUPATERM_DARK_THEME_COLORS],
  ] as const)("keeps chart series off the %s theme's accent", (appearance, colors) => {
    const series = (theme: ReturnType<typeof htmlRenderTheme>) =>
      [1, 2, 3, 4, 5, 6].map((n) => theme.variables[`--chart-${n}`]);
    const theme = htmlRenderTheme(colors, appearance);
    expect(series(theme)).toEqual(
      Array.from({ length: 6 }, () => expect.stringMatching(/^#[0-9a-f]{6}$/)),
    );
    expect(new Set(series(theme)).size).toBe(6);
    expect(series(theme)).not.toContain(theme.variables["--foreground"]);
    expect(series(htmlRenderTheme({ ...colors, accent: "#ff0000" }, appearance))).toEqual(
      series(theme),
    );
  });
});

describe("readHtmlRenderLinkRequest", () => {
  it("accepts only http(s) URLs in an MCP Apps ui/open-link request", () => {
    const link = (url: unknown, modifiers = {}) => ({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/open-link",
      params: { url, ...modifiers },
    });
    expect(readHtmlRenderLinkRequest(link("https://example.com/a"))).toEqual({
      id: 1,
      url: "https://example.com/a",
      metaKey: false,
      ctrlKey: false,
    });
    expect(
      readHtmlRenderLinkRequest(link("https://example.com/a", { metaKey: true, ctrlKey: "yes" })),
    ).toEqual({ id: 1, url: "https://example.com/a", metaKey: true, ctrlKey: false });
    expect(readHtmlRenderLinkRequest(link("javascript:alert(1)"))).toBeUndefined();
    expect(readHtmlRenderLinkRequest(link("file:///etc/passwd"))).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({
        jsonrpc: "2.0",
        method: "ui/open-link",
        params: { url: "https://example.com" },
      }),
    ).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({ type: "supaterm-html-render-link", url: "https://example.com" }),
    ).toBeUndefined();
  });
});

describe("readHtmlRenderImageRequest", () => {
  it("accepts http(s) and inline image URLs in an open-image notification", () => {
    const image = (params: unknown) => ({
      jsonrpc: "2.0",
      method: "supaterm/notifications/open-image",
      params,
    });
    expect(
      readHtmlRenderImageRequest(image({ src: "data:image/png;base64,AA", name: " Chart " })),
    ).toEqual({ images: [{ src: "data:image/png;base64,AA", name: "Chart" }], index: 0 });
    expect(readHtmlRenderImageRequest(image({ src: "https://example.com/a.png" }))).toEqual({
      images: [{ src: "https://example.com/a.png", name: "Image" }],
      index: 0,
    });
    const boundaryImage = readHtmlRenderImageRequest(
      image({ src: "https://example.com/a.png", name: "a".repeat(199) + "😀" }),
    );
    expect(boundaryImage?.images[0]?.name.isWellFormed()).toBe(true);
    expect(boundaryImage?.images[0]?.name).toBe("a".repeat(199));
    expect(readHtmlRenderImageRequest(image({ src: "javascript:alert(1)" }))).toBeUndefined();
    expect(readHtmlRenderImageRequest(image({ src: "data:text/html,<p>" }))).toBeUndefined();
    expect(readHtmlRenderImageRequest(image({ src: "blob:null/1" }))).toBeUndefined();
  });

  it("keeps the page's other images, dropping unsafe ones, around the clicked image", () => {
    const b = { src: "https://example.com/b.png", name: "B" };
    const params = {
      ...b,
      images: [{ src: "https://example.com/a.png", name: "A" }, { src: "blob:null/1" }, b, null],
      index: 2,
    };
    const request = (overrides: object) =>
      readHtmlRenderImageRequest({
        jsonrpc: "2.0",
        method: "supaterm/notifications/open-image",
        params: { ...params, ...overrides },
      });
    expect(request({})).toEqual({
      images: [{ src: "https://example.com/a.png", name: "A" }, b],
      index: 1,
    });
    // An index that does not point at the clicked image falls back to that image alone.
    expect(request({ index: 0 })).toEqual({ images: [b], index: 0 });
    expect(request({ index: -1 })).toEqual({ images: [b], index: 0 });
  });
});

describe("readHtmlRenderSelectionEvent", () => {
  const selection = (params: unknown, method = "supaterm/notifications/selection-changed") => ({
    jsonrpc: "2.0",
    method,
    params,
  });
  const rect = { left: 8, top: 20, right: 120, bottom: 38 };
  const bounds = { left: 8, top: 0, right: 300, bottom: 38 };

  it("reads a trimmed selection with its boxes, a clear, a Tab hand-off, and nothing else", () => {
    expect(
      readHtmlRenderSelectionEvent(selection({ text: " Quoted\nwords ", rect, bounds })),
    ).toEqual({ _tag: "selected", selection: { text: "Quoted\nwords", rect, bounds } });
    const cleared = { _tag: "cleared" };
    expect(readHtmlRenderSelectionEvent(selection({ text: "" }))).toEqual(cleared);
    expect(readHtmlRenderSelectionEvent(selection({ text: " \n ", rect, bounds }))).toEqual(
      cleared,
    );
    expect(
      readHtmlRenderSelectionEvent(
        selection(undefined, "supaterm/notifications/focus-selection-action"),
      ),
    ).toEqual({ _tag: "focus-action" });
    for (const params of [
      { text: "Quoted", bounds },
      { text: "Quoted", rect },
      { text: "Quoted", rect: { ...rect, top: Number.NaN }, bounds },
      { text: "Quoted", rect: { ...rect, right: 0 }, bounds },
      { text: "Quoted", rect, bounds: { ...bounds, bottom: Number.POSITIVE_INFINITY } },
      { text: "Quoted", rect, bounds: { ...bounds, top: 40 } },
      { text: 1, rect, bounds },
      { text: ["Quoted"], rect, bounds },
    ]) {
      expect(readHtmlRenderSelectionEvent(selection(params))).toBeUndefined();
    }
    expect(
      readHtmlRenderSelectionEvent(
        selection({ text: "Quoted", rect, bounds }, "supaterm/notifications/open-image"),
      ),
    ).toBeUndefined();
  });

  it("keeps oversized text one character past the citation limit, however it is padded", () => {
    const limit = ASSISTANT_CITATION_MAX_TEXT_LENGTH;
    const read = (text: string) => {
      const event = readHtmlRenderSelectionEvent(selection({ text, rect, bounds }));
      return event?._tag === "selected" ? event.selection.text : undefined;
    };
    expect(read("a".repeat(limit * 3))).toHaveLength(limit + 1);
    // Padding must not hide the overflow: trimming after the cut would leave a quote at the limit.
    expect(read(` ${"a".repeat(limit)}TAIL`)).toHaveLength(limit + 1);
    expect(read(` ${"a".repeat(limit)} `)).toHaveLength(limit);
  });
});

describe("htmlRenderFromToolItem", () => {
  const result = { htmlRender: reference, message: "Rendered above your reply." };

  it("reads the reference from each provider's result envelope", () => {
    for (const [toolName, output] of [
      ["mcp__supaterm__html_render", [{ type: "text", text: JSON.stringify(result) }]],
      ["supaterm.html_render", { structuredContent: result, content: [] }],
      ["supaterm-thread_1_html_render", JSON.stringify(result)],
      ["html_render", result],
    ] as const) {
      expect(htmlRenderFromToolItem({ toolName, output })).toEqual(reference);
    }
  });
});
