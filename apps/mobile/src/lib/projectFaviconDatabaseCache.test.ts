import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PROJECT_FAVICON_MAX_DATA_URL_LENGTH } from "@supaterm/client-runtime/project-favicon-cache";

type LoadOptions = { maxWidth: number; maxHeight: number };
type Decoded = { width: number; height: number; release: () => void };

const native = vi.hoisted(() => ({
  load: vi.fn<(url: string, options: LoadOptions) => void>(),
  loads: [] as Array<() => Promise<Decoded>>,
  decoded: [] as Array<Decoded>,
  write: vi.fn(),
  read: vi.fn(),
  encodings: [] as Array<string>,
  encoding: "",
  remove: vi.fn(),
}));
vi.mock("expo-image", () => ({
  Image: {
    loadAsync: async (url: string, options: LoadOptions) => {
      native.load(url, options);
      const decoded = (await native.loads.shift()?.()) ?? {
        width: options.maxWidth,
        height: options.maxWidth,
        release: vi.fn(),
      };
      native.decoded.push(decoded);
      return decoded;
    },
    writeToCacheAsync: async (...args: ReadonlyArray<unknown>) => {
      native.write(...args);
    },
    getCachePathAsync: async () => "/cache/thumbnail",
  },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    size = 24_000;
    async base64() {
      native.read();
      return native.encodings.shift() ?? native.encoding;
    }
    delete() {
      native.remove();
    }
  },
}));

import { downscaleProjectFavicon } from "./projectFaviconDatabaseCache";

const png = "iVBORw0KGgoAAAAA";
const image = { url: "https://remote/icon.png" };

beforeEach(() => {
  vi.clearAllMocks();
  native.encoding = png;
  native.encodings.length = 0;
  native.loads.length = 0;
  native.decoded.length = 0;
});

describe("mobile project icon thumbnails", () => {
  it("reduces an oversized encoding and deletes temporary thumbnail files", async () => {
    native.encodings.push(`iVBORw0KGgo${"a".repeat(PROJECT_FAVICON_MAX_DATA_URL_LENGTH)}`);
    const thumbnail = await downscaleProjectFavicon(image, new AbortController().signal);
    expect(thumbnail).toBe(`data:image/png;base64,${png}`);
    expect(native.load.mock.calls.map(([, options]) => options.maxWidth)).toEqual([96, 48]);
    expect(native.remove).toHaveBeenCalledTimes(2);
    for (const decoded of native.decoded) expect(decoded.release).toHaveBeenCalledOnce();
  });

  it("releases a decoded image when its request was canceled", async () => {
    const controller = new AbortController();
    const release = vi.fn();
    native.loads.push(async () => {
      controller.abort();
      return { width: 96, height: 96, release };
    });
    await expect(downscaleProjectFavicon(image, controller.signal)).rejects.toThrow();
    expect(release).toHaveBeenCalledOnce();
    expect(native.write).not.toHaveBeenCalled();
  });

  it("rejects an image the native decoder did not downsize", async () => {
    const release = vi.fn();
    native.loads.push(async () => ({ width: 4000, height: 3000, release }));
    await expect(downscaleProjectFavicon(image, new AbortController().signal)).rejects.toThrow(
      "not resized",
    );
    expect(native.write).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
