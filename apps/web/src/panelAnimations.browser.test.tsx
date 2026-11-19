import { act, fakeTimers, render as renderUi, type Screen } from "../test/render";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelPresence,
} from "./panelAnimations";

let fixtureScreen: Screen;
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
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const changed =
    query.matches === value
      ? Promise.resolve()
      : new Promise<void>((resolve) =>
          query.addEventListener("change", () => resolve(), { once: true }),
        );
  await act(async () => {
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: value ? "reduce" : "no-preference" }],
    });
    await changed;
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

    await setReducedMotion(true);
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
  await setReducedMotion(false);
  fixtureScreen = await renderUi(null, { router: false });

  const clock = fakeClock ? fakeTimers() : null;

  const ownedScreen = fixtureScreen;
  return {
    async [Symbol.asyncDispose]() {
      await ownedScreen[Symbol.asyncDispose]();

      clock?.[Symbol.dispose]();
      await cdp().send("Emulation.setEmulatedMedia", { features: [] });
    },
  };
}
