import { THREAD_GROUPING_OPTIONS } from "@supaterm/client-runtime/state/thread-grouping";
import { SlidersHorizontalIcon } from "@supaterm/icons";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

export function SidebarThreadListMenu({
  open,
  onOpenChange,
  hidesOfflineThreads,
  projectFilter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether hiding offline environments leaves out a row the list would otherwise show. */
  hidesOfflineThreads: boolean;
  projectFilter: ReactNode;
}) {
  const grouping = useClientSettings((settings) => settings.sidebarThreadGrouping);
  const hideOfflineEnvironments = useClientSettings(
    (settings) => settings.sidebarHideOfflineEnvironments,
  );
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger
        render={
          <SidebarHeaderIconButton
            label={
              hidesOfflineThreads
                ? "Thread list options, offline environments hidden"
                : "Thread list options"
            }
          />
        }
      >
        <SlidersHorizontalIcon />
        {hidesOfflineThreads ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 size-1.5 rounded-full bg-muted-foreground"
          />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end">
        {projectFilter}
        <MenuSub>
          <MenuSubTrigger>
            <span className="flex-1">Grouping</span>
            {/* Every label shares one cell so the popup keeps the widest one's
                width: a resize re-runs collision flipping and moves the menu. */}
            <span className="ml-6 grid justify-items-end text-muted-foreground">
              {THREAD_GROUPING_OPTIONS.map((option) => (
                <span
                  key={option.value}
                  className={cn(
                    "col-start-1 row-start-1",
                    option.value !== grouping && "invisible",
                  )}
                >
                  {option.label}
                </span>
              ))}
            </span>
          </MenuSubTrigger>
          <MenuSubPopup>
            <MenuRadioGroup
              value={grouping}
              onValueChange={(value) => {
                const option = THREAD_GROUPING_OPTIONS.find((entry) => entry.value === value);
                if (option) void updateClientSettings({ sidebarThreadGrouping: option.value });
              }}
            >
              {THREAD_GROUPING_OPTIONS.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-6">
                    <span className="flex-1">{option.label}</span>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
        <MenuCheckboxItem
          variant="switch"
          checked={hideOfflineEnvironments}
          closeOnClick={false}
          onCheckedChange={(checked) =>
            void updateClientSettings({ sidebarHideOfflineEnvironments: checked })
          }
        >
          Hide offline environments
        </MenuCheckboxItem>
      </MenuPopup>
    </Menu>
  );
}
