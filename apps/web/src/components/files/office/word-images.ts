import type { ImageResolver } from "@betteroffice/docx/layout/render";
import type { YrsMediaSource } from "@betteroffice/docx/yrs";
import { officeImageBitmap } from "./image-bitmap";

const mediaToken = /^media:(0|[1-9]\d*)$/u;

const budget = 256 * 1024 * 1024;

type Decoded = {
  readonly image: Promise<CanvasImageSource | null>;

  bitmap: ImageBitmap | undefined;
};

export function createBitmapImageResolver(media: (token: string) => YrsMediaSource | null) {
  const cache = new Map<string, Decoded>();
  const placeholder = greyBox();

  const decode = (source: string): Promise<CanvasImageSource | null> => {
    const token = mediaToken.test(source);
    const found = token ? media(source) : undefined;

    if (token && !found) return Promise.resolve(placeholder);

    const blob = found
      ? Promise.resolve(new Blob([new Uint8Array(found.bytes)], { type: found.mimeType }))
      : fetch(source).then((response) => response.blob());

    return blob.then(officeImageBitmap).then(
      (bitmap): CanvasImageSource => bitmap,
      () => (token ? placeholder : null),
    );
  };

  const resolve: ImageResolver = (source) => {
    if (!mediaToken.test(source) && !source.startsWith("blob:") && !source.startsWith("data:"))
      return null;

    const cached = cache.get(source);

    if (cached) {
      cache.delete(source);
      cache.set(source, cached);

      return cached.image;
    }

    const entry: Decoded = {
      image: decode(source).then((image) => {
        if (image instanceof ImageBitmap) entry.bitmap = image;

        return image;
      }),
      bitmap: undefined,
    };

    cache.set(source, entry);

    return entry.image;
  };

  return {
    resolve,

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

function greyBox() {
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext("2d");

  if (!context) return null;

  context.fillStyle = "#e6e6e6";
  context.fillRect(0, 0, 1, 1);

  return canvas;
}
