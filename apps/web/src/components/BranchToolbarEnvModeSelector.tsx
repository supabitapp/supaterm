import { formatFilePathForClipboard } from "@supaterm/client-runtime/media-actions";
import { ThreadDetailsComboboxControl, ThreadDetailsControl } from "./chat/ThreadDetailsControl";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { CheckIcon, CopyIcon, FolderGitIcon, FolderIcon } from "@supaterm/icons";
import { memo, type MouseEvent as ReactMouseEvent } from "react";
import { useCopyToClipboard, writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { useShortcutLabel } from "../hooks/useShortcutLabel";
import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS,
} from "./chat/threadDetailsPanelStyles";

import {
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveLockedWorkspaceLabel,
  resolveWorkspaceDisplayName,
  type EnvMode,
} from "./BranchToolbar.logic";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { PreviousWorktreeItemContent } from "./PreviousWorktreeItemContent";
import {
  Combobox,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxList,
  ComboboxEmpty,
  ComboboxItem,
} from "./ui/combobox";
import { Kbd } from "./ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { stackedThreadToast, toastManager } from "./ui/toast";

const PREVIOUS_WORKTREE_SELECT_VALUE = "previous-worktree";

interface BranchToolbarEnvModeSelectorProps {
  forceNewWorktree?: boolean;
  envLocked: boolean;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  activeBranch?: string | null;
  workspaceRoot?: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  displayMode?: "toolbar" | "panel";
  previousWorktreeLabel?: string | null;
  previousWorktreeBranch?: string | null;
  onUsePreviousWorktree?: () => void;
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  forceNewWorktree = false,
  envLocked,
  effectiveEnvMode,
  activeWorktreePath,
  activeBranch = null,
  workspaceRoot = null,
  onEnvModeChange,
  displayMode = "toolbar",
  previousWorktreeLabel,
  previousWorktreeBranch = null,
  onUsePreviousWorktree,
}: BranchToolbarEnvModeSelectorProps) {
  const workspacePath =
    displayMode === "panel" && (effectiveEnvMode === "local" || activeWorktreePath !== null)
      ? (activeWorktreePath ?? workspaceRoot)
      : null;
  const workspaceDisplayName = resolveWorkspaceDisplayName(workspacePath);
  // The panel names the workspace kind only when it is not the project folder.
  const workspaceKind = activeWorktreePath ? "Worktree" : null;
  const lockedWorkspaceKind = forceNewWorktree ? "Worktree" : workspaceKind;
  const selectWorkspaceKind =
    effectiveEnvMode === "worktree" && !activeWorktreePath ? "Create" : workspaceKind;
  const composerFloatingLayerProps = useComposerMenuProps();
  const workspaceShortcut = useShortcutLabel(
    displayMode === "toolbar" ? "composer.workspace" : null,
  );
  const showPreviousWorktree = Boolean(previousWorktreeLabel && onUsePreviousWorktree);
  const previousWorktreeShortcut = useShortcutLabel(
    showPreviousWorktree ? "composer.previousWorktree" : null,
  );
  const envModeItems = [
    {
      value: "local",
      label: workspaceDisplayName ?? resolveCurrentWorkspaceLabel(activeWorktreePath),
    },
    { value: "worktree", label: resolveEnvModeLabel("worktree") },
    ...(showPreviousWorktree && previousWorktreeLabel
      ? [{ value: PREVIOUS_WORKTREE_SELECT_VALUE, label: previousWorktreeLabel }]
      : []),
  ];

  const handleWorkspaceContextMenu = (event: ReactMouseEvent) => {
    if (!workspacePath || forceNewWorktree) return;
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    event.stopPropagation();
    void api.contextMenu
      .show([{ id: "copy-path", label: "Copy full path", icon: "copy" }], {
        x: event.clientX,
        y: event.clientY,
      })
      .then((action) => {
        if (action !== "copy-path") return;
        void writeTextToClipboard(formatFilePathForClipboard(workspacePath), "workspace path").then(
          (didCopy) => {
            if (didCopy) {
              toastManager.add({
                type: "success",
                title: "Path copied",
                description: workspacePath,
              });
            }
          },
          (error: unknown) => {
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to copy path",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          },
        );
      });
  };

  const stopContextMenuMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0 || event.ctrlKey) {
      event.stopPropagation();
    }
  };

  if (
    displayMode === "panel" &&
    envLocked &&
    !forceNewWorktree &&
    (effectiveEnvMode === "local" || activeWorktreePath !== null) &&
    activeBranch
  ) {
    return (
      <WorkspaceBranchCopyRow
        key={activeBranch}
        branch={activeBranch}
        workspaceKind={workspaceKind}
        onContextMenu={handleWorkspaceContextMenu}
      />
    );
  }

  if (envLocked || forceNewWorktree) {
    const lockedRow = (
      <span
        className={cn(
          "inline-flex h-7 min-w-0 items-center gap-1 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-xs sm:h-6",
          displayMode === "panel" && THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS,
        )}
        data-composer-context-control
        onContextMenu={handleWorkspaceContextMenu}
      >
        {activeWorktreePath ? (
          <FolderGitIcon
            className={displayMode === "panel" ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3"}
          />
        ) : effectiveEnvMode === "worktree" ? (
          <FolderGitIcon
            className={displayMode === "panel" ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3"}
          />
        ) : (
          <FolderIcon
            className={displayMode === "panel" ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3"}
          />
        )}
        <ComposerContextLabel displayMode={displayMode}>
          {forceNewWorktree
            ? resolveEnvModeLabel("worktree")
            : (workspaceDisplayName ??
              resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode))}
        </ComposerContextLabel>
        {displayMode === "panel" && lockedWorkspaceKind ? (
          <span className="shrink-0 text-3xs font-normal text-muted-foreground/70">
            {lockedWorkspaceKind}
          </span>
        ) : null}
      </span>
    );

    return (
      <Tooltip>
        <TooltipTrigger render={lockedRow} />
        <TooltipPopup side={displayMode === "panel" ? "left" : undefined}>
          {forceNewWorktree
            ? "Each model starts in its own worktree."
            : (workspacePath ?? resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode))}
        </TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Combobox
      autoHighlight
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
      value={envModeItems.find((item) => item.value === effectiveEnvMode) ?? null}
      onValueChange={(item) => {
        if (!item) return;
        const value = item.value;
        if (value === PREVIOUS_WORKTREE_SELECT_VALUE) {
          onUsePreviousWorktree?.();
          return;
        }
        onEnvModeChange(value as EnvMode);
      }}
      items={envModeItems}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsComboboxControl
              panel={displayMode === "panel"}
              className="min-w-0 shrink"
              aria-label="Workspace"
              data-composer-shortcut="composer.workspace"
              data-composer-context-control
              onMouseDownCapture={stopContextMenuMouseDown}
              onContextMenu={handleWorkspaceContextMenu}
            />
          }
        >
          {effectiveEnvMode === "worktree" ? (
            <FolderGitIcon
              className={displayMode === "panel" ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3"}
            />
          ) : activeWorktreePath ? (
            <FolderGitIcon
              className={displayMode === "panel" ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3"}
            />
          ) : (
            <FolderIcon
              className={displayMode === "panel" ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3"}
            />
          )}
          <ComposerContextLabel displayMode={displayMode}>
            {envModeItems.find((item) => item.value === effectiveEnvMode)?.label}
          </ComposerContextLabel>
          {displayMode === "panel" && selectWorkspaceKind ? (
            <span className="shrink-0 text-3xs font-normal text-muted-foreground/70">
              {selectWorkspaceKind}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup
          side={displayMode === "panel" ? "left" : undefined}
          shortcut={workspaceShortcut}
        >
          {workspacePath ??
            (effectiveEnvMode === "worktree"
              ? resolveEnvModeLabel("worktree")
              : resolveCurrentWorkspaceLabel(activeWorktreePath))}
        </TooltipPopup>
      </Tooltip>
      <ComboboxPopup
        {...(displayMode === "toolbar" ? composerFloatingLayerProps : {})}
        className={
          displayMode === "panel"
            ? "w-(--anchor-width)"
            : showPreviousWorktree
              ? "w-[min(21rem,calc(100vw-2rem))]"
              : undefined
        }
      >
        <ComboboxSearchInput
          autoFocus
          aria-label="Search workspaces"
          placeholder="Search workspaces..."
        />
        <ComboboxEmpty>No matches found.</ComboboxEmpty>
        <ComboboxList>
          {(item: (typeof envModeItems)[number]) => (
            <ComboboxItem key={item.value} value={item}>
              {item.value === PREVIOUS_WORKTREE_SELECT_VALUE ? (
                <>
                  <PreviousWorktreeItemContent branch={previousWorktreeBranch} />
                  {previousWorktreeShortcut ? (
                    <Kbd variant="plain" className="ms-auto" aria-hidden>
                      {previousWorktreeShortcut}
                    </Kbd>
                  ) : null}
                </>
              ) : (
                <>
                  <FolderIcon className="size-3" />
                  {item.label}
                </>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
});

/** The pinned workspace exposes its branch as a copy action while retaining path copying. */
function WorkspaceBranchCopyRow({
  branch,
  workspaceKind,
  onContextMenu,
}: {
  branch: string;
  workspaceKind: string | null;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "branch name",
    timeout: 1500,
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy branch name",
          description: error.message,
        }),
      );
    },
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ThreadDetailsControl
            className="group/branch-copy"
            aria-label={`Copy branch name: ${branch}`}
            data-composer-context-control
            onClick={() => copyToClipboard(branch)}
            onContextMenu={onContextMenu}
          />
        }
      >
        {isCopied ? (
          <CheckIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        ) : (
          <FolderGitIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        )}
        <ComposerContextLabel displayMode="panel">
          <span aria-live="polite">{isCopied ? "Copied" : branch}</span>
        </ComposerContextLabel>
        <CopyIcon
          aria-hidden
          className="size-3.5 text-muted-foreground opacity-0 transition-opacity duration-150 ease-out group-hover/branch-copy:opacity-100 group-focus-visible/branch-copy:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100"
        />
        {workspaceKind ? (
          <span className="shrink-0 text-3xs font-normal text-muted-foreground/70">
            {workspaceKind}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="left">Copy branch name: {branch}</TooltipPopup>
    </Tooltip>
  );
}
