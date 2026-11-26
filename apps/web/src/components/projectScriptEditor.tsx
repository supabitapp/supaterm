import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectScript,
  type ProjectScriptIcon,
  type ResolvedKeybindingsConfig,
} from "@supaterm/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import {
  BugIcon,
  FlaskIcon,
  HammerIcon,
  ListChecksIcon,
  PlayIcon,
  WrenchIcon,
} from "@supaterm/icons";
import React, { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  keybindingValueForCommand,
  decodeProjectScriptKeybindingRule,
} from "~/lib/projectScriptKeybindings";
import { keybindingFromKeyboardEvent } from "~/components/settings/KeybindingsSettings.logic";
import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { commandForProjectScript, nextProjectScriptId } from "~/projectScripts";
import { InlineConfirmLabel } from "./InlineConfirm";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { useComposerMenuState } from "./chat/useComposerMenuState";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { msg, T, useGT } from "gt-react";

const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: msg("Play") },
  { id: "test", label: msg("Test") },
  { id: "lint", label: msg("Lint") },
  { id: "configure", label: msg("Configure") },
  { id: "build", label: msg("Build") },
  { id: "debug", label: msg("Debug") },
];

export function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

export interface NewProjectScriptInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  runOnWorktreeCreate: boolean;
  waitForSetup: boolean;
  runOnDone: boolean;
  stopOnDone?: boolean;
  /** Omit to preserve the current shortcut when the form did not edit it. */
  keybinding?: string | null;
  previewUrl: string | null;
  autoOpenPreview: boolean;
}

export type ProjectScriptActionResult = AtomCommandResult<void, unknown>;

export const EMPTY_PROJECT_SCRIPT_INPUT: NewProjectScriptInput = {
  name: "",
  command: "",
  icon: "play",
  runOnWorktreeCreate: false,
  waitForSetup: false,
  runOnDone: false,
  stopOnDone: false,
  keybinding: null,
  previewUrl: null,
  autoOpenPreview: false,
};

export interface ProjectScriptEditorRequest {
  scriptId: string | null;
  initial: NewProjectScriptInput;
  error?: string;
}

export function editorRequestForScript(
  script: ProjectScript,
  keybindings: ResolvedKeybindingsConfig,
): ProjectScriptEditorRequest {
  return {
    scriptId: script.id,
    initial: {
      name: script.name,
      command: script.command,
      icon: script.icon,
      runOnWorktreeCreate: script.runOnWorktreeCreate,
      waitForSetup: script.runOnWorktreeCreate && script.async === false,
      runOnDone: script.runOnDone ?? false,
      stopOnDone: script.stopOnDone ?? false,
      keybinding: keybindingValueForCommand(keybindings, commandForProjectScript(script.id)),
      previewUrl: script.previewUrl ?? null,
      autoOpenPreview: script.autoOpenPreview ?? false,
    },
  };
}

