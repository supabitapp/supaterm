import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { waitForDisclosureSettle } from "./timelineDisclosure";

let frames: Array<FrameRequestCallback> = [];
let now = 0;

function runFrame(elapsedMs = 16) {
  now += elapsedMs;
  vi.advanceTimersByTime(elapsedMs);
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(now);
}

function rowElement(transitions: () => ReadonlyArray<string>) {
  return {
    getAnimations: () =>
      transitions().map((transitionProperty) => ({ transitionProperty }) as unknown as Animation),
  } as unknown as Element;
}

beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  vi.useFakeTimers({ toFake: ["performance"], now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("waitForDisclosureSettle", () => {
  it("waits out the frames before a panel starts moving", () => {
    const onSettled = vi.fn();
    waitForDisclosureSettle(() => ({ size: 40, element: null }), onSettled);

    runFrame();
    runFrame();
    expect(onSettled).not.toHaveBeenCalled();
    runFrame();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("holds while the toggled row is still resizing", () => {
    const onSettled = vi.fn();
    const sizes = [40, 60, 90, 120, 120];
    let frame = 0;
    waitForDisclosureSettle(() => ({ size: sizes[frame++], element: null }), onSettled);

    for (let index = 0; index < 4; index += 1) runFrame();
    expect(onSettled).not.toHaveBeenCalled();
    runFrame();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it.each(["height", "grid-template-rows"])(
    "holds while a %s transition runs inside the row",
    (property) => {
      const onSettled = vi.fn();
      let running = [property, "opacity"];
      const element = rowElement(() => running);
      waitForDisclosureSettle(() => ({ size: 40, element }), onSettled);

      for (let index = 0; index < 5; index += 1) runFrame();
      expect(onSettled).not.toHaveBeenCalled();
      running = ["opacity"];
      runFrame();
      expect(onSettled).toHaveBeenCalledOnce();
    },
  );

  it("holds while a scripted height animation runs inside the row", () => {
    class TestKeyframeEffect {
      constructor(readonly property: string) {}
      getKeyframes() {
        return [{ [this.property]: "0px" }, { [this.property]: "40px" }];
      }
    }
    vi.stubGlobal("KeyframeEffect", TestKeyframeEffect);
    const onSettled = vi.fn();
    let running = [new TestKeyframeEffect("height"), new TestKeyframeEffect("opacity")];
    const element = {
      getAnimations: () => running.map((effect) => ({ effect }) as unknown as Animation),
    } as unknown as Element;
    waitForDisclosureSettle(() => ({ size: 40, element }), onSettled);

    for (let index = 0; index < 5; index += 1) runFrame();
    expect(onSettled).not.toHaveBeenCalled();
    running = [new TestKeyframeEffect("opacity")];
    runFrame();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("releases a row that never settles", () => {
    const onSettled = vi.fn();
    let size = 0;
    waitForDisclosureSettle(() => ({ size: (size += 10), element: null }), onSettled);

    runFrame(500);
    runFrame(400);
    expect(onSettled).not.toHaveBeenCalled();
    runFrame(200);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("never settles once cancelled", () => {
    const onSettled = vi.fn();
    const cancel = waitForDisclosureSettle(() => null, onSettled);

    runFrame();
    cancel();
    for (let index = 0; index < 5; index += 1) runFrame();
    expect(onSettled).not.toHaveBeenCalled();
  });
});
