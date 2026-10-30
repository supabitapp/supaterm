import type {
  NavigationState,
  ParamListBase,
  StackNavigationState,
} from "@react-navigation/native";

type Route = StackNavigationState<ParamListBase>["routes"][number];

export function projectStackPresentation(
  state: StackNavigationState<ParamListBase>,
  isOverlay: (route: Route) => boolean,
) {
  const firstOverlay = state.routes.findIndex(isOverlay);
  return {
    workspace: state.routes.slice(0, firstOverlay < 0 ? undefined : firstOverlay),
    overlays: firstOverlay < 0 ? [] : state.routes.slice(firstOverlay),
  };
}

export function projectWorkspaceStack(
  state: StackNavigationState<ParamListBase>,
  isOverlay: (route: Route) => boolean,
) {
  const { workspace: workspaceRoutes, overlays } = projectStackPresentation(state, isOverlay);
  const primary = workspaceRoutes.find((route) => route.name === "Home");

  const detail = workspaceRoutes.filter(
    (route) => route.name !== "Home" && route.name !== "Settings",
  );
  return { primary, detail, overlays };
}

export function nativeWorkspacePopCount(
  state: Pick<NavigationState, "index" | "routes">,
  dismissedKey: string,
): number {
  const index = state.routes.findIndex((route) => route.key === dismissedKey);
  return index <= 0 || index > state.index ? 0 : state.index - index + 1;
}

export function nativeWorkspacePopAction(
  state: Pick<NavigationState, "key" | "index" | "routes">,
  dismissedKey: string,
) {
  const count = nativeWorkspacePopCount(state, dismissedKey);
  return count
    ? {
        type: "POP" as const,
        payload: { count },
        source: state.routes[state.index]!.key,
        target: state.key,
      }
    : null;
}

export function nativeStackPopAction(
  state: Pick<NavigationState, "key" | "index" | "routes">,
  dismissedKey: string,
  destinationKey?: string,
) {
  const sourceIndex = state.routes.findIndex((route) => route.key === dismissedKey);
  let destinationIndex =
    destinationKey === undefined
      ? sourceIndex - 1
      : state.routes.findIndex((route) => route.key === destinationKey);

  if (destinationIndex >= 0 && state.routes[destinationIndex + 1]?.name === "Settings")
    destinationIndex += 1;
  if (
    sourceIndex <= 0 ||
    sourceIndex > state.index ||
    destinationIndex < 0 ||
    destinationIndex >= sourceIndex
  ) {
    return null;
  }
  return {
    type: "POP" as const,
    payload: { count: sourceIndex - destinationIndex },
    source: dismissedKey,
    target: state.key,
  };
}

export interface CollapsedSplitColumn {
  readonly visible: "primary" | "secondary";
  readonly leaving: string | null;
}

export function collapsedSplitTransition(
  column: CollapsedSplitColumn,
  event: { readonly type: "willAppear" | "didAppear" | "willDisappear"; readonly key: string },
  state: Pick<NavigationState, "key" | "index" | "routes">,
  primaryKey: string,
): {
  readonly column: CollapsedSplitColumn;
  readonly pop: ReturnType<typeof nativeStackPopAction>;
} {
  switch (event.type) {
    case "willDisappear":
      return {
        column:
          state.index > 0 && state.routes[state.index]?.key === event.key
            ? { ...column, leaving: event.key }
            : column,
        pop: null,
      };
    case "willAppear":
      return {
        column: column.leaving === event.key ? { ...column, leaving: null } : column,
        pop: null,
      };
    case "didAppear":
      return {
        column: { visible: event.key === primaryKey ? "primary" : "secondary", leaving: null },
        pop:
          event.key === primaryKey && column.leaving
            ? nativeStackPopAction(state, column.leaving, primaryKey)
            : null,
      };
  }
}

export function partitionStackPresentations<T>(
  routes: readonly T[],
  isModal: (route: T) => boolean,
): T[][] {
  const groups: T[][] = [];
  for (const route of routes) {
    if (groups.length === 0 || isModal(route)) groups.push([]);
    groups.at(-1)!.push(route);
  }
  return groups;
}

export function reconcileStackScreens<T extends { readonly key: string }>(
  previous: readonly T[],
  current: readonly T[],
  completedNativeDismissals: ReadonlySet<string> = new Set(),
): T[] {
  const active = new Set(current.map((route) => route.key));
  const screens = [...current];
  previous.forEach((route, index) => {
    if (!active.has(route.key) && !completedNativeDismissals.has(route.key)) {
      screens.splice(Math.min(index, screens.length), 0, route);
    }
  });
  return screens;
}
