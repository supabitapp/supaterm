import { NativeStackScreenOptions } from "../../native/StackHeader";
import { ThreadListToolbar } from "./ThreadListToolbar";
import { useThreadListFilterMenu } from "./useThreadListFilterMenu";
import type { HomeHeaderProps } from "./HomeHeader.types";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

export function HomeHeader(props: HomeHeaderProps) {
  const menu = useThreadListFilterMenu(props);
  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <ThreadListToolbar
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        filterMenu={menu}
        onOpenSettings={props.onOpenSettings}
        onOpenEnvironments={props.onOpenEnvironments}
      />
    </>
  );
}
