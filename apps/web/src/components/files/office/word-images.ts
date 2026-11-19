import type { ImageResolver } from "@betteroffice/docx/layout/render";
import type { YrsMediaSource } from "@betteroffice/docx/yrs";
import { officeImageBitmap } from "./image-bitmap";
import type { VectorBitmap, VectorRequest } from "./vector-pictures";

const mediaToken = /^media:(0|[1-9]\d*)$/u;

const budget = 256 * 1024 * 1024;

type Size = { readonly width: number; readonly height: number };

type Decoded = {
  image: Promise<CanvasImageSource | null>;
  bitmap: ImageBitmap | undefined;
  vector: { readonly blob: Blob; failed: boolean } | undefined;
};

/**
 * Resolves the display list's images in a worker: `media:{n}` sources decode from the session's bytes, `data:` and
 * `blob:` ones in place, and nothing else, so painting never makes a request. Undecodable parts paint a grey box. SVG
 * pictures, which the engine converts WMF and EMF ones to, need the window: `vectors` lists them, `provide` takes them.
 */
export function createBitmapImageResolver(media: (token: string) => YrsMediaSource | null) {
  const cache = new Map<string, Decoded>();
  const placeholder = greyBox();
  const drawn = new Set<string>();

  const decode = (source: string, entry: Decoded): Promise<CanvasImageSource | null> => {
    const token = mediaToken.test(source);
    const found = token ? media(source) : undefined;

    if (token && !found) return Promise.resolve(placeholder);

    const blob = found
      ? Promise.resolve(new Blob([new Uint8Array(found.bytes)], { type: found.mimeType }))
      : fetch(source).then((response) => response.blob());

    return blob.then((decoded) => {
      if (decoded.type === "image/svg+xml") {
        entry.vector = { blob: decoded, failed: false };

        return null;
      }

      return officeImageBitmap(decoded).then(
        (bitmap): CanvasImageSource => bitmap,
        () => (token ? placeholder : null),
      );
    });
  };

  const resolve: ImageResolver = (source) => {
    if (!mediaToken.test(source) && !source.startsWith("blob:") && !source.startsWith("data:"))
      return null;

    const cached = cache.get(source);

    if (cached) {
      cache.delete(source);
      cache.set(source, cached);

      if (cached.vector) drawn.add(source);

      return cached.vector
        ? Promise.resolve(cached.bitmap ?? (cached.vector.failed ? placeholder : null))
        : cached.image;
    }

    const entry: Decoded = { image: Promise.resolve(null), bitmap: undefined, vector: undefined };

    entry.image = decode(source, entry).then((decoded) => {
      if (decoded instanceof ImageBitmap) entry.bitmap = decoded;

      if (entry.vector) drawn.add(source);

      return decoded;
    });
    cache.set(source, entry);

    return entry.image;
  };

  return {
    resolve,
    vectors(sizes: ReadonlyMap<string, Size>): VectorRequest[] {
      const requests = [...drawn].flatMap((source) => {
        const entry = cache.get(source);
        const size = sizes.get(source);

        if (!entry?.vector || entry.vector.failed) return [];

        if (entry.bitmap && (!size || covers(entry.bitmap, size))) return [];

        return [{ asset: source, blob: entry.vector.blob, size }];
      });

      drawn.clear();

      return requests;
    },
    provide(bitmaps: readonly VectorBitmap[]) {
      for (const { asset, bitmap } of bitmaps) {
        const entry = cache.get(asset);

        if (!entry?.vector || (bitmap && entry.bitmap && covers(entry.bitmap, bitmap))) {
          bitmap?.close();
          continue;
        }

        if (!bitmap) {
          entry.vector.failed = !entry.bitmap;
          continue;
        }

        entry.bitmap?.close();
        entry.bitmap = bitmap;
      }
    },
    trim() {
      const size = (entry: Decoded) =>
        entry.bitmap ? entry.bitmap.width * entry.bitmap.height * 4 : 0;

      [...cache].reduce(
        (total, [source, entry]) => {
          if (total <= budget || !entry.bitmap) return total;

          const freed = size(entry);

          entry.bitmap.close();
          cache.delete(source);

          return total - freed;
        },
        [...cache.values()].reduce((total, entry) => total + size(entry), 0),
      );
    },
  };
}

function covers(bitmap: Size, size: Size) {
  return bitmap.width >= size.width && bitmap.height >= size.height;
}

function greyBox() {
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext("2d");

  if (!context) return null;

  context.fillStyle = "#e6e6e6";
  context.fillRect(0, 0, 1, 1);

  return canvas;
}
