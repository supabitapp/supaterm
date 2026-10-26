import {
  ArrowLeftIcon,
  ChartColumnIcon,
  CircleHelpIcon,
  GlobeIcon,
  MessageSquareTextIcon,
  SettingsIcon,
} from "@supaterm/icons";
import type { MouseEvent, ReactNode } from "react";
import { memo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { parseKeybindingShortcut } from "@supaterm/shared/keybindings";
import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";

import { APP_BASE_NAME, SOURCE_CODE_URL, WEBSITE_URL } from "../../branding";
import { isElectron } from "../../env";
import { useStartTriage, useTriageEnvironmentId } from "../../hooks/useStartTriage";
import { useShortcutLabel } from "../../hooks/useShortcutLabel";
import { formatShortcutLabel } from "../../keybindings";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { usePullRequestsSupported } from "../../state/environments";
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
import { useEnvironmentStageLabel } from "./environmentIdentification";
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
        "flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-3",
        isElectron && "drag-region",
      )}
    >
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger aria-label="Toggle main sidebar" />
      </div>
      <div className="flex h-8 min-w-0 flex-1 items-center overflow-hidden py-0.5">
        <SidebarBrand />
      </div>
    </div>
  );
});

export function SidebarBrandWidthProbe({
  onWidthChange,
}: {
  onWidthChange: (width: number) => void;
}) {
  const title = useSidebarBrandTitle();
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
      <div className="ml-[var(--workspace-titlebar-content-left)] flex">
        <SidebarBrandMark title={title} />
      </div>
    </div>
  );
}

function SidebarBrand() {
  const title = useSidebarBrandTitle();
  return (
    <Link
      aria-label={`${title}, go to threads`}
      className="flex h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset md:ml-[var(--workspace-titlebar-content-left)]"
      to="/"
    >
      <SidebarBrandMark title={title} />
    </Link>
  );
}

function useSidebarBrandTitle() {
  const stageLabel = useEnvironmentStageLabel();
  return stageLabel ? `${APP_BASE_NAME} (${stageLabel})` : APP_BASE_NAME;
}

function SidebarBrandMark({ title }: { title: string }) {
  return <span className="truncate text-sm font-semibold">{title}</span>;
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
              label="Pull Requests"
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
      <SidebarHelpItem closeMobileSidebar={closeMobileSidebar} />
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter({
  showUndoNotice = false,
}: {
  showUndoNotice?: boolean;
}) {
  return (
    <SidebarFooter>
      {showUndoNotice ? <SidebarThreadUndoNotice /> : null}
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
