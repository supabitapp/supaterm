import type { NavigationState, PartialState } from "@react-navigation/native";

export function shouldHandleAppLink(url: string): boolean {
  return (
    !url.includes("expo-development-client") &&
    !url.includes("://expo-sharing") &&
    !/^supaterm(-dev|-preview)?:\/*$/.test(url)
  );
}

export function restoreDraftLinkState(
  state: PartialState<NavigationState> | undefined,
  path: string,
) {
  const pathname = path.split("?")[0]?.replace(/^\/+|\/+$/g, "");
  if (!state || !pathname || !/^new\/draft(?:\/|$)/.test(pathname)) return state;
  const target = state.routes.at(-1);
  if (!target) return state;
  const draft = target.params ?? {};
  const routes = state.routes.slice(0, -1);
  routes.push({ name: "Thread", params: { draft } });
  if (pathname !== "new/draft") routes.push(target);
  return { ...state, index: routes.length - 1, routes };
}

type LinkState = PartialState<NavigationState>;
type LinkRoute = LinkState["routes"][number];

function isLinkState(value: unknown): value is LinkState {
  return typeof value === "object" && value !== null && Array.isArray((value as LinkState).routes);
}

export function findLinkedRoute(
  state: LinkState | undefined,
  names: ReadonlyArray<string>,
): LinkRoute | undefined {
  for (const route of state?.routes ?? []) {
    if (names.includes(route.name)) return route;
    const nested = isLinkState(route.state) ? findLinkedRoute(route.state, names) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

export function findStackRoute(
  state: NavigationState | undefined,
  name: string,
  accept?: (params: Readonly<Record<string, unknown>> | undefined) => boolean,
):
  | { readonly navigatorKey: string; readonly routeKey: string; readonly focused: boolean }
  | undefined {
  if (!state) return undefined;
  for (let index = state.routes.length - 1; index >= 0; index -= 1) {
    const route = state.routes[index]!;
    if (
      route.name === name &&
      (accept === undefined ||
        accept(route.params as Readonly<Record<string, unknown>> | undefined))
    ) {
      return { navigatorKey: state.key, routeKey: route.key, focused: index === state.index };
    }
    const nested = route.state;

    if (typeof nested?.key === "string") {
      const found = findStackRoute(nested as NavigationState, name, accept);
      if (found) return found;
    }
  }
  return undefined;
}

export function updateLinkedRoute(
  state: LinkState | undefined,
  names: ReadonlyArray<string>,
  update: (route: LinkRoute) => LinkRoute,
): LinkState | undefined {
  if (!state) return state;
  for (const [index, route] of state.routes.entries()) {
    let next: LinkRoute | undefined;
    if (names.includes(route.name)) next = update(route);
    else if (isLinkState(route.state)) {
      const nested = updateLinkedRoute(route.state, names, update);
      if (nested !== route.state) next = { ...route, state: nested };
    }
    if (next) {
      const routes = state.routes.slice();
      routes[index] = next;
      return { ...state, routes };
    }
  }
  return state;
}
