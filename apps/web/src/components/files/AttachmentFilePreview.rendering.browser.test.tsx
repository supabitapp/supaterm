import DocumentPages, { sanitizeDocumentHtml } from "./DocumentPages";
import { act, render, stubGlobal, type Screen } from "../../../test/render";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";

const { refresh, assetUrlState } = vi.hoisted(() => ({
  refresh: vi.fn<() => Promise<string | null>>(),
  assetUrlState: vi.fn<() => import("~/assets/assetUrls").AssetUrlState>(),
}));

vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlRefresh: () => refresh,
  useAssetUrlState: assetUrlState,
}));
// The real source view highlights through a worker pool; the text it receives is what matters here.
// Never load the original: its highlighter graph can outlast waitFor on a cold CI browser.
vi.mock(import("./ReadOnlySourcePreview"), () => ({
  default: ({ text, wordWrap }: { text: string; wordWrap?: boolean }) => (
    <pre data-word-wrap={String(wordWrap)}>{text}</pre>
  ),
}));

// The Word engine compiles about 30 MB of WebAssembly in a fresh worker per document, which took
// 10-17 s per test on loaded CI runners. These tests cover fetching, preparation and remounts, so
// the stand-in shows the prepared body's text instead of laying it out.
vi.mock(import("./office/WordDocument"), async () => {
  const { use } = await import("react");
  const { default: Zip } = await import("jszip");
  const texts = new WeakMap<ArrayBuffer, Promise<string>>();
  const read = (bytes: ArrayBuffer) =>
    Zip.loadAsync(bytes)
      .then((zip) => zip.file("word/document.xml")!.async("string"))
      .then((xml) => xml.replace(/<[^>]+>/g, " "));
  return {
    default: ({ bytes }: { bytes: ArrayBuffer }) => {
      let text = texts.get(bytes);
      if (!text) texts.set(bytes, (text = read(bytes)));
      return <pre>{use(text)}</pre>;
    },
  };
});

import { getClientSettings } from "~/hooks/useSettings";
import { AttachmentFilePreview } from "./AttachmentFilePreview";
import LargeTextViewer from "./LargeTextViewer";
import { OfficeFilePreview } from "./OfficeFilePreview";
import { MermaidFilePreview } from "./MermaidFilePreview";
import JSZip from "jszip";
import type { OfficeWorkerResult } from "./officePreviewProtocol";

describe("standalone Mermaid previews", () => {
  it.each([
    'A@{ "img": "//attacker.invalid/pixel.png" }',
    'A@{ "im\\u0067": "/pixel.png" }',
    "A@{ label: &key img, *key: '/pixel.png' }",
    'A["<img src=//attacker.invalid/pixel.png>"]',
  ])("never requests the resource in %s", async (node) => {
    using imageSource = vi
      .spyOn(HTMLImageElement.prototype, "src", "set")
      .mockImplementation(() => {});
    await using screen = await render(<MermaidFilePreview text={`flowchart LR\n${node}`} />);
    // Pele lays these out in a worker, so the diagram has to be on screen before its absence of
    // resource references means anything.
    await vi.waitFor(
      () => expect(screen.container.querySelector("[data-markdown-mermaid] svg")).not.toBeNull(),
      { timeout: 10_000 },
    );
    expect(imageSource).not.toHaveBeenCalled();
    expect(screen.container.querySelector("img, image, foreignObject, [*|href], [src]")).toBeNull();
  });

  it.each(["<-->", "<==>", "<-.->", "-->"])("renders the %s arrow", async (arrow) => {
    await using screen = await render(<MermaidFilePreview text={`flowchart LR\nA ${arrow} B`} />);
    await vi.waitFor(
      () => {
        const diagram = screen.container.querySelector("svg");
        expect(diagram?.querySelector("path")).not.toBeNull();
        expect(diagram?.textContent).toContain("A");
        expect(diagram?.textContent).toContain("B");
      },
      { timeout: 10_000 },
    );
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  });
});

