import type { ServerWebSocket } from "bun";
import {
  type WorkspaceState,
  type WorkspaceItemState,
  type TabState,
  type PaneState,
  type PaneDirection,
  type SplitTree,
  type Direction,
  createTreeWithLeaf,
  insertAt,
  remove,
  equalize as equalizeTree,
  setZoomed,
  resize as resizeTree,
  leaves,
  focusTargetAfterClosing,
  toneFromId,
} from "@supaterm/shared";
import type { ServerMessage } from "@supaterm/shared";
import { PtyManager } from "./pty-manager.js";
import { StateStore } from "./persistence.js";

const PERSIST_TYPES = new Set([
  "workspace_created", "workspace_deleted", "workspace_renamed", "workspace_selected",
  "tab_created", "tab_closed", "tab_selected",
  "split_tree_updated", "focus_changed",
]);

export interface ControlWsData {
  type: "control";
}

export class WorkspaceStateManager {
  private workspaces = new Map<string, WorkspaceItemState>();
  private tabs = new Map<string, TabState>();
  private trees = new Map<string, SplitTree<string>>();
  private focusedPaneByTab = new Map<string, string>();
  private panes = new Map<string, PaneState>();
  private tabsByWorkspace = new Map<string, string[]>();
  private selectedWorkspaceId: string | null = null;
  private selectedTabId: string | null = null;
  private controlClients = new Set<ServerWebSocket<ControlWsData>>();
  private store: StateStore;

  constructor(private ptyManager: PtyManager) {
    this.store = new StateStore();
    ptyManager.onPaneTitleChanged = (paneId, title) => {
      const pane = this.panes.get(paneId);
      if (!pane) return;
      pane.title = title;

      const tab = this.tabs.get(pane.tabId);
      if (tab && !tab.isTitleLocked) {
        const focusedPaneId = this.focusedPaneByTab.get(tab.id);
        if (focusedPaneId === paneId) {
          tab.title = title;
          this.broadcast({ type: "tab_updated", tabId: tab.id, patch: { title } });
        }
      }

      this.broadcast({ type: "pane_title_changed", paneId, title });
    };

    ptyManager.onPaneExited = (paneId) => {
      const pane = this.panes.get(paneId);
      if (pane) {
        pane.isRunning = false;
        const tab = this.tabs.get(pane.tabId);
        if (tab) {
          tab.isDirty = false;
          this.broadcast({ type: "tab_updated", tabId: tab.id, patch: { isDirty: false } });
        }
      }
    };
  }

  // === Bootstrap ===

  bootstrap(): void {
    const persisted = this.store.load();
    if (persisted && persisted.workspaces.length > 0) {
      for (const ws of persisted.workspaces) {
        this.workspaces.set(ws.id, ws);
        this.tabsByWorkspace.set(ws.id, []);
      }
      for (const tab of persisted.tabs) {
        this.tabs.set(tab.id, tab);
        const wsTabIds = this.tabsByWorkspace.get(tab.workspaceId) ?? [];
        wsTabIds.push(tab.id);
        this.tabsByWorkspace.set(tab.workspaceId, wsTabIds);
      }
      for (const [tabId, tree] of Object.entries(persisted.trees)) {
        this.trees.set(tabId, tree);
      }
      for (const [tabId, paneId] of Object.entries(persisted.focusedPaneByTab)) {
        this.focusedPaneByTab.set(tabId, paneId);
      }
      this.selectedWorkspaceId = persisted.selectedWorkspaceId;
      this.selectedTabId = persisted.selectedTabId;

      for (const [tabId, tree] of this.trees) {
        const paneIds = leaves(tree);
        for (const paneId of paneIds) {
          const tab = this.tabs.get(tabId);
          const managed = this.ptyManager.create({
            id: paneId,
            cols: 80,
            rows: 24,
            tabId,
          });
          const pane: PaneState = {
            id: paneId,
            tabId,
            title: tab?.title ?? "shell",
            isRunning: true,
            cols: 80,
            rows: 24,
          };
          this.panes.set(paneId, pane);
        }
      }
      return;
    }

    const wsId = crypto.randomUUID();
    const ws: WorkspaceItemState = { id: wsId, name: "A" };
    this.workspaces.set(wsId, ws);
    this.tabsByWorkspace.set(wsId, []);
    this.selectedWorkspaceId = wsId;
    this.store.saveWorkspace(ws, 0);
    this.store.saveSelection(wsId, null);
  }

