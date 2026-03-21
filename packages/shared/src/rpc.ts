import type { PaneDirection } from "./workspace.js";

export const SP_METHODS = {
  APP_TREE: "app.tree",
  SYSTEM_PING: "system.ping",
  TERMINAL_NEW_PANE: "terminal.new_pane",
} as const;

export interface SpRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface SpResponse {
  id?: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface TreeSnapshot {
  windows: Array<{
    index: number;
    isKey: boolean;
    workspaces: Array<{
      index: number;
      name: string;
      isSelected: boolean;
      tabs: Array<{
        index: number;
        title: string;
        isSelected: boolean;
        panes: Array<{ index: number; isFocused: boolean }>;
      }>;
    }>;
  }>;
}

export interface NewPaneRequest {
  command?: string;
  contextPaneID?: string;
  direction?: PaneDirection;
  focus?: boolean;
  targetPaneIndex?: number;
  targetTabIndex?: number;
  targetWindowIndex?: number;
}

// Environment variable keys injected into each PTY
export const CLI_ENV = {
  SURFACE_ID: "SUPATERM_SURFACE_ID",
  TAB_ID: "SUPATERM_TAB_ID",
  SOCKET_PATH: "SUPATERM_SOCKET_PATH",
} as const;
