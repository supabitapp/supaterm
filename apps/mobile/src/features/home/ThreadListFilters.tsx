import { memo, use } from "react";
import { Pressable, ScrollView } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { ListFilterMenu } from "../workspace/ListFilterMenu";
import {
  buildHomeListFilterMenu,
  type HomeListFilterMenuInput,
  type HomeListFilterMenuSubmenu,
} from "./home-list-filter-menu";

export const ThreadListFilters = memo(function ThreadListFilters(props: HomeListFilterMenuInput) {
  const filters = buildHomeListFilterMenu(props).items.filter((item) => item.type === "submenu");
  // The scroller bleeds through the primary column's list padding so pills start where row content does.
  const gutter = use(NativePrimaryColumnContext) ? 8 : 0;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -gutter }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 2, paddingBottom: 10, gap: 8 }}
    >
      {filters.map((filter) => (
        <ThreadListFilterPill key={filter.title} filter={filter} />
      ))}
      {props.selectedEnvironmentId !== null || props.selectedProjectKey !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset thread filters"
          className="h-8 w-8 items-center justify-center"
          onPress={() => {
            props.onEnvironmentChange(null);
            props.onProjectChange(null);
          }}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColorClassName="accent-icon-muted" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
});

function ThreadListFilterPill({ filter }: { readonly filter: HomeListFilterMenuSubmenu }) {
  const current = filter.items.find((item) => item.state === "on");
  return (
    <ListFilterMenu
      label={
        filter.kind === "grouping"
          ? `Group: ${current?.title ?? "Default"}`
          : (current?.title ?? filter.title)
      }
      accessibilityLabel={
        filter.kind === "grouping"
          ? "Group threads by"
          : `Filter threads by ${filter.title.toLowerCase()}`
      }
      active={filter.kind === "filter" && current !== undefined && current !== filter.items[0]}
      actions={filter.items.map((item, index) => ({
        id: String(index),
        title: item.title,
        state: item.state,
      }))}
      onSelect={(id) => filter.items[Number(id)]?.onPress()}
    />
  );
}
