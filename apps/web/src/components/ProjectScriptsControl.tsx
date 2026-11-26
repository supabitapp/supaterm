import { projectScriptMenuLabel } from "@supaterm/shared/projectScriptsCopy";
import { ThreadDetailsControl } from "./chat/ThreadDetailsControl";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectScript,
  type SupatermProjectFileScript,
} from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { ChevronDownIcon, DownloadIcon, PlusIcon, SettingsIcon, WrenchIcon } from "@supaterm/icons";
import React, { useState } from "react";

import { commandForProjectScript, primaryProjectScript } from "~/projectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import { serverEnvironment } from "~/state/server";
import { useManagedPolicy } from "~/state/managedPolicy";
import { managedSettingDenial } from "@supaterm/client-runtime/managed-policy";
import { readEnvironmentScope } from "~/state/session";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  ProjectScriptEditorDialog,
  ScriptIcon,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptEditorRequest,
} from "./projectScriptEditor";
import { Button } from "./ui/button";
import { Group, GroupSeparator } from "./ui/group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "./ui/menu";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { cn } from "~/lib/utils";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./chat/threadDetailsPanelStyles";
import { T, useMessages, useGT, Var } from "gt-react";

export type { NewProjectScriptInput, ProjectScriptActionResult };

const NO_FILE_SCRIPTS: ReadonlyArray<SupatermProjectFileScript> = [];

