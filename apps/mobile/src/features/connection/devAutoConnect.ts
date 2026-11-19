import type { NavigationState, PartialState } from "@react-navigation/native";
import { CommonActions, StackActions } from "@react-navigation/native";
import { Atom } from "effect/reactivity";

import { findLinkedRoute, updateLinkedRoute } from "../../lib/appLinking";
import { rootNavigationRef, whenRootNavigationReady } from "../../lib/rootNavigation";
import { appAtomRegistry } from "../../state/atom-registry";
import { pairEnvironment } from "../../state/use-remote-environment-registry";

export type DevAutoConnectAttempt =
  | { readonly pairingUrl: string; readonly status: "connecting" }
  | { readonly pairingUrl: string; readonly status: "failed"; readonly error: string | null };

/** The pairing the dev deep link started, so the form it opens can show its progress. */
export const devAutoConnectAttemptAtom = Atom.make<DevAutoConnectAttempt | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:dev-auto-connect-attempt"),
);

/** Production builds ignore a link's pairing URL so it never prefills an attacker-chosen host and token. */
export function linkedPairingUrl(pairingUrl: string | undefined) {
  return __DEV__ ? (pairingUrl?.trim() ?? "") : "";
}

/**
 * What the form opened by `routePairingUrl` shows of the dev auto-connect. Editing or submitting
 * (`dismissed`) hides a failure, but a pairing still running keeps Connect busy, so the user
 * cannot start a second pairing beside it.
 */
export function autoConnectReport(
  attempt: DevAutoConnectAttempt | null,
  routePairingUrl: string,
  dismissed: boolean,
) {
  if (attempt === null || routePairingUrl.length === 0 || attempt.pairingUrl !== routePairingUrl) {
    return { connecting: false, error: null };
  }
  if (attempt.status === "connecting") return { connecting: true, error: null };
  return { connecting: false, error: dismissed ? null : attempt.error };
}

const PAIRING_FORM_ROUTES = ["ConnectionsNew", "SettingsEnvironmentNew"];

function isAutoConnectFlag(value: unknown) {
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
    else rootNavigationRef.goBack();
  });
}

/**
 * `routeFor` makes a pairing an "Add route" to a saved environment, which skips the guard against
 * a pairing taking over that environment's id. Only in-app navigation may set it, never a link.
 */
export function withoutPairingTarget(
  state: PartialState<NavigationState> | undefined,
): PartialState<NavigationState> | undefined;
export function withoutPairingTarget(state: PartialState<NavigationState> | undefined) {
  return updateLinkedRoute(state, PAIRING_FORM_ROUTES, (route) => {
    if (route.params === undefined || !("routeFor" in route.params)) return route;
    const { routeFor: _routeFor, ...params } = route.params as { readonly routeFor?: unknown };
    return { ...route, params };
  }) satisfies PartialState<NavigationState> | undefined;
}

/**
 * `connections/new?pairingUrl=…&autoConnect=1` (or `settings/environment-new?…`) pairs from the
 * link itself, so a remount of the form never pairs twice. Production builds ignore the flag so
 * a link can never pair with an attacker-chosen host.
 */
export function startDevAutoConnect(
  state: PartialState<NavigationState> | undefined,
): PartialState<NavigationState> | undefined;
export function startDevAutoConnect(state: PartialState<NavigationState> | undefined) {
  if (!__DEV__) return state satisfies PartialState<NavigationState> | undefined;
  const route = findLinkedRoute(state, PAIRING_FORM_ROUTES);
  if (route === undefined) return state satisfies PartialState<NavigationState> | undefined;
  const params = (route.params ?? {}) as {
    readonly autoConnect?: unknown;
    readonly pairingUrl?: unknown;
  };
  const pairingUrl = typeof params.pairingUrl === "string" ? params.pairingUrl.trim() : "";
  if (isAutoConnectFlag(params.autoConnect) && pairingUrl.length > 0) {
    void connect(pairingUrl);
  } else {
    appAtomRegistry.set(devAutoConnectAttemptAtom, null);
  }
  return state satisfies PartialState<NavigationState> | undefined;
}

/**
 * A pairing link that lands on an open pairing form fills that form. React Navigation would push
 * `ConnectionsNew` over Settings' `SettingsEnvironmentNew`, stacking two copies of the same form.
 * The form reseeds its fields from the new pairing URL.
 */
export function pairingFormLinkAction(
  link: PartialState<NavigationState>,
  current: NavigationState | undefined,
) {
  const linked = findLinkedRoute(link, PAIRING_FORM_ROUTES);
  if (!linked || !current) return undefined;
  let navigator = current;
  let open = navigator.routes[navigator.index];
  while (open?.state?.key !== undefined && open.state.index !== undefined) {
    navigator = open.state as NavigationState;
    open = navigator.routes[navigator.index];
  }
  if (!open || !PAIRING_FORM_ROUTES.includes(open.name)) return undefined;
  return {
    ...CommonActions.replaceParams(linked.params ?? {}),
    source: open.key,
    target: navigator.key,
  };
}
