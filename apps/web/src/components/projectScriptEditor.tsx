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
import React, {
  type FormEvent,
  type KeyboardEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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

const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: "Play" },
  { id: "test", label: "Test" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "Configure" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
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
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* The form owns its fields so a keystroke re-renders it, not the dialog chrome. */}
      <DialogPopup>
        <ProjectScriptEditorForm {...props} />
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
}: ProjectScriptEditorProps) {
  const canEditActions = useEnvironmentScope(environmentId, editScope);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const formId = React.useId();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useComposerMenuState(!canEditActions);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [waitForSetup, setWaitForSetup] = useState(false);
  const [runOnDone, setRunOnDone] = useState(false);
  const [keybinding, setKeybinding] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [autoOpenPreview, setAutoOpenPreview] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savingRequest, setSavingRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const pendingSubmissionRef = useRef<{ request: ProjectScriptEditorRequest } | null>(null);

  const isEditing = request?.scriptId != null;
  const isSaving = request !== null && savingRequest === request;

  useLayoutEffect(
    () => () => {
      if (pendingSubmissionRef.current?.request === request) {
        pendingSubmissionRef.current = null;
      }
    },
    [request],
  );

  const [hydratedRequest, setHydratedRequest] = useState<ProjectScriptEditorRequest | null>(null);
  if (hydratedRequest !== request) {
    setHydratedRequest(request);
    if (request) {
      setName(request.initial.name);
      setCommand(request.initial.command);
      setIcon(request.initial.icon);
      setIconPickerOpen(false);
      setRunOnWorktreeCreate(request.initial.runOnWorktreeCreate);
      setWaitForSetup(request.initial.waitForSetup);
      setRunOnDone(request.initial.runOnDone);
      setKeybinding(request.initial.keybinding ?? "");
      setPreviewUrl(request.initial.previewUrl ?? "");
      setAutoOpenPreview(request.initial.autoOpenPreview);
      setValidationError(request.error ?? null);
      setSavingRequest(null);
    }
  }

  const close = () => {
    pendingSubmissionRef.current = null;
    setSavingRequest(null);
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
    if (!request || pendingSubmissionRef.current !== null) return;
    if (!readEnvironmentScope(environmentId, editScope)) {
      setValidationError("This connection cannot change project actions.");
      return;
    }
    const changesKeybinding =
      (keybinding.trim() || null) !== (request.initial.keybinding?.trim() || null);
    const canChangeKeybinding = readEnvironmentScope(environmentId, AuthSettingsWriteScope);
    if (changesKeybinding && !canChangeKeybinding) {
      setValidationError("This connection cannot change keyboard shortcuts.");
      return;
    }
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }
    if (trimmedCommand.length === 0) {
      setValidationError("Command is required.");
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
        ...((request.scriptId === null && canChangeKeybinding) || changesKeybinding
          ? { keybinding: keybindingRule?.key ?? null }
          : {}),
        previewUrl: trimmedPreviewUrl.length > 0 ? trimmedPreviewUrl : null,
        autoOpenPreview: trimmedPreviewUrl.length > 0 ? autoOpenPreview : false,
      } satisfies NewProjectScriptInput;
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save action.");
      return;
    }

    const submission = { request };
    pendingSubmissionRef.current = submission;
    setSavingRequest(request);
    setIconPickerOpen(false);
    try {
      const result = await onSubmit(request.scriptId, payload);
      if (pendingSubmissionRef.current === submission) {
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            setValidationError(error instanceof Error ? error.message : "Failed to save action.");
          }
        } else {
          close();
        }
      }
    } catch (error) {
      if (pendingSubmissionRef.current === submission) {
        setValidationError(error instanceof Error ? error.message : "Failed to save action.");
      }
    }
    if (pendingSubmissionRef.current === submission) {
      pendingSubmissionRef.current = null;
      setSavingRequest(null);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEditing ? "Edit Action" : "Add Action"}</DialogTitle>
        <DialogDescription>
          Actions are project-scoped commands you can run from the top bar or keybindings.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form id={formId} onSubmit={submit}>
          <fieldset className="space-y-4" disabled={isSaving || !canEditActions}>
            <div className="space-y-1.5">
              <Label htmlFor="script-name">Name</Label>
              <div className="flex items-center gap-2">
                <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        className="size-9 shrink-0"
                        aria-label="Choose icon"
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
                  placeholder="Test"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="script-keybinding">Keybinding</Label>
              <Input
                id="script-keybinding"
                disabled={!canWriteSettings}
                placeholder="Press shortcut"
                value={keybinding}
                readOnly
                onKeyDown={captureKeybinding}
              />
              <p className="text-xs text-muted-foreground">
                Press a shortcut. Use <code>Backspace</code> to clear. Shortcuts are
                environment-wide. Projects using the same action share its shortcut.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="script-command">Command</Label>
              <Textarea
                id="script-command"
                placeholder="bun test"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="script-preview-url">Preview URL (optional)</Label>
              <Input
                id="script-preview-url"
                placeholder="http://localhost:5173"
                value={previewUrl}
                onChange={(event) => setPreviewUrl(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Open this URL in the in-app preview when this action runs.
              </p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
              <span>Run automatically on worktree creation</span>
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
              <span>Wait for it to finish before the agent starts</span>
              <Switch
                checked={waitForSetup}
                disabled={!runOnWorktreeCreate}
                onCheckedChange={(checked) => setWaitForSetup(Boolean(checked))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
              <span>Run in the thread's worktree when the thread is marked Done</span>
              <Switch
                checked={runOnDone}
                onCheckedChange={(checked) => setRunOnDone(Boolean(checked))}
              />
            </label>
            <label
              className={`flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035] ${
                previewUrl.trim().length === 0 ? "opacity-60" : ""
              }`}
            >
              <span>Open preview automatically when this action runs</span>
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
              if (!request?.scriptId) return;
              if (!readEnvironmentScope(environmentId, editScope)) {
                setValidationError("This connection cannot change project actions.");
                return;
              }
              close();
              onDelete(request.scriptId);
            }}
          />
        )}
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button form={formId} type="submit" disabled={isSaving || !canEditActions}>
          {isSaving ? "Saving…" : isEditing ? "Save changes" : "Save action"}
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
        {armed ? `Click again to delete “${name}”. This can’t be undone.` : "Delete this action"}
      </TooltipPopup>
    </Tooltip>
  );
}
