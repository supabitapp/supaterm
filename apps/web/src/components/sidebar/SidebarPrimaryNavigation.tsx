import type { ScopedProjectRef } from "@supaterm/contracts";
import { Link, useLocation, useParams, useRouter } from "@tanstack/react-router";
import { CalendarClockIcon, SquarePenIcon } from "@supaterm/icons";
import type { MouseEvent as ReactMouseEvent } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import {
  readRouteThreadContext,
  useNewThreadHandler,
  useStartNewThreadInCurrentProject,
} from "../../hooks/useHandleNewThread";
import { useShortcutLabel } from "../../hooks/useShortcutLabel";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { resolveScopedNewThreadProjectRef } from "../Sidebar.logic";

export function SidebarPrimaryNavigation({
  projectGroupCount,
  scopedProjectGroups,
}: {
  projectGroupCount: number;
  scopedProjectGroups: ReadonlyArray<{
    readonly environmentId: string;
    readonly id: string;
    readonly memberProjectRefs: readonly ScopedProjectRef[];
  }>;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const size = isMobile ? "default" : "compact";
  const newThreadShortcut = useShortcutLabel("chat.newLocal");
  const automationsShortcut = useShortcutLabel("automations.open");
  const router = useRouter();
  const startNewThreadIn = useNewThreadHandler();
  const startNewThreadInCurrentProject = useStartNewThreadInCurrentProject();
  const newThreadActive = useParams({
    strict: false,
    select: (params) => Boolean(params.draftId),
  });
  const automationsActive = useLocation({
    select: (location) => location.pathname === "/automations",
  });
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  const handleNewThread = (event: ReactMouseEvent) => {
    closeMobileSidebar();
    const { activeThread, activeDraftThread } = readRouteThreadContext(router);
    const scopedProjectRef = resolveScopedNewThreadProjectRef({
      shiftKey: event.shiftKey,
      scopedProjectGroups,
      viewed: activeThread ?? activeDraftThread,
    });
    if (scopedProjectRef) {
      void startNewThreadIn(scopedProjectRef);
      return;
    }
    void startNewThreadInCurrentProject().then((started) => {
      if (!started) openCommandPalette({ open: "new-thread-in" });
    });
  };

  return (
    <SidebarMenu size={size}>
      <SidebarMenuItem>
        <SidebarMenuButton
          size={size}
          isActive={newThreadActive}
          disabled={projectGroupCount === 0}
          onClick={handleNewThread}
          shortcut={newThreadShortcut}
        >
          <SquarePenIcon />
          <span>New thread</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          size={size}
          isActive={automationsActive}
          render={<Link to="/automations" onClick={closeMobileSidebar} />}
          shortcut={automationsShortcut}
        >
          <CalendarClockIcon />
          <span>Automations</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
