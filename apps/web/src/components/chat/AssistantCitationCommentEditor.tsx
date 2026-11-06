import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation } from "@supaterm/contracts";
import { useState, type RefObject } from "react";
import { useThreadRouteRef } from "~/hooks/useThreadRouteTarget";
import { textDirection } from "~/textDirection";

import { Button } from "../ui/button";
import { TextFieldVoiceInput } from "./TextFieldVoiceInput";

export function AssistantCitationCommentEditor({
  citation,
  inputRef,
  onSubmit,
  onSubmitAndSend,
  onCancel,
  onDraftChange,
}: {
  citation: AssistantCitation;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: (comment: string) => boolean;
  onSubmitAndSend?: (comment: string) => boolean;
  onCancel: () => void;
  onDraftChange?: (comment: string) => void;
}) {
  const [comment, setComment] = useState(citation.comment ?? "");
  const threadRef = useThreadRouteRef();
  const [voiceBusy, setVoiceBusy] = useState(false);
  const commentTooLong = comment.length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH;
  const changeComment = (next: string) => {
    setComment(next);
    onDraftChange?.(next);
  };
  const submit = () => {
    if (!commentTooLong && !voiceBusy) onSubmit(comment);
  };
  const submitAndSend = () => {
    if (commentTooLong || voiceBusy) return;
    if (onSubmitAndSend) {
      onSubmitAndSend(comment);
    } else {
      onSubmit(comment);
    }
  };

  return (
    <div
      data-citation-comment-editor="true"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <textarea
        ref={inputRef}
        aria-label="Comment on selected text"
        aria-description="Enter to save the citation comment; Command/Ctrl+Enter to save and send; Shift+Enter for a new line."
        aria-invalid={commentTooLong || undefined}
        placeholder="Add an optional comment..."
        rows={2}
        dir={textDirection(comment)}
        className="field-sizing-content block max-h-40 min-h-16 w-full resize-none bg-transparent px-1 py-1.5 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        readOnly={voiceBusy}
        value={comment}
        onChange={(event) => changeComment(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) {
              submitAndSend();
            } else {
              submit();
            }
          }
        }}
      />
      {commentTooLong ? (
        <p role="status" className="pt-1 text-xs text-destructive">
          Comments can contain up to {ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString()}{" "}
          characters.
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        {threadRef ? (
          <span className="mr-auto">
            <TextFieldVoiceInput
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              fieldRef={inputRef}
              onChange={changeComment}
              onBusyChange={setVoiceBusy}
            />
          </span>
        ) : null}
        <Button
          variant="outline"
          size="xs"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={commentTooLong || voiceBusy}
          onPointerDown={(event) => event.preventDefault()}
          onClick={submit}
        >
          {commentTooLong ? "Shorten comment" : "Save"}
        </Button>
      </div>
    </div>
  );
}
