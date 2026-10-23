import type { ComposerHandleRef } from "../../composerHandleContext";
import type { BranchToolbarHandle } from "../BranchToolbar";
import type { ChatComposerHandle } from "./ChatComposer";
import type { ChatShortcutCommands, ChatShortcutHandler } from "./useChatShortcuts";

/** Which composer chords apply: draft project controls show only on a draft's project picker. */
export interface ComposerShortcutAvailability {
  readonly draftProjectControls: boolean;
  readonly branchPicker: boolean;
}

const openControl =
  (
    composerRef: ComposerHandleRef,
    control: Parameters<ChatComposerHandle["openControl"]>[0],
    available = true,
  ): ChatShortcutHandler =>
  ({ repeat }) => {
    if (!available) return false;
    if (!repeat) composerRef.current?.openControl(control);
  };

/** Chords that open or step the composer's controls and its branch toolbar. Held keys do not repeat them. */
export function composerShortcutCommands(
  composerRef: ComposerHandleRef,
  branchToolbarRef: { readonly current: BranchToolbarHandle | null },
  availability: ComposerShortcutAvailability,
): ChatShortcutCommands {
  return {
    "modelPicker.toggle": ({ repeat }) => {
      if (!repeat) composerRef.current?.toggleModelPicker();
    },
    "composer.increaseEffort": ({ repeat }) => {
      if (!repeat) composerRef.current?.stepReasoningEffort(1);
    },
    "composer.decreaseEffort": ({ repeat }) => {
      if (!repeat) composerRef.current?.stepReasoningEffort(-1);
    },
    "composer.host": openControl(composerRef, "composer.host", availability.draftProjectControls),
    "composer.effort": openControl(composerRef, "composer.effort"),
    "composer.mode": openControl(composerRef, "composer.mode"),
    "composer.workspace": openControl(
      composerRef,
      "composer.workspace",
      availability.draftProjectControls,
    ),
    "composer.branch": ({ repeat }) => {
      if (!availability.branchPicker) return false;
      if (!repeat) branchToolbarRef.current?.openBranchPicker();
    },
    "composer.previousWorktree": ({ repeat }) => {
      if (!repeat) branchToolbarRef.current?.usePreviousWorktree();
    },
  } satisfies ChatShortcutCommands;
}