  // === Workspace CRUD ===

  createWorkspace(): WorkspaceItemState {
    const id = crypto.randomUUID();
    const name = this.nextWorkspaceName();
    const ws: WorkspaceItemState = { id, name };
    this.workspaces.set(id, ws);
    this.tabsByWorkspace.set(id, []);
    this.broadcast({ type: "workspace_created", workspace: ws });
    this.selectWorkspace(id);
    this.createTab({ workspaceId: id });

    return ws;
  }

  deleteWorkspace(id: string): void {
    const tabIds = this.tabsByWorkspace.get(id) ?? [];
    for (const tabId of Array.from(tabIds)) {
      this.closeTab(tabId);
    }
    this.workspaces.delete(id);
    this.tabsByWorkspace.delete(id);
    if (this.selectedWorkspaceId === id) {
      const first = this.workspaces.keys().next();
      this.selectedWorkspaceId = first.done ? null : first.value;
      if (this.selectedWorkspaceId) {
        this.selectWorkspace(this.selectedWorkspaceId);
      }
    }
    this.broadcast({ type: "workspace_deleted", workspaceId: id });
  }

  renameWorkspace(id: string, name: string): void {
    const ws = this.workspaces.get(id);
    if (!ws) return;
    ws.name = name;
    this.broadcast({ type: "workspace_renamed", workspaceId: id, name });
  }

  selectWorkspace(id: string): void {
    if (!this.workspaces.has(id)) return;
    this.selectedWorkspaceId = id;
    const tabIds = this.tabsByWorkspace.get(id) ?? [];
    this.selectedTabId = tabIds[0] ?? null;
    this.broadcast({ type: "workspace_selected", workspaceId: id });
    if (this.selectedTabId) {
      this.broadcast({ type: "tab_selected", tabId: this.selectedTabId });
    }
  }

  // === Tab CRUD ===

  createTab(options?: {
    workspaceId?: string;
    cols?: number;
    rows?: number;
  }): { tab: TabState; pane: PaneState; ptyUrl: string } {
    const workspaceId = options?.workspaceId ?? this.selectedWorkspaceId;
    if (!workspaceId) throw new Error("No workspace selected");

    const tabId = crypto.randomUUID();
    const paneId = crypto.randomUUID();
    const cols = options?.cols ?? 80;
    const rows = options?.rows ?? 24;

    const managed = this.ptyManager.create({
      id: paneId,
      cols,
      rows,
      tabId,
    });

    const tab: TabState = {
      id: tabId,
      workspaceId,
      title: managed.title,
      isDirty: false,
      isPinned: false,
      isTitleLocked: false,
      tone: toneFromId(tabId),
    };

    const pane: PaneState = {
      id: paneId,
      tabId,
      title: managed.title,
      isRunning: true,
      cols,
      rows,
    };

    this.tabs.set(tabId, tab);
    this.panes.set(paneId, pane);
    this.trees.set(tabId, createTreeWithLeaf(paneId));
    this.focusedPaneByTab.set(tabId, paneId);

    const tabIds = this.tabsByWorkspace.get(workspaceId) ?? [];
    tabIds.push(tabId);
    this.tabsByWorkspace.set(workspaceId, tabIds);

    this.selectedTabId = tabId;

    const ptyUrl = `/pty/${paneId}`;

    this.broadcast({ type: "tab_created", tab });
    this.broadcast({ type: "pane_created", paneId, tabId, ptyUrl });
    this.broadcast({ type: "tab_selected", tabId });
    this.broadcast({
      type: "split_tree_updated",
      tabId,
      tree: this.trees.get(tabId)!,
    });

    return { tab, pane, ptyUrl };
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const tree = this.trees.get(tabId);
    if (tree) {
      const paneIds = leaves(tree);
      for (const paneId of paneIds) {
        this.ptyManager.destroy(paneId);
        this.panes.delete(paneId);
      }
    }

    this.tabs.delete(tabId);
    this.trees.delete(tabId);
    this.focusedPaneByTab.delete(tabId);

    const wsTabIds = this.tabsByWorkspace.get(tab.workspaceId) ?? [];
    const idx = wsTabIds.indexOf(tabId);
    if (idx !== -1) wsTabIds.splice(idx, 1);

    let nextTabId: string | undefined;
    if (this.selectedTabId === tabId) {
      nextTabId = wsTabIds[Math.min(idx, wsTabIds.length - 1)];
      this.selectedTabId = nextTabId ?? null;
    }

    this.broadcast({ type: "tab_closed", tabId, nextTabId });
    if (nextTabId) {
      this.broadcast({ type: "tab_selected", tabId: nextTabId });
    }
  }

