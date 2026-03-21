import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";
import { homedir } from "os";
import type {
  WorkspaceItemState,
  TabState,
  SplitTree,
} from "@supaterm/shared";

export const CONFIG_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "supaterm",
);
const DB_PATH = join(CONFIG_DIR, "supaterm.db");

export interface PersistedState {
  workspaces: WorkspaceItemState[];
  selectedWorkspaceId: string | null;
  tabs: TabState[];
  selectedTabId: string | null;
  trees: Record<string, SplitTree<string>>;
  focusedPaneByTab: Record<string, string>;
}

export class StateStore {
  private db: Database;

  constructor(dbPath?: string) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    this.db = new Database(dbPath ?? DB_PATH);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS tabs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'shell',
        icon TEXT,
        is_dirty INTEGER NOT NULL DEFAULT 0,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        is_title_locked INTEGER NOT NULL DEFAULT 0,
        tone TEXT NOT NULL DEFAULT 'slate',
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS trees (
        tab_id TEXT PRIMARY KEY REFERENCES tabs(id) ON DELETE CASCADE,
        tree_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS focus (
        tab_id TEXT PRIMARY KEY REFERENCES tabs(id) ON DELETE CASCADE,
        pane_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS selection (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    this.db.run(
      `INSERT OR IGNORE INTO selection (key, value) VALUES ('selected_workspace_id', NULL)`,
    );
    this.db.run(
      `INSERT OR IGNORE INTO selection (key, value) VALUES ('selected_tab_id', NULL)`,
    );
  }

  // === Load ===

  load(): PersistedState | null {
    const workspaces = this.db
      .query("SELECT id, name FROM workspaces ORDER BY sort_order")
      .all() as WorkspaceItemState[];

    if (workspaces.length === 0) return null;

    const tabs = (
      this.db
        .query(
          "SELECT id, workspace_id, title, icon, is_dirty, is_pinned, is_title_locked, tone FROM tabs ORDER BY sort_order",
        )
        .all() as Array<{
        id: string;
        workspace_id: string;
        title: string;
        icon: string | null;
        is_dirty: number;
        is_pinned: number;
        is_title_locked: number;
        tone: string;
      }>
    ).map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      icon: row.icon ?? undefined,
      isDirty: false, // always false on load — PTYs are dead
      isPinned: !!row.is_pinned,
      isTitleLocked: !!row.is_title_locked,
      tone: row.tone as TabState["tone"],
    }));

    const trees: Record<string, SplitTree<string>> = {};
    const treeRows = this.db
      .query("SELECT tab_id, tree_json FROM trees")
      .all() as Array<{ tab_id: string; tree_json: string }>;
    for (const row of treeRows) {
      try {
        trees[row.tab_id] = JSON.parse(row.tree_json);
      } catch {
        // Corrupt JSON — skip this tree
      }
    }

    const focusedPaneByTab: Record<string, string> = {};
    const focusRows = this.db
      .query("SELECT tab_id, pane_id FROM focus")
      .all() as Array<{ tab_id: string; pane_id: string }>;
    for (const row of focusRows) {
      focusedPaneByTab[row.tab_id] = row.pane_id;
    }

    const selectedWorkspaceId =
      (
        this.db
          .query("SELECT value FROM selection WHERE key = 'selected_workspace_id'")
          .get() as { value: string | null } | null
      )?.value ?? null;

    const selectedTabId =
      (
        this.db
          .query("SELECT value FROM selection WHERE key = 'selected_tab_id'")
          .get() as { value: string | null } | null
      )?.value ?? null;

    return {
      workspaces,
      selectedWorkspaceId,
      tabs,
      selectedTabId,
      trees,
      focusedPaneByTab,
    };
  }

  // === Save (full snapshot) ===

  save(state: PersistedState): void {
    const tx = this.db.transaction(() => {
      this.db.run("DELETE FROM focus");
      this.db.run("DELETE FROM trees");
      this.db.run("DELETE FROM tabs");
      this.db.run("DELETE FROM workspaces");

      const insertWs = this.db.prepare(
        "INSERT INTO workspaces (id, name, sort_order) VALUES (?, ?, ?)",
      );
      state.workspaces.forEach((ws, i) => {
        insertWs.run(ws.id, ws.name, i);
      });

      const insertTab = this.db.prepare(
        "INSERT INTO tabs (id, workspace_id, title, icon, is_pinned, is_title_locked, tone, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      state.tabs.forEach((tab, i) => {
        insertTab.run(
          tab.id,
          tab.workspaceId,
          tab.title,
          tab.icon ?? null,
          tab.isPinned ? 1 : 0,
          tab.isTitleLocked ? 1 : 0,
          tab.tone,
          i,
        );
      });

      const insertTree = this.db.prepare(
        "INSERT INTO trees (tab_id, tree_json) VALUES (?, ?)",
      );
      for (const [tabId, tree] of Object.entries(state.trees)) {
        insertTree.run(tabId, JSON.stringify(tree));
      }

      const insertFocus = this.db.prepare(
        "INSERT INTO focus (tab_id, pane_id) VALUES (?, ?)",
      );
      for (const [tabId, paneId] of Object.entries(state.focusedPaneByTab)) {
        insertFocus.run(tabId, paneId);
      }

      this.db.run(
        "UPDATE selection SET value = ? WHERE key = 'selected_workspace_id'",
        [state.selectedWorkspaceId],
      );
      this.db.run(
        "UPDATE selection SET value = ? WHERE key = 'selected_tab_id'",
        [state.selectedTabId],
      );
    });

    tx();
  }

  // === Incremental updates (used during bootstrap) ===

  saveWorkspace(ws: WorkspaceItemState, sortOrder: number): void {
    this.db.run(
      "INSERT OR REPLACE INTO workspaces (id, name, sort_order) VALUES (?, ?, ?)",
      [ws.id, ws.name, sortOrder],
    );
  }

  saveSelection(
    selectedWorkspaceId: string | null,
    selectedTabId: string | null,
  ): void {
    this.db.run(
      "UPDATE selection SET value = ? WHERE key = 'selected_workspace_id'",
      [selectedWorkspaceId],
    );
    this.db.run(
      "UPDATE selection SET value = ? WHERE key = 'selected_tab_id'",
      [selectedTabId],
    );
  }

  close(): void {
    this.db.close();
  }
}
