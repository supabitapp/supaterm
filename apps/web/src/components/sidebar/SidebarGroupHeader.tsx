import { PlusIcon } from "@supaterm/icons";
import { Button } from "../ui/button";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "~/lib/utils";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import {
  animateSidebarLayoutChanges,
  sidebarListItemId,
  type SidebarListItem,
} from "../Sidebar.logic";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { SIDEBAR_SORTABLE_DRAG_DISABLED } from "./SidebarListMarkers";

const FOLDER_DOT = {
  attention: { className: "bg-warning", label: "Needs you" },
  failed: { className: "bg-error", label: "Failed" },
  unread: { className: "bg-success", label: "Done" },
  working: { className: "bg-info", label: "Working" },
};

export function SidebarGroupHeader({
  item,
  project,
  onNewThread,
  onToggle,
  prepare,
}: {
  item: Extract<SidebarListItem, { kind: "group" }>;
  project: ProjectFaviconProject | null;
  onToggle: (key: string) => void;
  onNewThread?: (() => void) | undefined;
  prepare: () => void;
}) {
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({
    id: sidebarListItemId(item),
    disabled: item.projectKey === null ? SIDEBAR_SORTABLE_DRAG_DISABLED : false,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-testid={`sidebar-group-${item.key}`}
      className={cn(
        "mx-0.5 h-8 list-none",
        isDragging &&
          "relative z-10 rounded-md bg-sidebar bg-linear-to-b from-sidebar-row-active to-sidebar-row-active shadow-lg",
      )}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        visibility: !isDragging && transform?.scaleY === 0 ? "hidden" : undefined,
      }}
      {...listeners}
    >
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <CollapsibleSectionHeader
            role="treeitem"
            tabIndex={-1}
            data-sidebar-row={item.key}
            onClick={() => {
              prepare();
              onToggle(item.key);
            }}
            expanded={!item.collapsed}
            weight="normal"
            tone={isDragging ? "emphasized" : "muted"}
            icon={
              project ? <ProjectFavicon project={project} className="size-3.5 shrink-0" /> : null
            }
            data-testid={`sidebar-group-toggle-${item.key}`}
          >
            {item.collapsed ? `${item.label} (${item.count})` : item.label}
            {item.dot ? (
              <span
                className={cn("size-1.5 shrink-0 rounded-full", FOLDER_DOT[item.dot].className)}
              >
                <span className="sr-only">{FOLDER_DOT[item.dot].label}</span>
              </span>
            ) : null}
          </CollapsibleSectionHeader>
        </div>
        {onNewThread ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            data-sidebar-action-for={item.key}
            aria-label={`New thread in ${item.label}`}
            onClick={onNewThread}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
