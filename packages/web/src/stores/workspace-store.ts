import { create } from "zustand";
import type {
  WorkspaceItemState,
  TabState,
  PaneState,
  PaneDirection,
  ServerMessage,
  SplitTree,
} from "@supaterm/shared";
import { useConnectionStore } from "./connection-store.js";

const titleThrottleMap = new Map<string, number>();

function buildPtyWsUrl(paneId: string): string {
  const serverBase = typeof __SERVER_URL__ === "string" && __SERVER_URL__
    ? __SERVER_URL__.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  const token = useConnectionStore.getState().token;
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${serverBase}/pty/${paneId}${tokenParam}`;
}

interface WorkspaceStore {
  workspaces: WorkspaceItemState[];
  selectedWorkspaceId: string | null;
  tabs: TabState[];
  selectedTabId: string | null;
  trees: Record<string, SplitTree<string>>;
  focusedPaneByTab: Record<string, string>;
  panes: Record<string, PaneState>;
  ptyUrls: Record<string, string>;

  createTab: () => void;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  createPane: (direction: PaneDirection) => void;
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  handleServerMessage: (msg: ServerMessage) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  selectedWorkspaceId: null,
  tabs: [],
  selectedTabId: null,
  trees: {},
  focusedPaneByTab: {},
  panes: {},
  ptyUrls: {},

  createTab() {
    useConnectionStore.getState().send({ type: "create_tab" });
  },

  closeTab(tabId: string) {
    useConnectionStore.getState().send({ type: "close_tab", tabId });
  },

  selectTab(tabId: string) {
    useConnectionStore.getState().send({ type: "select_tab", tabId });
  },

  createPane(direction: PaneDirection) {
    const { selectedTabId } = get();
    if (!selectedTabId) return;
    useConnectionStore.getState().send({
      type: "create_pane",
      tabId: selectedTabId,
      direction,
    });
  },

  closePane(paneId: string) {
    useConnectionStore.getState().send({ type: "close_pane", paneId });
  },

  focusPane(paneId: string) {
    useConnectionStore.getState().send({ type: "focus_pane", paneId });
  },

  handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "sync": {
        const ptyUrls: Record<string, string> = {};
        for (const paneId of Object.keys(msg.state.panes)) {
          ptyUrls[paneId] = buildPtyWsUrl(paneId);
        }
        set({
          workspaces: msg.state.workspaces,
          selectedWorkspaceId: msg.state.selectedWorkspaceId,
          tabs: msg.state.tabs,
          selectedTabId: msg.state.selectedTabId,
          trees: msg.state.trees,
          focusedPaneByTab: msg.state.focusedPaneByTab,
          panes: msg.state.panes,
          ptyUrls,
        });
        break;
      }

      case "tab_created":
        set((s) => ({
          tabs: s.tabs.some((t) => t.id === msg.tab.id)
            ? s.tabs
            : [...s.tabs, msg.tab],
        }));
        break;

      case "tab_closed":
        titleThrottleMap.delete(`tab:${msg.tabId}`);
        set((s) => {
          const { [msg.tabId]: _tree, ...remainingTrees } = s.trees;
          const { [msg.tabId]: _focus, ...remainingFocus } =
            s.focusedPaneByTab;
          return {
            tabs: s.tabs.filter((t) => t.id !== msg.tabId),
            trees: remainingTrees,
            focusedPaneByTab: remainingFocus,
            selectedTabId:
              s.selectedTabId === msg.tabId
                ? msg.nextTabId ?? null
                : s.selectedTabId,
          };
        });
        break;

      case "tab_selected":
        set({ selectedTabId: msg.tabId });
        break;

      case "tab_updated": {
        if (msg.patch.title && Object.keys(msg.patch).length === 1) {
          const now = Date.now();
          const last = titleThrottleMap.get(`tab:${msg.tabId}`) ?? 0;
          if (now - last < 200) break;
          titleThrottleMap.set(`tab:${msg.tabId}`, now);
        }
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === msg.tabId ? { ...t, ...msg.patch } : t,
          ),
        }));
        break;
      }

      case "pane_created":
        set((s) => ({
          panes: { ...s.panes, [msg.paneId]: msg.pane },
          ptyUrls: { ...s.ptyUrls, [msg.paneId]: buildPtyWsUrl(msg.paneId) },
        }));
        break;

      case "pane_closed":
        titleThrottleMap.delete(msg.paneId);
        set((s) => {
          const { [msg.paneId]: _, ...remainingPanes } = s.panes;
          const { [msg.paneId]: __, ...remainingUrls } = s.ptyUrls;
          return {
            panes: remainingPanes,
            ptyUrls: remainingUrls,
          };
        });
        break;

      case "pane_title_changed": {
        if (!get().panes[msg.paneId]) break;
        const now = Date.now();
        const lastTitle = titleThrottleMap.get(msg.paneId) ?? 0;
        if (now - lastTitle < 200) break;
        titleThrottleMap.set(msg.paneId, now);
        set((s) => {
          const existing = s.panes[msg.paneId];
          if (!existing) return s; // Pane already removed, no-op
          return {
            panes: {
              ...s.panes,
              [msg.paneId]: { ...existing, title: msg.title },
            },
          };
        });
        break;
      }

      case "pane_resized":
        set((s) => {
          const existing = s.panes[msg.paneId];
          if (!existing) return s;
          if (existing.cols === msg.cols && existing.rows === msg.rows) return s;
          return {
            panes: {
              ...s.panes,
              [msg.paneId]: { ...existing, cols: msg.cols, rows: msg.rows },
            },
          };
        });
        break;

      case "split_tree_updated":
        set((s) => {
          if (s.trees[msg.tabId] === msg.tree) return s;
          return { trees: { ...s.trees, [msg.tabId]: msg.tree } };
        });
        break;

      case "focus_changed":
        set((s) => {
          if (s.focusedPaneByTab[msg.tabId] === msg.paneId) return s;
          return {
            focusedPaneByTab: { ...s.focusedPaneByTab, [msg.tabId]: msg.paneId },
          };
        });
        break;

      case "workspace_created":
        set((s) => ({
          workspaces: s.workspaces.some((w) => w.id === msg.workspace.id)
            ? s.workspaces
            : [...s.workspaces, msg.workspace],
        }));
        break;

      case "workspace_deleted":
        set((s) => {
          const deletedTabIds = new Set(
            s.tabs.filter((t) => t.workspaceId === msg.workspaceId).map((t) => t.id),
          );
          const remainingPanes: Record<string, PaneState> = {};
          const remainingUrls: Record<string, string> = {};
          for (const [id, pane] of Object.entries(s.panes)) {
            if (pane && !deletedTabIds.has(pane.tabId)) {
              remainingPanes[id] = pane;
              if (s.ptyUrls[id]) remainingUrls[id] = s.ptyUrls[id]!;
            }
          }
          const remainingTrees: Record<string, typeof s.trees[string]> = {};
          const remainingFocus: Record<string, string> = {};
          for (const [tabId, tree] of Object.entries(s.trees)) {
            if (!deletedTabIds.has(tabId)) {
              remainingTrees[tabId] = tree;
              if (s.focusedPaneByTab[tabId])
                remainingFocus[tabId] = s.focusedPaneByTab[tabId]!;
            }
          }
          return {
            workspaces: s.workspaces.filter((w) => w.id !== msg.workspaceId),
            tabs: s.tabs.filter((t) => t.workspaceId !== msg.workspaceId),
            trees: remainingTrees,
            focusedPaneByTab: remainingFocus,
            panes: remainingPanes,
            ptyUrls: remainingUrls,
          };
        });
        break;

      case "workspace_renamed":
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === msg.workspaceId ? { ...w, name: msg.name } : w,
          ),
        }));
        break;

      case "workspace_selected":
        set({ selectedWorkspaceId: msg.workspaceId });
        break;

      case "tab_order_changed":
        break;

      case "error":
        console.error(`[supaterm] Server error: ${msg.code}: ${msg.message}`);
        break;
    }
  },
}));
