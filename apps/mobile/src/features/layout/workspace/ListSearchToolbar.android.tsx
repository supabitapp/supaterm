import { useNavigation } from "@react-navigation/native";
import { useEffect } from "react";
import { BackHandler, Keyboard } from "react-native";
import { AppBar } from "../../../components/ui/AppBar";
import { useHardwareKeyboardCommand } from "../../keyboard/hardwareKeyboardCommands";
import { WorkspaceConnectionTitle } from "../../home/WorkspaceConnectionTitle";
import type { SharedSlotTab } from "./navigation-tab-order";
import { SharedSlotTitle } from "./SharedSlotTitle";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { type WorkspaceFilterMenu, workspaceFilterAppBarMenu } from "./workspace-filter-menu";
import { openSettings } from "../../settings/settings-navigation";
import { useGT } from "gt-react-native";

/** Pull request and issue search share the thread list's Android header. */
export function ListSearchToolbar(props: {
  readonly tab: SharedSlotTab;
  readonly filters?: WorkspaceFilterMenu | null;
  readonly onRequestVisibility?: () => void;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const { filters, tab: section } = props;
  const workspace = useWorkspaceTabs()!;
  const { dispatch, getScrollOffset, recordScrollOffset, isTabActive } = workspace;
  const { onRequestVisibility } = props;
  const tab = workspace.state.tabs[section];
  const searching = tab.searchMode !== "resting";
  const openSearch = () => {
    onRequestVisibility?.();
    dispatch({
      type: "scroll",
      tab: section,
      offset: getScrollOffset(section),
    });
    dispatch({ type: "search", tab: section });
    return true;
  };
  useHardwareKeyboardCommand("focusSearch", openSearch);
  const closeSearch = () => {
    Keyboard.dismiss();
    recordScrollOffset(section, tab.searchEntryOffset);
    dispatch({ type: "cancel", tab: section });
  };
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to BackHandler while searching to close the list search on Android back
  useEffect(() => {
    if (!searching) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Frozen Home screens stay mounted under a detail route or another tab,
      // so back only applies while this list is in front.
      const state = navigation.getState();
      if (!state || state.routes[state.index]?.name !== "Home" || !isTabActive(section))
        return false;
      if (Keyboard.isVisible()) Keyboard.dismiss();
      else closeSearch();
      return true;
    });
    return () => subscription.remove();
  }, [searching, closeSearch, navigation, isTabActive, section]);
  return (
    <AppBar
      title="Supaterm"
      titleContent={
        <WorkspaceConnectionTitle
          grow
          onPress={() => openSettings(navigation, "SettingsEnvironments")}
          brand={<SharedSlotTitle tab={section} />}
        />
      }
      search={{
        value: tab.query,
        onChangeText: (query) => dispatch({ type: "query", tab: section, query }),
        placeholder: section === "issues" ? gt("Search issues") : gt("Search pull requests"),
        active: searching,
        onOpen: openSearch,
        onClose: closeSearch,
      }}
      menus={filters ? [workspaceFilterAppBarMenu(filters)] : undefined}
    />
  );
}
