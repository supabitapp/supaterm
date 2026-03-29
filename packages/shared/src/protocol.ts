import type { Direction } from "./split-tree.js";
import type {
  PaneDirection,
  PaneState,
  TabState,
  WorkspaceItemState,
  WorkspaceState,
} from "./workspace.js";
import type { SplitTree } from "./split-tree.js";

// === Client → Server ===

export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "sync" }
  | { type: "create_tab"; inheritFromPaneId?: string }
  | { type: "close_tab"; tabId: string }
  | { type: "select_tab"; tabId: string }
  | { type: "select_tab_slot"; slot: number }
  | { type: "next_tab" }
  | { type: "previous_tab" }
  | {
      type: "create_pane";
      tabId: string;
      direction: PaneDirection;
      targetPaneId?: string;
      command?: string;
      focus?: boolean;
    }
  | { type: "close_pane"; paneId: string }
  | {
      type: "resize_pane";
      paneId: string;
      cols: number;
      rows: number;
      pixelWidth?: number;
      pixelHeight?: number;
    }
  | { type: "focus_pane"; paneId: string }
  | { type: "split_resize"; paneId: string; delta: number; axis: Direction }
  | { type: "equalize_panes"; tabId: string }
  | { type: "toggle_zoom"; tabId: string }
  | { type: "create_workspace" }
  | { type: "delete_workspace"; workspaceId: string }
  | { type: "rename_workspace"; workspaceId: string; name: string }
  | { type: "select_workspace"; workspaceId: string }
  | { type: "set_tab_order"; tabIds: string[]; pinned: boolean }
  | { type: "toggle_pinned"; tabId: string }
  | { type: "resume"; paneOffsets: Record<string, number> };

// === Server → Client ===

export type ServerMessage =
  | { type: "auth_ok" }
  | { type: "auth_error"; message: string }
  | { type: "sync"; state: WorkspaceState }
  | {
      type: "pane_created";
      paneId: string;
      tabId: string;
      ptyUrl: string;
      pane: PaneState;
    }
  | {
      type: "pane_closed";
      paneId: string;
      tabId: string;
      nextFocusId?: string;
    }
  | { type: "pane_title_changed"; paneId: string; title: string }
  | { type: "pane_resized"; paneId: string; cols: number; rows: number }
  | { type: "tab_created"; tab: TabState }
  | { type: "tab_closed"; tabId: string; nextTabId?: string }
  | { type: "tab_selected"; tabId: string }
  | { type: "tab_updated"; tabId: string; patch: Partial<TabState> }
  | { type: "workspace_created"; workspace: WorkspaceItemState }
  | { type: "workspace_deleted"; workspaceId: string }
  | { type: "workspace_renamed"; workspaceId: string; name: string }
  | { type: "workspace_selected"; workspaceId: string }
  | {
      type: "split_tree_updated";
      tabId: string;
      tree: SplitTree<string>;
    }
  | { type: "focus_changed"; tabId: string; paneId: string }
  | { type: "tab_order_changed"; tabIds: string[]; pinned: boolean }
  | { type: "resume_ok"; replaying: string[] }
  | { type: "resume_complete" }
  | { type: "error"; code: string; message: string };
