import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  retain: vi.fn(),
  releases: [] as Array<() => void>,
  nextReleases: [] as Array<() => void>,
  share: vi.fn(),
  sharing: Promise.resolve(),
  fileExists: true,
}));

vi.mock("./composerAttachmentPreviewRetention", () => ({
  retainComposerAttachmentFileForPreview: (attachment: unknown) => {
    mocks.retain(attachment);
    const release = mocks.nextReleases.shift() ?? vi.fn();
    mocks.releases.push(release);
    return release;
  },
}));
vi.mock("./attachmentDownload", () => ({
  shareLocalAttachment: (...args: ReadonlyArray<unknown>) => {
    mocks.share(...args);
    return mocks.sharing;
  },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {}
    get exists() {
      return mocks.fileExists;
    }
  },
  Paths: {
    document: {
      uri: "file:///var/mobile/Containers/Data/Application/22222222-2222-4222-8222-222222222222/Documents/",
    },
  },
}));

import { AtomRegistry, type AsyncResult } from "effect/reactivity";

import {
  loadLocalAttachmentPreview,
  localAttachmentPreviewAtom,
  type LocalAttachmentPreviewState,
  localAttachmentPreviewState,
} from "./localAttachmentPreview";

const attachment = {
  type: "file" as const,
  id: "draft-video",
  name: "clip.mov",
  mimeType: "video/quicktime",
  sizeBytes: 12,
  fileUri:
    "file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Documents/supaterm-composer-attachments/33333333-3333-4333-8333-333333333333-clip.mov",
};

beforeEach(() => {
  mocks.retain.mockReset();
  mocks.releases.length = 0;
  mocks.nextReleases.length = 0;
  mocks.share.mockReset();
  mocks.sharing = Promise.resolve();
  mocks.fileExists = true;
});

describe("loadLocalAttachmentPreview", () => {
  it("keeps an image MIME type when its filename has a video extension", async () => {
    const image = {
      ...attachment,
      type: "image" as const,
      name: "photo.mov",
      mimeType: "image/png",
      previewUri: attachment.fileUri,
    };
    const preview = await loadLocalAttachmentPreview(image, new AbortController().signal);
    await preview!.share(new AbortController().signal);
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: { name: "photo.mov", mimeType: "image/png" },
      }),
    );
    preview!.dispose();
  });

  it("resolves the current iOS container and releases its playback lease once", async () => {
    const preview = await loadLocalAttachmentPreview(attachment, new AbortController().signal);
    expect(preview?.uri).toContain("/22222222-2222-4222-8222-222222222222/Documents/");
    expect(mocks.retain).toHaveBeenCalledWith(attachment);
    const release = mocks.releases[0];
    expect(release).not.toHaveBeenCalled();
    preview?.dispose();
    preview?.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "share-button"])(
    "keeps a separate share lease after playback closes (source: %s)",
    async (sourceIdentifier) => {
      const shared = Promise.withResolvers<void>();
      mocks.sharing = shared.promise;
      const preview = await loadLocalAttachmentPreview(attachment, new AbortController().signal);
      const share = preview!.share(new AbortController().signal, sourceIdentifier);
      expect(mocks.retain).toHaveBeenCalledTimes(2);
      const [releasePlayback, releaseShare] = mocks.releases;
      preview!.dispose();
      expect(releasePlayback).toHaveBeenCalledTimes(1);
      expect(releaseShare).not.toHaveBeenCalled();
      shared.resolve();
      await share;
      expect(releaseShare).toHaveBeenCalledTimes(1);
    },
  );
});

describe("localAttachmentPreviewAtom", () => {
  const settled: (
    registry: AtomRegistry.AtomRegistry,
    target: typeof attachment,
  ) => { state: Promise<LocalAttachmentPreviewState>; unsubscribe: () => void } = (
    registry: AtomRegistry.AtomRegistry,
    target: typeof attachment,
  ) => {
    const atom = localAttachmentPreviewAtom(target);
    const { promise, resolve } = Promise.withResolvers<LocalAttachmentPreviewState>();
    const onChange = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
      if (result._tag !== "Initial") resolve(localAttachmentPreviewState(registry.get(atom)));
    };
    const unsubscribe = registry.subscribe(atom, onChange, { immediate: true });
    return { state: promise, unsubscribe };
  };

  it("shares one lease per file and releases it when the last reader leaves", async () => {
    const released = Promise.withResolvers<void>();
    const release = vi.fn(() => released.resolve());
    mocks.nextReleases.push(release);
    const registry = AtomRegistry.make();
    const first = settled(registry, attachment);
    const renamed = settled(registry, { ...attachment, name: "renamed.mov" });
    expect((await first.state).uri).toContain("/Documents/");
    expect((await renamed.state).uri).toBe((await first.state).uri);
    expect(mocks.retain).toHaveBeenCalledTimes(1);
    first.unsubscribe();
    expect(release).not.toHaveBeenCalled();
    renamed.unsubscribe();
    await released.promise;
    expect(release).toHaveBeenCalledTimes(1);
    registry.dispose();
  });

  it("reports a missing file as an error", async () => {
    mocks.fileExists = false;
    const registry = AtomRegistry.make();
    const reader = settled(registry, { ...attachment, id: "missing" });
    const state = await reader.state;
    expect(state.uri).toBeNull();
    expect(state.error?.message).toBe(
      "This attachment is no longer available. Attach the file again.",
    );
    reader.unsubscribe();
    registry.dispose();
  });
});