it("reloads a workspace Word file after a preview remount", async () => {
  const { default: JSZip } = await import("jszip");
  let heading = "Original outlook";
  using _fetch = stubGlobal(
    "fetch",
    vi.fn(async () => {
      const archive = new JSZip().file(
        "word/document.xml",
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${heading}</w:t></w:r></w:p></w:body></w:document>`,
      );
      return new Response(await archive.generateAsync({ type: "arraybuffer" }));
    }),
  );
  refresh.mockReset().mockResolvedValue("https://example.com/workspace.docx");
  const asset = { environmentId: EnvironmentId.make("test-environment"), attachmentId: "word" };
  await using screen = await render(
    <AttachmentFilePreview
      key="original"
      name="outlook.docx"
      mimeType="application/octet-stream"
      sizeBytes={0}
      asset={asset}
    />,
  );
  await vi.waitFor(() => expect(screen.container.textContent).toContain("Original outlook"), {
    timeout: 10_000,
  });
  heading = "Revised outlook";
  await screen.rerender(
    <AttachmentFilePreview
      key="refreshed"
      name="outlook.docx"
      mimeType="application/octet-stream"
      sizeBytes={0}
      asset={asset}
    />,
  );
  await vi.waitFor(() => expect(screen.container.textContent).toContain("Revised outlook"), {
    timeout: 10_000,
  });
  expect(screen.container.textContent).not.toContain("Original outlook");
});

it("clears an Office metadata error when the same URL becomes previewable", async () => {
  const src = "data:application/octet-stream,invalid-office-file";
  let resolveResponse!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  using _fetch = stubGlobal(
    "fetch",
    vi.fn(() => response),
  );
  await using screen = await render(
    <OfficeFilePreview src={src} name="report.docx" kind="docx" sizeBytes={51 * 1024 * 1024} />,
  );
  await vi.waitFor(() => expect(screen.container.textContent).toContain("under 50 MB"));
  await screen.rerender(
    <OfficeFilePreview src={src} name="report.docx" kind="docx" sizeBytes={100} />,
  );
  await vi.waitFor(() =>
    expect(screen.container.querySelector('[aria-label="Loading file"]')).not.toBeNull(),
  );
  expect(screen.container.textContent).not.toContain("under 50 MB");
  resolveResponse(new Response("invalid-office-file"));
  await vi.waitFor(() => expect(screen.container.textContent).toContain("not a readable ZIP"), {
    timeout: 10_000,
  });
});

describe("attachment HTML preview recovery", () => {
  const originalUrl = "data:text/html,original";
  const renewedUrl = "data:text/html,renewed";

  function setup() {
    refresh.mockReset().mockResolvedValueOnce(originalUrl).mockResolvedValue(renewedUrl);
  }

  const openRemote = () =>
    render(
      <AttachmentFilePreview
        name="document.html"
        mimeType="text/html"
        sizeBytes={100}
        asset={{ environmentId: EnvironmentId.make("test-environment"), attachmentId: "html" }}
      />,
    );

  const toggleMode = async (screen: Screen, label: string) => {
    const button = screen.container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(button, label).not.toBeNull();
    await act(async () => button!.click());
  };
  const alert = (screen: Screen) => screen.container.querySelector('[role="alert"]');
  // The app's connection runtime keeps polling environment discovery through the same global
  // fetch while these tests run, so only the attachment's own requests are counted.
  const attachmentFetches = () =>
    vi
      .mocked(fetch)
      .mock.calls.map(([url]) => url)
      .filter((url) => typeof url === "string" && url.startsWith("data:text/html"));

  it("keeps a renewed URL for subsequent rendered and source views", async () => {
    setup();
    let now = 0;
    using _now = vi.spyOn(Date, "now").mockImplementation(() => now);
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<p>Captured HTML</p>")),
    );
    await using screen = await openRemote();
    expect(screen.container.querySelector("iframe")?.getAttribute("src")).toBe(originalUrl);
    now = 61 * 60_000;
    await toggleMode(screen, "Show HTML source");
    await act(async () => {
      await import("./ReadOnlySourcePreview");
    });
    expect(attachmentFetches()).toEqual([renewedUrl]);
    await vi.waitFor(() =>
      expect(screen.container.querySelector("pre")?.textContent).toBe("<p>Captured HTML</p>"),
    );

    await toggleMode(screen, "Show rendered page");
    expect(screen.container.querySelector("iframe")?.getAttribute("src")).toBe(renewedUrl);
    await toggleMode(screen, "Show HTML source");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(attachmentFetches()).toEqual([renewedUrl, renewedUrl]);
  });

  it("does not fetch or mark an expired URL fresh when reauthorization is unavailable", async () => {
    setup();
    let now = 0;
    using _now = vi.spyOn(Date, "now").mockImplementation(() => now);
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<p>Captured HTML</p>")),
    );
    await using screen = await openRemote();
    now = 61 * 60_000;
    refresh.mockResolvedValue(null);
    await toggleMode(screen, "Show HTML source");
    expect(attachmentFetches()).toEqual([]);
    expect(alert(screen)?.textContent).toContain("Reconnect to the environment and try again.");

    await toggleMode(screen, "Show rendered page");
    await toggleMode(screen, "Show HTML source");
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(attachmentFetches()).toEqual([]);
  });

  it("can return to rendered HTML after local source decoding fails", async () => {
    setup();
    let now = 0;
    using _now = vi.spyOn(Date, "now").mockImplementation(() => now);
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<p>Captured HTML</p>")),
    );
    const file = new Blob([new Uint8Array([0x3c, 0x70, 0x3e, 0xe9])], { type: "text/html" });
    await using screen = await render(
      <AttachmentFilePreview
        name="document.html"
        mimeType="text/html"
        sizeBytes={file.size}
        file={file}
      />,
    );
    await toggleMode(screen, "Show HTML source");
    await vi.waitFor(() => expect(alert(screen)?.textContent).toContain("not UTF-8"));

    await toggleMode(screen, "Show rendered page");
    expect(alert(screen)).toBeNull();
    expect(screen.container.querySelector("iframe")?.title).toBe("document.html");
  });
});

describe("document output sanitization", () => {
  it("fits saved HTML outputs to their content and resizes when the content changes", async () => {
    await using screen = await render(
      <DocumentPages html="<table><tr><td>42</td></tr></table>" name="Output" output />,
    );
    const frame = screen.container.querySelector("iframe")!;
    await vi.waitFor(() => {
      expect(frame.contentDocument?.querySelector("td")?.textContent).toBe("42");
      expect(frame.clientHeight).toBeGreaterThan(32);
      expect(frame.clientHeight).toBeLessThan(120);
    });
    const initialHeight = frame.clientHeight;
    await screen.rerender(
      <DocumentPages html={"<p>More saved output</p>".repeat(10)} name="Output" output />,
    );
    await vi.waitFor(() => {
      expect(frame.contentDocument?.querySelectorAll("p")).toHaveLength(10);
      expect(frame.clientHeight).toBeGreaterThan(initialHeight);
      expect(frame.contentDocument!.body.scrollHeight).toBeLessThanOrEqual(frame.clientHeight);
    });
  });

  it("preserves table content and raster data while removing scripts and network resources", () => {
    const html = sanitizeDocumentHtml(
      '<script>alert(1)</script><style>@import "https://example.com/style.css";</style><iframe src="https://example.com"></iframe><img src="https://example.com/tracker.png" onerror="alert(1)"><img src="data:image/png;base64,iVBORw0KGgo="><table><tr><td>Research</td></tr></table><a href="https://example.com">Results</a>',
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("td")?.textContent).toBe("Research");
    expect(doc.images).toHaveLength(1);
    expect(doc.images[0]!.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(doc.querySelector("script,style,iframe,a,[onerror]")).toBeNull();
    expect(html).not.toContain("https://");
  });
});
it("opens a known empty attachment even when its range response is inaccessible", async () => {
  refresh.mockResolvedValue("https://unreachable.invalid/empty.txt");
  await using screen = await render(
    <AttachmentFilePreview
      name="empty.txt"
      mimeType="text/plain"
      sizeBytes={0}
      asset={{ environmentId: EnvironmentId.make("test"), attachmentId: "empty" }}
    />,
  );
  await vi.waitFor(
    () => expect(screen.container.textContent).toContain("This file is empty."),
    10_000,
  );
});

it.each(["draft", "thread"] as const)(
  "reads an unknown-size %s workspace file instead of treating it as empty",
  async (source) => {
    refresh.mockResolvedValue("https://example.test/binary.txt");
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid\0text")),
    );
    await using screen = await render(
      <AttachmentFilePreview
        name="binary.txt"
        mimeType="application/octet-stream"
        sizeBytes={0}
        asset={{
          environmentId: EnvironmentId.make("test"),
          resource:
            source === "draft"
              ? { _tag: "draft-workspace-file", cwd: "/repo", path: "/repo/binary.txt" }
              : { _tag: "media-file", threadId: ThreadId.make("test"), path: "/repo/binary.txt" },
        }}
      />,
    );
    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain(
        "This file contains binary data and cannot be shown as text.",
      ),
    );
    expect(fetch).toHaveBeenCalled();
    expect(screen.container.textContent).not.toContain("This file is empty.");
  },
);

it("refreshes authorization and retries a failed streamed attachment", async () => {
  const bad = URL.createObjectURL(new Blob(["invalid\0text"]));
  const good = URL.createObjectURL(new Blob(["recovered text\n"]));
  refresh.mockReset().mockResolvedValueOnce(bad).mockResolvedValue(good);
  try {
    await using screen = await render(
      <AttachmentFilePreview
        name="retry.txt"
        mimeType="text/plain"
        sizeBytes={2_000_000}
        asset={{ environmentId: EnvironmentId.make("test"), attachmentId: "retry" }}
      />,
    );
    // A cold large-text worker can take longer than waitFor's default to boot on CI.
    await vi.waitFor(
      () => expect(screen.container.textContent).toContain("This file contains binary data."),
      { timeout: 10_000 },
    );
    await act(() =>
      screen.container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    await vi.waitFor(() => expect(screen.container.textContent).toContain("recovered text"));
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally {
    URL.revokeObjectURL(bad);
    URL.revokeObjectURL(good);
  }
});

it.each([
  ["custom/sheet1.xml", 250001],
  ["/xl/custom/sheet1.bin", 250001],
  ["custom/valid.xml", 1],
] as const)(
  "bounds the worksheet relationship target %s at row %i before the reader allocates its grid",
  async (target, row) => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/></Relationships>`,
    );
    zip.file(
      target.startsWith("/") ? target.slice(1) : `xl/${target}`,
      `<worksheet><sheetData><row r="${row}"><c r="A${row}" t="inlineStr"><is><t>worksheet value</t></is></c></row></sheetData></worksheet>`,
    );
    const file = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const src = URL.createObjectURL(file);
    try {
      await using screen = await render(
        <div style={{ display: "flex", height: 400, width: 600 }}>
          <OfficeFilePreview name="custom.xlsx" src={src} kind="xlsx" sizeBytes={file.size} />
        </div>,
      );
      await vi.waitFor(
        () =>
          expect(screen.container.textContent).toContain(
            row > 250000 ? "This workbook exceeds the preview limit" : "worksheet value",
          ),
        { timeout: 10_000 },
      );
    } finally {
      URL.revokeObjectURL(src);
    }
  },
);

it("copies every indexed line rather than the mounted preview rows", async () => {
  const text = Array.from({ length: 10_000 }, (_, i) => `line-${i}`).join("\n");
  const copyContents = { current: null as (() => Promise<string>) | null };
  await using screen = await render(
    <LargeTextViewer name="whole.txt" text={text} delimiter={null} copyContents={copyContents} />,
  );
  await vi.waitFor(() => expect(screen.container.textContent).toContain("line-0"));
  // Copy rejects until the worker finishes indexing, which a cold worker can delay past waitFor's default on CI.
  await vi.waitFor(async () => expect(await copyContents.current!()).toBe(text), {
    timeout: 10_000,
  });
  const first = copyContents.current!();
  await expect(copyContents.current!()).rejects.toThrow("Another copy is in progress.");
  expect(await first).toBe(text);
  expect(await copyContents.current!()).toBe(text);
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

it.each(["archive", "sqlite"] as const)(
  "reauthorizes and retries a failed %s attachment",
  async (kind) => {
    const bad = URL.createObjectURL(new Blob(["invalid"]));
    let bytes: Uint8Array<ArrayBuffer>;
    if (kind === "archive")
      bytes = new Uint8Array(
        await new JSZip().file("recovered.txt", "ok").generateAsync({ type: "uint8array" }),
      );
    else {
      const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
        import("sql.js"),
        import("sql.js/dist/sql-wasm.wasm?url"),
      ]);
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      const database = new SQL.Database();
      database.run(
        "CREATE TABLE recovered (value TEXT); INSERT INTO recovered VALUES('retry succeeded')",
      );
      bytes = new Uint8Array(database.export());
      database.close();
    }
    const good = URL.createObjectURL(new Blob([bytes]));
    refresh.mockReset().mockResolvedValueOnce(bad).mockResolvedValue(good);
    try {
      await using screen = await render(
        <AttachmentFilePreview
          name={kind === "archive" ? "retry.zip" : "retry.sqlite"}
          mimeType="application/octet-stream"
          sizeBytes={bytes.length}
          asset={{ environmentId: EnvironmentId.make("test"), attachmentId: "retry" }}
        />,
      );
      await vi.waitFor(
        () => expect(screen.container.querySelector('[role="alert"] button')).not.toBeNull(),
        10_000,
      );
      await act(() =>
        screen.container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
      );
      await vi.waitFor(
        () =>
          expect(screen.container.textContent).toContain(
            kind === "archive" ? "recovered.txt" : "retry succeeded",
          ),
        10_000,
      );
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      URL.revokeObjectURL(bad);
      URL.revokeObjectURL(good);
    }
  },
);

it("loads a font attachment through the lazy preview", async () => {
  const { default: fontUrl } =
    await import("../../../node_modules/@betteroffice/fonts/assets/Carlito-Regular.ttf?url");
  const file = await (await fetch(fontUrl)).blob();
  await using screen = await render(
    <AttachmentFilePreview
      name="Carlito.ttf"
      mimeType="font/ttf"
      sizeBytes={file.size}
      file={file}
    />,
  );
  // Two cold lazy chunks plus decoding a 600 KB font can take longer than waitFor's default on CI.
  await vi.waitFor(
    () => {
      const frame = screen.container.querySelector("iframe");
      expect(frame?.title).toBe("Carlito.ttf");
      expect(frame?.srcdoc).toContain("@font-face");
      expect(frame?.srcdoc).toContain("The quick brown fox");
    },
    { timeout: 10_000 },
  );
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

it("toggles a Mermaid attachment between diagram and source through the lazy preview", async () => {
  const text = "flowchart LR\nA --> B";
  const file = new Blob([text], { type: "text/vnd.mermaid" });
  await using screen = await render(
    <AttachmentFilePreview
      name="diagram.mmd"
      mimeType={file.type}
      sizeBytes={file.size}
      file={file}
    />,
  );
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-markdown-mermaid] svg path")).not.toBeNull(),
  );
  await screen.getByRole("button", { name: "Expand diagram" }).click();
  await vi.waitFor(() => {
    const image = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    expect(image?.alt).toBe("Mermaid diagram");
    expect(image?.naturalWidth).toBeGreaterThan(0);
  });
  await page.getByRole("button", { name: "Close image preview" }).click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await screen.getByRole("button", { name: "Show Mermaid source" }).click();
  await vi.waitFor(() => expect(screen.container.querySelector("pre")?.textContent).toBe(text));
  await screen.getByRole("button", { name: "Show rendered diagram" }).click();
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-markdown-mermaid] svg path")).not.toBeNull(),
  );
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

it("keeps a workspace PDF open across URL renewals and reloads it when the file changes", async () => {
  const { WorkspaceBrowserPreview } = await import("./FilePreviewPanel");
  using _native = vi.spyOn(navigator, "pdfViewerEnabled", "get").mockReturnValue(true);
  const original = URL.createObjectURL(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
  const edited = URL.createObjectURL(new Blob(["%PDF-1.4 edited"], { type: "application/pdf" }));
  const preview = (mutation: string) => (
    <WorkspaceBrowserPreview
      environmentId={EnvironmentId.make("test")}
      threadRef={{ environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("test") }}
      draft={false}
      workspaceRoot="/repo"
      absolutePath="/repo/planning.pdf"
      title="Planning PDF"
      workspaceMutationId={mutation}
    />
  );
  assetUrlState.mockReturnValue({
    _tag: "Success",
    url: `${original}#initial`,
    expiresAt: 0,
    fileRevision: "one",
  });
  try {
    await using screen = await render(preview("first"));
    const opened = screen.container.querySelector("iframe");
    expect(opened?.src.startsWith(original)).toBe(true);

    // An agent command renews the signed URL but leaves the file alone.
    assetUrlState.mockReturnValue({
      _tag: "Success",
      url: `${original}#renewed`,
      expiresAt: 0,
      fileRevision: "one",
    });
    await screen.rerender(preview("second"));
    expect(assetUrlState).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), "second");
    expect(screen.container.querySelector("iframe")).toBe(opened);

    assetUrlState.mockReturnValue({
      _tag: "Success",
      url: edited,
      expiresAt: 0,
      fileRevision: "two",
    });
    await screen.rerender(preview("third"));
    const reloaded = screen.container.querySelector("iframe");
    expect(reloaded).not.toBe(opened);
    expect(reloaded?.src.startsWith(edited)).toBe(true);

    // Servers without revisions hold the preview back until a fresh grant arrives.
    assetUrlState.mockReturnValue({
      _tag: "Success",
      url: `${edited}#stale`,
      expiresAt: 0,
      waiting: true,
    });
    await screen.rerender(preview("fourth"));
    expect(screen.container.querySelector("iframe")).toBeNull();
    assetUrlState.mockReturnValue({ _tag: "Success", url: original, expiresAt: 0 });
    await screen.rerender(preview("fourth"));
    expect(screen.container.querySelector("iframe")?.src.startsWith(original)).toBe(true);
  } finally {
    URL.revokeObjectURL(original);
    URL.revokeObjectURL(edited);
  }
});
function planningPdf(
  titles = ["Quarterly outlook", "Delivery milestones", "Budget and risks"],
  firstHeight = 140,
  pageHeight = 792,
) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${titles.length} /Kids [${titles.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] >>`,
  ];
  const font = 3 + titles.length * 2;
  for (const [index, title] of titles.entries()) {
    const text = `/GS1 gs BT /F1 24 Tf 30 ${index === 0 ? 70 : 700} Td ${index === 0 ? "(Quarter) Tj /F2 24 Tf (ly outlook) Tj" : `(${title}) Tj`} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${index === 0 ? firstHeight : pageHeight}] /Rotate ${index === 2 ? 90 : 0} /Resources << /Font << /F1 ${font} 0 R /F2 ${font + 1} 0 R >> /ExtGState << /GS1 << /TR << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 2 >> >> >> >> /Contents ${4 + index * 2} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([source], { type: "application/pdf" });
}

async function workspacePdfPreview() {
  assetUrlState.mockReset();
  const { WorkspaceBrowserPreview } = await import("./FilePreviewPanel");
  const native = vi.spyOn(navigator, "pdfViewerEnabled", "get").mockReturnValue(false);
  const urls = (() => {
    const original = URL.createObjectURL(planningPdf());
    const updated = URL.createObjectURL(
      planningPdf(["Quarterly outlook", "Delivery milestones", "Updated budget"], 500),
    );
    const shorter = URL.createObjectURL(planningPdf(["Quarterly outlook", "Updated milestones"]));
    const shrunk = URL.createObjectURL(
      planningPdf(["Quarterly outlook", "Small page", "Budget and risks"], 500, 200),
    );
    const single = URL.createObjectURL(planningPdf(["Quarterly outlook"]));
    return {
      original,
      updated,
      shorter,
      shrunk,
      single,
      [Symbol.dispose]: () =>
        [original, updated, shorter, shrunk, single].forEach(URL.revokeObjectURL),
    };
  })();
  const preview = (src: string, mutation: string, path = "/repo/planning.pdf") => {
    assetUrlState.mockReturnValue({
      _tag: "Success",
      url: `${src}#preview`,
      expiresAt: Date.now() + 3_600_000,
    });
    return (
      <div className="flex h-[600px] w-[320px]">
        <WorkspaceBrowserPreview
          environmentId={EnvironmentId.make("test")}
          threadRef={{ environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("test") }}
          draft={false}
          absolutePath={path}
          workspaceRoot="/repo"
          title="Planning PDF"
          workspaceMutationId={mutation}
        />
      </div>
    );
  };
  return {
    preview,
    urls,
    [Symbol.dispose]() {
      native.mockRestore();
      urls[Symbol.dispose]();
    },
  };
}

function pdfScroll(screen: Screen) {
  const region = () => screen.container.querySelector<HTMLElement>('[role="region"]')!;
  const canvas = (page: number) =>
    region().querySelector<HTMLCanvasElement>(`canvas[aria-label="Page ${page}"]`)!;
  const offset = (page: number) =>
    region().getBoundingClientRect().top - canvas(page).getBoundingClientRect().top;
  const scrollTo = (options: ScrollToOptions) =>
    act(async () => {
      const node = region();
      const scrolled = new Promise<void>((resolve) =>
        node.addEventListener("scroll", () => resolve(), { once: true }),
      );
      node.scrollTo(options);
      await scrolled;
    });
  return { region, canvas, offset, scrollTo };
}

it("keeps workspace PDF scroll and zoom after reloads", async () => {
  using fixture = await workspacePdfPreview();
  const { preview, urls } = fixture;
  await using screen = await render(preview(urls.original, "one"));
  await expect.element(screen.getByText("1 / 3 pages", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Next page", exact: true }).click();
  await vi.waitFor(() => expect(screen.container.textContent).toContain("2 / 3 pages"));
  await screen.getByRole("button", { name: "Next page", exact: true }).click();
  await vi.waitFor(() => expect(screen.container.textContent).toContain("3 / 3 pages"));
  for (let index = 0; index < 4; index++) {
    await screen.getByRole("button", { name: "Zoom in", exact: true }).click();
  }
  const { region, offset, scrollTo } = pdfScroll(screen);
  const zoom = screen.container.textContent!.match(/\d+%/)![0];
  const top = region().scrollTop;
  await scrollTo({ top: top + 100, left: 80 });
  await vi.waitFor(() => {
    expect(region().scrollTop).toBeCloseTo(top + 100, 0);
    expect(region().scrollLeft).toBe(80);
  });
  const savedOffset = offset(3);
  await screen.rerender(preview(urls.updated, "two"));
  await expect.element(screen.getByText("3 / 3 pages", { exact: true })).toBeVisible();
  await vi.waitFor(() => {
    expect(screen.container.querySelector('[role="region"]')?.textContent).toContain(
      "Updated budget",
    );
    expect(screen.container.textContent).toContain(zoom);
    expect(region().scrollLeft).toBe(80);
    expect(offset(3)).toBeCloseTo(savedOffset, 0);
  });
  await screen.getByRole("button", { name: "Previous page", exact: true }).click();
  await vi.waitFor(() => expect(screen.container.textContent).toContain("2 / 3 pages"));
  await screen.getByRole("button", { name: "Fit width", exact: true }).click();
  await scrollTo({ top: region().scrollTop + 30 });
  const fitOffset = offset(2);
  await screen.rerender(preview(urls.original, "fit-width"));
  await expect.element(screen.getByText("2 / 3 pages", { exact: true })).toBeVisible();
  await vi.waitFor(() => {
    expect(screen.container.textContent).toContain("Fit width");
    expect(region().scrollLeft).toBe(0);
    expect(offset(2)).toBeCloseTo(fitOffset, 0);
  });
  await screen.getByRole("button", { name: "Previous page", exact: true }).click();
  await vi.waitFor(() => expect(screen.container.textContent).toContain("1 / 3 pages"));
  await screen.getByRole("button", { name: "Zoom in", exact: true }).click();
  const firstPageZoom = screen.container.textContent!.match(/\d+%/)![0];
  await screen.rerender(preview(urls.original, "first-page"));
  await expect.element(screen.getByText("1 / 3 pages", { exact: true })).toBeVisible();
  await vi.waitFor(() => expect(screen.container.textContent).toContain(firstPageZoom));
  await screen.getByRole("button", { name: "Next page", exact: true }).click();
  await vi.waitFor(() => expect(screen.container.textContent).toContain("2 / 3 pages"));
  await screen.rerender(preview(urls.original, "one", "/repo/another.pdf"));
  await expect.element(screen.getByText("1 / 3 pages", { exact: true })).toBeVisible();
  await vi.waitFor(() => {
    expect(screen.container.textContent).toContain("Fit width");
    expect(region().scrollTop).toBe(0);
    expect(region().scrollLeft).toBe(0);
  });
});

it("clamps workspace PDF scroll when pages shrink or disappear", async () => {
  using fixture = await workspacePdfPreview();
  const { preview, urls } = fixture;
  await using screen = await render(preview(urls.original, "one"));
  await expect.element(screen.getByText("1 / 3 pages", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Next page", exact: true }).click();
  await expect.element(screen.getByText("2 / 3 pages", { exact: true })).toBeVisible();
  for (let index = 0; index < 4; index++) {
    await screen.getByRole("button", { name: "Zoom in", exact: true }).click();
  }
  const { region, canvas, offset, scrollTo } = pdfScroll(screen);
  const zoom = screen.container.textContent!.match(/\d+%/)![0];
  const secondPageTop = region().scrollTop;
  await scrollTo({ top: secondPageTop + 600, left: 80 });
  await vi.waitFor(() => expect(region().scrollTop).toBeCloseTo(secondPageTop + 600, 0));
  await screen.rerender(preview(urls.shrunk, "smaller-page"));
  await expect.element(screen.getByText("2 / 3 pages", { exact: true })).toBeVisible();
  await vi.waitFor(() => {
    expect(screen.container.textContent).toContain(zoom);
    expect(region().scrollLeft).toBe(80);
    expect(offset(2)).toBeGreaterThan(0);
    expect(offset(2)).toBeLessThan(canvas(2).getBoundingClientRect().height);
  });
  await screen.rerender(preview(urls.shorter, "three"));
  await expect.element(screen.getByText("2 / 2 pages", { exact: true })).toBeVisible();
  await vi.waitFor(() => {
    expect(screen.container.querySelector('[role="region"]')?.textContent).toContain(
      "Updated milestones",
    );
  });
  await screen.rerender(preview(urls.single, "four"));
  await expect.element(screen.getByText("1 / 1 pages", { exact: true })).toBeVisible();
  await screen.rerender(preview(urls.original, "five"));
  await expect.element(screen.getByText("1 / 3 pages", { exact: true })).toBeVisible();
});

it("unwraps one text attachment without turning off the word wrap setting", async () => {
  const file = new Blob(["a long line"], { type: "text/plain" });
  await using screen = await render(
    <AttachmentFilePreview
      name="notes.txt"
      mimeType={file.type}
      sizeBytes={file.size}
      file={file}
    />,
  );
  await screen.getByRole("button", { name: "Disable word wrap" }).click();
  await expect.element(screen.getByRole("button", { name: "Enable word wrap" })).toBeVisible();
  expect(getClientSettings().wordWrap).toBe(true);
  expect(screen.container.querySelector("pre")?.dataset.wordWrap).toBe("false");
});

it("mounts a bounded set of saved notebook outputs as the reader scrolls", async () => {
  const notebook = {
    nbformat: 4,
    metadata: {},
    cells: Array.from({ length: 20 }, (_, cell) => ({
      cell_type: "code",
      source: [],
      metadata: {},
      outputs: Array.from({ length: 100 }, (_, output) => ({
        output_type: "display_data",
        data: { "text/html": `<p>saved ${cell}-${output}</p>` },
      })),
    })),
  };
  const file = new Blob([JSON.stringify(notebook)]);
  await using screen = await render(
    <div style={{ display: "flex", height: 400, width: 600 }}>
      <AttachmentFilePreview
        name="observations.ipynb"
        mimeType="application/json"
        sizeBytes={file.size}
        file={file}
      />
    </div>,
  );
  // The first outputs wait on the lazy notebook viewer and the conversion worker, not on a frame.
  await vi.waitFor(
    () => expect(screen.container.querySelectorAll("iframe").length).toBeGreaterThan(0),
    { timeout: 10_000 },
  );
  expect(screen.container.querySelectorAll("iframe").length).toBeLessThanOrEqual(16);
  const first = screen.container.querySelector("iframe")!;
  expect(first.srcdoc).toContain("saved 0-0");
  const viewport = screen.container.querySelector<HTMLElement>(".scrollbar-gutter-both")!;
  await act(() => {
    viewport.scrollTop = viewport.scrollHeight;
  });
  await vi.waitFor(() => {
    expect(
      [...screen.container.querySelectorAll("iframe")].some((frame) =>
        frame.srcdoc.includes("saved 19-99"),
      ),
    ).toBe(true);
    expect(first.isConnected).toBe(false);
  });
  expect(screen.container.querySelectorAll("iframe").length).toBeLessThanOrEqual(16);
  await act(() => {
    viewport.scrollTop = 0;
  });
  await vi.waitFor(() =>
    expect(screen.container.querySelector("iframe")?.srcdoc).toContain("saved 0-0"),
  );
});

it.each([
  [String.raw`{\rtf1\uc1\u945{\b bold}Hello}`, "αboldHello"],
  [String.raw`{\rtf1\uc1{\u945}Hello}`, "αHello"],
  [
    String.raw`{\rtf1\ansi{\fonttbl{\f0\fcharset204 Cyrillic;}{\f1\fcharset0 Latin;}}\f0\'c0{\f1\'c0}\'c1}`,
    "АÀБ",
  ],
  [String.raw`{\rtf1\ansi\deff1{\fonttbl{\f1\fcharset204 Cyrillic;}}\'c0\plain\'c1}`, "АБ"],
])("retains RTF grouped Unicode and font text in %s", async (source, expected) => {
  const { openRtf } = await import("./extendedDocumentPreview");
  const result = openRtf(new TextEncoder().encode(source).buffer);
  if (result.type !== "document") throw new Error("Expected rich text document");
  const html = result.pages.map((page) => page.html).join("");
  expect(new DOMParser().parseFromString(html, "text/html").body.textContent).toBe(expected);
});

it.each(["odt", "odp"] as const)("preserves rendered %s spaces and tabs", async (kind) => {
  const archive = new JSZip().file(
    "content.xml",
    `<office:document>${kind === "odt" ? "<office:text>" : "<draw:page>"}<text:p>A<text:s text:c="3"/>B<text:tab/>C</text:p>${kind === "odt" ? "</office:text>" : "</draw:page>"}</office:document>`,
  );
  const bytes = await archive.generateAsync({ type: "arraybuffer" });
  const worker = new Worker(new URL("./officePreview.worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    const result = await new Promise<OfficeWorkerResult>((resolve) => {
      worker.addEventListener(
        "message",
        (event: MessageEvent<OfficeWorkerResult>) => resolve(event.data),
        { once: true },
      );
      worker.postMessage({ type: "open", kind, bytes }, [bytes]);
    });
    if (result.type !== "document") throw new Error("Expected document");
    await using screen = await render(
      <DocumentPages html={result.pages[0]!.html} name="spacing" output />,
    );
    await vi.waitFor(() => {
      const doc = screen.container.querySelector("iframe")?.contentDocument;
      const spans = doc?.querySelectorAll<HTMLElement>("span[data-odf-whitespace]");
      expect(doc?.querySelector("p")?.textContent).toBe("A   B\tC");
      expect(spans).toHaveLength(2);
      for (const span of spans!) {
        expect(doc!.defaultView!.getComputedStyle(span).whiteSpace).toBe("pre-wrap");
        expect(span.getBoundingClientRect().width).toBeGreaterThan(0);
      }
      expect(spans![0]!.getBoundingClientRect().width).toBeGreaterThan(10);
    });
  } finally {
    worker.terminate();
  }
});

it.each(["rtf", "epub", "ods"] as const)(
  "preserves %s document text through the worker and attachment viewer",
  async (kind) => {
    const archive = new JSZip();
    if (kind === "epub") {
      archive.file(
        "META-INF/container.xml",
        '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
      );
      archive.file(
        "book.opf",
        '<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
      );
      archive.file(
        "chapter.xhtml",
        "<html><head><title>Handbook</title></head><body><p>first<br/>second<br/>third</p><hr/></body></html>",
      );
    } else if (kind === "ods") {
      archive.file(
        "content.xml",
        '<office:document><table:table table:name="Forecast"><table:table-row><table:table-cell><text:p>North<office:annotation><text:p>nested note</text:p></office:annotation></text:p><office:annotation><text:p>private note</text:p></office:annotation></table:table-cell><table:table-cell office:value="150"><office:annotation><text:p>revised from 120</text:p></office:annotation></table:table-cell><table:table-cell table:number-columns-repeated="1024"/></table:table-row><table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table></office:document>',
      );
    }
    const file =
      kind === "rtf"
        ? new Blob([
            String.raw`{\rtf1\ansi 10\endash 20 \emdash \bullet \lquote a\rquote \ldblquote b\rdblquote\par Name\cell Value\cell\row 12\cell 34\cell\row{\*\private hidden\endash\cell\row}Unicode:\u8211\endash end}`,
          ])
        : await archive.generateAsync({ type: "blob" });
    const bytes = await file.arrayBuffer();
    const worker = new Worker(new URL("./officePreview.worker.ts", import.meta.url), {
      type: "module",
    });
    try {
      const result = await new Promise<OfficeWorkerResult>((resolve) => {
        worker.addEventListener(
          "message",
          (event: MessageEvent<OfficeWorkerResult>) => resolve(event.data),
          { once: true },
        );
        worker.postMessage({ type: "open", kind, bytes }, [bytes]);
      });
      if (kind === "ods") {
        expect(result.type).toBe("ods");
        if (result.type !== "ods") throw new Error("Expected spreadsheet");
        expect(result.sheets[0]!.rows).toEqual([["North", "150"]]);
      } else {
        expect(result.type).toBe("document");
        if (result.type !== "document") throw new Error("Expected document");
        const body = new DOMParser().parseFromString(result.pages[0]!.html, "text/html").body;
        if (kind === "epub") {
          expect(body.querySelectorAll("br")).toHaveLength(2);
          expect(body.querySelectorAll("hr")).toHaveLength(1);
        } else {
          expect(body.textContent).toContain("10–20 —•‘a’“b”");
          expect(body.textContent).toContain("Name\tValue\t12\t34\t");
          expect(body.textContent).toContain("Unicode:–end");
          expect(body.textContent).not.toContain("hidden");
          expect(body.querySelectorAll("br")).toHaveLength(3);
        }
      }
    } finally {
      worker.terminate();
    }
    await using screen = await render(
      <div style={{ display: "flex", height: 400, width: 600 }}>
        <AttachmentFilePreview
          name={`report.${kind}`}
          mimeType="application/octet-stream"
          sizeBytes={file.size}
          file={file}
        />
      </div>,
    );
    await vi.waitFor(
      () => {
        if (kind === "ods") {
          expect(screen.container.textContent).toContain("North");
          expect(screen.container.textContent).toContain("150");
          expect(screen.container.textContent).not.toContain("private note");
          expect(screen.container.textContent).toContain("1 rows · 2 columns");
          expect(screen.container.textContent).not.toContain("Limited to 500");
        } else {
          const frame = screen.container.querySelector("iframe");
          expect(frame?.srcdoc).toContain(kind === "rtf" ? "10–20" : "first<br>second<br>third");
        }
        // The viewer runs its own conversion worker behind lazy chunks.
      },
      { timeout: 10_000 },
    );
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  },
);

it.each(["epub", "odt", "ipynb", "html", "encoded-html"] as const)(
  "bounds %s image pixels before returning browser markup",
  async (kind) => {
    const canvas = new OffscreenCanvas(2, 3);
    canvas.getContext("2d");
    const blob = await canvas.convertToBlob({ type: "image/png" });
    for (const width of [2, 12000]) {
      const image = await blob.arrayBuffer();
      new DataView(image).setUint32(16, width);
      new DataView(image).setUint32(20, width === 2 ? 3 : 12000);
      const archive = new JSZip();
      archive.file("cover.png", image);
      if (kind === "epub") {
        archive.file(
          "META-INF/container.xml",
          '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
        );
        archive.file(
          "book.opf",
          '<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
        );
        archive.file(
          "chapter.xhtml",
          '<html><body><p>retained caption</p><img src="cover.png"/></body></html>',
        );
      } else
        archive.file(
          "content.xml",
          '<office:document><office:text><text:p>retained caption</text:p><draw:image xlink:href="cover.png"/></office:text></office:document>',
        );
      const base64 = btoa(String.fromCharCode(...new Uint8Array(image)));
      const bytes =
        kind === "ipynb" || kind === "html" || kind === "encoded-html"
          ? new TextEncoder().encode(
              JSON.stringify({
                nbformat: 4,
                cells: [
                  {
                    cell_type: "code",
                    source: "plot()",
                    outputs: [
                      {
                        data: {
                          ...(kind === "html" || kind === "encoded-html"
                            ? {
                                "text/html": `<table><tr><td>retained caption</td></tr></table><img src="${kind === "encoded-html" ? "&#100ata" : "data"}:image/png;base64,${base64}">`,
                              }
                            : { "image/png": base64 }),
                          "text/plain": "retained caption",
                        },
                      },
                    ],
                  },
                ],
              }),
            ).buffer
          : await archive.generateAsync({ type: "arraybuffer" });
      const worker = new Worker(new URL("./officePreview.worker.ts", import.meta.url), {
        type: "module",
      });
      try {
        const result = await new Promise<OfficeWorkerResult>((resolve) => {
          worker.addEventListener(
            "message",
            (event: MessageEvent<OfficeWorkerResult>) => resolve(event.data),
            { once: true },
          );
          worker.postMessage(
            {
              type: "open",
              kind: kind === "html" || kind === "encoded-html" ? "ipynb" : kind,
              bytes,
            },
            [bytes],
          );
        });
        if (result.type === "notebook") {
          const output = result.cells[0]!.outputs[0]!;
          expect(output.kind).toBe(
            width === 2 ? (kind === "html" || kind === "encoded-html" ? "html" : "image") : "text",
          );
          if (output.kind === "html") {
            const rendered = new DOMParser().parseFromString(
              sanitizeDocumentHtml(output.text),
              "text/html",
            );
            expect(rendered.images).toHaveLength(1);
            expect(rendered.querySelector("td")!.textContent).toBe("retained caption");
          }
          if (width !== 2) expect(result.cells[0]!.outputs[0]!.text).toBe("retained caption");
        } else {
          expect(result.type).toBe("document");
          if (result.type !== "document") throw new Error("Expected document");
          expect(result.pages[0]!.html.includes("<img")).toBe(width === 2);
          expect(result.pages[0]!.html).toContain("retained caption");
        }
      } finally {
        worker.terminate();
      }
    }
  },
);

it.each([
  ["standardFontDataUrl", "FoxitSerif.pfb", "standard_fonts"],
  ["cMapUrl", "78-EUC-H.bcmap", "cmaps"],
  ["wasmUrl", "openjpeg.wasm", "wasm"],
])("validates PDF %s assets before decoding", async (kind, filename, directory) => {
  const { BinaryDataFactory } = await import("./pdfDocument");
  const factory = new BinaryDataFactory();
  const fetchAsset = vi.fn(
    async () =>
      new Response("<html>app</html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );
  using _fetch = stubGlobal("fetch", fetchAsset);
  await expect(factory.fetch({ kind, filename })).rejects.toThrow(
    `PDF ${directory} asset unavailable.`,
  );
  fetchAsset.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
  await expect(factory.fetch({ kind, filename })).resolves.toEqual(new Uint8Array([1, 2, 3]));
  await expect(factory.fetch({ kind, filename: "missing" })).rejects.toThrow(
    `Unsupported PDF ${directory} asset.`,
  );
});

describe("binary workspace file", () => {
  it("offers a download instead of reading a text-named binary as text", async () => {
    refresh.mockReset().mockResolvedValue("data:application/octet-stream,a%00b");
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0x61, 0x00, 0x62]))),
    );
    await using screen = await render(
      <AttachmentFilePreview
        name="export.csv"
        mimeType="application/octet-stream"
        sizeBytes={0}
        kind="unsupported"
        asset={{
          environmentId: EnvironmentId.make("test-environment"),
          resource: {
            _tag: "media-file",
            threadId: ThreadId.make("thread-1"),
            path: "/repo/export.csv",
            disposition: "attachment",
          },
        }}
        origin="File"
      />,
    );
    const { container } = screen;
    const saveButtons = () =>
      [...container.querySelectorAll("button")].filter(
        (button) =>
          button.textContent === "Save file" || button.getAttribute("aria-label") === "Save file",
      );
    await vi.waitFor(() => expect(saveButtons()).toHaveLength(1));
    expect(saveButtons()[0]?.textContent).toBe("Save file");
    expect(container.textContent).toContain("No preview for this file");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Show table"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
