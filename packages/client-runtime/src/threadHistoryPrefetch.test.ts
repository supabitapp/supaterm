import { describe, expect, it, vi } from "vite-plus/test";
import {
  createThreadHistoryPrefetcher,
  type ThreadHistoryControls,
} from "./threadHistoryPrefetch.ts";

function history(overrides: Partial<ThreadHistoryControls> = {}): ThreadHistoryControls {
  return {
    historyCursor: "page-1",
    hasMoreHistory: true,
    loading: false,
    error: null,
    onLoadEarlier: vi.fn(),
    ...overrides,
  };
}

describe("thread history prefetch", () => {
  it.each([400, 800])("loads two viewports before the edge at height %i", (scrollLength) => {
    const prefetch = createThreadHistoryPrefetcher();
    const controls = history();
    prefetch("thread", controls, { scroll: scrollLength * 2 + 1, scrollLength });
    expect(controls.onLoadEarlier).not.toHaveBeenCalled();

    prefetch("thread", controls, { scroll: scrollLength * 2, scrollLength });
    prefetch("thread", controls, { scroll: 0, scrollLength });
    expect(controls.onLoadEarlier).toHaveBeenCalledExactlyOnceWith();
  });

  it("fills the prefetch buffer across pages that add little visible height", () => {
    const prefetch = createThreadHistoryPrefetcher();
    const controls = history();
    const viewport = { scroll: 0, scrollLength: 800 };
    prefetch("thread", controls, viewport);
    prefetch("thread", { ...controls, loading: true }, viewport);
    expect(controls.onLoadEarlier).toHaveBeenCalledTimes(1);

    prefetch("thread", { ...controls, historyCursor: "page-2" }, { ...viewport, scroll: 100 });
    expect(controls.onLoadEarlier).toHaveBeenCalledTimes(2);
    prefetch("thread", { ...controls, historyCursor: "page-3" }, { ...viewport, scroll: 2000 });
    expect(controls.onLoadEarlier).toHaveBeenCalledTimes(2);
    prefetch("thread", { ...controls, historyCursor: "page-3" }, { ...viewport, scroll: 1500 });
    expect(controls.onLoadEarlier).toHaveBeenCalledTimes(3);
  });

  it("stops on failure and resumes after an explicit retry succeeds", () => {
    const prefetch = createThreadHistoryPrefetcher();
    const controls = history();
    const viewport = { scroll: 100, scrollLength: 800 };
    prefetch("thread", controls, viewport);
    prefetch("thread", { ...controls, error: "Disconnected" }, viewport);
    prefetch("thread", { ...controls, error: "Disconnected" }, viewport);
    prefetch("thread", { ...controls, loading: true }, viewport);
    expect(controls.onLoadEarlier).toHaveBeenCalledTimes(1);
    prefetch("thread", { ...controls, historyCursor: "page-2" }, viewport);
    expect(controls.onLoadEarlier).toHaveBeenCalledTimes(2);
  });

  it("does not suppress a different thread or environment using the same cursor", () => {
    const prefetch = createThreadHistoryPrefetcher();
    const controls = history();
    const viewport = { scroll: 100, scrollLength: 800 };
    prefetch("environment-a:thread", controls, viewport);
    prefetch("environment-b:thread", controls, viewport);
    expect(controls.onLoadEarlier).toHaveBeenCalledTimes(2);
  });

  it("retries an interrupted page after visiting another thread away from its start", () => {
    const prefetch = createThreadHistoryPrefetcher();
    const controls = history();
    const viewport = { scroll: 400, scrollLength: 800 };
    prefetch("thread-a", controls, viewport);
    prefetch("thread-b", history(), { ...viewport, scroll: 8000 });
    prefetch("thread-a", controls, viewport);
    expect(controls.onLoadEarlier).toHaveBeenCalledTimes(2);
  });

  it("ignores unavailable history, unmeasured lists, in-flight requests, and exhausted pages", () => {
    const prefetch = createThreadHistoryPrefetcher();
    const controls = history();
    const viewport = { scroll: 0, scrollLength: 800 };
    prefetch("thread", undefined, viewport);
    prefetch("thread", controls, undefined);
    prefetch("thread", controls, { ...viewport, scrollLength: 0 });
    prefetch("thread", { ...controls, loading: true }, viewport);
    prefetch("thread", { ...controls, hasMoreHistory: false }, viewport);
    prefetch("thread", { ...controls, historyCursor: null }, viewport);
    expect(controls.onLoadEarlier).not.toHaveBeenCalled();
  });

  it("loads from a native inset or overscroll position", () => {
    const prefetch = createThreadHistoryPrefetcher();
    const controls = history();
    prefetch("thread", controls, { scroll: -120, scrollLength: 800 });
    expect(controls.onLoadEarlier).toHaveBeenCalledExactlyOnceWith();
  });
});
