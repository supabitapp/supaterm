/**
 * The heading above the thread list, holding the list options and new project.
 *
 * The heading names the selected project while the list is filtered to one,
 * so the list still says what it shows once the options menu closes.
 */
import { FolderPlusIcon } from "lucide-react";
import { type ComponentProps, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  /** The selected project's name, or null for every project. */
  scopeLabel: string | null;
  optionsMenu: ReactNode;
  onNewProject: () => void;
}

export function SidebarThreadHeader({
  scopeLabel,
  optionsMenu,
  onNewProject,
}: SidebarThreadHeaderProps) {
  return (
    <div className="-mb-1.5 flex items-center gap-1 pl-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-muted-foreground/80">
        {scopeLabel ?? "Threads"}
      </span>
      {/* Unfilled: the buttons carry their own hover states, and a background
          well reads far louder on themed palettes than on the base ones. */}
      <div className="flex shrink-0 items-center">
        {optionsMenu}
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
