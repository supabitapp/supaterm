import {
  createNavigationContainerRef,
  type NavigationAction,
  type NavigationContainerRef,
} from "@react-navigation/native";

export const rootNavigationRef = createNavigationContainerRef<ReactNavigation.RootParamList>();

export function attachRootNavigation(
  navigation: NavigationContainerRef<ReactNavigation.RootParamList> | null,
): () => void {
  rootNavigationRef.current = navigation;
  return () => {
    if (rootNavigationRef.current === navigation) rootNavigationRef.current = null;
  };
}

const pendingUntilReady: Array<() => void> = [];

export function whenRootNavigationReady(navigate: () => void): void {
  if (rootNavigationRef.isReady()) {
    navigate();
    return;
  }
  pendingUntilReady.push(navigate);
}

export function flushRootNavigationQueue(): void {
  for (const navigate of pendingUntilReady.splice(0)) {
    try {
      navigate();
    } catch (error) {
      console.error("[navigation] queued navigation failed", error);
    }
  }
}

export function linkToRootPath(href: string, toAction: (href: string) => NavigationAction): void {
  if (!href.startsWith("/")) throw new Error(`The href must start with '/' (${href}).`);
  whenRootNavigationReady(() => {
    rootNavigationRef.dispatch({
      target: rootNavigationRef.getRootState()?.key,
      ...toAction(href),
    });
  });
}
