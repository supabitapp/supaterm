import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import { useAtomCommand } from "~/state/use-atom-command";
import type { EnvironmentId, PullRequestDetailView, PullRequestRef } from "@supaterm/contracts";
import { SendIcon } from "@supaterm/icons";
import { useState, type RefObject } from "react";

import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { pullRequestEnvironment } from "~/state/pullRequests";

import { InlineConfirmIcon, InlineConfirmLabel } from "../InlineConfirm";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { PullRequestGlyph } from "./pullRequestIcons";

export function PullRequestCommentForm({
  environmentId,
  reference,
  detail,
  actionPending,
  textareaRef,
  onCommentAction,
  onCommented,
  onClose,
}: {
  environmentId: EnvironmentId;
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
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState<"comment" | "close" | "reopen" | null>(null);
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
  const disabled = body.trim().length === 0 || submitting !== null || actionPending;

  const submit = async (action: "comment" | "close" | "reopen") => {
    if (disabled) return;
    const trimmed = body.trim();
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
      toastManager.add({ type: "error", title: "Could not post the comment" });
      return;
    }
    setBody("");
    setSubmitting(null);
    onClose();
    onCommented();
  };

  return (
    <div className="space-y-2">
      <Textarea
        ref={textareaRef}
        // Locked while posting: the body is cleared on success, which would otherwise throw
        // away a new draft typed while the request was still in flight.
        disabled={submitting !== null || actionPending}
        value={body}
        rows={3}
        placeholder="Leave a comment"
        aria-label={`Comment on this ${sourceControlClients.get(detail.provider).changeRequest.singular}`}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.shiftKey &&
            !event.altKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) void submit("comment");
          }
        }}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {followUpAction === "close" ? (
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={disabled}
            {...confirm.bind("close", () => void submit("close"))}
          >
            <InlineConfirmIcon armed={confirm.armed === "close"}>
              <PullRequestGlyph.closed className="size-3.5" />
            </InlineConfirmIcon>
            <InlineConfirmLabel
              armed={confirm.armed === "close"}
              idle={submitting === "close" ? "Closing..." : "Close with comment"}
              confirm="Confirm close"
            />
          </Button>
        ) : followUpAction === "reopen" ? (
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => void submit("reopen")}
          >
            <PullRequestGlyph.reopen className="size-3.5" />
            {submitting === "reopen" ? "Reopening..." : "Reopen with comment"}
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => void submit("comment")}
        >
          <SendIcon className="size-3.5" />
          {submitting === "comment" ? "Posting..." : "Comment"}
        </Button>
      </div>
    </div>
  );
}
