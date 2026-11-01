import type {
  EnvironmentId,
  EnvironmentMachineKind,
  ResolvedKeybindingsConfig,
} from "@supaterm/contracts";
import { CheckIcon, FolderIcon, SettingsIcon } from "@supaterm/icons";
import type { KeyboardEvent, MouseEvent } from "react";
import { shortcutLabelForCommand } from "~/keybindings";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { isProjectPinShortcut, ProjectPinButton } from "../ProjectPinButton";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { MenuRadioGroup, MenuRadioItem, MenuSub, MenuSubPopup, MenuSubTrigger } from "../ui/menu";

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
  onToggle,
  onProjectSettings,
  pin,
}: {
  items: readonly TItem[];
  /** The selected projects' keys; empty means all projects. */
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
  onSelect: (value: string) => void;
  /** Adds or removes one project while keeping the others, from Shift+click or Shift+Enter. */
  onToggle: (value: string) => void;
  onProjectSettings: (event: MouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
  pin: {
    readonly canPin: (project: SidebarProjectSnapshot) => boolean;
    readonly toggle: (project: SidebarProjectSnapshot) => void;
    readonly keybindings: ResolvedKeybindingsConfig;
  };
}) {
  // With several projects chosen no radio is checked; each chosen row shows its own check.
  const value = values.length === 0 ? "all" : values.length === 1 ? values[0]! : "";
  const summary =
    values.length > 1
      ? `${values.length} projects`
      : (items.find((item) => item.value === value) ?? items[0])?.label;
  const toggleWithShift = (
    event: (MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) & {
      preventBaseUIHandler?: () => void;
    },
    project: SidebarProjectSnapshot | null,
    itemValue: string,
  ) => {
    if (!project || !event.shiftKey) return;
    if ("key" in event && event.key !== "Enter") return;
    event.preventDefault();
    event.preventBaseUIHandler?.();
    onToggle(itemValue);
  };
  // The thread pin shortcut pins the highlighted project here.
  const pinWithShortcut = (
    event: KeyboardEvent<HTMLElement>,
    project: SidebarProjectSnapshot | null,
  ) => {
    if (!project || !pin.canPin(project) || !isProjectPinShortcut(event, pin.keybindings)) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    pin.toggle(project);
    return true;
  };
  const pinShortcutLabel = shortcutLabelForCommand(pin.keybindings, "thread.pin");
  return (
    <MenuSub open={open} onOpenChange={onOpenChange}>
      <MenuSubTrigger>
        <span className="flex-1">Project</span>
        <span className="ml-6 max-w-32 truncate text-muted-foreground">{summary}</span>
      </MenuSubTrigger>
      <MenuSubPopup className="max-w-[min(18rem,var(--available-width))]" data-project-pin-list="">
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (typeof next === "string") onSelect(next);
          }}
        >
          {items.map((item) => {
            const project = projects.get(item.value) ?? null;
            const shortcut = shortcutLabels.get(item);
            const checked = project ? values.includes(item.value) : values.length === 0;
            return (
              <MenuRadioItem
                key={item.value}
                value={item.value}
                label={item.label}
                closeOnClick
                onClick={(event) => toggleWithShift(event, project, item.value)}
                onKeyDown={(event) => {
                  if (pinWithShortcut(event, project)) return;
                  toggleWithShift(event, project, item.value);
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
                  {project && pin.canPin(project) ? (
                    <ProjectPinButton
                      name={project.displayName}
                      pinned={project.pinned}
                      shortcutLabel={pinShortcutLabel}
                      onToggle={() => pin.toggle(project)}
                    />
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
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}
