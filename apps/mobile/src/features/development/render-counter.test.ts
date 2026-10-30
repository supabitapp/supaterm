import * as NodeFS from "node:fs";
import * as NodeVM from "node:vm";
import { afterEach, expect, it, vi } from "vite-plus/test";

const globals = [
  "__supatermRenderCounterOpen",
  "__supatermRenderCounterReload",
  "__supatermRenderCounterStart",
  "__supatermRenderCounterStop",
];

afterEach(() => {
  for (const name of globals) Reflect.deleteProperty(globalThis, name);
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("loads only in development with the documented measurement flag", () => {
  const entry = NodeFS.readFileSync(new URL("./render-counter-entry.ts", import.meta.url), "utf8");
  for (const [development, enabled] of [
    [true, "1"],
    [false, "1"],
    [true, "0"],
  ]) {
    const load = vi.fn();
    NodeVM.runInNewContext(entry, {
      __DEV__: development,
      process: { env: { EXPO_PUBLIC_SUPATERM_RENDER_COUNTER: enabled } },
      require: load,
    });
    expect(load).toHaveBeenCalledTimes(development && enabled === "1" ? 1 : 0);
  }
});

it("records and stops measurements through the runner's public functions", async () => {
  const hook = { onCommitFiberRoot: vi.fn() };
  vi.stubGlobal("__REACT_DEVTOOLS_GLOBAL_HOOK__", hook);
  await import("./render-counter");
  const counter = globalThis as typeof globalThis & {
    __supatermRenderCounterOpen: (url: string) => boolean;
    __supatermRenderCounterReload: () => boolean;
    __supatermRenderCounterStart: () => boolean;
    __supatermRenderCounterStop: () => import("./render-counter").RenderCounterReport;
  };
  expect(typeof counter.__supatermRenderCounterOpen).toBe("function");
  expect(typeof counter.__supatermRenderCounterReload).toBe("function");
  expect(counter.__supatermRenderCounterStart()).toBe(true);
  const root = {
    current: {
      child: {
        tag: 0,
        type: { displayName: "ThreadDetail" },
        flags: 1,
        alternate: null,
        child: null,
        sibling: null,
        memoizedProps: null,
        memoizedState: null,
      },
    },
  };
  hook.onCommitFiberRoot("renderer", root);
  expect(counter.__supatermRenderCounterStop()).toEqual({
    commits: 1,
    totalRenders: 1,
    components: [{ key: "ThreadDetail", count: 1 }],
    causes: [{ key: "ThreadDetail mount", count: 1 }],
  });
  hook.onCommitFiberRoot("renderer", root);
  expect(counter.__supatermRenderCounterStop().commits).toBe(1);
});
