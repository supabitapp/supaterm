// @effect-diagnostics nodeBuiltinImport:off - reads the installed JS bundles for synchronous VM tests.
import * as NodeFS from "node:fs";
import * as NodeVM from "node:vm";
import { describe, expect, it } from "vite-plus/test";

function createList(bundle: string, firstHeight = 32, platform = "web") {
  const source = NodeFS.readFileSync(
    new URL(`../apps/web/node_modules/@legendapp/list/${bundle}`, import.meta.url),
    "utf8",
  );
  const positions = source.slice(
    source.indexOf("function updateItemPositions("),
    source.indexOf("// src/core/viewability.ts"),
  );
  const calculationStart = source.indexOf("function calculateItemsInView(");
  const calculation = source.slice(
    calculationStart,
    source.indexOf("    totalSize = getContentSize(ctx);", calculationStart),
  );
  const keys = Array.from({ length: 80 }, (_, index) => `row-${index}`);
  const sizes = new Map(keys.map((key, index) => [key, index === 0 ? firstHeight : 32]));
  const state = {
    props: {
      data: keys,
      alwaysRenderIndicesArr: [],
      alwaysRenderIndicesSet: new Set(),
      stickyHeaderIndicesSet: new Set(),
    },
    columns: [],
    columnSpans: [],
    idCache: keys,
    indexByKey: new Map(keys.map((key, index) => [key, index])),
    sizes,
    sizesKnown: new Map(sizes),
    positions: keys.map((_, index) => (index === 0 ? 0 : firstHeight + (index - 1) * 32)),
    scroll: 0,
    scrollLength: 600,
    lastScrollDelta: 5,
    startBuffered: 0,
    minIndexSizeChanged: undefined as number | undefined,
    scrollAdjustHandler: { getAdjust: () => 0 },
  };
  const values = new Map<string, unknown>([
    ["numContainers", 35],
    ["numColumns", 1],
    ["stylePaddingTop", 0],
    ["alignItemsAtEndPadding", 0],
    ["headerSize", 0],
    ["activeStickyIndex", -1],
  ]);
  const ctx = { state, values, positionListeners: new Map(), scrollAxisGap: 0 };
  const totalSize = () => [...sizes.values()].reduce((total, size) => total + size, 0);
  const calculate = NodeVM.runInNewContext(
    `${positions}\n${calculation}\n  });\n}\ncalculateItemsInView`,
    {
      IS_DEV: false,
      Platform: { OS: platform },
      batchedUpdates: (run: () => void) => run(),
      peek$: (_ctx: unknown, key: string) => values.get(key),
      getContentSize: totalSize,
      updateTotalSize: totalSize,
      getEffectiveDrawDistance: () => 250,
      getScrollVelocity: () => 1,
      hasActiveInitialScroll: () => false,
      getId: (_state: unknown, index: number) => keys[index],
      prepareMVCP: () => undefined,
    },
  ) as (context: typeof ctx) => void;
  return {
    positions: state.positions,
    resize(index: number, height: number) {
      sizes.set(keys[index]!, height);
      state.sizesKnown.set(keys[index]!, height);
      state.minIndexSizeChanged = index;
      calculate(ctx);
    },
  };
}

