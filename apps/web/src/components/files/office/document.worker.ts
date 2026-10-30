import * as Schema from "effect/Schema";
import {
  buildResidentRegionLayoutRequest,
  getLayoutKernelInputs,
  workerLayoutComputation,
} from "@betteroffice/docx/editor";
import { createRustMeasureSource } from "@betteroffice/docx/layout";
import {
  applyFrameDelta,
  decodeFrameDelta,
  encodeDisplayListFrameExtras,
  GlyphCache,
  rasterizeDisplayPageToBackBuffer,
  type DisplayPage,
  type RetainedFrame,
} from "@betteroffice/docx/layout/render";
import {
  createYrsPositionProjection,
  createYrsSession,
  type YrsPositionProjection,
} from "@betteroffice/docx/yrs";
import { wordFonts } from "./fonts";
import { createBitmapImageResolver } from "./word-images";
import { layerFont, type WordMethods, type WordPageSize, type WordSpan } from "./word-protocol";
import { pageText, positionTarget, type TextMeasure } from "./word-text";
import { serveWorker, Transfer } from "./worker-rpc";

const FontRequirements = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      key: Schema.String,
      family: Schema.String,
      bold: Schema.Boolean,
      italic: Schema.Boolean,
      scripts: Schema.optional(
        Schema.Array(Schema.Literals(["cjk-sc", "cjk-tc", "cjk-jp", "cjk-kr", "arabic", "hebrew"])),
      ),
    }),
  ),
);

const decodeFontRequirements = Schema.decodeUnknownSync(FontRequirements);

const decodeLayoutReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ provisional: Schema.optional(Schema.Boolean) })),
);

const firstPages = 3;

const stepBudget = 24;

const keptAround = 10;

type Opened = Awaited<ReturnType<typeof open>>;

type Lazy<T> = { value: T | undefined };

const opened: Lazy<Opened> = { value: undefined };

serveWorker<WordMethods>({
  open: async (input) => {
    if (opened.value) throw new Error("The worker already holds a document");

    const loaded = await open(new Uint8Array(input.bytes));

    opened.value = loaded;

    return { pages: loaded.pages().map(pageSize), loading: loaded.loading() };
  },
  layout: () => required().step(),
  paint: async (input, signal) => {
    const bitmap = await required().paint(input.index, input.scale, input.ratio, signal);

    return bitmap ? new Transfer(bitmap, [bitmap]) : undefined;
  },
  build: (input) => {
    required().built(input.index);

    return undefined;
  },
  text: (input) => required().text(input.index),
  bookmark: (input) => required().target(input.name),
});

function required() {
  if (!opened.value) throw new Error("The worker holds no document");

  return opened.value;
}

