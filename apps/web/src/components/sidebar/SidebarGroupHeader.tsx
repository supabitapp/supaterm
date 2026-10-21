import { sidebarListItemId, type SidebarListItem } from "../Sidebar.logic";
import { SortableSidebarMarker } from "./SidebarListMarkers";

export function SidebarGroupHeader({
  item,
}: {
  item: Extract<SidebarListItem, { kind: "group" }>;
}) {
  return (
    <SortableSidebarMarker
      id={sidebarListItemId(item)}
      className="mx-0.5 flex h-8 items-center px-2"
    >
      <span className="truncate text-xs text-sidebar-muted-foreground/80">{item.label}</span>
    </SortableSidebarMarker>
  );
}
