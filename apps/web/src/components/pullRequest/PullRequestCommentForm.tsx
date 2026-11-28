import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import { useAtomCommand } from "~/state/use-atom-command";
import type { EnvironmentId, PullRequestDetailView, PullRequestRef } from "@supaterm/contracts";
import { SendIcon } from "@supaterm/icons";
import { useEffect, useState, type RefObject } from "react";

import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { TextFieldSpeechControls, useTextFieldSpeech } from "~/speech/useTextFieldSpeech";
import { pullRequestEnvironment } from "~/state/pullRequests";

import { InlineConfirmIcon, InlineConfirmLabel } from "../InlineConfirm";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { PullRequestGlyph } from "./pullRequestIcons";
import {
  PullRequestMarkdownTextarea,
  pullRequestCompletionScope,
} from "./PullRequestMarkdownTextarea";
import { isImeComposing } from "~/lib/imeComposition";
import { msg, useGT } from "gt-react";
import { changeRequestTermKind } from "./changeRequestTerm";
import { m } from "~/i18n/messages";

export function PullRequestCommentForm({
  environmentId,
  active,
  reference,
  detail,
  actionPending,
  textareaRef,
  onCommentAction,
  onCommented,
  onClose,
}: {
  environmentId: EnvironmentId;
  /** False while the form stays mounted but hidden; dictation is cancelled then. */
  active: boolean;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  actionPending: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onCommentAction: (
    body: string,
    action: "close" | "reopen",
  ) => Promise<{ readonly commentPosted: boolean }>;
  onCommented: () => void;
  onClose: () => void;
}) {
  const gt = useGT();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState<"comment" | "close" | "reopen" | null>(null);
  const locked = submitting !== null || actionPending;
  const speech = useTextFieldSpeech({
    environmentId,
    projectId: reference.projectId,
    ownerKey: JSON.stringify(["pr-comment", environmentId, reference]),
    text: body,
    textareaRef,
    onTextChange: setBody,
    disabled: !active || locked,
  });
  const { cancel } = speech;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- discards a recording when the hidden form can no longer be submitted
  useEffect(() => {
    if (!active) cancel();
  }, [active, cancel]);
  const postComment = useAtomCommand(pullRequestEnvironment.comment, {
    reportFailure: false,
  });
  const followUpAction =
    detail.state === "open" &&
    detail.capabilities.actions.includes("close") &&
    detail.viewerPermissions.actions.includes("close")
      ? ("close" as const)
      : detail.state === "closed" &&
          detail.capabilities.actions.includes("reopen") &&
          detail.viewerPermissions.actions.includes("reopen")
        ? ("reopen" as const)
        : null;
  const confirm = useInlineConfirm<"close">();

  const submit = async (action: "comment" | "close" | "reopen", text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || submitting !== null || actionPending) return;
    setSubmitting(action);
    if (action !== "comment") {
      const result = await onCommentAction(trimmed, action);
      if (result.commentPosted) {
        setBody("");
        onClose();
      }
      setSubmitting(null);
      return;
    }
    const result = await postComment({
      environmentId,
      input: {
        ...reference,
        body: trimmed,
      },
    });
    if (result._tag === "Failure") {
      setSubmitting(null);
      toastManager.add({ type: "error", title: m(msg("Could not post the comment")) });
      return;
    }
    setBody("");
    setSubmitting(null);
    onClose();
    onCommented();
  };
  const submitAfterDictation = (action: "comment" | "close" | "reopen") =>
    speech.submitAfterDictation((text) => void submit(action, text));
  const disabled =
    speech.preparing || (body.trim().length === 0 && !speech.blocksSubmission) || locked;

  return (
    <div className="space-y-2">
      <PullRequestMarkdownTextarea
        ref={textareaRef}
        completionScope={pullRequestCompletionScope(detail, environmentId, reference)}
        // Lock while posting because success clears the draft.
        disabled={locked}
        readOnly={speech.freezesEditor}
        value={body}
        rows={3}
        placeholder={gt("Leave a comment")}
        aria-label={gt(
          "Comment on this {term, select, mr {merge request} cr {change request} other {pull request}}",
          {
            term: changeRequestTermKind(sourceControlClients.get(detail.provider).changeRequest),
          },
        )}
        onValueChange={setBody}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.shiftKey &&
            !event.altKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) submitAfterDictation("comment");
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <TextFieldSpeechControls speech={speech} disabled={locked} />
        {followUpAction === "close" ? (
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={disabled}
            {...confirm.bind("close", () => submitAfterDictation("close"))}
          >
            <InlineConfirmIcon armed={confirm.armed === "close"}>
              <PullRequestGlyph.closed className="size-3.5" />
            </InlineConfirmIcon>
            <InlineConfirmLabel
              armed={confirm.armed === "close"}
              idle={submitting === "close" ? gt("Closing...") : gt("Close with comment")}
              confirm={gt("Confirm close")}
            />
          </Button>
        ) : followUpAction === "reopen" ? (
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => submitAfterDictation("reopen")}
          >
            <PullRequestGlyph.reopen className="size-3.5" />
            {submitting === "reopen" ? gt("Reopening...") : gt("Reopen with comment")}
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => submitAfterDictation("comment")}
        >
          <SendIcon className="size-3.5" />
          {submitting === "comment"
            ? gt("Posting...")
            : gt("Comment", { $context: "verb, submit button" })}
        </Button>
      </div>
    </div>
  );
}
