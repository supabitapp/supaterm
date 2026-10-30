import {
  initWasm,
  needsElementDecode,
  openPresentation,
  paintSlide,
  presentationImageBlob,
  type PresentationHandle,
  type SlideDisplayList,
  type SlidePrimitive,
} from "@betteroffice/pptx";
import { slideFonts } from "./slide-fonts";
import {
  maxImageSide,
  type SlideMethods,
  type SlidePainted,
  type SlideSummary,
  type VectorBitmap,
  type VectorRequest,
} from "./slide-protocol";
import { deckText } from "./slide-text";
import { officeImageBitmap } from "./image-bitmap";
import { serveWorker, Transfer } from "./worker-rpc";

const emuPerPixel = 9525;

const maxBitmapPixels = 3840 * 2160;

const maxBitmapSide = 16384;

const shadowPixelsPerPixel = 16;

const pictureBudget = 128 * 1024 * 1024;

type Size = { readonly width: number; readonly height: number };

type Picture =
  | { readonly kind: "bitmap"; readonly bitmap: ImageBitmap; readonly size: Size }
  | {
      readonly kind: "vector";
      readonly blob: Blob;
      bitmap: ImageBitmap | undefined;
      failed: boolean;
    }
  | { readonly kind: "missing" };

type Deck = ReturnType<typeof createDeck>;

type WorkerState = { deck: Deck | undefined };

const state: WorkerState = { deck: undefined };

serveWorker<SlideMethods>({
  open: async (input) => {
    if (state.deck) throw new Error("The worker already holds a deck");

    await initWasm();

    const bytes = new Uint8Array(input.bytes);
    const handle = openPresentation(bytes);
    const snapshot = handle.snapshot();
    const text = deckText(bytes, snapshot);
    const fonts = slideFonts(handle, workerFonts());

    await fonts.load(text);

    state.deck = createDeck(handle, fonts.layout);

    const size = {
      width: snapshot.widthEmu / emuPerPixel,
      height: snapshot.heightEmu / emuPerPixel,
    };

    return snapshot.slides.map((slide, index): SlideSummary => ({
      ...size,
      hidden: text.hidden[index] ?? false,
      notes: slide.notes?.trim() || undefined,
    }));
  },
  paint: async (input, signal) => {
    const deck = required();
    const painted = await deck.paint(input.index, input.density, signal).finally(deck.trim);

    return painted.kind === "painted" ? new Transfer(painted, [painted.bitmap]) : painted;
  },
  vectors: (input) => required().vectors(input),
});

function required() {
  if (!state.deck) throw new Error("The worker holds no deck");

  return state.deck;
}

function workerFonts() {
  if (!("fonts" in self)) throw new Error("This browser has no fonts in workers");

  return self.fonts as FontFaceSet;
}

function createDeck(
  handle: PresentationHandle,
  layout: (index: number) => Promise<SlideDisplayList>,
) {
  const frames = new Map<number, Promise<SlideDisplayList | undefined>>();
  const pictures = new Map<string, Promise<Picture>>();

  const drawn = new Map<string, ImageBitmap>();
  const surface = new OffscreenCanvas(1, 1);

  const frame = (index: number) => {
    const cached = frames.get(index);

    if (cached) return cached;

    const laid = layout(index).catch(() => undefined);

    frames.set(index, laid);

    return laid;
  };

  const decode = async (asset: string): Promise<Picture> => {
    const blob = presentationImageBlob(handle.mediaBytes(asset));

    if (needsElementDecode(blob)) return { kind: "vector", blob, bitmap: undefined, failed: false };

    const source = await officeImageBitmap(blob).catch(() => undefined);

    if (!source) return { kind: "missing" };
    const size = { width: source.width, height: source.height };
    return { kind: "bitmap", bitmap: await bounded(source), size };
  };

  const picture = (asset: string) => {
    const cached = pictures.get(asset);

    if (cached) return cached;

    const decoded = decode(asset).catch((): Picture => ({ kind: "missing" }));

    pictures.set(asset, decoded);

    return decoded;
  };

  const tileScale = async (primitive: SlidePrimitive): Promise<SlidePrimitive> => {
    if (primitive.kind === "table" || primitive.kind === "chart") {
      const primitives: SlidePrimitive[] = [];
      for (const child of primitive.primitives) primitives.push(await tileScale(child));
      return { ...primitive, primitives };
    }
    if (primitive.kind !== "image" || !primitive.tile || !primitive.assetId) return primitive;
    const found = await picture(primitive.assetId);
    if (found.kind !== "bitmap") return primitive;
    return {
      ...primitive,
      tile: {
        ...primitive.tile,
        scaleX: primitive.tile.scaleX * (found.size.width / found.bitmap.width),
        scaleY: primitive.tile.scaleY * (found.size.height / found.bitmap.height),
      },
    };
  };

  return {
    paint: async (index: number, density: number, signal: AbortSignal): Promise<SlidePainted> => {
      const laid = await frame(index);

      if (!laid) return { kind: "failed" };

      if (signal.aborted) return { kind: "cancelled" };

      const scale = Math.min(
        density,
        Math.sqrt(maxBitmapPixels / (laid.width * laid.height)),
        maxBitmapSide / Math.max(laid.width, laid.height),
      );

      const canvas = surface;
      const width = Math.max(1, Math.round(laid.width * scale));
      const height = Math.max(1, Math.round(laid.height * scale));

      if (canvas.width !== width) canvas.width = width;

      if (canvas.height !== height) canvas.height = height;

      const context = canvas.getContext("2d");

      if (!context) return { kind: "failed" };

      context.reset();

      const needs = vectorSizes(laid.primitives, scale);
      const wanted = new Map<string, VectorRequest>();

      const resolveImage = async (asset: string) => {
        if (signal.aborted) return null;

        const found = await picture(asset);

        if (found.kind === "bitmap") {
          drawn.delete(asset);
          drawn.set(asset, found.bitmap);

          return found.bitmap;
        }

        if (found.kind === "missing" || found.failed) return null;

        const need = needs.get(asset);

        if (!covers(found.bitmap, need)) wanted.set(asset, { asset, blob: found.blob, size: need });

        if (found.bitmap) {
          drawn.delete(asset);
          drawn.set(asset, found.bitmap);
        }

        return found.bitmap ?? null;
      };

      const options = {
        resolveImage,
        maxShadowPixels: canvas.width * canvas.height * shadowPixelsPerPixel,
      };

      const attempt = (list: SlideDisplayList) =>
        paintSlide(context as unknown as CanvasRenderingContext2D, list, scale, 1, options).then(
          () => true,
          () => false,
        );

      const primitives: SlidePrimitive[] = [];
      for (const primitive of laid.primitives) primitives.push(await tileScale(primitive));
      const scaled = { ...laid, primitives };
      const shadowed = await attempt(scaled);

      if (!shadowed) await new Promise((resolve) => setTimeout(resolve));

      if (signal.aborted) return { kind: "cancelled" };

      const done = shadowed || (await attempt(withoutShadows(scaled)));

      if (!done) return { kind: "failed" };

      if (signal.aborted) return { kind: "cancelled" };

      return {
        kind: "painted",
        bitmap: canvas.transferToImageBitmap(),
        vectors: [...wanted.values()],
      };
    },

    trim: () => {
      [...drawn].reduce(
        (total, [asset, bitmap]) => {
          if (total <= pictureBudget) return total;

          const freed = pixelBytes(bitmap);

          bitmap.close();
          drawn.delete(asset);
          pictures.delete(asset);

          return total - freed;
        },
        [...drawn.values()].reduce((total, bitmap) => total + pixelBytes(bitmap), 0),
      );
    },

    vectors: (bitmaps: readonly VectorBitmap[]) =>
      Promise.all(
        bitmaps.map(async (entry) => {
          const found = await picture(entry.asset);

          if (found.kind !== "vector") return entry.bitmap?.close();

          if (found.bitmap && (!entry.bitmap || covers(found.bitmap, entry.bitmap)))
            return entry.bitmap?.close();

          found.bitmap?.close();
          drawn.delete(entry.asset);
          found.bitmap = entry.bitmap;
          found.failed = !entry.bitmap;
          if (entry.bitmap) drawn.set(entry.asset, entry.bitmap);
        }),
      ).then(() => undefined),
  };
}

