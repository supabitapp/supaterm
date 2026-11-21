import { THREAD_GROUPING_OPTIONS } from "@supaterm/client-runtime/state/thread-grouping";
import type { EnvironmentId } from "@supaterm/contracts";
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

const ALL_ENVIRONMENTS = "all";

export function SidebarThreadListMenu({
  open,
  onOpenChange,
  hidesOfflineThreads,
  projectFilter,
  environmentFilter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether hiding offline environments leaves out a row the list would otherwise show. */
  hidesOfflineThreads: boolean;
  projectFilter: ReactNode;
  environmentFilter: {
    readonly items: ReadonlyArray<{ readonly value: EnvironmentId; readonly label: string }>;
    readonly value: EnvironmentId | null;
    readonly label: string | null;
    readonly onSelect: (environmentId: EnvironmentId | null) => void;
  } | null;
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
        {environmentFilter ? (
          <MenuSub>
            <MenuSubTrigger>
              <span className="flex-1">Environment</span>
              <span dir="auto" className="ml-6 max-w-32 truncate text-muted-foreground">
                {environmentFilter.label ?? "All"}
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className="max-w-[min(18rem,var(--available-width))]">
              <MenuRadioGroup
                value={environmentFilter.value ?? ALL_ENVIRONMENTS}
                onValueChange={(value) => {
                  if (value === ALL_ENVIRONMENTS) return environmentFilter.onSelect(null);
                  const item = environmentFilter.items.find((entry) => entry.value === value);
                  if (item) environmentFilter.onSelect(item.value);
                }}
              >
                {[{ value: ALL_ENVIRONMENTS, label: "All" }, ...environmentFilter.items].map(
                  (item) => (
                    <MenuRadioItem key={item.value} value={item.value} closeOnClick>
                      <span className="flex items-center gap-6">
                        <span dir="auto" className="min-w-0 flex-1 truncate">
                          {item.label}
                        </span>
                        <MenuRadioItemIndicator />
                      </span>
                    </MenuRadioItem>
                  ),
                )}
              </MenuRadioGroup>
            </MenuSubPopup>
          </MenuSub>
        ) : null}
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