  selectTab(tabId: string): void {
    if (!this.tabs.has(tabId)) return;
    this.selectedTabId = tabId;
    this.broadcast({ type: "tab_selected", tabId });
  }

  selectTabSlot(slot: number): void {
    if (!this.selectedWorkspaceId) return;
    const tabIds = this.tabsByWorkspace.get(this.selectedWorkspaceId) ?? [];
    const tabId = tabIds[slot];
    if (tabId) this.selectTab(tabId);
  }

  nextTab(): void {
    if (!this.selectedWorkspaceId || !this.selectedTabId) return;
    const tabIds = this.tabsByWorkspace.get(this.selectedWorkspaceId) ?? [];
    const idx = tabIds.indexOf(this.selectedTabId);
    if (idx === -1) return;
    const nextId = tabIds[(idx + 1) % tabIds.length];
    if (nextId) this.selectTab(nextId);
  }

  previousTab(): void {
    if (!this.selectedWorkspaceId || !this.selectedTabId) return;
    const tabIds = this.tabsByWorkspace.get(this.selectedWorkspaceId) ?? [];
    const idx = tabIds.indexOf(this.selectedTabId);
    if (idx === -1) return;
    const prevId = tabIds[(idx - 1 + tabIds.length) % tabIds.length];
    if (prevId) this.selectTab(prevId);
  }

  // === Pane CRUD ===

  createPane(
    tabId: string,
    direction: PaneDirection,
    targetPaneId?: string,
    command?: string,
    focus?: boolean,
  ): { pane: PaneState; ptyUrl: string } {
    const tree = this.trees.get(tabId);
    if (!tree) throw new Error(`Tab ${tabId} not found`);

    const focusedId = targetPaneId ?? this.focusedPaneByTab.get(tabId);
    if (!focusedId) throw new Error("No pane to split");

    const refPane = this.panes.get(focusedId);
    const cols = refPane?.cols ?? 80;
    const rows = refPane?.rows ?? 24;

    const paneId = crypto.randomUUID();

    const managed = this.ptyManager.create({
      id: paneId,
      cols,
      rows,
      tabId,
    });

    const pane: PaneState = {
      id: paneId,
      tabId,
      title: managed.title,
      isRunning: true,
      cols,
      rows,
    };
    this.panes.set(paneId, pane);

    const newTree = insertAt(tree, focusedId, paneId, direction);
    this.trees.set(tabId, newTree);

    if (focus !== false) {
      this.focusedPaneByTab.set(tabId, paneId);
    }

    const ptyUrl = `/pty/${paneId}`;

    this.broadcast({ type: "pane_created", paneId, tabId, ptyUrl });
    this.broadcast({ type: "split_tree_updated", tabId, tree: newTree });
    if (focus !== false) {
      this.broadcast({ type: "focus_changed", tabId, paneId });
    }

    return { pane, ptyUrl };
  }

  closePane(paneId: string): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;

    const tree = this.trees.get(pane.tabId);
    if (!tree) return;

    const allLeaves = leaves(tree);
    if (allLeaves.length <= 1) {
      this.closeTab(pane.tabId);
      return;
    }

    const nextFocusId = focusTargetAfterClosing(tree, paneId) ?? undefined;

    this.ptyManager.destroy(paneId);
    this.panes.delete(paneId);

    const newTree = remove(tree, paneId);
    this.trees.set(pane.tabId, newTree);

    if (this.focusedPaneByTab.get(pane.tabId) === paneId && nextFocusId) {
      this.focusedPaneByTab.set(pane.tabId, nextFocusId);
    }

