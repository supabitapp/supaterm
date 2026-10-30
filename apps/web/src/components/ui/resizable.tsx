import * as Schema from "effect/Schema";
import * as React from "react";
import {
  Cell,
  Grid,
  Gridline,
  Group,
  Panel,
  Separator,
  useGridRef,
  useGroupRef,
  usePanelCallbackRef,
  type CellProps,
  type GridlineProps,
  type GridProps,
  type GroupProps,
  type PanelProps,
  type PanelSize,
  type SeparatorProps,
} from "react-resizable-panels";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

/** Last expanded width, so collapsing content keeps its width while the panel animates closed. */
const PANEL_WIDTH_PROPERTY = "--resizable-panel-width";
const PANEL_TOGGLING_ATTRIBUTE = "data-panel-toggling";
const GROUP_ANIMATING_ATTRIBUTE = "data-panels-animating";

interface ResizablePanelGroupContextValue {
  /** Runs after each layout change the user made by pointer or keyboard. */
  readonly subscribe: (listener: () => void) => () => void;
}

const ResizablePanelGroupContext = React.createContext<ResizablePanelGroupContextValue | null>(
  null,
);

function ResizablePanelGroup({ onLayoutChanged, ...props }: GroupProps) {
  const listeners = React.useRef(new Set<() => void>());
  const context: ResizablePanelGroupContextValue = {
    subscribe: (listener) => {
      listeners.current.add(listener);
      return () => {
        listeners.current.delete(listener);
      };
    },
  };
  return (
    <ResizablePanelGroupContext value={context}>
      <Group
        data-slot="resizable-panel-group"
        onLayoutChanged={(layout, meta) => {
          onLayoutChanged?.(layout, meta);
          if (meta.isUserInteraction) listeners.current.forEach((listener) => listener());
        }}
        {...props}
      />
    </ResizablePanelGroupContext>
  );
}

function ResizablePanel({ style, ...props }: PanelProps) {
  return <Panel data-slot="resizable-panel" style={{ overflow: "hidden", ...style }} {...props} />;
}

const HANDLE_CLASS_NAME =
  "relative z-20 outline-none before:absolute after:pointer-events-none after:absolute after:transition-colors after:duration-150 aria-[orientation=vertical]:w-0 aria-[orientation=vertical]:before:inset-y-0 aria-[orientation=vertical]:before:-left-1 aria-[orientation=vertical]:before:w-2 aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:left-1/2 aria-[orientation=vertical]:after:w-px aria-[orientation=vertical]:after:-translate-x-1/2 aria-[orientation=horizontal]:h-0 aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:-top-1 aria-[orientation=horizontal]:before:h-2 aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-px aria-[orientation=horizontal]:after:-translate-y-1/2 data-[separator=active]:after:bg-primary/60 data-[separator=disabled]:hidden data-[separator=focus]:after:bg-ring data-[separator=hover]:after:bg-border";

/**
 * A zero-thickness divider. The library hit-tests its own widened target; the
 * `before` strip gives double-click a real element to land on. The library's
 * double-click resets to a percentage, so it is off and callers pass their own.
 */
function ResizableHandle({ className, ...props }: Omit<SeparatorProps, "disableDoubleClick">) {
  return (
    <Separator
      className={cn(HANDLE_CLASS_NAME, className)}
      data-slot="resizable-handle"
      disableDoubleClick
      {...props}
    />
  );
}

/** Resizable cells in two dimensions. Cells and gridlines must be its direct children. */
function ResizableGrid(props: GridProps) {
  return <Grid data-slot="resizable-grid" {...props} />;
}

function ResizableGridCell({ style, ...props }: CellProps) {
  return (
    <Cell data-slot="resizable-grid-cell" style={{ overflow: "hidden", ...style }} {...props} />
  );
}

/**
 * A zero-thickness gridline drawn like `ResizableHandle`; segments stop beside spanning cells.
 * The library forwards no DOM attributes, so the accessible name is set on its element.
 */
function ResizableGridline({ className, label, ...props }: GridlineProps & { label: string }) {
  return (
    <Gridline
      className={cn(HANDLE_CLASS_NAME, className)}
      elementRef={(element) => {
        element?.setAttribute("aria-label", label);
        element?.setAttribute("data-slot", "resizable-gridline");
      }}
      {...props}
    />
  );
}

interface ResizablePanelWidthOptions {
  /** localStorage key for the user's width; null keeps it per mount. */
  readonly storageKey: string | null;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth?: number | string | undefined;
  readonly open: boolean;
  /** Animate open on mount, for panels that mount when they open. */
  readonly animateMount?: boolean | undefined;
  /** The user dragged the panel below its collapse threshold. */
  readonly onCollapse?: (() => void) | undefined;
}

function readStoredWidth(storageKey: string | null, defaultWidth: number, minWidth: number) {
  if (storageKey === null || typeof window === "undefined") return defaultWidth;
  try {
    return Math.max(minWidth, getLocalStorageItem(storageKey, Schema.Finite) ?? defaultWidth);
  } catch (error) {
    console.error("Could not read persisted panel width.", error);
    return defaultWidth;
  }
}

function writeStoredWidth(storageKey: string | null, width: number | null) {
  if (storageKey === null) return;
  try {
    if (width === null) removeLocalStorageItem(storageKey);
    else setLocalStorageItem(storageKey, width, Schema.Finite);
  } catch (error) {
    console.error("Could not persist panel width.", error);
  }
}

/**
 * Pixel width, persistence, and open state for a collapsible side panel in a
 * `ResizablePanelGroup`. Spread `panelProps` on the panel and `handleProps` on
 * its handle. Width persists once per drag, not on every pointer move.
 */
