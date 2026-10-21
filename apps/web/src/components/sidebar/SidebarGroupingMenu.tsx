import { THREAD_GROUPING_OPTIONS } from "@supaterm/client-runtime/state/thread-grouping";
import { Settings2Icon } from "lucide-react";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import {
  Menu,
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

export function SidebarGroupingMenu() {
  const grouping = useClientSettings((settings) => settings.sidebarThreadGrouping);
  const label = THREAD_GROUPING_OPTIONS.find((option) => option.value === grouping)!.label;
  return (
    <Menu>
      <MenuTrigger render={<SidebarHeaderIconButton label="Thread list options" />}>
        <Settings2Icon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuSub>
          <MenuSubTrigger>
            <span className="flex-1">Grouping</span>
            <span className="ml-6 text-muted-foreground">{label}</span>
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
      </MenuPopup>
    </Menu>
  );
}
