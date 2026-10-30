import { ThreadDetailsComboboxControl } from "./chat/ThreadDetailsControl";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import type { EnvironmentId } from "@supaterm/contracts";
import { PlusIcon, ScaleIcon } from "@supaterm/icons";
import { useAtomValue } from "@effect/atom-react";
import { memo, useState } from "react";

import { type EnvironmentOption } from "./BranchToolbar.logic";
import { cn } from "../lib/utils";
import { useShortcutLabel } from "../hooks/useShortcutLabel";
import { usePickerShortcuts } from "../hooks/usePickerShortcuts";
import { primaryServerKeybindingsAtom } from "../state/server";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS,
} from "./chat/threadDetailsPanelStyles";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { useComposerMenuProps } from "./chat/composerEventScope";
import {
  Combobox,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxList,
  ComboboxEmpty,
  ComboboxItem,
  useComboboxFilter,
} from "./ui/combobox";
import { Kbd } from "./ui/kbd";

interface BranchToolbarEnvironmentSelectorProps {
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  envLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  displayMode?: "toolbar" | "panel";
  onAddToMachine?: (() => void) | undefined;
}

// Action values cannot collide with server-minted environment IDs.
const AUTO_VALUE = "action:auto";
const ADD_MACHINE_VALUE = "action:add-machine";
const environmentValue = (id: EnvironmentId) => `env:${id}`;

export const BranchToolbarEnvironmentSelector = memo(function BranchToolbarEnvironmentSelector({
  autoEnvironmentLabel,
  onAutoEnvironment,
  envLocked,
  environmentId,
  availableEnvironments,
  onEnvironmentChange,
  displayMode = "toolbar",
  onAddToMachine,
}: BranchToolbarEnvironmentSelectorProps) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const hostShortcut = useShortcutLabel(displayMode === "toolbar" ? "composer.host" : null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const hostFilter = useComboboxFilter();
  const activeEnvironment =
    availableEnvironments.find((env) => env.environmentId === environmentId) ?? null;
  const interactive =
    !envLocked && (onEnvironmentChange !== undefined || onAddToMachine !== undefined);

  const environmentItems = [
    ...(onAutoEnvironment
      ? [{ value: AUTO_VALUE, label: autoEnvironmentLabel ?? "Auto balance" }]
      : []),
    ...availableEnvironments.map((env) => ({
      value: environmentValue(env.environmentId),
      label: env.label,
    })),
    ...(onAddToMachine ? [{ value: ADD_MACHINE_VALUE, label: "Add to another machine" }] : []),
  ];
  const filteredEnvironmentItems = environmentItems.filter((item) =>
    hostFilter.contains(item.label, query),
  );
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery("");
  };
  const selectEnvironmentItem = (item: (typeof environmentItems)[number]) => {
    if (item.value === ADD_MACHINE_VALUE) onAddToMachine?.();
    else if (item.value === AUTO_VALUE) onAutoEnvironment?.();
    else {
      const environment = availableEnvironments.find(
        (candidate) => environmentValue(candidate.environmentId) === item.value,
      );
      if (environment) onEnvironmentChange?.(environment.environmentId);
    }
  };
  const hostJumpLabels = usePickerShortcuts({
    picker: "host",
    open: open && interactive,
    items: filteredEnvironmentItems,
    keybindings,
    onSelect: (item) => {
      selectEnvironmentItem(item);
      handleOpenChange(false);
    },
  });

  // The static label carries the xs control's height: the context strip has no min-height and the
  // glass seam joining it to the composer assumes a fixed strip height.
  if (!interactive) {
    const lockedRow = (
      <span
        className={cn(
          "inline-flex h-7 min-w-0 max-w-full items-center gap-1 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-xs sm:h-6",
          displayMode === "panel" && THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS,
        )}
        data-composer-context-control
      >
        <EnvironmentMachineIcon
          kind={activeEnvironment?.machine ?? "server"}
          className={displayMode === "panel" ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3 shrink-0"}
        />
        <ComposerContextLabel displayMode={displayMode}>
          {activeEnvironment?.label ?? "Run on"}
        </ComposerContextLabel>
      </span>
    );
    return (
      <Tooltip>
        <TooltipTrigger render={lockedRow} />
        <TooltipPopup>{activeEnvironment?.label ?? "Run on"}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Combobox
      autoHighlight
      open={open}
      onOpenChange={handleOpenChange}
      filteredItems={filteredEnvironmentItems}
      filter={null}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
      value={
        environmentItems.find(
          (item) =>
            item.value === (autoEnvironmentLabel ? AUTO_VALUE : environmentValue(environmentId)),
        ) ?? null
      }
      onValueChange={(item) => {
        if (!item) return;
        selectEnvironmentItem(item);
      }}
      items={environmentItems}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsComboboxControl
              panel={displayMode === "panel"}
              className="min-w-0 max-w-full"
              aria-label="Run on"
              data-composer-shortcut="composer.host"
              data-composer-context-control
            />
          }
        >
          {autoEnvironmentLabel ? (
            <ScaleIcon
              className={
                displayMode === "panel" ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3 shrink-0"
              }
              aria-hidden="true"
            />
          ) : (
            <EnvironmentMachineIcon
              kind={activeEnvironment?.machine ?? "server"}
              className={
                displayMode === "panel" ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3 shrink-0"
              }
            />
          )}
          <ComposerContextLabel displayMode={displayMode}>
            {autoEnvironmentLabel ?? activeEnvironment?.label ?? "Run on"}
          </ComposerContextLabel>
        </TooltipTrigger>
        <TooltipPopup shortcut={hostShortcut}>
          {autoEnvironmentLabel ?? activeEnvironment?.label ?? "Run on"}
        </TooltipPopup>
      </Tooltip>
      <ComboboxPopup
        {...(displayMode === "toolbar" ? composerFloatingLayerProps : {})}
        {...(displayMode === "panel"
          ? {
              className: "w-(--anchor-width)",
            }
          : {})}
      >
        <ComboboxSearchInput
          autoFocus
          aria-label="Search hosts"
          placeholder="Search hosts..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No matches found.</ComboboxEmpty>
        <ComboboxList>
          {(item: (typeof environmentItems)[number]) => (
            <ComboboxItem key={item.value} value={item}>
              {item.value === ADD_MACHINE_VALUE ? (
                <PlusIcon className="size-3" />
              ) : item.value === AUTO_VALUE ? (
                <ScaleIcon className="size-3" />
              ) : (
                <EnvironmentMachineIcon
                  kind={
                    availableEnvironments.find(
                      (env) => environmentValue(env.environmentId) === item.value,
                    )?.machine ?? "server"
                  }
                  className="size-3"
                />
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {hostJumpLabels.has(item) ? (
                <Kbd variant="plain" aria-hidden>
                  {hostJumpLabels.get(item)}
                </Kbd>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
});
