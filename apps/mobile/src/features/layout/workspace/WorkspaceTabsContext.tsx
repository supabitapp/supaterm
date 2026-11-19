import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, use, useState, type Dispatch, type ReactNode } from "react";

import { mobilePreferencesAtom } from "../../../state/preferences";
import {
  navigationCustomizationAvailable,
  resolveHiddenNavigationTabs,
  resolveSelectedNavigationTab,
} from "./navigation-tab-order";
import {
  initialWorkspaceTabsState,
  resolveWorkspaceTabOrder,
  workspaceTabsReducer,
  type WorkspaceSearchTab,
  type WorkspaceTab,
  type WorkspaceTabsAction,
  type WorkspaceTabsState,
} from "./workspace-tabs-state";

export interface WorkspaceScrollAnchor {
  readonly key: string;
  readonly viewOffset: number;
}

export const WorkspaceTabsContext = createContext<{
  readonly state: WorkspaceTabsState;
  readonly dispatch: Dispatch<WorkspaceTabsAction>;
  readonly isTabActive: (tab: WorkspaceTab) => boolean;
  readonly bottomClearance: number;
  readonly settingsOpen: boolean;
  readonly getScrollOffset: (tab: WorkspaceSearchTab) => number;
  readonly recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => void;
  readonly getScrollAnchor: (tab: WorkspaceTab) => WorkspaceScrollAnchor | undefined;
  readonly recordScrollAnchor: (tab: WorkspaceTab, anchor: WorkspaceScrollAnchor) => void;
  /** Leaves search and returns the list to where it was when search began. */
  readonly cancelSearch: (tab: WorkspaceSearchTab) => void;
} | null>(null);

export function useWorkspaceTabs() {
  return use(WorkspaceTabsContext);
}

type MobilePreferencesResult = Atom.Type<typeof mobilePreferencesAtom>;

function resolveWorkspaceTabsSelection(
  state: WorkspaceTabsState,
  preferences: MobilePreferencesResult,
): WorkspaceTabsState {
  const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
  const order = resolveWorkspaceTabOrder(saved?.navigationTabOrder);
  const hidden = navigationCustomizationAvailable()
    ? resolveHiddenNavigationTabs(saved?.hiddenNavigationTabs)
    : [];
  const selected = resolveSelectedNavigationTab(order, hidden, state.selectedTab);
  return selected && selected !== state.selectedTab
    ? workspaceTabsReducer(state, { type: "select", tab: selected })
    : state;
}

function createWorkspaceTabsModel(selectedTab?: WorkspaceTab) {
  const stored = Atom.make(initialWorkspaceTabsState(selectedTab));
  const scrollOffsets: Record<WorkspaceSearchTab, number> = {
    threads: 0,
    pullRequests: 0,
    usage: 0,
    settings: 0,
  };
  const scrollAnchors: Partial<Record<WorkspaceTab, WorkspaceScrollAnchor>> = {};
  return {
    stored,
    resolved: Atom.make((get) =>
      resolveWorkspaceTabsSelection(get(stored), get(mobilePreferencesAtom)),
    ),
    getScrollOffset: (tab: WorkspaceSearchTab) => scrollOffsets[tab],
    recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => {
      scrollOffsets[tab] = offset;
    },
    getScrollAnchor: (tab: WorkspaceTab) => scrollAnchors[tab],
    recordScrollAnchor: (tab: WorkspaceTab, anchor: WorkspaceScrollAnchor) => {
      scrollAnchors[tab] = anchor;
    },
  };
}

export function WorkspaceTabsProvider(props: {
  readonly children: ReactNode;
  readonly settingsOpen?: boolean;
  readonly initialTab?: WorkspaceTab;
}) {
  const registry = use(RegistryContext);
  const [model] = useState(() => createWorkspaceTabsModel(props.initialTab));
  const state = useAtomValue(model.resolved);
  const dispatch = (action: WorkspaceTabsAction) =>
    registry.set(model.stored, workspaceTabsReducer(registry.get(model.resolved), action));
  const context = {
    state,
    dispatch,
    isTabActive: (tab: WorkspaceTab) => registry.get(model.resolved).selectedTab === tab,
    bottomClearance: 0,
    settingsOpen: props.settingsOpen ?? false,
    getScrollOffset: model.getScrollOffset,
    recordScrollOffset: model.recordScrollOffset,
    getScrollAnchor: model.getScrollAnchor,
    recordScrollAnchor: model.recordScrollAnchor,
    cancelSearch: (tab: WorkspaceSearchTab) => {
      model.recordScrollOffset(tab, registry.get(model.resolved).tabs[tab].searchEntryOffset);
      dispatch({ type: "cancel", tab });
    },
  };
  return <WorkspaceTabsContext value={context}>{props.children}</WorkspaceTabsContext>;
}
