import type { NavigationState, PartialState } from "@react-navigation/native";

import {
  dispatchRootStackReset,
  resetRootStack,
  rootStackState,
  type RootStackNavigation,
} from "../../lib/root-stack-reset";

type RootParams = ReactNavigation.RootParamList;

const SETTINGS_MODAL_ROUTES = new Set(["SettingsLegal", "SettingsAuth", "SettingsWaitlist"]);

export type SettingsRouteName = Exclude<
  Extract<keyof RootParams, `Settings${string}`>,
  "SettingsLegal" | "SettingsAuth" | "SettingsWaitlist"
>;

export type SettingsPageName = Exclude<SettingsRouteName, "Settings">;

export function isSettingsRoute(name: string): boolean {
  return name.startsWith("Settings") && !SETTINGS_MODAL_ROUTES.has(name);
}

export function settingsOpenIn(workspaceRoutes: readonly { readonly name: string }[]): boolean {
  return (
    workspaceRoutes.some((route) => route.name === "Settings") &&
    isSettingsRoute(workspaceRoutes.at(-1)?.name ?? "")
  );
}

export function restoreSettingsLinkState(
  state: PartialState<NavigationState> | undefined,
  page: SettingsPageName | undefined,
) {
  if (!state) return state;
  const routes = [...state.routes];
  const list = routes.findIndex((route) => route.name === "Settings");
  const first = routes.findIndex((route) => isSettingsRoute(route.name));
  if (first < 0) return state;
  if (list < 0) routes.splice(first, 0, { name: "Settings" });
  const top = routes.at(-1);
  if (page && top?.name === "Settings") routes.push({ name: page });
  return routes.length === state.routes.length
    ? state
    : { ...state, index: routes.length - 1, routes };
}

type SettingsPageArgs<Name extends SettingsPageName> = undefined extends RootParams[Name]
  ? [params?: RootParams[Name]]
  : [params: RootParams[Name]];

type RouteLike = { readonly name: string; readonly key?: string; readonly params?: object };

export function settingsNavigationState<State extends { readonly routes: readonly RouteLike[] }>(
  state: State,
  page: SettingsPageName | undefined,
  params?: object,
  key?: string,
) {
  const home = state.routes.find((route) => route.name === "Home") ?? { name: "Home" };
  const list = state.routes.find((route) => route.name === "Settings") ?? { name: "Settings" };
  const current = page
    ? state.routes.find(
        (route) => route.name === page && JSON.stringify(route.params) === JSON.stringify(params),
      )
    : undefined;
  const routes = [
    home,
    list,
    ...(page ? [current ?? (key ? { key, name: page, params } : { name: page, params })] : []),
  ];
  return { ...state, index: routes.length - 1, routes };
}

export function openSettings<Name extends SettingsPageName>(
  navigation: RootStackNavigation,
  page: Name,
  ...[params]: SettingsPageArgs<Name>
) {
  resetRootStack(navigation, (state) => settingsNavigationState(state, page, params));
}

export function leaveSettingsPage(
  navigation: RootStackNavigation & { readonly goBack: () => void },
  columns: boolean,
  fallback: SettingsPageName,
) {
  const state = rootStackState(navigation);
  const below = state?.routes[state.index - 1];
  if (state && columns && below?.name === "Settings") {
    dispatchRootStackReset(navigation, state, settingsNavigationState(state, fallback));
  } else {
    navigation.goBack();
  }
}
