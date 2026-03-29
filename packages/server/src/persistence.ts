import {
  existsSync,
  watch,
  type FSWatcher,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { homedir } from "os";
import type {
  PaneState,
  SplitTree,
  TabState,
  WorkspaceItemState,
} from "@supaterm/shared";

export const CONFIG_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "supaterm",
);
const STATE_PATH = join(CONFIG_DIR, "sessions.json");
const LEGACY_JSON_PATH = join(CONFIG_DIR, "workspace-state.json");
const LEGACY_DB_PATH = join(CONFIG_DIR, "supaterm.db");

export interface PersistedState {
  workspaces: WorkspaceItemState[];
  selectedWorkspaceId: string | null;
  tabs: TabState[];
  selectedTabId: string | null;
  trees: Record<string, SplitTree<string>>;
  focusedPaneByTab: Record<string, string>;
  panes: Record<string, PaneState>;
}

const EMPTY_STATE: PersistedState = {
  workspaces: [],
  selectedWorkspaceId: null,
  tabs: [],
  selectedTabId: null,
  trees: {},
  focusedPaneByTab: {},
  panes: {},
};

export class StateStore {
  private statePath: string;
  private lastKnownCatalog: SerializedSessionCatalog | null = null;

  constructor(statePath?: string) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    this.statePath = statePath ?? STATE_PATH;
    this.cleanupLegacySqlite();
  }

  load(): PersistedState | null {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (this.looksLikeSessionCatalog(parsed)) {
        this.lastKnownCatalog = parsed;
      }
      const state = this.decodePersistedState(parsed);
      return state.workspaces.length > 0 ? state : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return null;
      }
    }

    return this.migrateLegacyJsonIfNeeded();
  }

  save(state: PersistedState): void {
    const normalized = this.normalizeState(state);
    const tempPath = `${this.statePath}.tmp`;
    const baseCatalog = this.readRawCatalog() ?? this.emptySessionCatalog();
    const encoded = this.mergedSessionCatalog(
      baseCatalog,
      this.encodeSessionCatalog(normalized, this.lastKnownCatalog ?? baseCatalog),
    );
    writeFileSync(tempPath, `${JSON.stringify(encoded, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.statePath);
    this.lastKnownCatalog = encoded;
  }

  saveWorkspace(ws: WorkspaceItemState, sortOrder: number): void {
    const state = this.load() ?? EMPTY_STATE;
    const workspaces = state.workspaces.filter((existing) => existing.id !== ws.id);
    workspaces.splice(Math.max(0, sortOrder), 0, ws);
    this.save({
      ...state,
      workspaces,
    });
  }

  saveSelection(
    selectedWorkspaceId: string | null,
    selectedTabId: string | null,
  ): void {
    const state = this.load() ?? EMPTY_STATE;
    this.save({
      ...state,
      selectedWorkspaceId,
      selectedTabId,
    });
  }

  close(): void {
  }

  observe(onChange: () => void): FSWatcher {
    const watchedDir = dirname(this.statePath);
    const watchedFile = basename(this.statePath);
    return watch(watchedDir, (_eventType, filename) => {
      if (filename && filename.toString() !== watchedFile) return;
      onChange();
    });
  }

  private migrateLegacyJsonIfNeeded(): PersistedState | null {
    if (!existsSync(LEGACY_JSON_PATH)) return null;

    try {
      const raw = readFileSync(LEGACY_JSON_PATH, "utf8");
      const state = this.normalizeState(JSON.parse(raw) as Partial<PersistedState>);
      this.save(state);
      rmSync(LEGACY_JSON_PATH, { force: true });
      return state.workspaces.length > 0 ? state : null;
    } catch {
      return null;
    }
  }

  private normalizeState(state: Partial<PersistedState> | null | undefined): PersistedState {
    return {
      workspaces: Array.isArray(state?.workspaces) ? state.workspaces : [],
      selectedWorkspaceId: state?.selectedWorkspaceId ?? null,
      tabs: Array.isArray(state?.tabs)
        ? state.tabs.map((tab) => ({
            ...tab,
            isDirty: false,
          }))
        : [],
      selectedTabId: state?.selectedTabId ?? null,
      trees: state?.trees ?? {},
      focusedPaneByTab: state?.focusedPaneByTab ?? {},
      panes: this.normalizePanes(state?.panes),
    };
  }

  private normalizePanes(
    panes: PersistedState["panes"] | undefined,
  ): PersistedState["panes"] {
    if (!panes || typeof panes !== "object") return {};

    return Object.fromEntries(
      Object.entries(panes).map(([paneId, pane]) => [
        paneId,
        {
          ...pane,
          isRunning: false,
        },
      ]),
    );
  }

  private decodePersistedState(raw: unknown): PersistedState {
    if (this.looksLikeSessionCatalog(raw)) {
      return this.fromSessionCatalog(raw);
    }
    return this.normalizeState(raw as Partial<PersistedState>);
  }

  private looksLikeSessionCatalog(raw: unknown): raw is SerializedSessionCatalog {
    if (!raw || typeof raw !== "object") return false;
    return Array.isArray((raw as { workspaces?: unknown }).workspaces)
      && "defaultSelectedWorkspaceID" in (raw as object);
  }

  private fromSessionCatalog(catalog: SerializedSessionCatalog): PersistedState {
    const workspaceTombstones = new Map(
      (catalog.workspaceTombstones ?? []).map((tombstone) => [
        this.decodedID(tombstone.id),
        tombstone.deletedAt,
      ]),
    );
    const tabTombstones = new Map(
      (catalog.tabTombstones ?? []).map((tombstone) => [
        this.decodedID(tombstone.id),
        tombstone.deletedAt,
      ]),
    );
    const paneTombstones = new Map(
      (catalog.paneTombstones ?? []).map((tombstone) => [tombstone.id, tombstone.deletedAt]),
    );
    const workspaces: WorkspaceItemState[] = [];
    const tabs: TabState[] = [];
    const trees: Record<string, SplitTree<string>> = {};
    const focusedPaneByTab: Record<string, string> = {};
    const panes: Record<string, PaneState> = {};

    for (const workspace of catalog.workspaces) {
      const workspaceId = this.decodedID(workspace.id);
      if (!workspaceId) continue;
      if ((workspaceTombstones.get(workspaceId) ?? -1) >= workspace.updatedAt) continue;

      workspaces.push({
        id: workspaceId,
        name: workspace.name.trim() || "A",
      });

      for (const tab of workspace.tabs) {
        const tabId = this.decodedID(tab.id);
        if (!tabId) continue;
        if ((tabTombstones.get(tabId) ?? -1) >= tab.updatedAt) continue;

        tabs.push({
          id: tabId,
          workspaceId,
          title: tab.title,
          icon: tab.icon ?? undefined,
          isDirty: false,
          isPinned: !!tab.isPinned,
          isTitleLocked: !!tab.isTitleLocked,
          tone: "slate",
        });

        const tree = this.decodeSplitTree(tab.splitTree);
        trees[tabId] = tree;
        const activePaneIDs = new Set<string>();

        for (const pane of tab.panes) {
          if ((paneTombstones.get(pane.id) ?? -1) >= pane.updatedAt) continue;
          panes[pane.id] = {
            id: pane.id,
            tabId,
            sessionName: pane.sessionName || this.nativePaneSessionName(tabId, pane.id),
            title: pane.title ?? tab.title,
            pwd: pane.workingDirectoryPath ?? undefined,
            isRunning: false,
            cols: 80,
            rows: 24,
          };
          activePaneIDs.add(pane.id);
        }

        if (activePaneIDs.size === 0) {
          tabs.pop();
          delete trees[tabId];
          continue;
        }

        const selectedPaneID =
          tab.selectedPaneID && activePaneIDs.has(tab.selectedPaneID)
            ? tab.selectedPaneID
            : this.leftmostPaneID(tree.root);
        if (selectedPaneID) {
          focusedPaneByTab[tabId] = selectedPaneID;
        }
      }
    }

    const selectedWorkspaceId = this.decodedID(catalog.defaultSelectedWorkspaceID);
    const resolvedSelectedWorkspaceId = workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
      ? selectedWorkspaceId
      : workspaces[0]?.id ?? null;
    return this.normalizeState({
      workspaces,
      selectedWorkspaceId: resolvedSelectedWorkspaceId,
      tabs,
      selectedTabId: this.selectedTabIDForWorkspace(catalog, resolvedSelectedWorkspaceId),
      trees,
      focusedPaneByTab,
      panes,
    });
  }

  private encodeSessionCatalog(
    state: PersistedState,
    baseCatalog: SerializedSessionCatalog,
  ): SerializedSessionCatalog {
    const currentTimestamp = this.currentTimestamp();
    const baseState = this.fromSessionCatalog(baseCatalog);
    const baseWorkspacesByID = new Map(baseCatalog.workspaces.map((workspace) => [
      this.decodedID(workspace.id),
      workspace,
    ]));
    const activeWorkspaceIDs = new Set(state.workspaces.map((workspace) => workspace.id));
    const activeTabIDs = new Set(state.tabs.map((tab) => tab.id));
    const activePaneIDs = new Set(Object.keys(state.panes));
    const workspaces = state.workspaces.map((workspace) => {
      const baseWorkspace = baseWorkspacesByID.get(workspace.id) ?? null;
      const baseWorkspaceState = baseState.workspaces.find((candidate) => candidate.id === workspace.id);
      const tabs = state.tabs.filter((tab) => tab.workspaceId === workspace.id);
      const encodedWorkspace: SerializedWorkspace = {
        id: this.encodedID(workspace.id),
        updatedAt:
          baseWorkspace && baseWorkspaceState
          && baseWorkspaceState.name === workspace.name
          && tabs.length === (baseWorkspace.tabs?.length ?? 0)
          ? baseWorkspace.updatedAt
          : currentTimestamp,
        name: workspace.name,
        tabs: tabs.map((tab) => {
          const baseTab = baseWorkspace?.tabs.find(
            (candidate) => this.decodedID(candidate.id) === tab.id,
          );
          const baseTabState = baseState.tabs.find((candidate) => candidate.id === tab.id);
          const paneIDs = this.leafOrder(state.trees[tab.id]?.root);
          const panes = paneIDs
            .map((paneID) => state.panes[paneID])
            .filter((pane): pane is PaneState => pane !== undefined)
            .map((pane) => ({
              id: pane.id,
              sessionName: pane.sessionName,
              updatedAt:
                baseTab?.panes.find((candidate) => candidate.id === pane.id)
                && this.samePane(
                  pane,
                  baseState.panes[pane.id] ?? null,
                )
                ? baseTab.panes.find((candidate) => candidate.id === pane.id)!.updatedAt
                : currentTimestamp,
              title: pane.title,
              workingDirectoryPath: pane.pwd ?? null,
              lastKnownRunning: pane.isRunning,
            }));

          return {
            id: this.encodedID(tab.id),
            updatedAt:
              baseTab && baseTabState && this.sameTab(tab, state, baseState, tab.id)
              ? baseTab.updatedAt
              : currentTimestamp,
            title: tab.title,
            icon: tab.icon ?? null,
            isPinned: tab.isPinned,
            isTitleLocked: tab.isTitleLocked,
            selectedPaneID:
              state.focusedPaneByTab[tab.id] ?? panes[0]?.id ?? crypto.randomUUID(),
            panes,
            splitTree: {
              root: this.encodeSplitNode(state.trees[tab.id]?.root ?? null),
              zoomedPaneID: this.leftmostPaneID(state.trees[tab.id]?.zoomed ?? null),
            },
          };
        }),
        selectedTabID: this.encodedNullableID(
          state.selectedWorkspaceId === workspace.id
            ? state.selectedTabId
            : tabs[0]?.id ?? null,
        ),
      };
      return encodedWorkspace;
    });

    return {
      defaultSelectedWorkspaceID: this.encodedID(
        state.selectedWorkspaceId ?? state.workspaces[0]?.id ?? crypto.randomUUID(),
      ),
      selectionUpdatedAt:
        state.selectedWorkspaceId === baseState.selectedWorkspaceId
        ? baseCatalog.selectionUpdatedAt
        : currentTimestamp,
      workspaces,
      workspaceTombstones: this.updatedWorkspaceTombstones(
        baseCatalog.workspaceTombstones ?? [],
        baseState.workspaces.map((workspace) => workspace.id),
        activeWorkspaceIDs,
        currentTimestamp,
        new Map(workspaces.map((workspace) => [workspace.id.rawValue, workspace.updatedAt])),
      ),
      tabTombstones: this.updatedTabTombstones(
        baseCatalog.tabTombstones ?? [],
        baseState.tabs.map((tab) => tab.id),
        activeTabIDs,
        currentTimestamp,
        new Map(workspaces.flatMap((workspace) => workspace.tabs.map((tab) => [tab.id.rawValue, tab.updatedAt]))),
      ),
      paneTombstones: this.updatedPaneTombstones(
        baseCatalog.paneTombstones ?? [],
        Object.keys(baseState.panes),
        activePaneIDs,
        currentTimestamp,
        new Map(workspaces.flatMap((workspace) => workspace.tabs.flatMap((tab) => tab.panes.map((pane) => [pane.id, pane.updatedAt])))),
      ),
    };
  }

  private selectedTabIDForWorkspace(
    catalog: SerializedSessionCatalog,
    workspaceId: string | null,
  ): string | null {
    if (!workspaceId) return null;
    const tabTombstones = new Map(
      (catalog.tabTombstones ?? []).map((tombstone) => [this.decodedID(tombstone.id), tombstone.deletedAt]),
    );
    const workspace = catalog.workspaces.find(
      (candidate) => this.decodedID(candidate.id) === workspaceId,
    );
    const selectedTabID = this.decodedID(workspace?.selectedTabID ?? null);
    if (!selectedTabID) return null;
    const tab = workspace?.tabs.find((candidate) => this.decodedID(candidate.id) === selectedTabID);
    if (!tab) return null;
    return (tabTombstones.get(selectedTabID) ?? -1) >= tab.updatedAt ? null : selectedTabID;
  }

  private encodedID(id: string): SerializedID {
    return { rawValue: id };
  }

  private encodedNullableID(id: string | null): SerializedID | null {
    return id ? this.encodedID(id) : null;
  }

  private decodedID(id: SerializedID | null | undefined): string | null {
    if (!id || typeof id !== "object") return null;
    return typeof id.rawValue === "string" ? id.rawValue : null;
  }

  private encodeSplitNode(node: SplitTree<string>["root"]): SerializedSplitNode | null {
    if (!node) return null;
    if (node.type === "leaf") {
      return { leaf: { _0: node.id } };
    }

    return {
      split: {
        _0: {
          direction: node.direction,
          ratio: node.ratio,
          left: this.encodeSplitNode(node.left)!,
          right: this.encodeSplitNode(node.right)!,
        },
      },
    };
  }

  private decodeSplitTree(
    splitTree: SerializedSplitTree | undefined,
  ): SplitTree<string> {
    return {
      root: this.decodeSplitNode(splitTree?.root ?? null),
      zoomed: splitTree?.zoomedPaneID
        ? { type: "leaf", id: splitTree.zoomedPaneID }
        : null,
    };
  }

  private decodeSplitNode(node: SerializedSplitNode | null): SplitTree<string>["root"] {
    if (!node) return null;
    if ("leaf" in node) {
      return { type: "leaf", id: node.leaf._0 };
    }

    return {
      type: "split",
      direction: node.split._0.direction,
      ratio: node.split._0.ratio,
      left: this.decodeSplitNode(node.split._0.left)!,
      right: this.decodeSplitNode(node.split._0.right)!,
    };
  }

  private leftmostPaneID(node: SplitTree<string>["root"]): string | null {
    if (!node) return null;
    if (node.type === "leaf") return node.id;
    return this.leftmostPaneID(node.left);
  }

  private leafOrder(node: SplitTree<string>["root"]): string[] {
    if (!node) return [];
    if (node.type === "leaf") return [node.id];
    return [...this.leafOrder(node.left), ...this.leafOrder(node.right)];
  }

  private nativePaneSessionName(tabId: string, paneId: string): string {
    return `supaterm.${tabId.toLowerCase()}.${paneId.toLowerCase()}`;
  }

  private readRawCatalog(): SerializedSessionCatalog | null {
    try {
      return JSON.parse(readFileSync(this.statePath, "utf8")) as SerializedSessionCatalog;
    } catch {
      return null;
    }
  }

  private emptySessionCatalog(): SerializedSessionCatalog {
    return {
      defaultSelectedWorkspaceID: this.encodedID(crypto.randomUUID()),
      selectionUpdatedAt: 0,
      workspaces: [],
      workspaceTombstones: [],
      tabTombstones: [],
      paneTombstones: [],
    };
  }

  private mergedSessionCatalog(
    base: SerializedSessionCatalog,
    incoming: SerializedSessionCatalog,
  ): SerializedSessionCatalog {
    const baseByID = new Map(base.workspaces.map((workspace) => [workspace.id.rawValue, workspace]));
    const incomingByID = new Map(incoming.workspaces.map((workspace) => [workspace.id.rawValue, workspace]));
    const preferredWorkspaceIDs =
      this.maxUpdatedAt(incoming.workspaces) >= this.maxUpdatedAt(base.workspaces)
      ? incoming.workspaces.map((workspace) => workspace.id.rawValue)
      : base.workspaces.map((workspace) => workspace.id.rawValue);
    const workspaceIDs = this.mergedIDs(
      preferredWorkspaceIDs,
      [...baseByID.keys(), ...incomingByID.keys()],
    );

    const merged: SerializedSessionCatalog = {
      defaultSelectedWorkspaceID:
        incoming.selectionUpdatedAt >= base.selectionUpdatedAt
        ? incoming.defaultSelectedWorkspaceID
        : base.defaultSelectedWorkspaceID,
      selectionUpdatedAt: Math.max(base.selectionUpdatedAt, incoming.selectionUpdatedAt),
      workspaces: workspaceIDs.flatMap((workspaceID) => {
        const baseWorkspace = baseByID.get(workspaceID);
        const incomingWorkspace = incomingByID.get(workspaceID);
        if (baseWorkspace && incomingWorkspace) {
          return [this.mergeWorkspace(baseWorkspace, incomingWorkspace)];
        }
        return baseWorkspace ?? incomingWorkspace ? [baseWorkspace ?? incomingWorkspace!] : [];
      }),
      workspaceTombstones: this.mergeWorkspaceTombstones(
        base.workspaceTombstones ?? [],
        incoming.workspaceTombstones ?? [],
      ),
      tabTombstones: this.mergeTabTombstones(
        base.tabTombstones ?? [],
        incoming.tabTombstones ?? [],
      ),
      paneTombstones: this.mergePaneTombstones(
        base.paneTombstones ?? [],
        incoming.paneTombstones ?? [],
      ),
    };
    return this.prunedCatalog(merged);
  }

  private mergeWorkspace(
    base: SerializedWorkspace,
    incoming: SerializedWorkspace,
  ): SerializedWorkspace {
    const baseTabs = new Map(base.tabs.map((tab) => [tab.id.rawValue, tab]));
    const incomingTabs = new Map(incoming.tabs.map((tab) => [tab.id.rawValue, tab]));
    const preferredTabIDs =
      incoming.updatedAt >= base.updatedAt
      ? incoming.tabs.map((tab) => tab.id.rawValue)
      : base.tabs.map((tab) => tab.id.rawValue);
    const tabIDs = this.mergedIDs(preferredTabIDs, [...baseTabs.keys(), ...incomingTabs.keys()]);

    return {
      id: incoming.updatedAt >= base.updatedAt ? incoming.id : base.id,
      updatedAt: Math.max(base.updatedAt, incoming.updatedAt),
      name: incoming.updatedAt >= base.updatedAt ? incoming.name : base.name,
      selectedTabID: incoming.updatedAt >= base.updatedAt ? incoming.selectedTabID : base.selectedTabID,
      tabs: tabIDs.flatMap((tabID) => {
        const baseTab = baseTabs.get(tabID);
        const incomingTab = incomingTabs.get(tabID);
        if (baseTab && incomingTab) return [this.mergeTab(baseTab, incomingTab)];
        return baseTab ?? incomingTab ? [baseTab ?? incomingTab!] : [];
      }),
    };
  }

  private mergeTab(base: SerializedTab, incoming: SerializedTab): SerializedTab {
    const basePanes = new Map(base.panes.map((pane) => [pane.id, pane]));
    const incomingPanes = new Map(incoming.panes.map((pane) => [pane.id, pane]));
    const preferredPaneIDs =
      incoming.updatedAt >= base.updatedAt
      ? incoming.panes.map((pane) => pane.id)
      : base.panes.map((pane) => pane.id);
    const paneIDs = this.mergedIDs(preferredPaneIDs, [...basePanes.keys(), ...incomingPanes.keys()]);

    return {
      id: incoming.updatedAt >= base.updatedAt ? incoming.id : base.id,
      updatedAt: Math.max(base.updatedAt, incoming.updatedAt),
      title: incoming.updatedAt >= base.updatedAt ? incoming.title : base.title,
      icon: incoming.updatedAt >= base.updatedAt ? incoming.icon : base.icon,
      isPinned: incoming.updatedAt >= base.updatedAt ? incoming.isPinned : base.isPinned,
      isTitleLocked: incoming.updatedAt >= base.updatedAt ? incoming.isTitleLocked : base.isTitleLocked,
      selectedPaneID: incoming.updatedAt >= base.updatedAt ? incoming.selectedPaneID : base.selectedPaneID,
      panes: paneIDs.flatMap((paneID) => {
        const basePane = basePanes.get(paneID);
        const incomingPane = incomingPanes.get(paneID);
        if (basePane && incomingPane) return [incomingPane.updatedAt >= basePane.updatedAt ? incomingPane : basePane];
        return basePane ?? incomingPane ? [basePane ?? incomingPane!] : [];
      }),
      splitTree: incoming.updatedAt >= base.updatedAt ? incoming.splitTree : base.splitTree,
    };
  }

  private mergedIDs<ID>(preferred: ID[], fallback: ID[]): ID[] {
    const seen = new Set<ID>();
    const ordered: ID[] = [];
    for (const id of preferred) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
    for (const id of fallback) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
    return ordered;
  }

  private updatedWorkspaceTombstones(
    existing: SerializedWorkspaceTombstone[],
    previousIDs: string[],
    currentIDs: Set<string>,
    currentTimestamp: number,
    activeUpdatedAtByID: Map<string, number>,
  ): SerializedWorkspaceTombstone[] {
    const merged = new Map(existing.map((tombstone) => [tombstone.id.rawValue, tombstone]));
    for (const id of previousIDs) {
      if (currentIDs.has(id)) continue;
      const current = merged.get(id);
      const candidate = { id: this.encodedID(id), deletedAt: currentTimestamp };
      if (!current || candidate.deletedAt >= current.deletedAt) merged.set(id, candidate);
    }
    return [...merged.values()]
      .filter((tombstone) => (activeUpdatedAtByID.get(tombstone.id.rawValue) ?? Number.NEGATIVE_INFINITY) <= tombstone.deletedAt)
      .sort((lhs, rhs) => lhs.deletedAt - rhs.deletedAt);
  }

  private updatedTabTombstones(
    existing: SerializedTabTombstone[],
    previousIDs: string[],
    currentIDs: Set<string>,
    currentTimestamp: number,
    activeUpdatedAtByID: Map<string, number>,
  ): SerializedTabTombstone[] {
    const merged = new Map(existing.map((tombstone) => [tombstone.id.rawValue, tombstone]));
    for (const id of previousIDs) {
      if (currentIDs.has(id)) continue;
      const current = merged.get(id);
      const candidate = { id: this.encodedID(id), deletedAt: currentTimestamp };
      if (!current || candidate.deletedAt >= current.deletedAt) merged.set(id, candidate);
    }
    return [...merged.values()]
      .filter((tombstone) => (activeUpdatedAtByID.get(tombstone.id.rawValue) ?? Number.NEGATIVE_INFINITY) <= tombstone.deletedAt)
      .sort((lhs, rhs) => lhs.deletedAt - rhs.deletedAt);
  }

  private updatedPaneTombstones(
    existing: SerializedPaneTombstone[],
    previousIDs: string[],
    currentIDs: Set<string>,
    currentTimestamp: number,
    activeUpdatedAtByID: Map<string, number>,
  ): SerializedPaneTombstone[] {
    const merged = new Map(existing.map((tombstone) => [tombstone.id, tombstone]));
    for (const id of previousIDs) {
      if (currentIDs.has(id)) continue;
      const current = merged.get(id);
      const candidate = { id, deletedAt: currentTimestamp };
      if (!current || candidate.deletedAt >= current.deletedAt) merged.set(id, candidate);
    }
    return [...merged.values()]
      .filter((tombstone) => (activeUpdatedAtByID.get(tombstone.id) ?? Number.NEGATIVE_INFINITY) <= tombstone.deletedAt)
      .sort((lhs, rhs) => lhs.deletedAt - rhs.deletedAt);
  }

  private mergeWorkspaceTombstones(
    base: SerializedWorkspaceTombstone[],
    incoming: SerializedWorkspaceTombstone[],
  ): SerializedWorkspaceTombstone[] {
    const merged = new Map(base.map((tombstone) => [tombstone.id.rawValue, tombstone]));
    for (const tombstone of incoming) {
      const current = merged.get(tombstone.id.rawValue);
      if (!current || tombstone.deletedAt >= current.deletedAt) merged.set(tombstone.id.rawValue, tombstone);
    }
    return [...merged.values()].sort((lhs, rhs) => lhs.deletedAt - rhs.deletedAt);
  }

  private mergeTabTombstones(
    base: SerializedTabTombstone[],
    incoming: SerializedTabTombstone[],
  ): SerializedTabTombstone[] {
    const merged = new Map(base.map((tombstone) => [tombstone.id.rawValue, tombstone]));
    for (const tombstone of incoming) {
      const current = merged.get(tombstone.id.rawValue);
      if (!current || tombstone.deletedAt >= current.deletedAt) merged.set(tombstone.id.rawValue, tombstone);
    }
    return [...merged.values()].sort((lhs, rhs) => lhs.deletedAt - rhs.deletedAt);
  }

  private mergePaneTombstones(
    base: SerializedPaneTombstone[],
    incoming: SerializedPaneTombstone[],
  ): SerializedPaneTombstone[] {
    const merged = new Map(base.map((tombstone) => [tombstone.id, tombstone]));
    for (const tombstone of incoming) {
      const current = merged.get(tombstone.id);
      if (!current || tombstone.deletedAt >= current.deletedAt) merged.set(tombstone.id, tombstone);
    }
    return [...merged.values()].sort((lhs, rhs) => lhs.deletedAt - rhs.deletedAt);
  }

  private prunedCatalog(catalog: SerializedSessionCatalog): SerializedSessionCatalog {
    const workspaceTombstones = new Map(
      (catalog.workspaceTombstones ?? []).map((tombstone) => [tombstone.id.rawValue, tombstone.deletedAt]),
    );
    const tabTombstones = new Map(
      (catalog.tabTombstones ?? []).map((tombstone) => [tombstone.id.rawValue, tombstone.deletedAt]),
    );
    const paneTombstones = new Map(
      (catalog.paneTombstones ?? []).map((tombstone) => [tombstone.id, tombstone.deletedAt]),
    );

    return {
      ...catalog,
      workspaces: catalog.workspaces
        .filter((workspace) => (workspaceTombstones.get(workspace.id.rawValue) ?? Number.NEGATIVE_INFINITY) < workspace.updatedAt)
        .map((workspace) => ({
          ...workspace,
          tabs: workspace.tabs
            .filter((tab) => (tabTombstones.get(tab.id.rawValue) ?? Number.NEGATIVE_INFINITY) < tab.updatedAt)
            .map((tab) => ({
              ...tab,
              panes: tab.panes.filter(
                (pane) => (paneTombstones.get(pane.id) ?? Number.NEGATIVE_INFINITY) < pane.updatedAt,
              ),
            }))
            .filter((tab) => tab.panes.length > 0),
        })),
    };
  }

  private maxUpdatedAt(
    workspaces: Array<Pick<SerializedWorkspace, "updatedAt">>,
  ): number {
    return workspaces.reduce((max, workspace) => Math.max(max, workspace.updatedAt), 0);
  }

  private samePane(
    pane: PaneState,
    basePane: PaneState | null,
  ): boolean {
    return !!basePane
      && basePane.sessionName === pane.sessionName
      && basePane.title === pane.title
      && basePane.pwd === pane.pwd
      && basePane.isRunning === pane.isRunning;
  }

  private sameTab(
    tab: TabState,
    nextState: PersistedState,
    baseState: PersistedState,
    tabId: string,
  ): boolean {
    const baseTab = baseState.tabs.find((candidate) => candidate.id === tabId);
    if (!baseTab) return false;
    return JSON.stringify({
      ...baseTab,
      panes: this.leafOrder(baseState.trees[tabId]?.root),
      focus: baseState.focusedPaneByTab[tabId] ?? null,
      tree: baseState.trees[tabId] ?? null,
    }) === JSON.stringify({
      ...tab,
      panes: this.leafOrder(nextState.trees[tabId]?.root),
      focus: nextState.focusedPaneByTab[tabId] ?? null,
      tree: nextState.trees[tabId] ?? null,
    });
  }

  private currentTimestamp(): number {
    return Date.now();
  }

  private cleanupLegacySqlite(): void {
    rmSync(LEGACY_DB_PATH, { force: true });
    rmSync(`${LEGACY_DB_PATH}-shm`, { force: true });
    rmSync(`${LEGACY_DB_PATH}-wal`, { force: true });
  }
}

interface SerializedID {
  rawValue: string;
}

interface SerializedSessionCatalog {
  defaultSelectedWorkspaceID: SerializedID;
  selectionUpdatedAt: number;
  workspaces: SerializedWorkspace[];
  workspaceTombstones?: SerializedWorkspaceTombstone[];
  tabTombstones?: SerializedTabTombstone[];
  paneTombstones?: SerializedPaneTombstone[];
}

interface SerializedWorkspace {
  id: SerializedID;
  updatedAt: number;
  name: string;
  tabs: SerializedTab[];
  selectedTabID?: SerializedID | null;
}

interface SerializedTab {
  id: SerializedID;
  updatedAt: number;
  title: string;
  icon?: string | null;
  isPinned: boolean;
  isTitleLocked: boolean;
  selectedPaneID: string;
  panes: SerializedPane[];
  splitTree: SerializedSplitTree;
}

interface SerializedPane {
  id: string;
  sessionName: string;
  updatedAt: number;
  title?: string | null;
  workingDirectoryPath?: string | null;
  lastKnownRunning?: boolean | null;
}

interface SerializedSplitTree {
  root: SerializedSplitNode | null;
  zoomedPaneID?: string | null;
}

interface SerializedWorkspaceTombstone {
  id: SerializedID;
  deletedAt: number;
}

interface SerializedTabTombstone {
  id: SerializedID;
  deletedAt: number;
}

interface SerializedPaneTombstone {
  id: string;
  deletedAt: number;
}

type SerializedSplitNode =
  | { leaf: { _0: string } }
  | {
      split: {
        _0: {
          direction: "horizontal" | "vertical";
          ratio: number;
          left: SerializedSplitNode;
          right: SerializedSplitNode;
        };
      };
    };