interface ProjectScriptsControlProps {
  displayMode?: "toolbar" | "panel";
  presentation?: "toolbar" | "menu";
  onRequestMenuClose?: () => void;
  environmentId: EnvironmentId;
  scripts: ReadonlyArray<ProjectScript>;
  fileScripts?: ReadonlyArray<SupatermProjectFileScript>;
  preferredScriptId?: string | null;
  onRunScript?: ((script: ProjectScript) => void) | undefined;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export default function ProjectScriptsControl({
  displayMode = "toolbar",
  presentation = "toolbar",
  onRequestMenuClose,
  environmentId,
  scripts,
  fileScripts = NO_FILE_SCRIPTS,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
}: ProjectScriptsControlProps) {
  const gt = useGT();
  const messages = useMessages();
  const isPanel = displayMode === "panel";
  const ActionGroup = isPanel ? "div" : Group;
  const panelAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const keybindings =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.keybindings ??
    DEFAULT_RESOLVED_KEYBINDINGS;
  const [actionsMenuOpen, setActionsMenuOpen] = useState({
    presentation,
    scripts: false,
    imports: false,
  });
  if (actionsMenuOpen.presentation !== presentation) {
    setActionsMenuOpen({ presentation, scripts: false, imports: false });
  }
  const [editorRequest, setEditorRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const editorRequestIdRef = React.useRef(0);

  const primaryScript =
    (preferredScriptId ? scripts.find((script) => script.id === preferredScriptId) : undefined) ??
    primaryProjectScript(scripts);
  const primaryScriptShortcut = primaryScript
    ? shortcutLabelForCommand(keybindings, commandForProjectScript(primaryScript.id))
    : null;
  const importableScripts = fileScripts.filter(
    (fileScript) =>
      !scripts.some(
        (script) =>
          script.command === fileScript.command ||
          script.name.toLowerCase() === fileScript.name.toLowerCase(),
      ),
  );

  // A policy that locks project scripts refuses every edit, so say so before the editor opens.
  const scriptsDenial = managedSettingDenial(
    [useManagedPolicy(environmentId)],
    ["defaultProjectScripts"],
    messages,
  );
  const refusedByPolicy = () => {
    if (scriptsDenial === undefined) return false;
    toastManager.add({
      type: "warning",
      title: gt("Project actions are managed"),
      description: scriptsDenial,
    });
    return true;
  };

  const openAddDialog = () => {
    if (refusedByPolicy()) return;
    editorRequestIdRef.current += 1;
    setEditorRequest({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT });
  };

  const openEditDialog = (script: ProjectScript) => {
    if (refusedByPolicy()) return;
    editorRequestIdRef.current += 1;
    onRequestMenuClose?.();
    setActionsMenuOpen({ presentation, scripts: false, imports: false });
    setEditorRequest(editorRequestForScript(script, keybindings));
  };

  const submitScript = (scriptId: string | null, input: NewProjectScriptInput) =>
    scriptId === null ? onAddScript(input) : onUpdateScript(scriptId, input);

  const importFileScript = async (fileScript: SupatermProjectFileScript) => {
    if (refusedByPolicy()) return;
    const requestId = ++editorRequestIdRef.current;
    const payload: NewProjectScriptInput = {
      name: fileScript.name,
      command: fileScript.command,
      icon: fileScript.icon ?? "play",
      runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
      waitForSetup: fileScript.runOnWorktreeCreate === true && fileScript.async === false,
      runOnDone: fileScript.runOnDone ?? false,
      stopOnDone: fileScript.stopOnDone ?? false,
      ...(readEnvironmentScope(environmentId, AuthSettingsWriteScope) ? { keybinding: null } : {}),
      previewUrl: fileScript.previewUrl ?? null,
      autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
    };
    const result = await onAddScript(payload);
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;

    const error = squashAtomCommandFailure(result);
    const message = error instanceof Error ? error.message : undefined;
    if (requestId !== editorRequestIdRef.current) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Failed to import {name}.", { name: fileScript.name }),
          ...(message ? { description: message } : {}),
        }),
      );
      return;
    }
    setEditorRequest({
      scriptId: null,
      initial: payload,
      error: message ?? gt("Failed to import action."),
    });
  };

  const importMenuItems = importableScripts.length > 0 && (
    <>
      {scripts.length > 0 && <MenuSeparator />}
      <MenuGroup>
        <MenuGroupLabel>
          <T>From supaterm.json</T>
        </MenuGroupLabel>
        {importableScripts.map((fileScript) => (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            key={`${fileScript.name} ${fileScript.command}`}
            onClick={() => void importFileScript(fileScript)}
          >
            <ScriptIcon icon={fileScript.icon ?? "play"} className="size-4" />
            <MenuItemLabel>{fileScript.name}</MenuItemLabel>
            <MenuShortcut>
              <DownloadIcon
                className="size-3.5"
                aria-label={gt("Import", { $context: "verb, import an action from supaterm.json" })}
              />
            </MenuShortcut>
          </MenuItem>
        ))}
      </MenuGroup>
    </>
  );

  const scriptItems = (
    <>
      {scripts.map((script) => {
        const shortcutLabel = shortcutLabelForCommand(
          keybindings,
          commandForProjectScript(script.id),
        );
        return (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            key={script.id}
            className="group"
            disabled={!onRunScript}
            onClick={() => onRunScript?.(script)}
          >
            <ScriptIcon icon={script.icon} className="size-4" />
            <MenuItemLabel>{projectScriptMenuLabel(script, messages)}</MenuItemLabel>
            <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
              {shortcutLabel && <MenuShortcut className="ms-0 mr-7">{shortcutLabel}</MenuShortcut>}
              <span
                className={`absolute right-0 top-1/2 flex -translate-y-1/2 ${presentation === "menu" ? "" : "opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"}`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  aria-label={gt("Edit {name}", { name: script.name })}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openEditDialog(script);
                  }}
                >
                  <SettingsIcon className="size-3.5" />
                </Button>
              </span>
            </span>
          </MenuItem>
        );
      })}
      {importMenuItems}
      <MenuItem density={presentation === "menu" ? "touch" : "default"} onClick={openAddDialog}>
        <PlusIcon className="size-4" />
        <MenuItemLabel>{isPanel ? gt("Add project script") : gt("Add action")}</MenuItemLabel>
      </MenuItem>
    </>
  );

  return (
    <>
      {presentation === "menu" ? (
        <>
          {primaryScript && (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              disabled={!onRunScript}
              onClick={() => onRunScript?.(primaryScript)}
            >
              <ScriptIcon icon={primaryScript.icon} className="size-4" />
              <MenuItemLabel>
                <T>
                  Run <Var>{primaryScript.name}</Var>
                </T>
              </MenuItemLabel>
              <MenuShortcut>{primaryScriptShortcut}</MenuShortcut>
            </MenuItem>
          )}
          {scripts.length > 0 || importableScripts.length > 0 ? (
            <MenuSub
              open={actionsMenuOpen.scripts}
              onOpenChange={(open) =>
                setActionsMenuOpen({ presentation, scripts: open, imports: false })
              }
            >
              <MenuSubTrigger density="touch">
                <ScriptIcon icon="play" className="size-4" />
                <MenuItemLabel>
                  <T>Project actions</T>
                </MenuItemLabel>
              </MenuSubTrigger>
              <MenuSubPopup>{scriptItems}</MenuSubPopup>
            </MenuSub>
          ) : (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              onClick={openAddDialog}
            >
              <PlusIcon className="size-4" />
              <MenuItemLabel>
                <T>Add project action…</T>
              </MenuItemLabel>
            </MenuItem>
          )}
        </>
      ) : primaryScript ? (
        <ActionGroup
          role="group"
          aria-label={gt("Project scripts")}
          {...(isPanel
            ? { className: THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS, ref: panelAnchorRef }
            : {})}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  size="xs"
                  variant={isPanel ? "ghost" : "outline"}
                  part="primary"
                  panel={isPanel}
                  className={isPanel ? undefined : "w-7 sm:w-6 @3xl/header-actions:w-auto!"}
                  aria-label={gt("Run {name}", { name: primaryScript.name })}
                  // Tooltip replaces the button data-slot, so toolbar theming needs a separate hook.
                  data-toolbar-control=""
                  aria-disabled={!onRunScript || undefined}
                  onClick={() => onRunScript?.(primaryScript)}
                />
              }
            >
              <ScriptIcon
                icon={primaryScript.icon}
                {...(isPanel ? { className: THREAD_DETAILS_PANEL_ICON_CLASS } : {})}
              />
              <span
                className={cn(
                  "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5",
                  isPanel && "not-sr-only ml-0 truncate",
                )}
              >
                {primaryScript.name}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top" shortcut={primaryScriptShortcut}>
              {onRunScript
                ? gt("Run {name}", { name: primaryScript.name })
                : gt("Pair this client again with permission to run terminal commands.")}
            </TooltipPopup>
          </Tooltip>
          {isPanel ? (
            <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
          ) : (
            <GroupSeparator className="hidden @3xl/header-actions:block" />
          )}
          <Menu
            open={actionsMenuOpen.scripts}
            onOpenChange={(open) =>
              setActionsMenuOpen({ presentation, scripts: open, imports: false })
            }
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={
                      <ThreadDetailsControl
                        size={isPanel ? "sm" : "icon-xs"}
                        variant={isPanel ? "ghost" : "outline"}
                        part="secondary"
                        panel={isPanel}
                        aria-label={gt("Script actions")}
                        data-toolbar-control=""
                      />
                    }
                  />
                }
              >
                <ChevronDownIcon
                  className={isPanel ? THREAD_DETAILS_PANEL_CHEVRON_CLASS : "size-4"}
                />
              </TooltipTrigger>
              <TooltipPopup side="top">
                <T>Script actions</T>
              </TooltipPopup>
            </Tooltip>
            <MenuPopup
              align="end"
              {...(isPanel ? { anchor: panelAnchorRef } : {})}
              className={isPanel ? "w-(--anchor-width)" : undefined}
            >
              {scriptItems}
            </MenuPopup>
          </Menu>
        </ActionGroup>
      ) : scripts.length > 0 || importableScripts.length > 0 ? (
        isPanel ? (
          <div
            role="group"
            aria-label={gt("Project actions")}
            className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}
            ref={panelAnchorRef}
          >
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="primary"
              aria-label={gt("Project actions")}
              onClick={() => setActionsMenuOpen({ presentation, scripts: false, imports: true })}
            >
              <WrenchIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
              <span className="min-w-0 truncate">
                <T context="project actions menu">Actions</T>
              </span>
            </ThreadDetailsControl>
            <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
            <Menu
              highlightItemOnHover={false}
              open={actionsMenuOpen.imports}
              onOpenChange={(open) =>
                setActionsMenuOpen({ presentation, scripts: false, imports: open })
              }
            >
              <MenuTrigger
                render={
                  <ThreadDetailsControl
                    size="sm"
                    variant="ghost"
                    part="secondary"
                    aria-label={gt("Choose project action")}
                  />
                }
              >
                <ChevronDownIcon className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
              </MenuTrigger>
              <MenuPopup align="end" anchor={panelAnchorRef} className="w-(--anchor-width)">
                {scriptItems}
              </MenuPopup>
            </Menu>
          </div>
        ) : (
          <Menu
            highlightItemOnHover={false}
            open={actionsMenuOpen.imports}
            onOpenChange={(open) =>
              setActionsMenuOpen({ presentation, scripts: false, imports: open })
            }
          >
            <MenuTrigger
              render={<Button size="xs" variant="outline" aria-label={gt("Project actions")} />}
            >
              <WrenchIcon className="size-3.5" />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                <T context="project actions menu">Actions</T>
              </span>
              <ChevronDownIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end">{scriptItems}</MenuPopup>
          </Menu>
        )
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="xs"
                variant={isPanel ? "ghost" : "outline"}
                part="row"
                panel={isPanel}
                className={isPanel ? undefined : "w-7 sm:w-6 @3xl/header-actions:w-auto!"}
                aria-label={isPanel ? gt("Add project script") : gt("Add action")}
                data-toolbar-control=""
                onClick={openAddDialog}
              />
            }
          >
            <PlusIcon className="size-3.5" />
            <span
              className={cn(
                "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5",
                isPanel && "not-sr-only ml-0.5",
              )}
            >
              {isPanel ? gt("Add project script") : gt("Add action")}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top">
            {isPanel ? gt("Add project script") : gt("Add action")}
          </TooltipPopup>
        </Tooltip>
      )}

      <ProjectScriptEditorDialog
        environmentId={environmentId}
        request={editorRequest}
        scripts={scripts}
        onSubmit={submitScript}
        onDelete={(scriptId) => void onDeleteScript(scriptId)}
        onClose={() => setEditorRequest(null)}
      />
    </>
  );
}
