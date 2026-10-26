import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { useWorkspaceListNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import {
  BackHandler,
  Keyboard,
  type TextInputInstance,
  View,
  type LayoutChangeEvent,
} from "react-native";
import type { MenuAction } from "@react-native-menu/menu";

import { Menu } from "../../components/ui/Menu";
import { SearchField } from "../../components/ui/SearchField";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { useWorkspaceState } from "../../state/workspace";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { WorkspaceFilterButton } from "../workspace/WorkspaceFilterButton";
import { WorkspaceListToolbarRow } from "../workspace/WorkspaceListToolbarRow";

/** One toolbar height for the compact list and expanded sidebar, including search. */
export function ThreadListToolbar(props: {
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly filterActions: MenuAction[];
  readonly filterCustomized: boolean;
  readonly onFilterAction: NonNullable<ComponentProps<typeof Menu>["onPressAction"]>;
  readonly onOpenSettings: () => void;
  readonly onOpenEnvironments: () => void;
  readonly sidebar?: boolean;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly onRequestVisibility?: () => void;
}) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const isTabActive = workspace?.isTabActive;
  const homeFocused = useNavigationState((state) => state.routes[state.index]?.name === "Home");
  const listFocused =
    homeFocused && (workspace === null || workspace.state.selectedTab === "threads");
  const { paddingTop, paddingBottom } = useToolbarLayout();
  const { state } = useWorkspaceState();
  const { onRequestVisibility, onSearchQueryChange } = props;
  const showPullRequests = useWorkspaceListNavigation("pullRequests");
  const searchRef = useRef<TextInputInstance>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = searchOpen || props.searchQuery.length > 0;
  const openSearch = useCallback(() => {
    onRequestVisibility?.();
    setSearchOpen(true);
    searchRef.current?.focus();
    return true;
  }, [onRequestVisibility]);
  useHardwareKeyboardCommand("focusSearch", openSearch);

  const closeSearch = useCallback(() => {
    onSearchQueryChange("");
    setSearchOpen(false);
    Keyboard.dismiss();
  }, [onSearchQueryChange]);

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

  const searchField = (
    <SearchField
      inputRef={searchRef}
      accessibilityLabel="Search threads"
      clearAccessibilityLabel="Clear search"
      placeholder="Search"
      value={props.searchQuery}
      onChangeText={onSearchQueryChange}
    />
  );

  return (
    <View
      onLayout={props.onLayout}
      className={props.sidebar ? "absolute inset-x-0 top-0 z-[4] bg-header px-2" : "bg-header px-2"}
      style={{ paddingTop, paddingBottom }}
    >
      <WorkspaceListToolbarRow
        searching={searching}
        searchField={searchField}
        onCloseSearch={closeSearch}
        onOpenEnvironments={props.onOpenEnvironments}
        actions={[
          ...(props.sidebar && workspace
            ? [
                {
                  accessibilityLabel: "Show pull requests",
                  icon: PullRequestGlyph.pullRequest,
                  onPress: showPullRequests,
                },
              ]
            : []),
          { accessibilityLabel: "Search threads", icon: "magnifyingglass", onPress: openSearch },
          { accessibilityLabel: "Open settings", icon: "gearshape", onPress: props.onOpenSettings },
        ]}
        filter={
          state.hasConnections ? (
            <WorkspaceFilterButton
              accessibilityLabel="Filter threads"
              actions={props.filterActions}
              customized={props.filterCustomized}
              onPressAction={props.onFilterAction}
            />
          ) : null
        }
      />
    </View>
  );
}
