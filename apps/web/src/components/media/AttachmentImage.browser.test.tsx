import { act, render, type Screen } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { AttachmentImage } from "./AttachmentImage";

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
const decodeImagePreview = vi.hoisted(() =>
  fake<(src: string, heif: boolean, signal: AbortSignal) => Promise<Blob>>(),
);
vi.mock("../files/decodeImagePreview", () => ({ decodeImagePreview }));

const bitmap = new Blob(["png"], { type: "image/png" });

function setup() {
  decodeImagePreview.reset(async () => bitmap);
  const createUrl = vi.spyOn(URL, "createObjectURL");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
  return {
    createUrl,
    revokeUrl,
    created: () => createUrl.mock.results[0]?.value as string | undefined,
    [Symbol.dispose]: () => {
      for (const url of createUrl.mock.results) URL.revokeObjectURL(url.value as string);
      createUrl.mockRestore();
      revokeUrl.mockRestore();
    },
  };
}

function image(screen: Screen) {
  const img = screen.container.querySelector("img");
  expect(img).not.toBeNull();
  return img!;
}

async function failDecode(screen: Screen) {
  const img = image(screen);
  await act(() => {
    img.dispatchEvent(new Event("error"));
  });
  await act(() => vi.dynamicImportSettled());
  return img;
}

function expectDecodeErrorFor(onError: ReturnType<typeof vi.fn>, img: HTMLImageElement) {
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ type: "error", target: img }));
}

it.each([
  { name: "photo.HEIC", mimeType: undefined, heif: true },
  { name: "photo.heif", mimeType: undefined, heif: true },
  { name: "photo", mimeType: "image/heif", heif: true },
  { name: "scan.TIFF", mimeType: undefined, heif: false },
  { name: "scan", mimeType: "image/tiff", heif: false },
])(
  "converts $name after native decoding fails and releases its preview",
  async ({ name, mimeType, heif }) => {
    using urls = setup();
    await using screen = await render(
      <AttachmentImage src="https://environment.test/photo" name={name} mimeType={mimeType} />,
    );
    expect(decodeImagePreview).not.toHaveBeenCalled();
    await failDecode(screen);
    expect(urls.created()).toMatch(/^blob:/);
    expect(image(screen).getAttribute("src")).toBe(urls.created());
    expect(decodeImagePreview).toHaveBeenCalledWith(
      "https://environment.test/photo",
      heif,
      expect.any(AbortSignal),
    );
    await screen.unmount();
    expect(urls.revokeUrl).toHaveBeenCalledWith(urls.created());
  },
);

it("leaves PNG errors to the caller without fetching or converting", async () => {
  using _urls = setup();
  const onError = vi.fn();
  await using screen = await render(
    <AttachmentImage src="blob:png" name="photo.png" onError={onError} />,
  );
  expectDecodeErrorFor(onError, await failDecode(screen));
  expect(decodeImagePreview).not.toHaveBeenCalled();
});

it("reports failed HEIC conversion through the existing error handler", async () => {
  using urls = setup();
  const onError = vi.fn();
  decodeImagePreview.implement(async () => Promise.reject(new Error("unreadable")));
  await using screen = await render(
    <AttachmentImage src="blob:heic" name="photo.heif" onError={onError} />,
  );
  expectDecodeErrorFor(onError, await failDecode(screen));
  expect(urls.createUrl).not.toHaveBeenCalled();
});

it("discards an old decode when navigating to a different source", async () => {
  using urls = setup();
  let finishDecode!: (result: Blob) => void;
  decodeImagePreview.implement(
    () =>
      new Promise((resolve) => {
        finishDecode = resolve;
      }),
  );
  await using screen = await render(<AttachmentImage src="blob:first" name="photo.heic" />);
  await failDecode(screen);
  const secondSource = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
  await screen.rerender(<AttachmentImage src={secondSource} name="photo.heic" />);
  await act(() => finishDecode(bitmap));
  expect(image(screen).getAttribute("src")).toBe(secondSource);
  expect(urls.createUrl).not.toHaveBeenCalled();
  expect(decodeImagePreview.mock.calls[0]?.[2].aborted).toBe(true);
});
