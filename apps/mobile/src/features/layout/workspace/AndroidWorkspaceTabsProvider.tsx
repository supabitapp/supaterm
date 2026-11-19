import type { NavigationState } from "@react-navigation/native";
import { createContext, use, type ReactNode } from "react";
import { Platform } from "react-native";
import { androidWorkspaceSettingsOpen } from "./android-workspace-tabs";
import { WorkspaceTabsProvider } from "./WorkspaceTabsContext";
import { workspaceTabOf } from "./workspace-tabs-state";

interface AndroidWorkspaceRoot {
  readonly key: string;
  readonly settingsOpen: boolean;
  readonly settingsRoute: NavigationState["routes"][number] | undefined;
  readonly settingsPage: string | null;
}

const AndroidWorkspaceRootContext = createContext<AndroidWorkspaceRoot | null>(null);

export function useAndroidWorkspaceRoot() {
  return use(AndroidWorkspaceRootContext);
}

/** Android keeps one tab controller above the root navigator and split sidebar. */
export function AndroidWorkspaceTabsProvider(props: {
  readonly state: NavigationState;
  readonly children: ReactNode;
}) {
  const key = props.state.key;
  const settingsOpen = Platform.OS === "android" && androidWorkspaceSettingsOpen(props.state);
  const settingsIndex = props.state.routes.findIndex((route) => route.name === "Settings");
  const settingsRoute = settingsIndex < 0 ? undefined : props.state.routes[settingsIndex];
  const settingsPage =
    settingsIndex < 0 ? null : (props.state.routes[settingsIndex + 1]?.name ?? null);
  const root = { key, settingsOpen, settingsRoute, settingsPage };
  return Platform.OS === "android" ? (
    <WorkspaceTabsProvider
      initialTab={workspaceTabOf(props.state.routes.find((route) => route.name !== "Home")?.name)}
    >
      <AndroidWorkspaceRootContext value={root}>{props.children}</AndroidWorkspaceRootContext>
    </WorkspaceTabsProvider>
  ) : (
    props.children
  );
}
