import { act, render as renderUi, type Screen } from "../test/render";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelPresence,
} from "./panelAnimations";

let fixtureScreen: Screen;
let pendingFrames: FrameRequestCallback[] = [];
let reducedMotion = false;
let mediaListeners = new Set<() => void>();
let settings: ReturnType<typeof usePanelAnimationSettings>;
let presence: ReturnType<typeof usePanelPresence<string>>;

function AnimationProbe({ open = true }: { open?: boolean }) {
  const animation = usePanelAnimationSettings();
  const panel = usePanelPresence(
    open,
    open ? "content" : null,
    animation.active,
    "thread",
    animation.durationMs,
  );
  useLayoutEffect(() => {
    settings = animation;
    presence = panel;
  });
  return null;
}

async function setReducedMotion(value: boolean) {
  await act(() => {
    reducedMotion = value;
    for (const listener of mediaListeners) listener();
  });
}

describe("panel motion", () => {
  it("animates by default and follows live system preference changes", async () => {
    await using _fixture = await setup();

    await act(() => fixtureScreen.rerender(<AnimationProbe />));
    expect(settings).toEqual({ active: true, durationMs: 200 });

    await setReducedMotion(true);
    expect(settings).toEqual({ active: false, durationMs: 0 });

    await setReducedMotion(false);
    expect(settings).toEqual({ active: true, durationMs: 200 });
  });

  it("skips motion immediately when Reduce Motion is already enabled", async () => {
    await using _fixture = await setup();

    reducedMotion = true;
    await act(() => fixtureScreen.rerender(<AnimationProbe />));
    expect(settings).toEqual({ active: false, durationMs: 0 });
    await act(() => fixtureScreen.rerender(<AnimationProbe open={false} />));
    expect(presence).toEqual({ present: false, value: null });
  });

  it("does not delay restored panels during navigation", async () => {
    await using _fixture = await setup();

    await act(() =>
      fixtureScreen.rerender(
        <PanelAnimationSuppressionProvider value={true}>
          <AnimationProbe />
        </PanelAnimationSuppressionProvider>,
      ),
    );
    expect(settings).toEqual({ active: false, durationMs: 0 });
  });

  it("retains closing content and cancels its pending removal when reopened", async () => {
    await using _fixture = await setup();

    await act(() => fixtureScreen.rerender(<AnimationProbe />));
    await act(() => fixtureScreen.rerender(<AnimationProbe open={false} />));
    expect(presence).toEqual({ present: true, value: "content" });
    await act(() => vi.advanceTimersByTime(100));
    await act(() => fixtureScreen.rerender(<AnimationProbe />));
    await act(() => vi.advanceTimersByTime(200));
    expect(presence).toEqual({ present: true, value: "content" });

    await act(() => fixtureScreen.rerender(<AnimationProbe open={false} />));
    await act(() => vi.advanceTimersByTime(200));
    expect(presence).toEqual({ present: false, value: null });
  });

  it("finishes an in-flight exit immediately when Reduce Motion is enabled", async () => {
    await using _fixture = await setup();

    await act(() => fixtureScreen.rerender(<AnimationProbe />));
    await act(() => fixtureScreen.rerender(<AnimationProbe open={false} />));
    expect(presence.present).toBe(true);
    await setReducedMotion(true);
    expect(presence).toEqual({ present: false, value: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});

async function setup(fakeClock = true) {
  pendingFrames = [];
  reducedMotion = false;
  mediaListeners = new Set();
  // Frames are stepped by hand so each assertion lands between two paints.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    pendingFrames.push(callback);
    return pendingFrames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        media: query,
        matches: reducedMotion,
        addEventListener: (_event: string, callback: () => void) => mediaListeners.add(callback),
        removeEventListener: (_event: string, callback: () => void) =>
          mediaListeners.delete(callback),
      }) as unknown as MediaQueryList,
  );
  fixtureScreen = await renderUi(null, { router: false });

  if (fakeClock) vi.useFakeTimers();

  const ownedScreen = fixtureScreen;
  return {
    async [Symbol.asyncDispose]() {
      await ownedScreen[Symbol.asyncDispose]();

      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
