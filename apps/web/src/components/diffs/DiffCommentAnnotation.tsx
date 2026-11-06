import type { EnvironmentId } from "@supaterm/contracts";
import { MessageCircleIcon, TrashIcon } from "@supaterm/icons";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { TextFieldVoiceInput } from "~/components/chat/TextFieldVoiceInput";
import { Textarea } from "~/components/ui/textarea";
import { useThreadRouteRef } from "~/hooks/useThreadRouteTarget";
import { textDirection } from "~/textDirection";

import { isCommentSubmitShortcut } from "./commentSubmitShortcut";

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
}

export function DiffCommentAnnotation({
  kind,
  rangeLabel,
  text,
  onTextChange,
  onCancel,
  onComment,
  onDelete,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  pending = false,
  secondaryAction,
  focusOnMount = true,
  voiceEnvironmentId,
}: DiffCommentAnnotationProps) {
  const [localDraftText, setLocalDraftText] = useState("");
  const displayedText = kind === "draft" && !onTextChange ? localDraftText : text;
  const trimmedText = displayedText.trim();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadRef = useThreadRouteRef();
  const voiceTarget = voiceEnvironmentId
    ? { environmentId: voiceEnvironmentId, threadId: null }
    : threadRef;
  const [voiceBusy, setVoiceBusy] = useState(false);
  const changeText = onTextChange ?? setLocalDraftText;
  const canComment = !pending && !voiceBusy && trimmedText.length > 0;

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
              aria-label="Delete comment"
              onClick={onDelete}
            >
              <TrashIcon className="size-3" />
            </Button>
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-diff-comment-annotation
      className="px-3 py-2 font-sans text-foreground caret-foreground selection:bg-primary selection:text-primary-foreground"
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Textarea
        ref={textareaRef}
        autoFocus={focusOnMount}
        size="sm"
        readOnly={voiceBusy}
        value={displayedText}
        dir={textDirection(displayedText)}
        placeholder={placeholder}
        aria-label={`Comment on lines ${rangeLabel}`}
        onChange={(event) => changeText(event.target.value)}
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (isCommentSubmitShortcut(event, trimmedText, pending || voiceBusy)) {
            event.preventDefault();
            onComment(trimmedText);
          }
        }}
      />
      <div className="mt-1.5 flex items-center gap-1">
        {voiceTarget ? (
          <TextFieldVoiceInput
            environmentId={voiceTarget.environmentId}
            threadId={voiceTarget.threadId}
            disabled={pending}
            fieldRef={textareaRef}
            onChange={changeText}
            onBusyChange={setVoiceBusy}
          />
        ) : null}
        <span className="mr-auto text-3xs text-muted-foreground/70">⌘/Ctrl Enter to send</span>
        <Button variant="ghost-muted" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        {secondaryAction ? (
          <Button
            size="xs"
            variant="outline"
            disabled={voiceBusy || (!secondaryAction.allowEmpty && !trimmedText)}
            onClick={() => secondaryAction.onAction(trimmedText)}
          >
            {secondaryAction.icon}
            {secondaryAction.label}
          </Button>
        ) : null}
        <Button size="xs" disabled={!canComment} onClick={() => onComment(trimmedText)}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
