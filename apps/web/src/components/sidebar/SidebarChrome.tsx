import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChartColumnIcon,
  CircleHelpIcon,
  GlobeIcon,
  MessageSquareTextIcon,
  SearchIcon,
  SettingsIcon,
} from "@supaterm/icons";
import type { MouseEvent, ReactNode } from "react";
import { memo } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { parseKeybindingShortcut } from "@supaterm/shared/keybindings";
import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";

import { SOURCE_CODE_URL, WEBSITE_URL } from "../../branding";
import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useStartTriage, useTriageEnvironmentId } from "../../hooks/useStartTriage";
import { useShortcutLabel } from "../../hooks/useShortcutLabel";
import { formatShortcutLabel } from "../../keybindings";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import { usePullRequestsSupported } from "../../state/environments";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { sourceControlIcon } from "~/sourceControlPresentation";
import { observeResize } from "~/lib/observeResize";

const GitHubIcon = sourceControlIcon(sourceControlClients.get("github"));

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-[calc((var(--workspace-topbar-height)+var(--workspace-titlebar-control-size))/2)] shrink-0 flex-row items-end pr-3",
        isElectron && "drag-region",
      )}
    >
      {/* From md up, the window-corner toggle sits where the in-flow trigger would be. */}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex min-w-0 flex-1 items-center md:ml-[calc(var(--workspace-controls-left)+1px+var(--workspace-titlebar-control-size))]">
        <SidebarTrigger className="md:hidden" aria-label="Toggle main sidebar" />
        <SidebarSearchButton />
        {isElectron ? (
          <div className="ml-auto hidden md:flex">
            <HistoryNavigationButton direction="back" />
            <HistoryNavigationButton direction="forward" />
          </div>
        ) : null}
      </div>
    </div>
  );
});

export function SidebarHeaderWidthProbe({
  onWidthChange,
}: {
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3"
      ref={observeWidth}
    >
      <div
        className={cn(
          "ml-[calc(var(--workspace-controls-left)+1px)]",
          isElectron
            ? "w-[calc(4*var(--workspace-titlebar-control-size))]"
            : "w-[calc(2*var(--workspace-titlebar-control-size))]",
        )}
      />
    </div>
  );
}

export function MainSidebarToggle({ className }: { className?: string }) {
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const shortcut = useShortcutLabel("sidebar.toggle", { context: { usagePageOpen } });
  return (
    <Tooltip>
      <TooltipTrigger
        render={<SidebarTrigger className={className} aria-label="Toggle main sidebar" />}
      />
      <TooltipPopup side="bottom" shortcut={shortcut}>
        Toggle main sidebar
      </TooltipPopup>
    </Tooltip>
  );
}

function SidebarSearchButton() {
  const { isMobile, setOpenMobile } = useSidebar();
  const shortcut = useShortcutLabel("commandPalette.toggle");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Search"
            onClick={() => {
              // The palette is a dialog over the whole app, so the sidebar sheet closes first.
              if (isMobile) setOpenMobile(false);
              openCommandPalette();
            }}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <SearchIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom" shortcut={shortcut}>
        Search
      </TooltipPopup>
    </Tooltip>
  );
}

const HISTORY_BUTTONS = {
  back: { label: "Go back", command: "navigation.back", Icon: ArrowLeftIcon },
  forward: { label: "Go forward", command: "navigation.forward", Icon: ArrowRightIcon },
} as const;

function HistoryNavigationButton({ direction }: { direction: HistoryDirection }) {
  const { label, command, Icon } = HISTORY_BUTTONS[direction];
  const enabled = useCanNavigateHistory(direction);
  const shortcut = useShortcutLabel(command);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={!enabled}
            onClick={() => navigateHistory(direction)}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipPopup side="bottom" shortcut={shortcut}>
        {label}
      </TooltipPopup>
    </Tooltip>
  );
}

// The desktop app's Settings menu item owns Mod+, so it is not in the keybinding registry.
const DESKTOP_SETTINGS_SHORTCUT = parseKeybindingShortcut("mod+,")!;

function SidebarUtilityItem({
  icon,
  label,
  shortcut = null,
  className,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string | null;
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <SidebarMenuItem className={cn("shrink-0", className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top" shortcut={shortcut}>
          {label}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

function openExternalLink(url: string) {
  void readLocalApi()
    ?.shell.openExternal(url)
    .catch(() => toastManager.add({ type: "error", title: "Unable to open the link" }));
}

function SidebarHelpItem({ closeMobileSidebar }: { closeMobileSidebar: () => void }) {
  const startTriage = useStartTriage();
  const triageEnvironmentId = useTriageEnvironmentId();

  return (
    <SidebarMenuItem className="ml-auto shrink-0">
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={<MenuTrigger render={<SidebarMenuButton aria-label="Help" size="icon" />} />}
          >
            <CircleHelpIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">Help</TooltipPopup>
        </Tooltip>
        <MenuPopup side="top" align="end">
          <MenuItem
            disabled={triageEnvironmentId === null}
            onClick={() => {
              if (triageEnvironmentId === null) return;
              closeMobileSidebar();
              void startTriage(triageEnvironmentId);
            }}
          >
            <MessageSquareTextIcon />
            Send feedback
          </MenuItem>
          <MenuItem onClick={() => openExternalLink(WEBSITE_URL)}>
            <GlobeIcon />
            supaterm.com
          </MenuItem>
          <MenuItem onClick={() => openExternalLink(SOURCE_CODE_URL)}>
            <GitHubIcon />
            View source on GitHub
          </MenuItem>
        </MenuPopup>
      </Menu>
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const pullRequestsSupported = usePullRequestsSupported();
  const usageShortcut = useShortcutLabel("usage.open");
  const settingsShortcut = isElectron ? formatShortcutLabel(DESKTOP_SETTINGS_SHORTCUT) : null;
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <SidebarMenu className="flex-row items-center">
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
      {isOnUtilityPage ? null : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label="Settings"
            shortcut={settingsShortcut}
            onClick={handleSettingsClick}
          />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label="Pull requests"
              onClick={handlePullRequestsClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartColumnIcon />}
            label="Usage"
            shortcut={usageShortcut}
            onClick={handleUsageClick}
          />
        </>
      )}
      <SidebarThreadUndoNotice />
      <SidebarHelpItem closeMobileSidebar={closeMobileSidebar} />
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