function vectorSizes(primitives: readonly SlidePrimitive[], scale: number) {
  const sizes = new Map<string, Size | undefined>();

  const visit = (primitive: SlidePrimitive): void => {
    if (primitive.kind === "table" || primitive.kind === "chart")
      return primitive.primitives.forEach(visit);

    if (primitive.kind !== "image" || !primitive.assetId) return;

    const asset = primitive.assetId;
    const previous = sizes.get(asset);

    if (primitive.tile || (sizes.has(asset) && !previous)) return void sizes.set(asset, undefined);

    const visibleX = 1 - fraction(primitive.crop?.left) - fraction(primitive.crop?.right);
    const visibleY = 1 - fraction(primitive.crop?.top) - fraction(primitive.crop?.bottom);

    if (visibleX <= 0 || visibleY <= 0) return;

    const width = Math.max(previous?.width ?? 0, (primitive.w * scale) / visibleX);
    const height = Math.max(previous?.height ?? 0, (primitive.h * scale) / visibleY);
    const shrink = Math.min(1, maxImageSide / Math.max(width, height));

    sizes.set(asset, {
      width: Math.max(1, Math.ceil(width * shrink)),
      height: Math.max(1, Math.ceil(height * shrink)),
    });
  };

  primitives.forEach(visit);

  return sizes;
}

function pixelBytes(bitmap: ImageBitmap) {
  return bitmap.width * bitmap.height * 4;
}

function covers(bitmap: ImageBitmap | undefined, need: Size | undefined) {
  if (!bitmap) return false;

  if (!need) return true;

  return bitmap.width >= need.width && bitmap.height >= need.height;
}

function fraction(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.min(Math.max(value, 0), 1);
}

function withoutShadows(frame: SlideDisplayList): SlideDisplayList {
  const strip = (primitive: SlidePrimitive): SlidePrimitive => {
    if (primitive.kind === "shape" || primitive.kind === "image") {
      const { shadow: _shadow, ...rest } = primitive;
      return rest;
    }

    if (primitive.kind === "textBox") {
      const { textShadow: _shadow, ...rest } = primitive;
      return rest;
    }

    if (primitive.kind === "table" || primitive.kind === "chart")
      return { ...primitive, primitives: primitive.primitives.map(strip) };

    return primitive;
  };

  return { ...frame, primitives: frame.primitives.map(strip) };
}

async function bounded(source: ImageBitmap) {
  const shrink = maxImageSide / Math.max(source.width, source.height);

  if (shrink >= 1) return source;

  return createImageBitmap(source, {
    resizeWidth: Math.max(1, Math.round(source.width * shrink)),
    resizeHeight: Math.max(1, Math.round(source.height * shrink)),
    resizeQuality: "high",
  }).then(
    (resized) => {
      source.close();

      return resized;
    },
    () => source,
  );
}
