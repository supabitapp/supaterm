import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { MotionPresence } from "./MotionPresence";

const animation = vi.hoisted(() => ({
  reducedMotion: false,
  completions: [] as Array<(finished: boolean) => void>,
}));

vi.mock("../../lib/useReducedMotionPreference", () => ({
  useReducedMotionPreference: () => animation.reducedMotion,
}));
vi.mock("../../lib/motionInput", () => ({ isKeyboardMotionSuppressed: () => false }));
vi.mock("react-native-reanimated", async () => {
  const { useState } = await import("react");
  return {
    default: { View: "View" },
    Easing: { bezier: () => undefined },
    ReduceMotion: { Never: "never" },
    runOnJS: (callback: () => void) => callback,
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: number) => useState(() => ({ value, set: () => {} }))[0],
    withTiming: (value: number, _options: unknown, complete: (finished: boolean) => void) => {
      animation.completions.push(complete);
      return value;
    },
  };
});

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  animation.reducedMotion = false;
  animation.completions.length = 0;
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

async function render(visible: boolean, onHidden: () => void) {
  await act(() => {
    const content = (
      <MotionPresence visible={visible} onHidden={onHidden}>
        content
      </MotionPresence>
    );
    if (renderer) renderer.update(content);
    else renderer = create(content);
  });
}

it.each([false, true])(
  "releases content after native exit completion with reduced motion %s",
  async (reducedMotion) => {
    animation.reducedMotion = reducedMotion;
    const onHidden = vi.fn();
    await render(true, onHidden);
    await render(false, onHidden);
    expect(renderer?.toJSON()).not.toBeNull();
    expect(onHidden).not.toHaveBeenCalled();

    await act(() => animation.completions.at(-1)?.(false));
    expect(renderer?.toJSON()).not.toBeNull();
    expect(onHidden).not.toHaveBeenCalled();

    await act(() => animation.completions.at(-1)?.(true));

    expect(renderer?.toJSON()).toBeNull();
    expect(onHidden).toHaveBeenCalledTimes(1);
  },
);

it("ignores a stale exit after reopening and calls the latest completion handler", async () => {
  const previous = vi.fn();
  const latest = vi.fn();
  await render(true, previous);
  await render(false, previous);
  const oldExit = animation.completions.at(-1)!;
  await render(true, latest);
  await act(() => oldExit(true));
  expect(renderer?.toJSON()).not.toBeNull();
  expect(previous).not.toHaveBeenCalled();
  expect(latest).not.toHaveBeenCalled();

  await render(false, previous);
  const exit = animation.completions.at(-1)!;
  const count = animation.completions.length;
  await render(false, latest);
  expect(animation.completions).toHaveLength(count);
  await act(() => exit(true));

  expect(renderer?.toJSON()).toBeNull();
  expect(previous).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
});
