import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ComposerImageAttachment } from "../../composerDraftStore";
import { serializeComposerImages } from "./composerImagePersistence";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const readFileAsDataUrl = fake<(file: Blob) => Promise<string>>();

function image(id: string) {
  const file = new File([id], `${id}.png`, { type: "image/png" });
  return {
    type: "image",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: `blob:${id}`,
    file,
  } satisfies ComposerImageAttachment;
}

describe("serializeComposerImages", () => {
  beforeEach(() => {
    readFileAsDataUrl.reset();
  });

  it("reads only new images and drops removed images without rereading retained bytes", async () => {
    const a = image("a");
    const b = image("b");
    readFileAsDataUrl.implement(async (file) =>
      file === a.file ? "data:image/png;base64,YQ==" : "data:image/png;base64,Yg==",
    );

    const first = await serializeComposerImages([a], [], readFileAsDataUrl);
    expect(first).toEqual([
      {
        id: "a",
        name: "a.png",
        mimeType: "image/png",
        sizeBytes: 1,
        dataUrl: "data:image/png;base64,YQ==",
      },
    ]);
    expect(readFileAsDataUrl).toHaveBeenCalledTimes(1);

    const second = await serializeComposerImages([a, b], first, readFileAsDataUrl);
    expect(second).toEqual([
      first[0],
      {
        id: "b",
        name: "b.png",
        mimeType: "image/png",
        sizeBytes: 1,
        dataUrl: "data:image/png;base64,Yg==",
      },
    ]);
    expect(readFileAsDataUrl).toHaveBeenCalledTimes(2);
    expect(readFileAsDataUrl).toHaveBeenNthCalledWith(2, b.file);

    expect(await serializeComposerImages([a], second, readFileAsDataUrl)).toEqual(first);
    expect(await serializeComposerImages([], second, readFileAsDataUrl)).toEqual([]);
    expect(readFileAsDataUrl).toHaveBeenCalledTimes(2);
  });

  it("preserves cached bytes without trying to read an unavailable file", async () => {
    const a = image("a");
    const persisted = {
      id: a.id,
      name: a.name,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      dataUrl: "data:image/png;base64,YQ==",
    };
    readFileAsDataUrl.implement(async () => Promise.reject(new Error("File is unavailable")));

    expect(await serializeComposerImages([a], [persisted], readFileAsDataUrl)).toEqual([persisted]);
    expect(readFileAsDataUrl).not.toHaveBeenCalled();
  });

  it("keeps composer order when a later image finishes reading first", async () => {
    const large = image("large");
    const small = image("small");
    let finishLargeRead = (_dataUrl: string) => {};
    const largeRead = new Promise<string>((resolve) => {
      finishLargeRead = resolve;
    });
    readFileAsDataUrl.implement(async (file) =>
      file === large.file ? largeRead : "data:image/png;base64,c21hbGw=",
    );

    const serialized = serializeComposerImages([large, small], [], readFileAsDataUrl);
    finishLargeRead("data:image/png;base64,bGFyZ2U=");
    expect((await serialized).map(({ id }) => id)).toEqual(["large", "small"]);
  });

  it("omits failed uncached reads while keeping successfully serialized images", async () => {
    const a = image("a");
    const b = image("b");
    readFileAsDataUrl
      .implementOnce(async () => Promise.reject(new Error("File is unavailable")))
      .implementOnce(async () => "data:image/png;base64,Yg==");

    expect(await serializeComposerImages([a, b], [], readFileAsDataUrl)).toEqual([
      {
        id: "b",
        name: "b.png",
        mimeType: "image/png",
        sizeBytes: 1,
        dataUrl: "data:image/png;base64,Yg==",
      },
    ]);
    expect(readFileAsDataUrl).toHaveBeenCalledTimes(2);
  });
});
