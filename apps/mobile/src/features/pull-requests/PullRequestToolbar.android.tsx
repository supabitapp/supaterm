import { useNavigation } from "@react-navigation/native";
import { useEffect } from "react";
import { BackHandler, Keyboard } from "react-native";
import { AppBar } from "../../components/ui/AppBar";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { WorkspaceBrandTitle } from "../workspace/WorkspaceBrandTitle";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import {
  type WorkspaceFilterMenu,
  workspaceFilterAppBarMenu,
} from "../workspace/workspace-filter-menu";
import { openSettings } from "../settings/settings-navigation";

/** PR search shares the thread list's Android header. */
export function PullRequestToolbar(props: {
  readonly filters: WorkspaceFilterMenu | null;
  readonly onRequestVisibility?: () => void;
}) {
  const navigation = useNavigation();
  const { filters } = props;
  const workspace = useWorkspaceTabs()!;
  const { dispatch, getScrollOffset, recordScrollOffset, isTabActive } = workspace;
  const { onRequestVisibility } = props;
  const tab = workspace.state.tabs.pullRequests;
  const searching = tab.searchMode !== "resting";
  const openSearch = () => {
    onRequestVisibility?.();
    dispatch({
      type: "scroll",
      tab: "pullRequests",
      offset: getScrollOffset("pullRequests"),
    });
    dispatch({ type: "search", tab: "pullRequests" });
    return true;
  };
  useHardwareKeyboardCommand("focusSearch", openSearch);
  const closeSearch = () => {
    Keyboard.dismiss();
    recordScrollOffset("pullRequests", tab.searchEntryOffset);
    dispatch({ type: "cancel", tab: "pullRequests" });
  };
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to BackHandler while searching to close the PR search on Android back
  useEffect(() => {
    if (!searching) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Frozen Home screens stay mounted under a detail route or another tab,
      // so back only applies while the PR list is in front.
      const state = navigation.getState();
      if (!state || state.routes[state.index]?.name !== "Home" || !isTabActive("pullRequests"))
        return false;
      if (Keyboard.isVisible()) Keyboard.dismiss();
      else closeSearch();
      return true;
    });
    return () => subscription.remove();
  }, [searching, closeSearch, navigation, isTabActive]);
  return (
    <AppBar
      title="Supaterm"
      titleContent={
        <WorkspaceBrandTitle
          accessibilityLabel="Supaterm, Pull requests"
          onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
        />
      }
      search={{
        value: tab.query,
        onChangeText: (query) => dispatch({ type: "query", tab: "pullRequests", query }),
        placeholder: "Search pull requests",
        active: searching,
        onOpen: openSearch,
        onClose: closeSearch,
      }}
      menus={filters ? [workspaceFilterAppBarMenu(filters)] : undefined}
    />
  );
}
