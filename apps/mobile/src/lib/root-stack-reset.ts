import type { CommonActions, NavigationState } from "@react-navigation/native";

export type RootStackResetAction = ReturnType<typeof CommonActions.reset> & {
  readonly target: string;
};

export interface RootStackNavigation {
  readonly dispatch: (action: RootStackResetAction) => void;
  readonly getParent: () => RootStackNavigation | undefined;
  readonly getState: () => NavigationState | undefined;

  readonly getRootState?: () => NavigationState | undefined;
}

export function rootStackState(navigation: RootStackNavigation) {
  let root = navigation;
  for (let parent = root.getParent(); parent; parent = root.getParent()) root = parent;
  return root.getRootState?.() ?? root.getState();
}

export function dispatchRootStackReset(
  navigation: RootStackNavigation,
  state: NavigationState,
  payload: RootStackResetAction["payload"],
) {
  navigation.dispatch({ type: "RESET", payload, target: state.key });
}

export function resetRootStack(
  navigation: RootStackNavigation,
  nextState: (state: NavigationState) => RootStackResetAction["payload"],
) {
  const state = rootStackState(navigation);
  if (state) dispatchRootStackReset(navigation, state, nextState(state));
}
