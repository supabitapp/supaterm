import type { EnvironmentId, EnvironmentMachineKind } from "@supaterm/contracts";
import { FolderIcon, SettingsIcon } from "lucide-react";
import type { MouseEvent } from "react";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import {
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "../ui/menu";

interface ProjectFilterItem {
  readonly value: string;
  readonly label: string;
}

export function SidebarProjectFilterSubmenu<TItem extends ProjectFilterItem>({
  items,
  value,
  open,
  onOpenChange,
  projects,
  environments,
  shortcutLabels,
  onSelect,
  onProjectSettings,
}: {
  items: readonly TItem[];
  /** "all" or the selected project's key. */
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ReadonlyMap<string, SidebarProjectSnapshot>;
  /** Present when projects span environments, so each row says where it lives. */
  environments: {
    readonly primaryEnvironmentId: EnvironmentId | null;
    readonly machineByEnvironmentId: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
  } | null;
  shortcutLabels: ReadonlyMap<TItem, string>;
  onSelect: (value: string) => void;
  onProjectSettings: (event: MouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
}) {
  const selected = items.find((item) => item.value === value) ?? items[0];
  return (
    <MenuSub open={open} onOpenChange={onOpenChange}>
      <MenuSubTrigger>
        <span className="flex-1">Project</span>
        <span className="ml-6 max-w-32 truncate text-muted-foreground">{selected?.label}</span>
      </MenuSubTrigger>
      <MenuSubPopup className="max-w-[min(18rem,var(--available-width))]">
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (typeof next === "string") onSelect(next);
          }}
        >
          {items.map((item) => {
            const project = projects.get(item.value) ?? null;
            const shortcut = shortcutLabels.get(item);
            return (
              <MenuRadioItem
                key={item.value}
                value={item.value}
                label={item.label}
                closeOnClick
                onContextMenu={(event) => {
                  if (project) onProjectSettings(event, project);
                }}
              >
                <span className="flex items-center gap-2">
                  {project ? (
                    <ProjectFavicon project={project} className="size-4 shrink-0" />
                  ) : (
                    // Menu items pull svgs in by 2px; favicons aren't svgs, so this one opts out to line up.
                    <FolderIcon className="mx-0! size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {project && environments ? (
                    <ProjectEnvironmentBadge group={project} {...environments} />
                  ) : null}
                  {shortcut ? (
                    <Kbd variant="plain" aria-hidden>
                      {shortcut}
                    </Kbd>
                  ) : null}
                  <MenuRadioItemIndicator />
                  {project ? (
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      tabIndex={-1}
                      aria-hidden="true"
                      title={`Project settings for ${project.displayName}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => onProjectSettings(event, project)}
                    >
                      <SettingsIcon className="size-3.5" />
                    </Button>
                  ) : null}
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}
