import type { MobileThemeId } from "../../lib/mobileTheme";
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

export interface ShowcaseReadinessInput {
  readonly scene: ShowcaseScene | null;
  readonly requestedScene: ShowcaseScene | null;
  readonly hasFixture: boolean;
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
