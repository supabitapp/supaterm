import type { EnvironmentId } from "@supaterm/contracts";
import { MessageCircleIcon, TrashIcon } from "@supaterm/icons";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  PullRequestMarkdownTextarea,
  type PullRequestCompletionScope,
} from "~/components/pullRequest/PullRequestMarkdownTextarea";
import { useThreadRouteRef } from "~/hooks/useThreadRouteTarget";
import {
  SpeechTextField,
  TextFieldSpeechControls,
  type TextFieldSpeech,
} from "~/speech/useTextFieldSpeech";
import { textDirection } from "~/textDirection";

import { isCommentSubmitShortcut } from "./commentSubmitShortcut";
import { T, useGT } from "gt-react";

interface DiffCommentSecondaryAction {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly allowEmpty?: boolean;
  readonly onAction: (text: string) => void;
}

interface DiffCommentAnnotationProps {
  kind: "draft" | "comment";
  rangeLabel: string;
  text: string;
  onTextChange?: (text: string) => void;
  onCancel: () => void;
  onComment: (text: string) => void;
  onDelete?: () => void;
  placeholder?: string;
  submitLabel?: string;
  pending?: boolean;
  secondaryAction?: DiffCommentSecondaryAction;
  focusOnMount?: boolean;
  /** Where dictation goes outside a thread route, as on a pull request page. */
  voiceEnvironmentId?: EnvironmentId | undefined;
  /** Names the draft to dictation, so a recording started here lands here after a remount. */
  speechOwnerKey?: string | undefined;
  /** Set only for pull request comments, where `@` completes the repository's users. */
  completionScope?: PullRequestCompletionScope | null;
}

export function DiffCommentAnnotation({
  kind,
  rangeLabel,
  text,
  onTextChange,
  onCancel,
  onComment,
  onDelete,
  placeholder,
  submitLabel,
  pending = false,
  secondaryAction,
  focusOnMount = true,
  voiceEnvironmentId,
  speechOwnerKey,
  completionScope = null,
}: DiffCommentAnnotationProps) {
  const gt = useGT();
  const [localDraftText, setLocalDraftText] = useState("");
  const displayedText = kind === "draft" && !onTextChange ? localDraftText : text;
  const trimmedText = displayedText.trim();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadRef = useThreadRouteRef();
  const speechEnvironmentId = voiceEnvironmentId ?? threadRef?.environmentId;
  const changeText = onTextChange ?? setLocalDraftText;

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- focuses the draft textarea on the next animation frame after mount
  useLayoutEffect(() => {
    if (kind !== "draft" || !focusOnMount) return;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnMount, kind]);

  if (kind === "comment") {
    return (
      <div
        data-diff-comment-annotation
        className="group/comment flex min-w-0 items-start gap-2.5 border-s-2 border-primary/55 bg-primary/[0.045] px-3 py-2.5 font-sans text-foreground selection:bg-primary selection:text-primary-foreground"
        contentEditable={false}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MessageCircleIcon className="size-3.5 h-5 shrink-0 text-primary/70" aria-hidden="true" />
        <p
          className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5 wrap-anywhere"
          dir={textDirection(displayedText)}
        >
          {displayedText}
        </p>
        {onDelete ? (
          <span className="-my-1 -mr-1 flex shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={gt("Delete comment")}
              onClick={onDelete}
            >
              <TrashIcon className="size-3" />
            </Button>
          </span>
        ) : null}
      </div>
    );
  }

  const submit = (
    speech: TextFieldSpeech | undefined,
    action: (text: string) => void,
    allowEmpty = false,
  ) => {
    const finish = (value: string) => {
      if (!pending && (allowEmpty || value.trim())) action(value.trim());
    };
    if (speech) speech.submitAfterDictation(finish);
    else finish(displayedText);
  };

  const renderDraft = (speech?: TextFieldSpeech) => (
    <div
      data-diff-comment-annotation
      className="px-3 py-2 font-sans text-foreground caret-foreground selection:bg-primary selection:text-primary-foreground"
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <PullRequestMarkdownTextarea
        ref={textareaRef}
        completionScope={completionScope}
        autoFocus={focusOnMount}
        size="sm"
        readOnly={speech?.freezesEditor}
        value={displayedText}
        dir={textDirection(displayedText)}
        placeholder={placeholder ?? gt("Add a comment…")}
        aria-label={gt("Comment on lines {rangeLabel}", { rangeLabel })}
        onValueChange={changeText}
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onKeyDown={(event) => {
          // Unclaimed, an IME Escape would close the right panel sheet or leave the pull requests page.
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            event.stopPropagation();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            if (speech && speech.state.phase !== "idle") speech.cancel();
            else onCancel();
          }
          if (isCommentSubmitShortcut(event, trimmedText, pending, speech?.blocksSubmission)) {
            event.preventDefault();
            submit(speech, onComment);
          }
        }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {speech ? <TextFieldSpeechControls speech={speech} disabled={pending} /> : null}
        <span className="mr-auto text-3xs text-muted-foreground/70">
          <T>⌘/Ctrl Enter to send</T>
        </span>
        <Button variant="ghost-muted" size="xs" onClick={onCancel}>
          <T>Cancel</T>
        </Button>
        {secondaryAction ? (
          <Button
            size="xs"
            variant="outline"
            disabled={
              pending ||
              speech?.preparing === true ||
              (!secondaryAction.allowEmpty && !trimmedText && !speech?.blocksSubmission)
            }
            onClick={() => submit(speech, secondaryAction.onAction, secondaryAction.allowEmpty)}
          >
            {secondaryAction.icon}
            {secondaryAction.label}
          </Button>
        ) : null}
        <Button
          size="xs"
          disabled={
            pending ||
            speech?.preparing === true ||
            (trimmedText.length === 0 && !speech?.blocksSubmission)
          }
          onClick={() => submit(speech, onComment)}
        >
          {submitLabel ?? gt("Comment", { $context: "verb, submit button" })}
        </Button>
      </div>
    </div>
  );

  if (!speechEnvironmentId) return renderDraft();
  return (
    <SpeechTextField
      environmentId={speechEnvironmentId}
      ownerKey={speechOwnerKey ?? JSON.stringify(["diff-comment", speechEnvironmentId, rangeLabel])}
      text={displayedText}
      textareaRef={textareaRef}
      onTextChange={changeText}
      disabled={pending}
    >
      {renderDraft}
    </SpeechTextField>
  );
}