function useCollapsiblePanel(options: ResizablePanelWidthOptions) {
  const { storageKey, defaultWidth, minWidth, maxWidth, open, animateMount } = options;
  // A callback ref re-runs the sync effect whenever the panel remounts.
  const [panel, setPanel] = usePanelCallbackRef();
  const elementRef = React.useRef<HTMLDivElement | null>(null);
  const [stored, setStored] = React.useState(() => ({
    storageKey,
    width: readStoredWidth(storageKey, defaultWidth, minWidth),
  }));
  // Panels stay mounted across threads; restore the destination width before paint.
  if (stored.storageKey !== storageKey) {
    setStored({ storageKey, width: readStoredWidth(storageKey, defaultWidth, minWidth) });
  }
  const width = stored.width;
  // Changing defaultSize re-registers the panel, so it is fixed at mount.
  const [defaultSize] = React.useState(defaultWidth);

  const applied = React.useRef<{ open: boolean; width: number } | null>(null);
  const endToggle = React.useRef<(() => void) | null>(null);
  const mountFrame = React.useRef(0);
  const animateOpen = React.useEffectEvent((element: HTMLElement) => {
    if (!open) return;
    endToggle.current = animateToggle(element);
    panel?.resize(width);
  });

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Synchronizes the imperative panel size and DOM transition with its open state and stored width.
  React.useLayoutEffect(() => {
    const element = elementRef.current;
    if (!panel || !element) return;
    element.style.setProperty(PANEL_WIDTH_PROPERTY, `${width}px`);
    const previous = applied.current;
    applied.current = { open, width };
    if (previous === null) {
      // This hook runs inside the group, so its effects precede the group's
      // registration of the panel; the first sync waits for the commit to finish.
      let pending = true;
      queueMicrotask(() => {
        if (!pending) return;
        pending = false;
        if (!open) {
          panel.collapse();
        } else if (animateMount) {
          panel.collapse();
          // Paint the collapsed frame first so the open has somewhere to animate from.
          mountFrame.current = requestAnimationFrame(() => animateOpen(element));
        } else {
          panel.resize(width);
        }
      });
      return () => {
        if (pending) applied.current = null;
        pending = false;
      };
    }
    if (previous.open === open && previous.width === width) return;
    if (previous.open !== open) {
      endToggle.current?.();
      endToggle.current = animateToggle(element);
    }
    if (open) panel.resize(width);
    else panel.collapse();
  }, [animateMount, open, panel, width]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Cancels the pending animation frame and removes DOM transition listeners on unmount.
  React.useEffect(
    () => () => {
      cancelAnimationFrame(mountFrame.current);
      endToggle.current?.();
    },
    [],
  );

  const subscribe = React.use(ResizablePanelGroupContext)?.subscribe;
  const handleLayoutChanged = React.useEffectEvent(() => {
    const group = elementRef.current?.parentElement;
    if (!panel || !group || !open) return;
    if (panel.isCollapsed()) {
      options.onCollapse?.();
      return;
    }
    const nextWidth = Math.round((panel.getSize().asPercentage / 100) * group.offsetWidth);
    if (nextWidth === width) return;
    applied.current = { open: true, width: nextWidth };
    setStored({ storageKey, width: nextWidth });
    writeStoredWidth(storageKey, nextWidth);
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Subscribes to panel layout events to persist user resizing and report collapse.
  React.useEffect(() => subscribe?.(handleLayoutChanged), [subscribe]);

  // Sizes are measured, so a toggle reports every animated frame; keep the pinned width.
  const onResize = (size: PanelSize) => {
    const element = elementRef.current;
    if (!element || size.inPixels === 0 || element.hasAttribute(PANEL_TOGGLING_ATTRIBUTE)) return;
    element.style.setProperty(PANEL_WIDTH_PROPERTY, `${size.inPixels}px`);
  };

  const reset = () => {
    writeStoredWidth(storageKey, null);
    applied.current = { open, width: defaultWidth };
    setStored({ storageKey, width: defaultWidth });
    if (open) panel?.resize(defaultWidth);
  };

  return {
    panelProps: {
      panelRef: setPanel,
      elementRef,
      defaultSize,
      minSize: minWidth,
      ...(maxWidth !== undefined ? { maxSize: maxWidth } : {}),
      collapsible: true,
      collapsedSize: 0,
      groupResizeBehavior: "preserve-pixel-size",
      onResize,
    } satisfies PanelProps,
    handleProps: {
      disabled: !open,
      onDoubleClick: reset,
    } satisfies SeparatorProps,
  };
}

/**
 * Animates only an explicit open or close, never drags or window resizes. Every
 * panel in the group transitions so the sizes stay consistent mid-animation.
 */
function animateToggle(panel: HTMLElement): (() => void) | null {
  const group = panel.parentElement;
  if (!group) return null;
  const end = () => {
    group.removeAttribute(GROUP_ANIMATING_ATTRIBUTE);
    panel.removeAttribute(PANEL_TOGGLING_ATTRIBUTE);
    panel.removeEventListener("transitionend", onTransitionEnd);
    panel.removeEventListener("transitioncancel", onTransitionEnd);
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === panel) end();
  };
  group.setAttribute(GROUP_ANIMATING_ATTRIBUTE, "");
  panel.setAttribute(PANEL_TOGGLING_ATTRIBUTE, "");
  if (Number.parseFloat(getComputedStyle(panel).transitionDuration) === 0) {
    end();
    return null;
  }
  panel.addEventListener("transitionend", onTransitionEnd);
  panel.addEventListener("transitioncancel", onTransitionEnd);
  return end;
}

export {
  ResizableGrid,
  ResizableGridCell,
  ResizableGridline,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useCollapsiblePanel,
  useGridRef,
  useGroupRef,
};
