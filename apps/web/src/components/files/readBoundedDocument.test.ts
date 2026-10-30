import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { readBoundedDocument } from "./readBoundedDocument";

afterEach(() => vi.unstubAllGlobals());

describe("bounded document downloads", () => {
  it("accepts exactly the byte limit and forwards cancellation and cache policy", async () => {
    const request = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", request);
    const controller = new AbortController();
    const bytes = await readBoundedDocument("/document", controller.signal, 3, "reload");
    expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3]);
    expect(request).toHaveBeenCalledWith("/document", {
      signal: controller.signal,
      cache: "reload",
    });
  });

  it("rejects an oversized declared response before reading its body", async () => {
    const response = new Response(new Uint8Array([1]), { headers: { "content-length": "4" } });
    const read = vi.spyOn(response.body!, "getReader");
    const cancel = vi.spyOn(response.body!, "cancel");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expect(readBoundedDocument("/document", new AbortController().signal, 3)).rejects.toThrow(
      "unavailable or too large",
    );
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels an understated stream as soon as it crosses the byte limit", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream)),
    );
    await expect(readBoundedDocument("/document", new AbortController().signal, 3)).rejects.toThrow(
      "too large",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("preserves an abort from the request", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(readBoundedDocument("/document", new AbortController().signal, 3)).rejects.toBe(
      abort,
    );
  });
});
