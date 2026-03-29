import type { SplitTree } from "./split-tree.js";

export type PaneDirection = "up" | "down" | "left" | "right";
export type TabTone = "amber" | "coral" | "mint" | "sky" | "slate" | "violet";

export const TAB_TONES: TabTone[] = [
  "amber",
  "coral",
  "mint",
  "sky",
  "slate",
  "violet",
];

export function toneFromId(id: string): TabTone {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return TAB_TONES[Math.abs(hash) % TAB_TONES.length]!;
}

export interface WorkspaceItemState {
  id: string;
  name: string;
}

export interface TabState {
  id: string;
  workspaceId: string;
  title: string;
  icon?: string;
  isDirty: boolean;
  isPinned: boolean;
  isTitleLocked: boolean;
  tone: TabTone;
}

export interface PaneState {
  id: string;
  tabId: string;
  sessionName: string;
  title: string;
  pwd?: string;
  isRunning: boolean;
  cols: number;
  rows: number;
}

export interface WorkspaceState {
  workspaces: WorkspaceItemState[];
  selectedWorkspaceId: string | null;
  tabs: TabState[];
  selectedTabId: string | null;
  trees: Record<string, SplitTree<string>>;
  focusedPaneByTab: Record<string, string>;
  panes: Record<string, PaneState>;
}
