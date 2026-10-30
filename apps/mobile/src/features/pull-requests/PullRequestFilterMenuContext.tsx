import {
  createContext,
  use,
  useLayoutEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { WorkspaceFilterMenu } from "../workspace/workspace-filter-menu";

const MenuContext = createContext<WorkspaceFilterMenu | null>(null);
const PublishContext = createContext<Dispatch<SetStateAction<WorkspaceFilterMenu | null>> | null>(
  null,
);

/**
 * The Android PR header opens the filter menu, but its facets come from the list below it.
 * The list publishes its menu here and only the header reads it, so the list's own renders
 * don't fan out.
 */
export function PullRequestFilterMenuProvider(props: { readonly children: ReactNode }) {
  const [menu, setMenu] = useState<WorkspaceFilterMenu | null>(null);
  return (
    <PublishContext value={setMenu}>
      <MenuContext value={menu}>{props.children}</MenuContext>
    </PublishContext>
  );
}

export function usePullRequestFilterMenu() {
  return use(MenuContext);
}

export function usePublishPullRequestFilterMenu(menu: WorkspaceFilterMenu | null) {
  const publish = use(PublishContext);
  // A layout effect lands the header's filter button in the same frame as the list. There is no
  // cleanup: the list lives exactly as long as this provider.
  useLayoutEffect(() => {
    if (publish && menu) publish(menu);
  }, [publish, menu]);
}
