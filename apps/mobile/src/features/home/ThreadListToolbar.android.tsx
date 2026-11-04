import { useEffect, useState } from "react";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { BackHandler, Keyboard } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { WorkspaceBrandTitle } from "../workspace/WorkspaceBrandTitle";
import { workspaceFilterAppBarMenu } from "../workspace/workspace-filter-menu";
import { useWorkspaceState } from "../../state/workspace";
import type { ThreadListToolbarProps } from "./ThreadListToolbar.types";

export function ThreadListToolbar(props: ThreadListToolbarProps) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const isTabActive = workspace?.isTabActive;
  const homeFocused = useNavigationState((state) => state.routes[state.index]?.name === "Home");
  const listFocused =
    homeFocused && (workspace === null || workspace.state.selectedTab === "threads");
  const { state } = useWorkspaceState();
  const { onRequestVisibility, onSearchQueryChange } = props;
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = searchOpen || props.searchQuery.length > 0;
  const openSearch = () => {
    onRequestVisibility?.();
    setSearchOpen(true);
    return true;
  };
  useHardwareKeyboardCommand("focusSearch", openSearch);

  const closeSearch = () => {
    onSearchQueryChange("");
    setSearchOpen(false);
    Keyboard.dismiss();
  };

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to BackHandler while searching to close search on Android back
  useEffect(() => {
    if (!searching || !listFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Frozen Home screens can keep effects alive after a detail route opens.
      const state = navigation.getState();
      if (
        !state ||
        state.routes[state.index]?.name !== "Home" ||
        isTabActive?.("threads") === false
      )
        return false;
      if (Keyboard.isVisible()) Keyboard.dismiss();
      else closeSearch();
      return true;
    });
    return () => subscription.remove();
  }, [closeSearch, searching, listFocused, navigation, isTabActive]);

  return (
    <AppBar
      title="Supaterm"
      titleContent={
        <WorkspaceBrandTitle
          accessibilityLabel="Supaterm, Threads"
          onOpenEnvironments={props.onOpenEnvironments}
        />
      }
      sidebar={false}
      search={{
        value: props.searchQuery,
        onChangeText: onSearchQueryChange,
        placeholder: "Search",
        accessibilityLabel: "Search threads",
        active: searching,
        onOpen: openSearch,
        onClose: closeSearch,
      }}
      menus={state.hasConnections ? [workspaceFilterAppBarMenu(props.filterMenu)] : undefined}
    />
  );
}