type ProjectScriptEditorProps = {
  environmentId: EnvironmentId;
  editScope?: typeof AuthOrchestrationOperateScope | typeof AuthSettingsWriteScope;
  request: ProjectScriptEditorRequest | null;
  scripts: ReadonlyArray<ProjectScript>;
  onSubmit: (
    scriptId: string | null,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDelete: (scriptId: string) => void;
  onClose: () => void;
};

export function ProjectScriptEditorDialog(props: ProjectScriptEditorProps) {
  const { request, onClose } = props;
  // The last opened request stays shown while the dialog animates closed. Each
  // new request mounts a fresh form, which drops the previous request's save.
  const [shown, setShown] = useState<{
    readonly request: ProjectScriptEditorRequest;
    readonly key: number;
  } | null>(request === null ? null : { request, key: 0 });
  if (request !== null && request !== shown?.request) {
    setShown({ request, key: (shown?.key ?? 0) + 1 });
  }
  return (
    <Dialog
      open={request !== null}
      // A stray click outside would discard the unsaved draft; Escape and Cancel still close it.
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* The form owns its fields so a keystroke re-renders it, not the dialog chrome. */}
      <DialogPopup>
        {shown ? (
          <ProjectScriptEditorForm key={shown.key} {...props} request={shown.request} />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function ProjectScriptEditorForm({
  environmentId,
  editScope = AuthOrchestrationOperateScope,
  request,
  scripts,
  onSubmit,
  onDelete,
  onClose,
}: Omit<ProjectScriptEditorProps, "request"> & { readonly request: ProjectScriptEditorRequest }) {
  const gt = useGT();
  const canEditActions = useEnvironmentScope(environmentId, editScope);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const formId = React.useId();
  const [name, setName] = useState(request.initial.name);
  const [command, setCommand] = useState(request.initial.command);
  const [icon, setIcon] = useState<ProjectScriptIcon>(request.initial.icon);
  const [iconPickerOpen, setIconPickerOpen] = useComposerMenuState(!canEditActions);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(
    request.initial.runOnWorktreeCreate,
  );
  const [waitForSetup, setWaitForSetup] = useState(request.initial.waitForSetup);
  const [runOnDone, setRunOnDone] = useState(request.initial.runOnDone);
  const [stopOnDone, setStopOnDone] = useState(request.initial.stopOnDone ?? false);
  const [keybinding, setKeybinding] = useState(request.initial.keybinding ?? "");
  const [previewUrl, setPreviewUrl] = useState(request.initial.previewUrl ?? "");
  const [autoOpenPreview, setAutoOpenPreview] = useState(request.initial.autoOpenPreview);
  const [validationError, setValidationError] = useState<string | null>(request.error ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const pendingSubmissionRef = useRef<object | null>(null);
  // A save that settles after this form is replaced must not close or error
  // the request that replaced it.
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- drops the pending save on unmount so a late result cannot close or fail the next request
  useEffect(
    () => () => {
      pendingSubmissionRef.current = null;
    },
    [],
  );

  const isEditing = request.scriptId != null;

  const close = () => {
    pendingSubmissionRef.current = null;
    setIsSaving(false);
    setIconPickerOpen(false);
    onClose();
  };

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!readEnvironmentScope(environmentId, editScope)) return;
    if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) return;
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      setKeybinding("");
      return;
    }
    const next = keybindingFromKeyboardEvent(event, navigator.platform);
    if (!next) return;
    setKeybinding(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pendingSubmissionRef.current !== null) return;
    if (!readEnvironmentScope(environmentId, editScope)) {
      setValidationError(gt("This connection cannot change project actions."));
      return;
    }
    const changesKeybinding =
      (keybinding.trim() || null) !== (request.initial.keybinding?.trim() || null);
    const canChangeKeybinding = readEnvironmentScope(environmentId, AuthSettingsWriteScope);
    if (changesKeybinding && !canChangeKeybinding) {
      setValidationError(gt("This connection cannot change keyboard shortcuts."));
      return;
    }
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (trimmedName.length === 0) {
      setValidationError(gt("Name is required."));
      return;
    }
    if (trimmedCommand.length === 0) {
      setValidationError(gt("Command is required."));
      return;
    }

    setValidationError(null);
    let payload: NewProjectScriptInput;
    try {
      const scriptIdForValidation =
        request.scriptId ??
        nextProjectScriptId(
          trimmedName,
          scripts.map((script) => script.id),
        );
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForProjectScript(scriptIdForValidation),
      });
      const trimmedPreviewUrl = previewUrl.trim();
      payload = {
        name: trimmedName,
        command: trimmedCommand,
        icon,
        runOnWorktreeCreate,
        waitForSetup: runOnWorktreeCreate && waitForSetup,
        runOnDone,
        stopOnDone,
        ...((request.scriptId === null && canChangeKeybinding) || changesKeybinding
          ? { keybinding: keybindingRule?.key ?? null }
          : {}),
        previewUrl: trimmedPreviewUrl.length > 0 ? trimmedPreviewUrl : null,
        autoOpenPreview: trimmedPreviewUrl.length > 0 ? autoOpenPreview : false,
      } satisfies NewProjectScriptInput;
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : gt("Failed to save action."));
      return;
    }

    const submission = {};
    pendingSubmissionRef.current = submission;
    setIsSaving(true);
    setIconPickerOpen(false);
    try {
      const result = await onSubmit(request.scriptId, payload);
      if (pendingSubmissionRef.current === submission) {
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            setValidationError(
              error instanceof Error ? error.message : gt("Failed to save action."),
            );
          }
        } else {
          close();
        }
      }
    } catch (error) {
      if (pendingSubmissionRef.current === submission) {
        setValidationError(error instanceof Error ? error.message : gt("Failed to save action."));
      }
    }
    if (pendingSubmissionRef.current === submission) {
      pendingSubmissionRef.current = null;
      setIsSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEditing ? <T>Edit Action</T> : <T>Add Action</T>}</DialogTitle>
        <DialogDescription>
          <T>Actions are project-scoped commands you can run from the top bar or keybindings.</T>
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form id={formId} onSubmit={submit}>
          <fieldset className="space-y-4" disabled={isSaving || !canEditActions}>
            <div className="space-y-1.5">
              <Label htmlFor="script-name">
                <T>Name</T>
              </Label>
              <div className="flex items-center gap-2">
                <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        className="size-9 shrink-0"
                        aria-label={gt("Choose icon")}
                      />
                    }
                  >
                    <ScriptIcon icon={icon} className="size-4.5" />
                  </PopoverTrigger>
                  <PopoverPopup align="start">
                    <div className="grid grid-cols-3 gap-2">
                      {SCRIPT_ICONS.map((entry) => {
                        const isSelected = entry.id === icon;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs dark:border-transparent ${
                              isSelected
                                ? "border-primary/70 bg-primary/10 ring-inset dark:ring-1 dark:ring-primary/30"
                                : "border-border/70 hover:bg-accent/60 dark:bg-white/[0.035]"
                            }`}
                            onClick={() => {
                              setIcon(entry.id);
                              setIconPickerOpen(false);
                            }}
                          >
                            <ScriptIcon icon={entry.id} className="size-4" />
                            <span>{entry.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverPopup>
                </Popover>
                <Input
                  id="script-name"
                  autoFocus
                  placeholder={gt("Test", { $context: "example action name" })}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="script-keybinding">
                <T>Keybinding</T>
              </Label>
              <Input
                id="script-keybinding"
                disabled={!canWriteSettings}
                placeholder={gt("Press shortcut")}
                value={keybinding}
                readOnly
                onKeyDown={captureKeybinding}
              />
              <p className="text-xs text-muted-foreground">
                <T>
                  Press a shortcut. Use <code>Backspace</code> to clear. Shortcuts are
                  environment-wide. Projects using the same action share its shortcut.
                </T>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="script-command">
                <T>Command</T>
              </Label>
              <Textarea
                id="script-command"
                // oxlint-disable-next-line supaterm/no-untranslated-copy -- example shell command
                placeholder="bun test"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="script-preview-url">
                <T>Preview URL (optional)</T>
              </Label>
              <Input
                id="script-preview-url"
                placeholder="http://localhost:5173"
                value={previewUrl}
                onChange={(event) => setPreviewUrl(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                <T>Open this URL in the in-app preview when this action runs.</T>
              </p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
              <span>
                <T>Run automatically on worktree creation</T>
              </span>
              <Switch
                checked={runOnWorktreeCreate}
                onCheckedChange={(checked) => setRunOnWorktreeCreate(Boolean(checked))}
              />
            </label>
            <label
              className={`flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035] ${
                runOnWorktreeCreate ? "" : "opacity-60"
              }`}
            >
              <span>
                <T>Wait for it to finish before the agent starts</T>
              </span>
              <Switch
                checked={waitForSetup}
                disabled={!runOnWorktreeCreate}
                onCheckedChange={(checked) => setWaitForSetup(Boolean(checked))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
              <span>
                <T>Run in the thread's worktree when the thread is marked Done</T>
              </span>
              <Switch
                checked={runOnDone}
                onCheckedChange={(checked) => setRunOnDone(Boolean(checked))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
              <span>
                <T>Stop this action when the thread is marked Done</T>
              </span>
              <Switch
                checked={stopOnDone}
                onCheckedChange={(checked) => setStopOnDone(Boolean(checked))}
              />
            </label>
            <label
              className={`flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035] ${
                previewUrl.trim().length === 0 ? "opacity-60" : ""
              }`}
            >
              <span>
                <T>Open preview automatically when this action runs</T>
              </span>
              <Switch
                checked={autoOpenPreview}
                disabled={previewUrl.trim().length === 0}
                onCheckedChange={(checked) => setAutoOpenPreview(Boolean(checked))}
              />
            </label>
            {validationError && <p className="text-sm text-destructive">{validationError}</p>}
          </fieldset>
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        {isEditing && (
          <DeleteActionButton
            name={name}
            disabled={isSaving || !canEditActions}
            onDelete={() => {
              if (!request.scriptId) return;
              if (!readEnvironmentScope(environmentId, editScope)) {
                setValidationError(gt("This connection cannot change project actions."));
                return;
              }
              close();
              onDelete(request.scriptId);
            }}
          />
        )}
        <Button type="button" variant="outline" onClick={close}>
          <T>Cancel</T>
        </Button>
        <Button form={formId} type="submit" disabled={isSaving || !canEditActions}>
          {isSaving ? <T>Saving…</T> : isEditing ? <T>Save changes</T> : <T>Save action</T>}
        </Button>
      </DialogFooter>
    </>
  );
}

function DeleteActionButton({
  name,
  disabled,
  onDelete,
}: {
  readonly name: string;
  readonly disabled: boolean;
  readonly onDelete: () => void;
}) {
  const gt = useGT();
  const confirm = useInlineConfirm<"delete">();
  const armed = confirm.armed === "delete";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="destructive-outline"
            className="mr-auto"
            disabled={disabled}
            {...confirm.bind("delete", onDelete)}
          >
            <InlineConfirmLabel armed={armed} idle="Delete" confirm="Confirm delete" />
          </Button>
        }
      />
      <TooltipPopup>
        {armed
          ? gt("Click again to delete “{name}”. This can’t be undone.", { name })
          : gt("Delete this action")}
      </TooltipPopup>
    </Tooltip>
  );
}
