import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
  usePanelPresence,
} from "./panelAnimations";

let root: Root;
let pendingFrames: FrameRequestCallback[] = [];
let observed: boolean[] = [];
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

function SuppressionProbe({ navigationKey }: { navigationKey: string }) {
  const suppressed = usePanelNavigationSuppression(navigationKey);
  useLayoutEffect(() => {
    observed.push(suppressed);
  }, [suppressed]);
  return null;
}

beforeEach(() => {
  pendingFrames = [];
  observed = [];
  reducedMotion = false;
  mediaListeners = new Set();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function paintPendingFrame() {
  const callback = pendingFrames.shift();
  await act(() => callback?.(0));
}

async function setReducedMotion(value: boolean) {
  await act(() => {
    reducedMotion = value;
    for (const listener of mediaListeners) listener();
  });
}

describe("panel motion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("animates by default and follows live system preference changes", async () => {
    await act(() => root.render(<AnimationProbe />));
    expect(settings).toEqual({ active: true, durationMs: 200 });

    await setReducedMotion(true);
    expect(settings).toEqual({ active: false, durationMs: 0 });

    await setReducedMotion(false);
    expect(settings).toEqual({ active: true, durationMs: 200 });
  });

  it("skips motion immediately when Reduce Motion is already enabled", async () => {
    reducedMotion = true;
    await act(() => root.render(<AnimationProbe />));
    expect(settings).toEqual({ active: false, durationMs: 0 });
    await act(() => root.render(<AnimationProbe open={false} />));
    expect(presence).toEqual({ present: false, value: null });
  });

  it("does not delay restored panels during navigation", async () => {
    await act(() =>
      root.render(
        <PanelAnimationSuppressionProvider value={true}>
          <AnimationProbe />
        </PanelAnimationSuppressionProvider>,
      ),
    );
    expect(settings).toEqual({ active: false, durationMs: 0 });
  });

  it("retains closing content and cancels its pending removal when reopened", async () => {
    await act(() => root.render(<AnimationProbe />));
    await act(() => root.render(<AnimationProbe open={false} />));
    expect(presence).toEqual({ present: true, value: "content" });
    await act(() => vi.advanceTimersByTime(100));
    await act(() => root.render(<AnimationProbe />));
    await act(() => vi.advanceTimersByTime(200));
    expect(presence).toEqual({ present: true, value: "content" });

    await act(() => root.render(<AnimationProbe open={false} />));
    await act(() => vi.advanceTimersByTime(200));
    expect(presence).toEqual({ present: false, value: null });
  });

  it("finishes an in-flight exit immediately when Reduce Motion is enabled", async () => {
    await act(() => root.render(<AnimationProbe />));
    await act(() => root.render(<AnimationProbe open={false} />));
    expect(presence.present).toBe(true);
    await setReducedMotion(true);
    expect(presence).toEqual({ present: false, value: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("usePanelNavigationSuppression", () => {
  it("suppresses initial and navigated panel state until each route has painted", async () => {
    await act(() => root.render(<SuppressionProbe navigationKey="/thread/one" />));
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);

    await act(() => root.render(<SuppressionProbe navigationKey="/thread/two" />));
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);
  });
});