    this.broadcast({
      type: "pane_closed",
      paneId,
      tabId: pane.tabId,
      nextFocusId,
    });
    this.broadcast({
      type: "split_tree_updated",
      tabId: pane.tabId,
      tree: newTree,
    });
    if (nextFocusId) {
      this.broadcast({
        type: "focus_changed",
        tabId: pane.tabId,
        paneId: nextFocusId,
      });
    }
  }

  resizePane(paneId: string, cols: number, rows: number): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    pane.cols = cols;
    pane.rows = rows;
    this.ptyManager.resize(paneId, cols, rows);
  }

  focusPane(paneId: string): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    this.focusedPaneByTab.set(pane.tabId, paneId);

    const tab = this.tabs.get(pane.tabId);
    if (tab && !tab.isTitleLocked) {
      tab.title = pane.title;
      this.broadcast({ type: "tab_updated", tabId: tab.id, patch: { title: pane.title } });
    }

    this.broadcast({ type: "focus_changed", tabId: pane.tabId, paneId });
  }

  equalizePanes(tabId: string): void {
    const tree = this.trees.get(tabId);
    if (!tree) return;
    const newTree = equalizeTree(tree);
    this.trees.set(tabId, newTree);
    this.broadcast({ type: "split_tree_updated", tabId, tree: newTree });
  }

  toggleZoom(tabId: string): void {
    const tree = this.trees.get(tabId);
    if (!tree) return;
    const focusedId = this.focusedPaneByTab.get(tabId);
    const newTree = tree.zoomed
      ? setZoomed(tree, null)
      : focusedId
        ? setZoomed(tree, focusedId)
        : tree;
    this.trees.set(tabId, newTree);
    this.broadcast({ type: "split_tree_updated", tabId, tree: newTree });
  }

  resizeSplit(paneId: string, delta: number, axis: Direction): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    const tree = this.trees.get(pane.tabId);
    if (!tree) return;
    const newTree = resizeTree(tree, paneId, delta, axis);
    this.trees.set(pane.tabId, newTree);
    this.broadcast({
      type: "split_tree_updated",
      tabId: pane.tabId,
      tree: newTree,
    });
  }

  // === Queries ===

  getSnapshot(): WorkspaceState {
    return {
      workspaces: Array.from(this.workspaces.values()),
      selectedWorkspaceId: this.selectedWorkspaceId,
      tabs: Array.from(this.tabs.values()),
      selectedTabId: this.selectedTabId,
      trees: Object.fromEntries(this.trees),
      focusedPaneByTab: Object.fromEntries(this.focusedPaneByTab),
      panes: Object.fromEntries(this.panes),
    };
  }

  // === Client management ===

  registerControlClient(ws: ServerWebSocket<ControlWsData>): void {
    this.controlClients.add(ws);
  }

  unregisterControlClient(ws: ServerWebSocket<ControlWsData>): void {
    this.controlClients.delete(ws);
  }

  broadcast(message: ServerMessage): void {
    const json = JSON.stringify(message);
    for (const ws of this.controlClients) {
      try {
        ws.sendText(json);
      } catch {
        this.controlClients.delete(ws);
      }
    }
    if (PERSIST_TYPES.has(message.type)) {
      this.persistSoon();
    }
  }

  // === Persistence ===

  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private buildPersistedState() {
    return {
      workspaces: Array.from(this.workspaces.values()),
      selectedWorkspaceId: this.selectedWorkspaceId,
      tabs: Array.from(this.tabs.values()),
      selectedTabId: this.selectedTabId,
      trees: Object.fromEntries(this.trees),
      focusedPaneByTab: Object.fromEntries(this.focusedPaneByTab),
    };
  }

  private persistSoon(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.store.save(this.buildPersistedState());
    }, 100);
  }

  persistNow(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.store.save(this.buildPersistedState());
  }

  // === Cleanup ===

  destroyAll(): void {
    this.persistNow();
    this.store.close();
    this.ptyManager.destroyAll();
    this.workspaces.clear();
    this.tabs.clear();
    this.trees.clear();
    this.focusedPaneByTab.clear();
    this.panes.clear();
    this.tabsByWorkspace.clear();
  }

  // --- Private ---

  private nextWorkspaceName(): string {
    const existing = new Set(
      Array.from(this.workspaces.values()).map((w) => w.name),
    );
    for (let i = 0; ; i++) {
      const name = i < 26
        ? String.fromCharCode(65 + i)
        : String.fromCharCode(65 + Math.floor(i / 26) - 1) +
          String.fromCharCode(65 + (i % 26));
      if (!existing.has(name)) return name;
    }
  }
}
