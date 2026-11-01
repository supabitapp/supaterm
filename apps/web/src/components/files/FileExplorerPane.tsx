import type { ReactNode } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useCollapsiblePanel,
} from "~/components/ui/resizable";
import { cn } from "~/lib/utils";

const FILE_EXPLORER_MAX_WIDTH = 560;
const FILE_CONTENT_MIN_WIDTH = 256;

/** Each surface keeps its own saved width, since their defaults and minimums differ. */
interface FileExplorerSizing {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly label: string;
  readonly resizeLabel: string;
}

const FILE_EXPLORER_SIZING: FileExplorerSizing = {
  storageKey: "supaterm.fileExplorerWidth",
  defaultWidth: 256,
  minWidth: 160,
  label: "File explorer",
  resizeLabel: "Resize file explorer",
};

export const CHANGES_FILE_TREE_SIZING: FileExplorerSizing = {
  storageKey: "supaterm:diff-file-tree-width",
  defaultWidth: 256,
  minWidth: 160,
  label: "Changes files",
  resizeLabel: "Resize Changes files",
};

export const PR_CODE_FILE_TREE_SIZING: FileExplorerSizing = {
  storageKey: "supaterm:pr-code-file-tree-width",
  defaultWidth: 320,
  minWidth: 192,
  label: "PR Code files",
  resizeLabel: "Resize PR Code files",
};

/**
 * The file preview row: the open file, then the explorer resized from its left
 * edge. Without an open file the explorer fills the row; CSS overrides the
 * library's flex-grow so the stored layout returns when a file opens again.
 */
export function FilePreviewSplit({
  content,
  explorer,
  showContent,
  showExplorer,
  sizing = FILE_EXPLORER_SIZING,
}: {
  content: ReactNode;
  explorer: ReactNode;
  showContent: boolean;
  showExplorer: boolean;
  sizing?: FileExplorerSizing;
}) {
  const explorerOnly = !showContent && showExplorer;
  return (
    <ResizablePanelGroup
      className="min-h-0 flex-1 overflow-hidden data-[explorer-only=true]:[&>[data-file-content]]:grow-0! data-[explorer-only=true]:[&>[data-file-explorer]]:grow!"
      data-explorer-only={explorerOnly}
    >
      <ResizablePanel
        className={cn("min-w-0 flex-col overflow-hidden", showContent ? "flex" : "hidden")}
        data-file-content=""
        minSize={FILE_CONTENT_MIN_WIDTH}
      >
        {content}
      </ResizablePanel>
      <FileExplorerPanel open={showExplorer} resizable={!explorerOnly} sizing={sizing}>
        {showExplorer ? explorer : null}
      </FileExplorerPanel>
    </ResizablePanelGroup>
  );
}

function FileExplorerPanel({
  open,
  resizable,
  sizing,
  children,
}: {
  open: boolean;
  resizable: boolean;
  sizing: FileExplorerSizing;
  children: ReactNode;
}) {
  const { panelProps, handleProps } = useCollapsiblePanel({
    storageKey: sizing.storageKey,
    defaultWidth: sizing.defaultWidth,
    minWidth: sizing.minWidth,
    maxWidth: FILE_EXPLORER_MAX_WIDTH,
    open,
  });
  return (
    <>
      <ResizableHandle
        aria-label={sizing.resizeLabel}
        {...handleProps}
        disabled={handleProps.disabled || !resizable}
      />
      <ResizablePanel
        {...panelProps}
        aria-label={sizing.label}
        className="flex"
        data-file-explorer=""
      >
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 bg-background",
            resizable && "border-l border-border/60",
          )}
        >
          {children}
        </div>
      </ResizablePanel>
    </>
  );
}