async function open(bytes: Uint8Array) {
  const session = await createYrsSession();
  const document = session.openDocx(bytes, true, { mediaTokens: true }).document;
  const settings = document.package.settings;

  const measure = createRustMeasureSource({
    engine: {
      registerFont: (font) => session.registerFont(font),
      registerSubstituteFont: (id, family) => session.registerSubstituteFont(id, family),
      clearFonts: () => session.clearFonts(),
    },
    bundled: wordFonts(),
  });

  measure.setCompat(settings?.compatibilityFlags);

  const request = buildResidentRegionLayoutRequest(document, 0, {
    themeColors: Object.fromEntries(
      Object.entries(document.package.theme?.colorScheme ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    defaultTabStopTwips: settings?.defaultTabStop ?? null,
    numericIds: {},
    mediaTokens: true,
  });

  const requirements = decodeFontRequirements(
    session.layoutFontRequirementsJson(JSON.stringify(request)),
  ).map(({ scripts, ...requirement }) => ({
    ...requirement,
    ...(scripts ? { scripts: [...scripts] } : {}),
  }));

  await measure.prepareFontRequirements(requirements);

  const measurement = measure.measurementConfigForRequirements(requirements);

  if (!measurement) throw new Error("The document's fonts could not be prepared");

  const input = JSON.stringify({ ...request, measurement });

  const resolvedCommentIds = (document.package.document.comments ?? [])
    .filter(
      (comment) =>
        (comment.done || comment.status === "resolved") && comment.parentId === undefined,
    )
    .map((comment) => comment.id);

  const display = (previous: RetainedFrame | null, reply: string) => {
    const layout = workerLayoutComputation(reply).layout;

    session.setDisplayWindow(0, firstPages);

    const extras = encodeDisplayListFrameExtras({
      measured: [],
      options: {},
      layout,
      fontChains: measurement.fontChains,
      ...(getLayoutKernelInputs(layout)?.headersFooters
        ? { headersFooters: getLayoutKernelInputs(layout)!.headersFooters! }
        : {}),
      resolvedCommentIds,
    });

    return applyFrameDelta(
      previous,
      decodeFrameDelta(session.buildDisplayListFrame(extras, previous?.frameEpoch ?? 0)),
    );
  };

  const prefix = session.layoutDocumentWithRegionsPrefixRetainedJson(input, firstPages);
  const retained = { frame: display(null, prefix) };

  if (retained.frame.displayList.pages.length === 0)
    throw new Error("The document produced no pages");

  const layout = { loading: decodeLayoutReply(prefix).provisional ?? false, begun: false, cost: 3 };

  const built = (index: number) => {
    const page = retained.frame.displayList.pages[index];

    if (!page?.unbuilt) return page;

    retained.frame = applyFrameDelta(
      retained.frame,
      decodeFrameDelta(session.buildDisplayPagesFrame([index], retained.frame.frameEpoch)),
    );

    return retained.frame.displayList.pages[index];
  };

  const release = (painted: number) => {
    if (layout.loading) return;

    const far = retained.frame.displayList.pages.flatMap((page, index) =>
      !page.unbuilt && Math.abs(painted - index) > keptAround ? [index] : [],
    );

    if (far.length === 0) return;

    const frame = session.releaseDisplayPagesFrame(far, retained.frame.frameEpoch);

    if (frame) retained.frame = applyFrameDelta(retained.frame, decodeFrameDelta(frame));
  };

  const complete = (reply: string) => {
    const before = retained.frame.displayList.pages;

    retained.frame = display(retained.frame, reply);
    layout.loading = false;

    const pages = retained.frame.displayList.pages;

    return {
      done: true as const,
      pages: pages.map(pageSize),
      kept: pages.map((page, index) => {
        const was = before[index];

        return was === page || (!!was?.unbuilt && !!page.unbuilt);
      }),
    };
  };

  const glyphCache = new GlyphCache({
    provider: (font, glyph) => session.outlineGlyphJson(font, glyph),
  });
  const images = createBitmapImageResolver((token) => session.mediaSource(token));
  const surface = new OffscreenCanvas(1, 1);
  const textMeasure = layerMeasure();
  const texts = new WeakMap<DisplayPage, readonly WordSpan[]>();

  const projection: Lazy<YrsPositionProjection | null> = { value: undefined };

  return {
    pages: () => retained.frame.displayList.pages,
    loading: () => layout.loading,
    built,

    step: () => {
      if (!layout.loading) {
        const pages = retained.frame.displayList.pages;

        return { done: true as const, pages: pages.map(pageSize), kept: pages.map(() => true) };
      }

      if (!layout.begun) {
        layout.begun = true;

        const begun = session.beginRegionLayout(input);

        return begun.layoutJson === undefined
          ? { done: false as const }
          : complete(begun.layoutJson);
      }

      const blocks = Math.min(8192, Math.max(1, Math.round(stepBudget / layout.cost)));
      const started = performance.now();
      const progress = session.resumeRegionLayout(blocks);

      layout.cost = layout.cost * 0.7 + ((performance.now() - started) / blocks) * 0.3;

      return progress.layoutJson === undefined
        ? { done: false as const }
        : complete(progress.layoutJson);
    },
    paint: async (index: number, scale: number, ratio: number, signal: AbortSignal) => {
      if (signal.aborted) return undefined;

      release(index);

      const page = built(index);

      if (!page) return undefined;

      const context = surface.getContext("2d");
      const width = Math.ceil(page.width * ratio * scale);
      const height = Math.ceil(page.height * ratio * scale);

      if (surface.width !== width) surface.width = width;

      if (surface.height !== height) surface.height = height;

      if (context) context.imageSmoothingQuality = "medium";

      await rasterizeDisplayPageToBackBuffer(
        surface,
        page,
        { glyphCache, resolveImage: images.resolve },
        ratio,
        scale,
      );
      images.trim();

      if (signal.aborted) return undefined;

      return surface.transferToImageBitmap();
    },
    text: (index: number) => {
      const page = built(index);

      if (!page || !textMeasure) return [];

      const cached = texts.get(page);

      if (cached) return cached;

      const spans = pageText(page, textMeasure);

      texts.set(page, spans);

      return spans;
    },
    target: (name: string) => {
      projection.value ??= createYrsPositionProjection(session, "body");

      const position = projection.value?.bookmarkPosition(name) ?? undefined;

      if (position !== undefined)
        return positionTarget(retained.frame.displayList.pages, position, built);

      return name === "_top" ? { index: 0, y: 0 } : undefined;
    },
  };
}

function pageSize(page: DisplayPage): WordPageSize {
  return { width: page.width, height: page.height, background: page.background };
}

function layerMeasure(): TextMeasure | undefined {
  const context = new OffscreenCanvas(1, 1).getContext("2d");

  if (!context) return undefined;

  const size = 100;

  context.font = `${size}px ${layerFont}`;

  const metrics = context.measureText("Hg");

  return {
    width: (text) => context.measureText(text).width / size,
    ascent: metrics.fontBoundingBoxAscent / size,
    descent: metrics.fontBoundingBoxDescent / size,
  };
}
