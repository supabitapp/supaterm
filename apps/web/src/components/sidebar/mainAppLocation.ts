import { useNavigate, useRouter, type AnyRouter } from "@tanstack/react-router";

import { withoutAssistantCitationHash } from "../../lib/assistantCitationNavigation";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../../threadRoutes";

/** Settings and Usage open as modals over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/usage";
}

export function isSidebarUtilityPage(pathname: string) {
  return pathname.startsWith("/projects/") || pathname === "/pull-requests";
}

const SHELL_LESS_PATHS = new Set(["/pair", "/connect-agent"]);

let mainAppHref: string | null = null;
let appModalReturnHref: string | null = null;
let appModalReturnHistoryIndex: number | null = null;
let appModalReturnThreadTarget: ThreadRouteTarget | null = null;
let initialHistoryIndex = 0;

/** Remembers where Settings, Usage, and the utility pages lead back to. */
export function startMainAppLocationTracking(router: AnyRouter) {
  initialHistoryIndex = router.state.location.state.__TSR_index;
  const record = () => {
    const { pathname } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname)) return;
    const href = withoutAssistantCitationHash(router.state.location.href);
    appModalReturnHref = href;
    appModalReturnHistoryIndex =
      href === router.state.location.href ? router.state.location.state.__TSR_index : null;
    appModalReturnThreadTarget = resolveThreadRouteTarget(
      router.state.matches.at(-1)?.params ?? {},
    );
    if (!isSidebarUtilityPage(pathname)) mainAppHref = href;
  };
  record();
  return router.subscribe("onResolved", record);
}

/** The thread Settings or Usage opened over, for views mounted while the modal is open. */
export function getAppModalReturnThreadTarget() {
  return appModalReturnThreadTarget;
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}

/** Leaves Settings or Usage for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  const router = useRouter();
  return () => {
    const href = appModalReturnHref ?? mainAppHref ?? "/";
    const returnIndex = appModalReturnHistoryIndex ?? 0;
    const steps = router.state.location.state.__TSR_index - returnIndex;
    if (!(returnIndex > initialHistoryIndex && steps > 0)) return navigate({ href, replace: true });
    const unsubscribe = router.history.subscribe(() => {
      unsubscribe();
      void navigate({ href });
    });
    router.history.go(-(steps + 1));
  };
}
