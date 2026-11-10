// @effect-diagnostics nodeBuiltinImport:off - reads the installed native JS bundle for synchronous VM tests.
import * as NodeFS from "node:fs";
import * as NodeVM from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";

function createBootstrapEvaluation(bundle: string, lastNativeScroll: number) {
  const source = NodeFS.readFileSync(
    new URL(`../apps/mobile/node_modules/@legendapp/list/${bundle}`, import.meta.url),
    "utf8",
  );
  const evaluate = source.slice(
    source.indexOf("function evaluateBootstrapInitialScroll("),
    source.indexOf("function finishBootstrapInitialScrollWithoutScroll("),
  );
  const finishWithoutScroll = vi.fn();
  const dispatchInitialScroll = vi.fn();
  // A session re-armed by a data change after landing keeps its stale mount seed.
  const bootstrap = {
    scroll: 4692,
    seedContentOffset: 12,
    previousResolvedOffset: 4692,
    visibleIndices: [9],
    passCount: 0,
    mountFrameCount: 0,
  };
  const state = {
    initialScroll: { index: 9, viewPosition: 1 },
    initialScrollSession: { kind: "bootstrap", bootstrap },
    lastNativeScroll,
    props: { data: [] },
    startBuffered: 9,
    endBuffered: 9,
    idCache: { 9: "message-9" },
    sizesKnown: new Set(["message-9"]),
  };
  const run = NodeVM.runInNewContext(`${evaluate}\nevaluateBootstrapInitialScroll`, {
    getBootstrapInitialScrollSession: () => bootstrap,
    isOffsetInitialScrollSession: () => false,
    abortBootstrapRevealIfNeeded: () => false,
    resolveInitialScrollOffset: () => 4692,
    checkAllSizesKnown: () => true,
    getBootstrapRevealVisibleIndices: () => [9],
    doVisibleIndicesMatch: () => true,
    DEFAULT_BOOTSTRAP_REVEAL_EPSILON: 1,
    Platform: { OS: "ios" },
    getObservedBootstrapInitialScrollOffset: () => lastNativeScroll,
    finishBootstrapInitialScrollWithoutScroll: finishWithoutScroll,
    clearBootstrapInitialScrollSession: vi.fn(),
    dispatchInitialScroll,
    queueBootstrapInitialScrollReevaluation: vi.fn(),
  }) as (context: { state: typeof state }) => void;
  run({ state });
  return { finishWithoutScroll, dispatchInitialScroll };
}

describe.each(["react-native.js", "react-native.mjs"])(
  "re-armed initial end bootstrap (%s)",
  (bundle) => {
    it("finishes without a no-op scroll once native reported the target", () => {
      const landed = createBootstrapEvaluation(bundle, 4692);
      expect(landed.finishWithoutScroll).toHaveBeenCalledTimes(1);
      expect(landed.dispatchInitialScroll).not.toHaveBeenCalled();
      const short = createBootstrapEvaluation(bundle, 4600);
      expect(short.finishWithoutScroll).not.toHaveBeenCalled();
      expect(short.dispatchInitialScroll).toHaveBeenCalledTimes(1);
    });
  },
);
