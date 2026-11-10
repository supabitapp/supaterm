// @effect-diagnostics nodeBuiltinImport:off - reads the installed JS bundles for synchronous VM tests.
import * as NodeFS from "node:fs";
import * as NodeVM from "node:vm";
import { describe, expect, it } from "vite-plus/test";

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
  const ctx = {
    viewRefs: new Map([[0, ref]]),
    state: { containerItemGenerations: [], dataChangeEpoch: 0, initialScrollSession: undefined },
  };
  const baselines = new Map<Element, ReturnType<Element["getBoundingClientRect"]>>();
  const useLayoutEffect = (effect: () => () => void) => {
    cleanup = effect();
  };
  const useRef = <T>(current: T) => ({ current });
  const useCallback = <T>(callback: T) => callback;
  const api = NodeVM.runInNewContext(
    `${measure}\n${observe}\n({ observe: useOnLayoutSync, measure: measureContainersInLayoutEffect })`,
    {
      HTMLElement: Element,
      React3: { useCallback, useLayoutEffect, useRef },
      React3__namespace: { useCallback, useLayoutEffect, useRef },
      useCallback,
      isContainerItemCurrent: () => true,
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
