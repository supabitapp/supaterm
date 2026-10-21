import { sidebarListItemId, type SidebarListItem } from "../Sidebar.logic";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { SortableSidebarMarker } from "./SidebarListMarkers";

export function SidebarGroupHeader({
  item,
  onToggle,
  prepare,
}: {
  item: Extract<SidebarListItem, { kind: "group" }>;
  onToggle: (key: string) => void;
  prepare: () => void;
}) {
  return (
    <SortableSidebarMarker id={sidebarListItemId(item)} className="mx-0.5 h-8">
      <CollapsibleSectionHeader
        onClick={() => {
          prepare();
          onToggle(item.key);
        }}
        expanded={!item.collapsed}
        weight="normal"
        data-testid={`sidebar-group-toggle-${item.key}`}
      >
        {item.collapsed ? `${item.label} (${item.count})` : item.label}
      </CollapsibleSectionHeader>
    </SortableSidebarMarker>
  );
}
