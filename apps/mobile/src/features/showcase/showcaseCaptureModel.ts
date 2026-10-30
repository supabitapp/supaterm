import type { MobileThemeId, MobileThemeIds } from "../../lib/mobileTheme";
import type { ShowcaseScene } from "./nativeShowcaseScene";
import { isShowcaseNativeContentReady, type ShowcaseRenderSignal } from "./showcaseRenderSignal";

export const SHOWCASE_THREAD_ID = "offline-reason";

function sceneFromPathname(pathname: string): ShowcaseScene | null {
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

export function showcaseSceneOnScreen(
  requestedScene: ShowcaseScene | null,
  pathname: string,
): ShowcaseScene | null {
  const routeScene = sceneFromPathname(pathname);
  return routeScene;
}

export interface ShowcaseNavigationTarget {
  readonly requestedScene: ShowcaseScene;
  readonly scene: ShowcaseScene | null;

  readonly thread: object;
}

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

export function isShowcaseThemeApplied(input: {
  readonly launchRequestRead: boolean;
  readonly requestedTheme: MobileThemeId | null;
  readonly themeIds: MobileThemeIds;
}): boolean {
  if (input.requestedTheme === null) return input.launchRequestRead;
  return (
    input.themeIds.light === input.requestedTheme && input.themeIds.dark === input.requestedTheme
  );
}

export interface ShowcaseReadinessInput {
  readonly scene: ShowcaseScene | null;
  readonly requestedScene: ShowcaseScene | null;
  readonly hasFixture: boolean;
  readonly orientationSettled: boolean;
  readonly themeApplied: boolean;
  readonly themeId: MobileThemeId;
  readonly renderSignal: ShowcaseRenderSignal | null;

  readonly renderReports: number;
}

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
