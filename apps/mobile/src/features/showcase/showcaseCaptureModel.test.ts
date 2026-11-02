import { describe, expect, it } from "vite-plus/test";

import {
  isShowcaseThemeApplied,
  showcaseReadinessKey,
  showcaseSceneOnScreen,
  showcaseThemePatch,
  shouldNavigateToShowcaseScene,
  type ShowcaseReadinessInput,
} from "./showcaseCaptureModel";

const ready: ShowcaseReadinessInput = {
  scene: "thread",
  requestedScene: "thread",
  hasFixture: true,
  threadSynced: true,
  orientationSettled: true,
  themeApplied: true,
  themeId: "supaterm",
  renderSignal: null,
  renderReports: 0,
};

describe("showcaseSceneOnScreen", () => {
  it("maps routes to the scene they show", () => {
    expect(showcaseSceneOnScreen("/")).toBe("threads");
    expect(showcaseSceneOnScreen("/threads/env/thread")).toBe("thread");
    expect(showcaseSceneOnScreen("/threads/env/thread/review?x=1")).toBe("review");
    expect(showcaseSceneOnScreen("/settings/environments")).toBe("environments");
    expect(showcaseSceneOnScreen("/projects")).toBeNull();
  });
});

describe("isShowcaseThemeApplied", () => {
  const applied = {
    preferencesReady: true,
    launchRequestRead: true,
    requestedTheme: null,
    themeMode: "system",
    themeId: "supaterm",
  } as const;

  it("waits for the launch request when no theme is requested", () => {
    expect(isShowcaseThemeApplied({ ...applied, launchRequestRead: false })).toBe(false);
    expect(isShowcaseThemeApplied(applied)).toBe(true);
  });

  it("requires loaded preferences following the system appearance", () => {
    expect(isShowcaseThemeApplied({ ...applied, preferencesReady: false })).toBe(false);
    expect(isShowcaseThemeApplied({ ...applied, themeMode: "dark" })).toBe(false);
  });

  it("requires the requested theme", () => {
    expect(isShowcaseThemeApplied({ ...applied, requestedTheme: "material-you" })).toBe(false);
    expect(
      isShowcaseThemeApplied({
        ...applied,
        requestedTheme: "material-you",
        themeId: "material-you",
      }),
    ).toBe(true);
  });
});

describe("showcaseReadinessKey", () => {
  it("is null until every precondition holds", () => {
    expect(showcaseReadinessKey(ready)).not.toBeNull();
    expect(showcaseReadinessKey({ ...ready, requestedScene: "terminal" })).toBeNull();
    expect(showcaseReadinessKey({ ...ready, hasFixture: false })).toBeNull();
    expect(showcaseReadinessKey({ ...ready, threadSynced: false })).toBeNull();
    expect(
      showcaseReadinessKey({
        ...ready,
        scene: "terminal",
        requestedScene: "terminal",
        threadSynced: false,
      }),
    ).not.toBeNull();
    expect(showcaseReadinessKey({ ...ready, orientationSettled: false })).toBeNull();
    expect(showcaseReadinessKey({ ...ready, themeApplied: false })).toBeNull();
  });

  it("waits for review to report a draw in the current theme, and changes key when it redraws", () => {
    const review = { ...ready, scene: "review", requestedScene: "review" } as const;
    expect(showcaseReadinessKey(review)).toBeNull();
    expect(
      showcaseReadinessKey({
        ...review,
        renderSignal: { scene: "review", themeId: "material-you" },
      }),
    ).toBeNull();
    const drawn = { ...review, renderSignal: { scene: "review", themeId: "supaterm" } } as const;
    const firstDraw = showcaseReadinessKey({ ...drawn, renderReports: 1 });
    expect(firstDraw).not.toBeNull();
    expect(showcaseReadinessKey({ ...drawn, renderReports: 2 })).not.toBe(firstDraw);
  });
});

describe("showcaseThemePatch", () => {
  const supaterm = { light: "supaterm", dark: "supaterm" } as const;

  it("follows the system appearance before applying the requested theme", () => {
    expect(
      showcaseThemePatch({ themeMode: "dark", themeIds: supaterm, requestedTheme: "dracula" }),
    ).toEqual({ themeMode: "system" });
    expect(
      showcaseThemePatch({ themeMode: "system", themeIds: supaterm, requestedTheme: null }),
    ).toBeNull();
  });

  it("stops writing once the stored pair can no longer move toward a single-appearance theme", () => {
    const patch = { themeMode: "system", themeIds: supaterm, requestedTheme: "dracula" } as const;
    expect(showcaseThemePatch(patch)).toEqual({ lightThemeId: "supaterm", darkThemeId: "dracula" });
    expect(
      showcaseThemePatch({ ...patch, themeIds: { light: "supaterm", dark: "dracula" } }),
    ).toBeNull();
  });
});

describe("shouldNavigateToShowcaseScene", () => {
  it("dispatches again when the thread shell changes while the scene is still not on screen", () => {
    const shell = { id: "offline-reason" };
    const first = { requestedScene: "review", scene: "threads", thread: shell } as const;
    expect(shouldNavigateToShowcaseScene(null, first)).toBe(true);
    expect(shouldNavigateToShowcaseScene(first, { ...first })).toBe(false);
    expect(shouldNavigateToShowcaseScene(first, { ...first, thread: { ...shell } })).toBe(true);
    expect(shouldNavigateToShowcaseScene(first, { ...first, scene: "thread" })).toBe(true);
    expect(shouldNavigateToShowcaseScene(first, { ...first, scene: "review" })).toBe(false);
  });
});
