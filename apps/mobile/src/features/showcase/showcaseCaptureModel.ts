import {
  createMobileThemePairPatch,
  type MobileThemeId,
  type MobileThemeIds,
  type MobileThemeMode,
} from "../../lib/mobileTheme";
import type { ShowcaseScene } from "./nativeShowcaseScene";
import { isShowcaseNativeContentReady, type ShowcaseRenderSignal } from "./showcaseRenderSignal";

export const SHOWCASE_THREAD_ID = "offline-reason";

export function showcaseSceneOnScreen(pathname: string): ShowcaseScene | null {
  const routePath = pathname.split(/[?#]/u, 1)[0] ?? pathname;
  if (routePath === "/settings" || routePath.endsWith("/settings/environments")) {
    return "environments";
  }
  if (routePath.endsWith("/terminal")) return "terminal";
  if (routePath.endsWith("/review")) return "review";
  if (routePath.startsWith("/threads/")) return "thread";
  if (routePath === "/") return "threads";
  return null;
}

export interface ShowcaseNavigationTarget {
  readonly requestedScene: ShowcaseScene;
  readonly scene: ShowcaseScene | null;
  /** The showcase thread shell; a new shell (or environment) is a new target to navigate to. */
  readonly thread: object;
}

/**
 * Whether to dispatch the navigation for `next`, given the target last dispatched. A target is
 * dispatched once, and again whenever any part of it changes, so a dispatch that did not move
 * the route is retried when the thread shell or route updates.
 */
export function shouldNavigateToShowcaseScene(
  last: ShowcaseNavigationTarget | null,
  next: ShowcaseNavigationTarget,
): boolean {
  return (
    next.scene !== next.requestedScene &&
    (last === null ||
      last.requestedScene !== next.requestedScene ||
      last.scene !== next.scene ||
      last.thread !== next.thread)
  );
}

/** Captures follow the system appearance, so both appearances must use the requested theme. */
export function isShowcaseThemeApplied(input: {
  readonly preferencesReady: boolean;
  readonly launchRequestRead: boolean;
  readonly requestedTheme: MobileThemeId | null;
  readonly themeMode: string;
  readonly themeId: MobileThemeId;
}): boolean {
  if (!input.preferencesReady || input.themeMode !== "system") return false;
  return input.requestedTheme === null
    ? input.launchRequestRead
    : input.themeId === input.requestedTheme;
}

/**
 * The preference write that moves toward the capture theme, or null when a write would change
 * nothing. Writing only changes keeps a theme the appearance lacks from rewriting forever.
 */
export function showcaseThemePatch(input: {
  readonly themeMode: MobileThemeMode;
  readonly themeIds: MobileThemeIds;
  readonly requestedTheme: MobileThemeId | null;
}) {
  if (input.themeMode !== "system") return { themeMode: "system" } as const;
  if (input.requestedTheme === null) return null;
  const patch = createMobileThemePairPatch(input.themeIds, input.requestedTheme);
  return patch.lightThemeId === input.themeIds.light && patch.darkThemeId === input.themeIds.dark
    ? null
    : patch;
}

export interface ShowcaseReadinessInput {
  readonly scene: ShowcaseScene | null;
  readonly requestedScene: ShowcaseScene | null;
  readonly hasFixture: boolean;
  /** The showcase thread finished syncing, so its screen no longer shows a sync status. */
  readonly threadSynced: boolean;
  readonly orientationSettled: boolean;
  readonly themeApplied: boolean;
  readonly themeId: MobileThemeId;
  readonly renderSignal: ShowcaseRenderSignal | null;
  /** Counts render-signal changes; a redraw report restarts the settle delay. */
  readonly renderReports: number;
}

/**
 * The capture key for a scene that is ready to be marked, or null while any
 * precondition is missing. A changed key restarts the settle delay.
 */
export function showcaseReadinessKey(input: ShowcaseReadinessInput): string | null {
  const { scene } = input;
  if (
    scene === null ||
    scene !== input.requestedScene ||
    !input.hasFixture ||
    (scene === "thread" && !input.threadSynced) ||
    !input.orientationSettled ||
    !input.themeApplied ||
    !isShowcaseNativeContentReady({
      scene,
      themeId: input.themeId,
      renderSignal: input.renderSignal,
    })
  ) {
    return null;
  }
  return [scene, input.themeId, input.renderReports].join("|");
}
