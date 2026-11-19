import {
  DEFAULT_PREVIEW_APPEARANCE,
  DEFAULT_PREVIEW_ZOOM_FACTOR,
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
} from "@supaterm/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const desktop = vi.hoisted(() => {
  const pendingCloses: Array<Promise<void>> = [];
  const pendingStops: Array<Promise<null>> = [];
  return {
    pendingCloses,
    pendingStops,
    closeTab: (_tabId: string) => pendingCloses.shift() ?? Promise.resolve(),
    createTab: (_tabId: string, _state: unknown) => Promise.resolve(),
    stopBrowserRecording: (_tabId: string) => pendingStops.shift() ?? Promise.resolve(null),
  };
});
const closeTab = vi.spyOn(desktop, "closeTab");
const createTab = vi.spyOn(desktop, "createTab");
const stopBrowserRecording = vi.spyOn(desktop, "stopBrowserRecording");

vi.mock("~/components/preview/previewBridge", () => ({
  previewBridge: {
    closeTab: (tabId: string) => desktop.closeTab(tabId),
    createTab: (tabId: string, state: unknown) => desktop.createTab(tabId, state),
  },
}));

vi.mock("./browserRecording", () => ({
  stopBrowserRecording: (tabId: string) => desktop.stopBrowserRecording(tabId),
}));

import { acquireDesktopTab } from "./desktopTabLifetime";
import { __setClientSettingsForTests } from "~/hooks/useSettings";

const DEFAULT_TAB_STATE = {
  zoomFactor: DEFAULT_PREVIEW_ZOOM_FACTOR,
  colorScheme: DEFAULT_PREVIEW_APPEARANCE,
};
import { previewRuntimeTabId } from "./previewRuntimeTabId";

describe("desktopTabLifetime", () => {
  beforeEach(() => {
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    closeTab.mockClear();
    createTab.mockClear();
    stopBrowserRecording.mockClear();
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps identical server tab ids from two environments in separate desktop slots", async () => {
    vi.useFakeTimers();
    const tabA = previewRuntimeTabId(
      {
        environmentId: EnvironmentId.make("environment-a"),
        threadId: ThreadId.make("thread-a"),
      },
      "epoch-a",
      "tab_1",
    );
    const tabB = previewRuntimeTabId(
      {
        environmentId: EnvironmentId.make("environment-b"),
        threadId: ThreadId.make("thread-b"),
      },
      "epoch-b",
      "tab_1",
    );

    const first = acquireDesktopTab(tabA);
    const second = acquireDesktopTab(tabB);
    await Promise.all([first.ready, second.ready]);

    expect(createTab).toHaveBeenCalledWith(tabA, DEFAULT_TAB_STATE);
    expect(createTab).toHaveBeenCalledWith(tabB, DEFAULT_TAB_STATE);
    expect(createTab).toHaveBeenCalledTimes(2);

    first.release();
    second.release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("stops recording before closing the final desktop tab lease", async () => {
    vi.useFakeTimers();
    let resolveStop: (() => void) | undefined;
    desktop.pendingStops.push(
      new Promise<null>((resolve) => {
        resolveStop = () => resolve(null);
      }),
    );

    const lease = acquireDesktopTab("tab_recording_cleanup");
    await lease.ready;
    lease.release();
    await vi.advanceTimersByTimeAsync(0);

    expect(stopBrowserRecording).toHaveBeenCalledWith("tab_recording_cleanup");
    expect(closeTab).not.toHaveBeenCalled();

    resolveStop?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(closeTab).toHaveBeenCalledWith("tab_recording_cleanup");
  });

  it("waits for an in-flight close before recreating a reacquired tab", async () => {
    vi.useFakeTimers();
    let resolveClose: (() => void) | undefined;
    desktop.pendingCloses.push(
      new Promise<void>((resolve) => {
        resolveClose = resolve;
      }),
    );

    const initial = acquireDesktopTab("tab_close_reacquire");
    await initial.ready;
    initial.release();
    await vi.advanceTimersByTimeAsync(0);

    expect(closeTab).toHaveBeenCalledWith("tab_close_reacquire");

    const reacquired = acquireDesktopTab("tab_close_reacquire");
    expect(createTab).toHaveBeenCalledTimes(1);

    resolveClose?.();
    await reacquired.ready;
    expect(createTab).toHaveBeenCalledTimes(2);
  });
});
