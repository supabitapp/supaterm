import { createContext, use, type ComponentProps, type ReactNode } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useCollapsiblePanel,
} from "~/components/ui/resizable";
import { cn } from "~/lib/utils";

const PREVIEW_PANEL_DEFAULT_WIDTH = 540;
const PREVIEW_PANEL_MIN_WIDTH = 360;
/** Only binds on wide screens; the sibling column's minimum binds first on narrow ones. */
const PREVIEW_PANEL_MAX_WIDTH = "70vw";
/** Floor for the column beside the panel: below this the chat composer overflows. */
const PREVIEW_PANEL_SIBLING_MIN_WIDTH = 360;

export const MaximizedContext = createContext(false);

/**
 * The row an inline preview panel sits in: one `PreviewPanelSibling`, then one
 * `PreviewPanelInline`. Keep every other element outside it; the library treats
 * all direct children as layout items.
 */
export function PreviewPanelGroup({
  maximized,
  className,
  ...props
}: ComponentProps<typeof ResizablePanelGroup> & { maximized: boolean }) {
  return (
    <MaximizedContext value={maximized}>
      <ResizablePanelGroup
        className={cn(
          // Maximize overrides the library's inline flex-grow so the stored layout survives it.
          "data-[maximized=true]:[&>[data-preview-panel-inline]]:grow! data-[maximized=true]:[&>[data-preview-panel-sibling]]:grow-0!",
          className,
        )}
        data-maximized={maximized}
        {...props}
      />
    </MaximizedContext>
  );
}

/** The column beside an inline preview panel; it yields the row while the panel is maximized. */
export function PreviewPanelSibling(props: ComponentProps<typeof ResizablePanel>) {
  return (
    <ResizablePanel
      data-preview-panel-sibling=""
      id="preview-panel-sibling"
      minSize={PREVIEW_PANEL_SIBLING_MIN_WIDTH}
      {...props}
    />
  );
}

/** A collapsible panel resized from its left edge, with its width persisted under `widthStorageKey`. */
export function PreviewPanelInline(props: {
  open: boolean;
  widthStorageKey: string;
  /** The initial width (px) before the user has resized the panel. */
  defaultWidth?: number;
  /** The user dragged the panel closed. */
  onCollapse: () => void;
  children: ReactNode;
}) {
  const maximized = use(MaximizedContext);
  const { panelProps, handleProps } = useCollapsiblePanel({
    storageKey: props.widthStorageKey,
    defaultWidth: props.defaultWidth ?? PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth: PREVIEW_PANEL_MAX_WIDTH,
    open: props.open,
    animateMount: true,
    onCollapse: props.onCollapse,
  });
  return (
    <>
      <ResizableHandle
        aria-label="Resize panel"
        {...handleProps}
        disabled={handleProps.disabled || maximized}
      />
      <ResizablePanel {...panelProps} data-preview-panel-inline="" id="right-panel">
        {props.children}
      </ResizablePanel>
    </>
  );
}
