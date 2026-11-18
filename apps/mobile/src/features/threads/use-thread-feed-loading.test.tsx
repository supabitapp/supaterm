import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useThreadFeedLoading } from "./use-thread-feed-loading";

type Input = Parameters<typeof useThreadFeedLoading>[0];
const initialInput: Input = {
  listMountKey: "environment:thread:empty",
  contentKind: "loading",
  hasContent: false,
  hasLocalMessages: false,
};
const filledInput = {
  ...initialInput,
  contentKind: "ready",
  hasContent: true,
  listMountKey: "environment:thread:filled",
} as const;

let renderer: ReactTestRenderer | undefined;
let result: ReturnType<typeof useThreadFeedLoading>;

function Probe(props: { input: Input }) {
  const state = useThreadFeedLoading(props.input);
  useLayoutEffect(() => {
    result = state;
  });
  return null;
}

async function land(state = result) {
  await act(async () => state.onListLoaded());
  await act(async () => state.onListLanded());
}

async function render(input: Input) {
  await act(async () => {
    if (renderer) renderer.update(<Probe input={input} />);
    else renderer = create(<Probe input={input} />);
  });
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe("thread feed loading handoff", () => {
  it("waits for the filled list to land even if the empty list already loaded", async () => {
    await render(initialInput);
    await land();
    expect(result.loading).toBe(true);
    await render(filledInput);
    expect(result.loading).toBe(true);
    await land();
    expect(result.loading).toBe(false);
    await render({ ...filledInput, listMountKey: "another-list-mount" });
    expect(result.loading).toBe(false);
  });

  it("holds a cached conversation until its list lands", async () => {
    await render(filledInput);
    expect(result.loading).toBe(true);
    await land();
    expect(result.loading).toBe(false);
  });

  it("keeps a loaded list hidden until it reaches the end", async () => {
    await render(filledInput);
    await act(async () => result.onListLoaded());
    expect(result.listLoaded).toBe(true);
    expect(result.loading).toBe(true);
    await act(async () => result.onListLanded());
    expect(result.loading).toBe(false);
  });

  it("reveals a loaded list that stalls short of the end after a second", async () => {
    vi.useFakeTimers();
    try {
      await render(filledInput);
      await act(async () => result.onListLoaded());
      await act(async () => {
        vi.advanceTimersByTime(999);
      });
      expect(result.loading).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(result.loading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a new list when the same thread loads again", async () => {
    await render(filledInput);
    await land();
    await render(initialInput);
    await render(filledInput);
    expect(result.loading).toBe(true);
    await land();
    expect(result.loading).toBe(false);
  });

  it("reveals an empty conversation without waiting for a list callback", async () => {
    await render(initialInput);
    await render({ ...initialInput, contentKind: "ready" });
    expect(result.loading).toBe(false);
    await render(filledInput);
    expect(result.loading).toBe(false);
  });

  it("shows a conversation opened with the user's own messages at once", async () => {
    await render({ ...filledInput, hasLocalMessages: true });
    expect(result.loading).toBe(false);
  });

  it("keeps queued messages visible while history loads", async () => {
    await render({ ...initialInput, hasLocalMessages: true });
    expect(result.loading).toBe(false);
  });

  it("clears the loader when history becomes unavailable", async () => {
    await render(initialInput);
    await render({ ...initialInput, contentKind: "unavailable" });
    expect(result.loading).toBe(false);
  });

  it("ignores a replaced list's late load callback", async () => {
    await render(initialInput);
    const replaced = result;
    await render(filledInput);
    await land(replaced);
    expect(result.loading).toBe(true);
    await land();
    expect(result.loading).toBe(false);
  });
});
