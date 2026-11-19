import type { ScopedThreadRef } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { OpenPreviewMutation } from "~/browser/openFileInPreview";
import { openTerminalLinkInPreview } from "./openTerminalLinkInPreview";

vi.mock("~/previewStateStore", () => ({
  applyPreviewServerSnapshot: vi.fn(),
  isPreviewSupportedInRuntime: () => true,
}));

vi.mock("~/rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({ openBrowser: vi.fn() }),
  },
}));

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const browserDefaultsMocks = vi.hoisted(() => ({
  resolve: fake(),
}));

vi.mock("~/browser/browserDefaults", () => ({
  resolveBrowserDefaults: browserDefaultsMocks.resolve,
}));

const linkTargetMocks = vi.hoisted(() => ({
  preference: fake<() => "system" | "app">(),
}));

vi.mock("~/browser/browserLinkTarget", () => ({
  resolveBrowserLinkTargetPreference: async () => linkTargetMocks.preference(),
  isWebUrl: (url: string) => /^https?:/u.test(url),
}));

const hydratedDefaults = {
  viewport: { _tag: "fixed", width: 1280, height: 720 } as const,
  profileId: "work",
  zoomFactor: 0.8,
  appearance: "dark",
};

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

beforeEach(() => {
  browserDefaultsMocks.resolve.reset();
  browserDefaultsMocks.resolve.implement(async () => hydratedDefaults);
  linkTargetMocks.preference.implement(() => "app");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openTerminalLinkInPreview", () => {
  it("does not report or fall back when opening the preview is interrupted", async () => {
    const fallbackToBrowser = vi.fn();
    const reportError = vi.spyOn(console, "error");

    await openTerminalLinkInPreview({
      url: "http://localhost:5173/",
      threadRef,
      openPreview: async () => AsyncResult.failure(Cause.interrupt()),
      fallbackToBrowser,
      forceBrowser: false,
    });

    expect(reportError).not.toHaveBeenCalled();
    expect(fallbackToBrowser).not.toHaveBeenCalled();
  });

  it("opens a server tab with the default zoom and appearance", async () => {
    const openPreview = vi.fn<OpenPreviewMutation>(async () =>
      AsyncResult.failure(Cause.interrupt()),
    );

    await openTerminalLinkInPreview({
      url: "https://supaterm.chat/",
      threadRef,
      openPreview,
      fallbackToBrowser: vi.fn(),
      forceBrowser: false,
      runtime: "server",
    });

    expect(openPreview).toHaveBeenCalledExactlyOnceWith({
      environmentId: threadRef.environmentId,
      input: expect.objectContaining({ runtime: "server", zoomFactor: 0.8, colorScheme: "dark" }),
    });
  });
});
