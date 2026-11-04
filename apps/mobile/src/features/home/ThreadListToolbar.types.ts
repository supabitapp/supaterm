import type { WorkspaceFilterMenu } from "../workspace/workspace-filter-menu";

export interface ThreadListToolbarProps {
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly filterMenu: WorkspaceFilterMenu;
  readonly onOpenEnvironments: () => void;
  readonly onRequestVisibility?: () => void;
}