function createMeasurements(bundle: string, initialHeight: number) {
  const source = NodeFS.readFileSync(
    new URL(`../apps/web/node_modules/@legendapp/list/${bundle}`, import.meta.url),
    "utf8",
  );
  const measure = source.slice(
    source.indexOf("function measureContainersInLayoutEffect("),
    source.indexOf("var typedForwardRef ="),
  );
  const observe = source.slice(
    source.indexOf("var globalResizeObserver ="),
    source.indexOf("// src/hooks/useContainerMeasurement.tsx"),
  );
  class Element {
    height = initialHeight;
    get offsetHeight() {
      return this.height;
    }
    get offsetWidth() {
      return 400;
    }
    getBoundingClientRect() {
      return { height: this.height, width: 400, left: 0, top: 0 };
    }
  }
  const element = new Element();
  const ref = { current: element };
  const observed = new Map<Element, number | undefined>();
  let deliver = () => {};
  let cleanup = () => {};
  let cachedHeight = initialHeight;
  let deliveries = 0;
  const ctx = { viewRefs: new Map([[0, ref]]) };
  const baselines = new Map<Element, ReturnType<Element["getBoundingClientRect"]>>();
  const useLayoutEffect = (effect: () => () => void) => {
    cleanup = effect();
  };
  const api = NodeVM.runInNewContext(
    `${measure}\n${observe}\n({ observe: useOnLayoutSync, measure: measureContainersInLayoutEffect })`,
    {
      HTMLElement: Element,
      React3: { useLayoutEffect },
      ResizeObserver: class {
        constructor(callback: (entries: unknown[]) => void) {
          deliver = () => {
            const entries = [...observed].flatMap(([target, previous]) => {
              if (previous === target.height) return [];
              observed.set(target, target.height);
              return [
                {
                  target,
                  borderBoxSize: [{ blockSize: target.height, inlineSize: 400 }],
                  contentRect: target.getBoundingClientRect(),
                },
              ];
            });
            if (entries.length) callback(entries);
          };
        }
        observe(target: Element) {
          if (!observed.has(target)) observed.set(target, undefined);
        }
        unobserve(target: Element) {
          observed.delete(target);
        }
      },
      useLayoutEffect,
      batchItemSizeUpdates: (run: () => void) => run(),
      peek$: () => "row-0",
      getContainerLayoutBaseline: (target: Element) => baselines.get(target),
      setContainerLayoutBaseline: (
        target: Element,
        size: ReturnType<Element["getBoundingClientRect"]>,
      ) => baselines.set(target, size),
      updateItemSizesBatch: (_ctx: unknown, measurements: Array<{ size: { height: number } }>) => {
        cachedHeight = measurements[0]!.size.height;
      },
    },
  ) as {
    observe: (props: {
      ref: typeof ref;
      measureInLayoutEffect: boolean;
      onLayoutChange: (size: { height: number }) => void;
    }) => void;
    measure: (context: typeof ctx) => void;
  };
  api.observe({
    ref,
    measureInLayoutEffect: false,
    onLayoutChange: (size) => {
      cachedHeight = size.height;
      deliveries++;
    },
  });
  deliver();
  return {
    height: () => cachedHeight,
    deliveries: () => deliveries,
    layout(height: number) {
      element.height = height;
      api.measure(ctx);
    },
    resize(height: number) {
      element.height = height;
    },
    deliver: () => deliver(),
    cleanup: () => cleanup(),
  };
}

describe.each([
  ["react.js", "web"],
  ["react.mjs", "web"],
  ["react-native.web.js", "web"],
  ["react-native.web.mjs", "web"],
  ["react-native.js", "ios"],
  ["react-native.mjs", "ios"],
  ["react-native.js", "android"],
  ["react-native.mjs", "android"],
])("measured row positions (%s, %s)", (bundle, platform) => {
  it("keeps later rows below a reply that grows while scrolling", () => {
    const list = createList(bundle, 32, platform);
    list.resize(0, 5000);
    expect(list.positions[13]).toBe(5384);
    expect(list.positions[79]).toBe(7496);
  });

  it("closes the space after a reply shrinks while scrolling", () => {
    const list = createList(bundle, 5000, platform);
    list.resize(0, 32);
    expect(list.positions[79]).toBe(2528);
  });

  it("reconciles the suffix without moving the unaffected prefix", () => {
    const list = createList(bundle, 32, platform);
    const prefix = list.positions.slice(0, 20);
    list.resize(20, 5000);
    expect(list.positions.slice(0, 20)).toEqual(prefix);
    expect(list.positions[79]).toBe(7496);
  });
});

describe.each(["react.js", "react.mjs", "react-native.web.js", "react-native.web.mjs"])(
  "observed row measurement (%s)",
  (bundle) => {
    it.each([
      [300, 100],
      [100, 300],
    ])("reconciles a transient layout from %i to %i and back", (initial, transient) => {
      const row = createMeasurements(bundle, initial);
      row.layout(transient);
      expect(row.height()).toBe(transient);
      row.resize(initial);
      row.deliver();
      expect(row.height()).toBe(initial);
      row.cleanup();
    });

    it("does not deliver an extra observation when the layout stays unchanged", () => {
      const row = createMeasurements(bundle, 300);
      row.layout(300);
      row.deliver();
      expect(row.deliveries()).toBe(1);
      row.cleanup();
    });
  },
);
