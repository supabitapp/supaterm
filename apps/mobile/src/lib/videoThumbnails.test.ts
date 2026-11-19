import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  createPlayer: vi.fn(),
  players: [] as Array<unknown>,
  makePlayer: (() => undefined) as () => unknown,
}));
vi.mock("expo-video", () => ({
  createVideoPlayer: (...args: ReadonlyArray<unknown>) => {
    mocks.createPlayer(...args);
    return mocks.players.shift() ?? mocks.makePlayer();
  },
}));

let thumbnails: typeof import("./videoThumbnails");
const frame = { width: 480, height: 270 };
type AttachListener = (event: { source: unknown }) => void;
const player = (
  overrides: {
    readonly addListener?: (event: string, listener: AttachListener) => { remove(): void };
    readonly replaceAsync?: () => Promise<void>;
    readonly generateThumbnailsAsync?: () => Promise<Array<typeof frame>>;
  } = {},
) => {
  const listeners = new Set<AttachListener>();
  const attach = () => listeners.forEach((listener) => listener({ source: {} }));
  const fake = {
    attach,
    addListener:
      overrides.addListener ??
      ((_event: string, listener: AttachListener) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      }),
    replaceAsync: overrides.replaceAsync ?? (async () => queueMicrotask(attach)),
    generateThumbnailsAsync: overrides.generateThumbnailsAsync ?? (async () => [frame]),
    release: () => {},
  };
  return Object.assign(fake, {
    addListener: vi.spyOn(fake, "addListener"),
    replaceAsync: vi.spyOn(fake, "replaceAsync"),
    generateThumbnailsAsync: vi.spyOn(fake, "generateThumbnailsAsync"),
    release: vi.spyOn(fake, "release"),
  });
};
const source = () => ({ uri: "file:///clip.mp4", dispose: vi.fn() });

beforeEach(async () => {
  vi.resetModules();
  mocks.createPlayer.mockReset();
  mocks.players.length = 0;
  mocks.makePlayer = player;
  thumbnails = await import("./videoThumbnails");
});

afterEach(() => vi.useRealTimers());

describe("video thumbnails", () => {
  it("serializes decoding and skips queued requests that scroll out of view", async () => {
    const started = Promise.withResolvers<void>();
    const generated = Promise.withResolvers<(typeof frame)[]>();
    const first = player({
      generateThumbnailsAsync: () => {
        started.resolve();
        return generated.promise;
      },
    });
    mocks.players.push(first);
    const firstRequest = thumbnails.loadVideoThumbnail(
      "first",
      async () => source(),
      new AbortController().signal,
    );
    await started.promise;
    const removed = new AbortController();
    const skipped = vi.fn(async () => source());
    const queued = thumbnails.loadVideoThumbnail("removed", skipped, removed.signal);
    const next = vi.fn(async () => source());
    const nextRequest = thumbnails.loadVideoThumbnail("next", next, new AbortController().signal);
    expect(next).not.toHaveBeenCalled();
    removed.abort();
    generated.resolve([frame]);
    expect(await firstRequest).toBe(frame);
    expect(await queued).toBeNull();
    expect(await nextRequest).toBe(frame);
    expect(skipped).not.toHaveBeenCalled();
    expect(first.release).toHaveBeenCalledTimes(1);
  });

  it("finishes a started extraction after its reader leaves so a re-signed URL reuses it", async () => {
    const started = Promise.withResolvers<void>();
    const replaced = Promise.withResolvers<void>();
    const first = player({
      replaceAsync: () => {
        started.resolve();
        return replaced.promise;
      },
    });
    mocks.players.push(first);
    const file = source();
    const controller = new AbortController();
    const request = thumbnails.loadVideoThumbnail("video", async () => file, controller.signal);
    await started.promise;
    controller.abort();
    const resigned = thumbnails.loadVideoThumbnail(
      "video",
      async () => source(),
      new AbortController().signal,
    );
    replaced.resolve();
    first.attach();
    expect(await request).toBe(frame);
    expect(await resigned).toBe(frame);
    expect(mocks.createPlayer).toHaveBeenCalledTimes(1);
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(file.dispose).toHaveBeenCalledTimes(1);
  });

  it("asks for a frame only once the player has attached the item", async () => {
    let attached = false;
    const first = player({
      replaceAsync: async () => {},
      generateThumbnailsAsync: async () => (attached ? [frame] : []),
    });
    mocks.players.push(first);
    const request = thumbnails.loadVideoThumbnail(
      "attach",
      async () => source(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(first.replaceAsync).toHaveBeenCalled());
    await first.replaceAsync.mock.results[0]!.value;
    attached = true;
    first.attach();
    expect(await request).toBe(frame);
  });

  it("gives up on an item that never attaches without holding up the next request", async () => {
    vi.useFakeTimers();
    const subscriptions: Array<{ remove: ReturnType<typeof vi.fn> }> = [];
    const first = player({
      addListener: () => {
        const subscription = { remove: vi.fn() };
        subscriptions.push(subscription);
        return subscription;
      },
      replaceAsync: async () => {},
    });
    mocks.players.push(first);
    const file = source();
    const stuck = thumbnails.loadVideoThumbnail(
      "never-attached",
      async () => file,
      new AbortController().signal,
    );
    const next = thumbnails.loadVideoThumbnail(
      "next",
      async () => source(),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await stuck).toBeNull();
    expect(first.generateThumbnailsAsync).not.toHaveBeenCalled();
    expect(subscriptions[0]!.remove).toHaveBeenCalledTimes(1);
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(file.dispose).toHaveBeenCalledTimes(1);
    expect(await next).toBe(frame);
  });
});
