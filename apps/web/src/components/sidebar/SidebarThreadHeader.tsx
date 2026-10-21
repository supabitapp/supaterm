/**
 * The heading above the thread list, holding project scope and new project.
 *
 * The scope icon swaps to the project favicon while a project is selected,
 * and the heading names that project, so the list still says what it shows.
 *
 * The scope picker itself is passed in: its combobox state lives with the rest
 * of the sidebar's scope logic. `rowRef` lands on the row so the picker's popup
 * can anchor to its width rather than to its 28px trigger.
 */
import { FolderPlusIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, type RefObject } from "react";

import { cn } from "~/lib/utils";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  /** Lands on the row so a popup can anchor to its width. */
  rowRef?: RefObject<HTMLDivElement | null>;
  /** The selected project's name, or null for every project. */
  scopeLabel: string | null;
  /** The project scope combobox, rendered before new project. */
  projectScope: ReactNode;
  groupingMenu: ReactNode;
  onNewProject: () => void;
}

export function SidebarThreadHeader({
  rowRef,
  scopeLabel,
  projectScope,
  groupingMenu,
  onNewProject,
}: SidebarThreadHeaderProps) {
  return (
    <div ref={rowRef} className="-mb-1.5 flex items-center gap-1 pl-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-muted-foreground/80">
        {scopeLabel ?? "Threads"}
      </span>
      {/* Unfilled: the buttons carry their own hover states, and a background
          well reads far louder on themed palettes than on the base ones. */}
      <div className="flex shrink-0 items-center">
        {groupingMenu}
        {projectScope}
        <SidebarHeaderIconButton label="Add project" onClick={onNewProject}>
          <FolderPlusIcon />
        </SidebarHeaderIconButton>
      </div>
    </div>
  );
}

/**
 * Icon button with a tooltip, sized for the header's controls. Spreads
 * unknown props through so it can serve as a popup trigger's render target,
 * which injects its own handlers, ref and aria state.
 */
export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
