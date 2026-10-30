import type { EnvironmentId, EnvironmentMachineKind } from "@supaterm/contracts";
import { CheckIcon, FolderIcon, SettingsIcon } from "@supaterm/icons";
import type { MouseEvent } from "react";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { MenuGroup, MenuItem, MenuSub, MenuSubPopup, MenuSubTrigger } from "../ui/menu";

interface ProjectFilterItem {
  readonly value: string;
  readonly label: string;
}

export function SidebarProjectFilterSubmenu<TItem extends ProjectFilterItem>({
  items,
  values,
  open,
  onOpenChange,
  projects,
  environments,
  shortcutLabels,
  onSelect,
  onProjectSettings,
}: {
  items: readonly TItem[];
  values: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ReadonlyMap<string, SidebarProjectSnapshot>;
  /** Present when projects span environments, so each row says where it lives. */
  environments: {
    readonly primaryEnvironmentId: EnvironmentId | null;
    readonly machineByEnvironmentId: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
  } | null;
  shortcutLabels: ReadonlyMap<TItem, string>;
  onSelect: (value: string, multiple: boolean) => void;
  onProjectSettings: (event: MouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
}) {
  const selected = items.filter((item) => values.includes(item.value));
  return (
    <MenuSub open={open} onOpenChange={onOpenChange}>
      <MenuSubTrigger>
        <span className="flex-1">Project</span>
        {selected.length > 1 ? (
          <span aria-hidden className="flex items-center -space-x-1">
            {selected.slice(0, 2).map((item) => {
              const project = projects.get(item.value);
              return project ? (
                <ProjectFavicon key={item.value} project={project} className="size-4 shrink-0" />
              ) : null;
            })}
            {selected.length > 2 ? (
              <span className="pl-1 text-xs">+{selected.length - 2}</span>
            ) : null}
          </span>
        ) : null}
        <span className="ml-6 max-w-32 truncate text-muted-foreground">
          {selected.length === 0 ? items[0]?.label : selected.map((item) => item.label).join(", ")}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="max-w-[min(18rem,var(--available-width))]">
        <MenuGroup>
          {items.map((item) => {
            const project = projects.get(item.value) ?? null;
            const shortcut = shortcutLabels.get(item);
            const checked =
              item.value === "all" ? values.length === 0 : values.includes(item.value);
            return (
              <MenuItem
                key={item.value}
                role="menuitemcheckbox"
                aria-checked={checked}
                label={item.label}
                onClick={(event) => {
                  if (event.shiftKey) event.preventBaseUIHandler();
                  onSelect(item.value, event.shiftKey);
                }}
                onKeyDown={(event) => {
                  if (event.shiftKey && event.key === "Enter") {
                    event.preventDefault();
                    event.preventBaseUIHandler();
                    onSelect(item.value, true);
                  }
                }}
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
                  <span className="grid shrink-0 place-items-center *:col-start-1 *:row-start-1">
                    <span aria-hidden className="size-7 sm:size-6" />
                    <span
                      className={
                        project
                          ? "flex in-data-highlighted:invisible pointer-coarse:invisible"
                          : "flex"
                      }
                    >
                      {checked ? <CheckIcon aria-hidden className="size-3.5" /> : null}
                    </span>
                    {project ? (
                      <span
                        className={
                          checked
                            ? "invisible flex in-data-highlighted:visible pointer-coarse:visible"
                            : "flex"
                        }
                      >
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
                      </span>
                    ) : null}
                  </span>
                </span>
              </MenuItem>
            );
          })}
        </MenuGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}
