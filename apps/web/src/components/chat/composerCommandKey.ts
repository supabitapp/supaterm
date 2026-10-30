import type { ComposerThreadDraftState } from "../../composerDraftStore";
import type { PreviewAnnotationPayload } from "@supaterm/contracts";
import type { ComposerTrigger } from "@supaterm/shared/composerTrigger";
import { type Dispatch, type RefObject, type SetStateAction } from "react";

import type { ChatComposerProps } from "./ChatComposer";
import {
  type ComposerSubmissionIntent,
  collapseExpandedComposerCursor,
  composerSubmissionIntentForKey,
} from "../../composer-logic";
import { listContinuationForEnter, listIndentForTab } from "../../composer-list-continuation";
import { composerTargetKey } from "../../composerDraftStore";
import type { ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import type { ComposerCommandItem } from "./ComposerCommandMenu";
import {
  buildComposerPromptHistoryEntries,
  stepComposerPromptHistory,
  type ComposerPromptHistoryPosition,
} from "./composerPromptHistory";
import type { PendingUserInput } from "../../session-logic";
import {
  resolveComposerDispatchMode,
  type ComposerDispatchMode,
} from "@supaterm/client-runtime/state/composer-dispatch";
import { useStableCallback } from "../../hooks/useStableCallback";
import type { ReviewCommentContext } from "../../reviewCommentContext";

/**
 * The composer's key handling inside the editor: send shortcuts, the slash/mention menu,
 * Escape cancelling a queued-message edit, ArrowUp editing the latest queued message before
 * prompt history, and list continuation.
 */
export function useComposerCommandKey(input: {
  readonly keybindings: ChatComposerProps["keybindings"];
  readonly sendShortcut: ChatComposerProps["settings"]["sendShortcut"];
  readonly routeKind: ChatComposerProps["routeKind"];
  readonly phase: ChatComposerProps["phase"];
  readonly isCompacting: boolean;
  readonly followUpBehavior: ChatComposerProps["settings"]["followUpBehavior"];
  readonly isSoftwareKeyboardOpen: boolean;
  readonly isLiteralPendingAnswer: boolean;
  readonly isEditingQueuedMessage: boolean;
  readonly pendingUserInputs: ReadonlyArray<PendingUserInput>;
  readonly promptHistoryMessages: ChatComposerProps["promptHistoryMessages"];
  readonly promptHistoryPositionRef: RefObject<{
    targetKey: string;
    position: ComposerPromptHistoryPosition;
  } | null>;
  readonly readAttachments: () => Pick<
    ComposerThreadDraftState,
    "images" | "files" | "terminalContexts"
  >;
  readonly composerDraftTarget: ChatComposerProps["composerDraftTarget"];
  readonly promptRef: ChatComposerProps["promptRef"];
  readonly composerPreviewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  readonly composerReviewComments: ReadonlyArray<ReviewCommentContext>;
  /** The predicted next prompt, offered only while it shows in the empty composer. */
  readonly promptSuggestion: { readonly text: string; readonly dismiss: () => void } | null;
  readonly composerEditorRef: RefObject<ComposerPromptEditorHandle | null>;
  readonly composerMenuOpen: boolean;
  readonly composerMenuItems: ComposerCommandItem[];
  readonly activeComposerMenuItem: ComposerCommandItem | null;
  readonly setComposerDraftPrompt: (
    target: ChatComposerProps["composerDraftTarget"],
    prompt: string,
  ) => void;
  readonly setComposerCursor: Dispatch<SetStateAction<number>>;
  readonly setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  readonly setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  readonly dismissComposerTrigger: (trigger: ComposerTrigger | null) => void;
  readonly nudgeComposerMenuHighlight: (key: "ArrowDown" | "ArrowUp") => void;
  readonly onSelectComposerItem: (item: ComposerCommandItem) => void;
  readonly resolveActiveComposerTrigger: () => { trigger: ComposerTrigger | null };
  readonly readComposerSnapshot: () => { value: string };
  readonly applyPromptReplacement: (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options?: { expandedCursorAfterReplace?: number },
  ) => boolean;
  readonly submitComposer: (
    event: undefined,
    dispatchMode: ComposerDispatchMode,
    submissionIntent: ComposerSubmissionIntent,
  ) => unknown;
  readonly onEditLatestQueuedMessage: ChatComposerProps["onEditLatestQueuedMessage"];
  readonly onCancelQueuedMessageEdit: ChatComposerProps["onCancelQueuedMessageEdit"];
}) {
  const {
    readAttachments,
    keybindings,
    sendShortcut,
    routeKind,
    phase,
    isCompacting,
    followUpBehavior,
    isSoftwareKeyboardOpen,
    isLiteralPendingAnswer,
    isEditingQueuedMessage,
    pendingUserInputs,
    promptHistoryMessages,
    promptHistoryPositionRef,
    composerDraftTarget,
    promptRef,
    composerPreviewAnnotations,
    composerReviewComments,
    promptSuggestion,
    composerEditorRef,
    composerMenuOpen,
    composerMenuItems,
    activeComposerMenuItem,
    setComposerDraftPrompt,
    setComposerCursor,
    setComposerTrigger,
    setComposerHighlightedItemId,
    dismissComposerTrigger,
    nudgeComposerMenuHighlight,
    onSelectComposerItem,
    resolveActiveComposerTrigger,
    readComposerSnapshot,
    applyPromptReplacement,
    submitComposer,
    onEditLatestQueuedMessage,
    onCancelQueuedMessageEdit,
  } = input;
  // A recall from another thread must not consume the current draft as prompt history.
  const promptHistoryTargetKey = composerTargetKey(composerDraftTarget);

  const replacePromptFromHistory = (nextPrompt: string) => {
    promptRef.current = nextPrompt;
    setComposerDraftPrompt(composerDraftTarget, nextPrompt);
    setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
    setComposerTrigger(null);
    setComposerHighlightedItemId(null);
  };

  const navigatePromptHistory = (
    direction: "backward" | "forward",
    event: KeyboardEvent,
  ): boolean => {
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) {
      return false;
    }
    if (pendingUserInputs.length > 0) return false;
    if (
      readAttachments().images.length > 0 ||
      readAttachments().files.length > 0 ||
      readAttachments().terminalContexts.length > 0 ||
      composerPreviewAnnotations.length > 0 ||
      composerReviewComments.length > 0
    ) {
      return false;
    }
    const recalled = promptHistoryPositionRef.current;
    // Sending a recalled prompt clears the composer without clearing the ref.
    const position =
      recalled?.targetKey === promptHistoryTargetKey &&
      recalled.position.recalled === promptRef.current
        ? recalled.position
        : null;
    if (position === null && promptRef.current.length > 0) {
      return false;
    }
    const editor = composerEditorRef.current;
    if (!editor?.isCaretOnVisualEdge(direction === "backward" ? "start" : "end")) {
      return false;
    }
    // A queued message is newer than anything sent, so it comes before history.
    if (direction === "backward" && position === null && onEditLatestQueuedMessage(event.repeat)) {
      return true;
    }
    const step = stepComposerPromptHistory({
      direction,
      entries: buildComposerPromptHistoryEntries(promptHistoryMessages),
      position,
      currentPrompt: promptRef.current,
    });
    if (!step) return false;
    promptHistoryPositionRef.current = step.position
      ? { targetKey: promptHistoryTargetKey, position: step.position }
      : null;
    replacePromptFromHistory(step.prompt);
    return true;
  };

  const onComposerCommandKey = (key: string, event: KeyboardEvent, isTaskItem = false) => {
    const submissionIntent = composerSubmissionIntentForKey({
      event,
      keybindings,
      isSoftwareKeyboardOpen,
      isDraftThread: routeKind === "draft",
      isRunning: phase === "running",
      sendShortcut,
      prompt: promptRef.current,
    });
    if (key === "Tab" && event.shiftKey && submissionIntent === null) {
      return false;
    }
    const { trigger } = resolveActiveComposerTrigger();
    const menuIsActive =
      !isLiteralPendingAnswer &&
      (composerMenuOpen || (trigger !== null && trigger.kind !== "slash-skill"));
    if (
      promptSuggestion !== null &&
      !menuIsActive &&
      !event.isComposing &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      promptRef.current === ""
    ) {
      // Accepting only fills the draft; the user still reads it and sends.
      if (key === "Tab" || key === "ArrowRight") {
        replacePromptFromHistory(promptSuggestion.text);
        return true;
      }
      if (key === "Escape") {
        promptSuggestion.dismiss();
        return true;
      }
    }
    if (key === "Escape") {
      if (event.isComposing || event.keyCode === 229) return false;
      if (menuIsActive) {
        dismissComposerTrigger(trigger);
        return true;
      }
      if (!isEditingQueuedMessage) return false;
      onCancelQueuedMessageEdit();
      return true;
    }
    if (menuIsActive && (submissionIntent === null || submissionIntent === "foreground")) {
      const currentItems = composerMenuItems;
      const selectedItem = activeComposerMenuItem ?? (key === "Tab" ? currentItems[0] : null);
      if (key === "ArrowDown" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowDown");
        return true;
      }
      if (key === "ArrowUp" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowUp");
        return true;
      }
      if ((key === "Enter" || key === "Tab") && selectedItem) {
        onSelectComposerItem(selectedItem);
        return true;
      }
    }
    if ((key === "ArrowUp" || key === "ArrowDown") && submissionIntent === null) {
      return navigatePromptHistory(key === "ArrowUp" ? "backward" : "forward", event);
    }
    if (submissionIntent) {
      submitComposer(
        undefined,
        resolveComposerDispatchMode({
          running: phase === "running",
          alternateModifier: submissionIntent === "alternate",
          activeTurnDefault: followUpBehavior,
          canSteer: !isCompacting,
        }),
        submissionIntent,
      );
      return true;
    }
    if (key === "Enter" && isTaskItem) return false;
    if (
      !isLiteralPendingAnswer &&
      !event.isComposing &&
      (key === "Enter" || (key === "Tab" && !event.shiftKey))
    ) {
      const selection = composerEditorRef.current?.readSelectionRange();
      const snapshot = readComposerSnapshot();
      if (selection && selection.start === selection.end && snapshot.value === promptRef.current) {
        const edit =
          key === "Enter"
            ? listContinuationForEnter(snapshot.value, selection.start)
            : listIndentForTab(snapshot.value, selection.start, selection.end);
        if (
          edit &&
          applyPromptReplacement(edit.start, edit.end, edit.replacement, {
            expandedCursorAfterReplace: edit.cursorAfter,
          })
        ) {
          return true;
        }
      }
    }
    return false;
  };

  return {
    onComposerCommandKey: useStableCallback(onComposerCommandKey),
    acceptPromptSuggestion: useStableCallback(() => {
      if (promptSuggestion !== null) replacePromptFromHistory(promptSuggestion.text);
    }),
  };
}
