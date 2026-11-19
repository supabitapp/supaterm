import { expect, it, vi } from "vite-plus/test";
import type * as Electron from "electron";
import { copyContextMenuImage, type ContextMenuImageNative } from "./ContextMenuImage.ts";

const sourcePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR4nGP4TyFgGDVg1IBRA4aLAQBdePwur/3haQAAAABJRU5ErkJggg==",
  "base64",
);

function setup() {
  const respond: () => Promise<Response> = () =>
    Promise.resolve(new Response(Uint8Array.from(sourcePng)));
  const decode: () => Promise<unknown> = () =>
    Promise.reject(new Error("Image could not be decoded"));
  const state = {
    frameDestroyed: false,
    imageEmpty: false,
    pngOverride: undefined as Buffer | undefined,
    respond,
    decode,
  };
  const fetched: Array<[string, RequestInit]> = [];
  const decodedBuffers: Array<Buffer> = [];
  const written: Array<Record<string, Blob>> = [];
  const image = {
    isEmpty: () => state.imageEmpty,
    toPNG: () => {
      const png = state.pngOverride ?? Buffer.from("png");
      state.pngOverride = undefined;
      return png;
    },
  };
  const toPNG = vi.spyOn(image, "toPNG");
  const native: ContextMenuImageNative = {
    fetch: (url, init) => {
      fetched.push([url, init]);
      return state.respond();
    },
    createFromBuffer: (bytes) => {
      decodedBuffers.push(bytes);
      return image;
    },
    writeClipboard: async (items) => {
      written.push(items);
    },
  };
  const frame = { isDestroyed: () => state.frameDestroyed };
  const contents = {
    isDestroyed: () => false,
    copyImageAt: vi.fn(),
    executeJavaScriptInIsolatedWorld: () => state.decode(),
    mainFrame: { isDestroyed: () => false },
  };
  const copyImage = (overrides: { readonly srcURL?: string } = {}) =>
    copyContextMenuImage(
      contents as unknown as Electron.WebContents,
      {
        x: 12,
        y: 34,
        srcURL: "https://example.com/image.png",
        frame,
        ...overrides,
      } as unknown as Electron.ContextMenuParams,
      native,
    );
  const writtenPng = () => written[0]?.["image/png"];
  return { state, fetched, decodedBuffers, written, writtenPng, toPNG, contents, copyImage };
}

it.each(["https://example.com/image.png", `data:image/png;base64,${sourcePng.toString("base64")}`])(
  "copies an iframe image from %s",
  async (srcURL) => {
    const fake = setup();
    await fake.copyImage({ srcURL });
    if (srcURL.startsWith("https:")) {
      expect(fake.fetched).toEqual([
        [srcURL, { credentials: "omit", redirect: "error", signal: expect.any(AbortSignal) }],
      ]);
    } else {
      expect(fake.fetched).toEqual([]);
    }
    expect(fake.contents.copyImageAt).not.toHaveBeenCalled();
    expect(fake.decodedBuffers).toEqual([sourcePng]);
    const blob = fake.writtenPng()!;
    expect(blob.type).toBe("image/png");
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(Buffer.from("png"));
  },
);

it.each([
  ["WebP", "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA="],
  ["GIF", "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkQBADs="],
])("copies %s using Chromium when nativeImage cannot decode it", async (_, base64) => {
  const fake = setup();
  fake.state.respond = async () => new Response(Uint8Array.from(Buffer.from(base64, "base64")));
  fake.state.imageEmpty = true;
  fake.state.decode = async () => Uint8Array.from(sourcePng).buffer;
  await fake.copyImage();
  const blob = fake.writtenPng()!;
  expect(Buffer.from(await blob.arrayBuffer())).toEqual(sourcePng);
  expect(fake.toPNG).not.toHaveBeenCalled();
});

it("preserves the clipboard if the source frame closes during Chromium decoding", async () => {
  const fake = setup();
  fake.state.imageEmpty = true;
  fake.state.decode = () => {
    fake.state.frameDestroyed = true;
    return Promise.resolve(Uint8Array.from(sourcePng).buffer);
  };
  await fake.copyImage();
  expect(fake.written).toEqual([]);
});

it("copies a GIF larger than the favicon pixel limit", async () => {
  const fake = setup();
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkQBADs=", "base64");
  gif.writeUInt16LE(2048, 6);
  gif.writeUInt16LE(1024, 8);
  fake.state.respond = async () => new Response(Uint8Array.from(gif));
  fake.state.imageEmpty = true;
  fake.state.decode = async () => Uint8Array.from(sourcePng).buffer;
  await fake.copyImage();
  const blob = fake.writtenPng()!;
  expect(Buffer.from(await blob.arrayBuffer())).toEqual(sourcePng);
});

it.each([
  "file:///private/image.png",
  "blob:https://example.com/image",
  "https://user:pass@example.com/image.png",
])("rejects unsupported or credential-bearing URLs: %s", async (srcURL) => {
  const fake = setup();
  await expect(fake.copyImage({ srcURL })).rejects.toThrow("Unsupported image URL");
  expect(fake.fetched).toEqual([]);
  expect(fake.written).toEqual([]);
});

it("cancels responses whose declared size exceeds the limit", async () => {
  const fake = setup();
  const cancel = vi.fn();
  fake.state.respond = async () =>
    new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": String(32 * 1024 * 1024 + 1) },
    });
  await expect(fake.copyImage()).rejects.toThrow("size limit");
  expect(cancel).toHaveBeenCalled();
  expect(fake.decodedBuffers).toEqual([]);
});

it("cancels oversized streams without a content-length", async () => {
  const fake = setup();
  const cancel = vi.fn();
  fake.state.respond = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(32 * 1024 * 1024));
          controller.enqueue(new Uint8Array(1));
        },
        cancel,
      }),
    );
  await expect(fake.copyImage()).rejects.toThrow("size limit");
  expect(cancel).toHaveBeenCalled();
  expect(fake.written).toEqual([]);
});

it("preserves the clipboard when the response is not an image", async () => {
  const fake = setup();
  fake.state.imageEmpty = true;
  await expect(fake.copyImage()).rejects.toThrow("could not be decoded");
  expect(fake.written).toEqual([]);
});

it("rejects large decoded dimensions before image allocation", async () => {
  const fake = setup();
  const oversizedPng = Buffer.from(sourcePng);
  oversizedPng.writeUInt32BE(4096, 16);
  oversizedPng.writeUInt32BE(4096, 20);
  fake.state.respond = async () => new Response(Uint8Array.from(oversizedPng));
  await expect(fake.copyImage()).rejects.toThrow("size limit");
  expect(fake.decodedBuffers).toEqual([]);
  expect(fake.toPNG).not.toHaveBeenCalled();
  expect(fake.written).toEqual([]);
});

it("preserves the clipboard when the encoded PNG exceeds the limit", async () => {
  const fake = setup();
  fake.state.pngOverride = Buffer.alloc(32 * 1024 * 1024 + 1);
  await expect(fake.copyImage()).rejects.toThrow("size limit");
  expect(fake.written).toEqual([]);
});

it("does not copy after the source frame closes during the request", async () => {
  const fake = setup();
  fake.state.respond = () => {
    fake.state.frameDestroyed = true;
    return Promise.resolve(new Response(Uint8Array.from(sourcePng)));
  };
  await fake.copyImage();
  expect(fake.written).toEqual([]);
});
