import { getReactI18nCache, GTProvider } from "gt-react-native";
import { act, createContext, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import de from "../../i18n/translations/de.json";

const { Children } = vi.hoisted(() => ({
  Children: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("react-native", () => ({ View: Children, Platform: { OS: "ios" } }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@react-navigation/native", () => ({ useNavigationState: () => null }));
vi.mock("../../components/ui/Pane", () => ({ usePaneRole: () => "main" }));
vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: Children }));
vi.mock("../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
vi.mock("../../native/native-layout-metrics", () => ({ useNativeColumnLayoutMetrics: () => null }));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useSavedRemoteConnections: () => ({ savedConnectionsById: {} }),
}));
vi.mock("../layout/adaptive-workspace-context", () => ({
  useAdaptiveWorkspaceLayout: () => ({ layout: { usesSplitView: false } }),
}));
vi.mock("../layout/workspace/navigation-tab-order", () => ({
  navigationCustomizationAvailable: () => true,
  overflowNavigationTabs: () => [],
}));
vi.mock("../layout/workspace/navigation-tabs", () => ({
  NAVIGATION_TAB_ICONS: {},
  WORKSPACE_TAB_LABELS: {},
  useNavigationTabOrder: () => [],
  useHiddenNavigationTabs: () => [],
}));
vi.mock("../layout/workspace/workspace-selection-store", () => ({
  currentWorkspaceSelections: () => ({}),
}));
vi.mock("../layout/workspace/workspace-tab-navigation", () => ({
  rememberedSettingsPage: () => null,
}));
vi.mock("../layout/workspace/useSelectWorkspaceTab", () => ({
  useSelectWorkspaceTab: () => () => {},
}));
vi.mock("../layout/workspace/WorkspaceTabsContext", () => ({ useWorkspaceTabs: () => null }));
vi.mock("./components/SettingsRow", () => ({
  SettingsRow: ({ label }: { label: string }) => <li>{label}</li>,
}));
vi.mock("./components/SettingsSection", () => ({
  SettingsSection: Children,
  SettingsSidebarContext: createContext(null),
}));
vi.mock("./components/SettingsScreen", () => ({ SettingsScreen: Children }));
vi.mock("./components/SettingsEnvironmentFilterHeader", () => ({
  useSettingsEnvironmentMenu: () => null,
}));
vi.mock("./settings-environment-filter", () => ({
  useSettingsEnvironmentFilter: () => ({
    selectedTargets: [],
    projectGroups: [],
    selectedProjectKey: null,
  }),
}));

import { WorkspaceSettingsList } from "./SettingsRouteScreen";

it("lists its pages in the language the shipped catalog translates them to", async () => {
  getReactI18nCache().updateTranslations({
    de: Object.fromEntries(
      Object.entries(de).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <GTProvider locale="de">
        <WorkspaceSettingsList />
      </GTProvider>,
    ),
  );
  expect(Array.from(container.querySelectorAll("li"), (row) => row.textContent)).toEqual([
    "Umgebungen",
    "Allgemein",
    "Darstellung",
    "Chat",
    "Tableiste",
    "Tastatur",
    "Anbieter",
    "Threads",
    "Geplante Aufgaben",
    "Projekte",
    "Versionskontrolle & Issues",
    "Worktrees",
    "Sprachtranskription",
    "Wartung",
    "Info",
    "Archiv",
  ]);
  await act(async () => root.unmount());
});
