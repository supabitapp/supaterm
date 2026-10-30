import { useNavigation } from "@react-navigation/native";
import { useEffect, useRef } from "react";
import { BackHandler, Keyboard, View, type TextInputInstance } from "react-native";
import { SearchField } from "../../components/ui/SearchField";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { useWorkspaceListNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { WorkspaceFilterButton } from "../workspace/WorkspaceFilterButton";
import { WorkspaceListToolbarRow } from "../workspace/WorkspaceListToolbarRow";
import type { PullRequestFilterMenu } from "./PullRequestListFilters";
import { openSettings } from "../settings/settings-navigation";

export function PullRequestToolbar(props: {
  readonly sidebar?: boolean;
  readonly filters: PullRequestFilterMenu | null;
  readonly onRequestVisibility?: () => void;
}) {
  const navigation = useNavigation();
  const { filters } = props;
  const workspace = useWorkspaceTabs()!;
  const { paddingTop, paddingBottom } = useToolbarLayout();
  const { dispatch, getScrollOffset, recordScrollOffset, isTabActive } = workspace;
  const { onRequestVisibility } = props;
  const showThreads = useWorkspaceListNavigation("threads");
  const tab = workspace.state.tabs.pullRequests;
  const input = useRef<TextInputInstance>(null);
  const searching = tab.searchMode !== "resting";
  const openSearch = () => {
    onRequestVisibility?.();
    dispatch({
      type: "scroll",
      tab: "pullRequests",
      offset: getScrollOffset("pullRequests"),
    });
    dispatch({ type: "search", tab: "pullRequests" });
    input.current?.focus();
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
    <View className="bg-header px-2" style={{ paddingTop, paddingBottom }}>
      <WorkspaceListToolbarRow
        searching={searching}
        searchField={
          <SearchField
            inputRef={input}
            accessibilityLabel="Search pull requests"
            clearAccessibilityLabel="Clear search"
            placeholder="Search pull requests"
            value={tab.query}
            onChangeText={(query) => dispatch({ type: "query", tab: "pullRequests", query })}
          />
        }
        onCloseSearch={closeSearch}
        titleAccessibilityLabel="Supaterm, Pull requests"
        onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
        actions={[
          ...(props.sidebar
            ? [
                {
                  accessibilityLabel: "Show threads",
                  icon: "text.bubble",
                  onPress: showThreads,
                } as const,
              ]
            : []),
          {
            accessibilityLabel: "Search pull requests",
            icon: "magnifyingglass",
            onPress: openSearch,
          },
          {
            accessibilityLabel: "Open settings",
            icon: "gearshape",
            onPress: () => openSettings(navigation, "Settings"),
          },
        ]}
        filter={
          filters ? (
            <WorkspaceFilterButton
              title="Filter pull requests"
              accessibilityLabel="Filter pull requests"
              actions={filters.actions}
              customized={filters.customized}
              onPressAction={({ nativeEvent }) => filters.onSelect(nativeEvent.event)}
            />
          ) : null
        }
      />
    </View>
  );
}
