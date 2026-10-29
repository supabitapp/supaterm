import type { ReactNode } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useCollapsiblePanel,
} from "~/components/ui/resizable";
import { cn } from "~/lib/utils";

const FILE_EXPLORER_DEFAULT_WIDTH = 256;
const FILE_EXPLORER_MIN_WIDTH = 160;
const FILE_EXPLORER_MAX_WIDTH = 560;
const FILE_CONTENT_MIN_WIDTH = 256;

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
}: {
  content: ReactNode;
  explorer: ReactNode;
  showContent: boolean;
  showExplorer: boolean;
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
      <FileExplorerPanel open={showExplorer} resizable={!explorerOnly}>
        {showExplorer ? explorer : null}
      </FileExplorerPanel>
    </ResizablePanelGroup>
  );
}

function FileExplorerPanel({
  open,
  resizable,
  children,
}: {
  open: boolean;
  resizable: boolean;
  children: ReactNode;
}) {
  const { panelProps, handleProps } = useCollapsiblePanel({
    storageKey: "supaterm.fileExplorerWidth",
    defaultWidth: FILE_EXPLORER_DEFAULT_WIDTH,
    minWidth: FILE_EXPLORER_MIN_WIDTH,
    maxWidth: FILE_EXPLORER_MAX_WIDTH,
    open,
  });
  return (
    <>
      <ResizableHandle
        aria-label="Resize file explorer"
        {...handleProps}
        disabled={handleProps.disabled || !resizable}
      />
      <ResizablePanel
        {...panelProps}
        aria-label="File explorer"
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
