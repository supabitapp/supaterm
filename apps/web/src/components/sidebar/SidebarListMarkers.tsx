import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLayoutEffect, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import {
  animateSidebarLayoutChanges,
  sidebarMarkerId,
  type SidebarListMarker,
} from "../Sidebar.logic";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

export const SIDEBAR_SORTABLE_DRAG_DISABLED = { draggable: true } as const;

export function SortableSidebarMarker(
  props: ({ marker: SidebarListMarker; id?: never } | { id: string; marker?: never }) & {
    className?: string;
    children?: ReactNode;
    "data-testid"?: string;
    revealOverflow?: boolean;
  },
) {
  const { node, setNodeRef, transform, transition } = useSortable({
    id: props.id ?? sidebarMarkerId(props.marker),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- keeps the translated drop hint inside the sidebar scroll viewport
  useLayoutEffect(() => {
    if (props.revealOverflow && transform?.y !== undefined)
      node.current?.firstElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [node, props.revealOverflow, transform?.y]);
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-testid={props["data-testid"]}
      className={cn("list-none", props.className)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker?.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

export function SidebarSectionPlaceholder(props: {
  marker: "active-placeholder" | "done-placeholder";
  label: string;
  showHint: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="relative mx-0.5 -mb-px h-0"
      revealOverflow={props.marker === "done-placeholder" && props.showHint}
    >
      {props.showHint ? (
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-md border border-dashed border-sidebar-foreground/25 text-xs text-sidebar-foreground/80",
            props.isDropTarget && "border-primary/40 bg-primary/5 text-primary",
          )}
        >
          {props.label}
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

export const SIDEBAR_DRAG_LABEL_HEIGHT = 24;

export function SidebarDragBoundary(props: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  persistent?: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("pointer-events-none relative mx-0.5", props.persistent ? "h-8" : "-mb-px h-0")}
    >
      {props.visible || props.persistent ? (
        <div
          className={cn(
            "sidebar-drag-boundary-label absolute inset-x-2 flex h-4 items-center gap-2",
            props.persistent ? "top-2" : "top-1",
          )}
        >
          <span
            className={cn(
              "shrink-0 text-xs",
              props.isDropTarget ? "text-primary" : "text-sidebar-muted-foreground/60",
            )}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "h-px flex-1",
              props.isDropTarget ? "bg-primary/50" : "bg-sidebar-border/60",
            )}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

export function SidebarSectionHeader(props: {
  marker: "pinned-header" | "working-header" | "snoozed-header" | "done-header";
  label: string;
  className?: string;
  dragging?: boolean;
  isDropTarget?: boolean;
  toggle: { expanded: boolean; onToggle: () => void; prepare: () => void };
}) {
  const shelf = props.marker.replace("-header", "");
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("mx-0.5 h-8", props.className)}
    >
      <CollapsibleSectionHeader
        role="treeitem"
        tabIndex={-1}
        data-sidebar-row={`shelf:${shelf}`}
        onClick={() => {
          props.toggle.prepare();
          props.toggle.onToggle();
        }}
        expanded={props.toggle.expanded}
        weight="normal"
        tone={props.isDropTarget ? "accent" : props.dragging ? "emphasized" : "muted"}
        data-testid={`sidebar-${shelf}-shelf-toggle`}
      >
        {props.label}
      </CollapsibleSectionHeader>
    </SortableSidebarMarker>
  );
}
