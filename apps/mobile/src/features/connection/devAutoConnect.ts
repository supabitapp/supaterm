import type { NavigationState, PartialState } from "@react-navigation/native";
import { CommonActions, StackActions } from "@react-navigation/native";
import { Atom } from "effect/reactivity";

import { PAIRING_FORM_LINK_PATHS } from "../../lib/pairingLinkPaths";
import { findLinkedRoute, updateLinkedRoute } from "../../lib/appLinking";
import { rootNavigationRef, whenRootNavigationReady } from "../../lib/rootNavigation";
import { appAtomRegistry } from "../../state/atom-registry";
import { leaveSettingsPage } from "../settings/settings-navigation";
import { workspaceHasColumns } from "../workspace/workspace-selection-store";
import { pairEnvironment } from "../../state/use-remote-environment-registry";

export type DevAutoConnectAttempt =
  | { readonly pairingUrl: string; readonly status: "connecting" }
  | { readonly pairingUrl: string; readonly status: "failed"; readonly error: string | null };

export const devAutoConnectAttemptAtom = Atom.make<DevAutoConnectAttempt | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:dev-auto-connect-attempt"),
);

export function autoConnectReport(
  attempt: DevAutoConnectAttempt | null,
  routePairingUrl: string,
  dismissed: boolean,
): { readonly connecting: boolean; readonly error: string | null } {
  if (attempt === null || routePairingUrl.length === 0 || attempt.pairingUrl !== routePairingUrl) {
    return { connecting: false, error: null };
  }
  if (attempt.status === "connecting") return { connecting: true, error: null };
  return { connecting: false, error: dismissed ? null : attempt.error };
}

const PAIRING_FORM_ROUTES = Object.keys(PAIRING_FORM_LINK_PATHS);

function isAutoConnectFlag(value: unknown): boolean {
  return value === "1" || value === "true";
}

async function connect(pairingUrl: string) {
  const attempt: DevAutoConnectAttempt = { pairingUrl, status: "connecting" };
  appAtomRegistry.set(devAutoConnectAttemptAtom, attempt);
  const outcome = await pairEnvironment(pairingUrl);

  if (appAtomRegistry.get(devAutoConnectAttemptAtom) !== attempt) return;
  if (!outcome.ok) {
    appAtomRegistry.set(devAutoConnectAttemptAtom, {
      pairingUrl,
      status: "failed",
      error: outcome.error,
    });
    return;
  }
  whenRootNavigationReady(() => {
    if (appAtomRegistry.get(devAutoConnectAttemptAtom) !== attempt) return;
    appAtomRegistry.set(devAutoConnectAttemptAtom, null);
    const current = rootNavigationRef.getCurrentRoute()?.name;
    if (current === undefined || !PAIRING_FORM_ROUTES.includes(current)) return;

    if (!rootNavigationRef.canGoBack()) rootNavigationRef.dispatch(StackActions.replace("Home"));
    else leaveSettingsPage(rootNavigationRef, workspaceHasColumns(), "SettingsEnvironments");
  });
}

export function withoutPairingTarget(
  state: PartialState<NavigationState> | undefined,
): PartialState<NavigationState> | undefined {
  return updateLinkedRoute(state, PAIRING_FORM_ROUTES, (route) => {
    if (route.params === undefined || !("routeFor" in route.params)) return route;
    const { routeFor: _routeFor, ...params } = route.params as { readonly routeFor?: unknown };
    return { ...route, params };
  });
}

export function startDevAutoConnect(
  state: PartialState<NavigationState> | undefined,
): PartialState<NavigationState> | undefined {
  if (!__DEV__) return state;
  const route = findLinkedRoute(state, PAIRING_FORM_ROUTES);
  if (route === undefined) return state;
  const params = (route.params ?? {}) as {
    readonly autoConnect?: unknown;
    readonly pairingUrl?: unknown;
  };
  const pairingUrl = typeof params.pairingUrl === "string" ? params.pairingUrl.trim() : "";
  if (isAutoConnectFlag(params.autoConnect) && pairingUrl.length > 0) {
    const current = appAtomRegistry.get(devAutoConnectAttemptAtom);
    if (current?.pairingUrl !== pairingUrl || current.status !== "connecting") {
      void connect(pairingUrl);
    }
  } else {
    appAtomRegistry.set(devAutoConnectAttemptAtom, null);
  }
  return state;
}

export function pairingFormLinkAction(
  link: PartialState<NavigationState>,
  current: NavigationState | undefined,
) {
  const linked = findLinkedRoute(link, PAIRING_FORM_ROUTES);
  const open = current?.routes[current.index];
  if (!linked || !current || !open || !PAIRING_FORM_ROUTES.includes(open.name)) return undefined;
  return {
    ...CommonActions.replaceParams(linked.params ?? {}),
    source: open.key,
    target: current.key,
  };
}
