import { useAtomCommand } from "~/state/use-atom-command";
import type { EnvironmentId, PullRequestRef, PullRequestReviewVerdict } from "@supaterm/contracts";
import { CheckIcon, CircleXIcon, MessageSquareIcon } from "@supaterm/icons";
import { useState, type ReactNode, type RefObject } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";

import { TextFieldVoiceInput } from "../chat/TextFieldVoiceInput";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { toastManager } from "../ui/toast";
import { readableFailure } from "./pullRequestDetail.logic";
import {
  pullRequestReviewKey,
  usePendingReviewComments,
  usePullRequestReviewStore,
} from "./pullRequestReviewStore";
import {
  PullRequestMarkdownTextarea,
  type PullRequestCompletionScope,
} from "./PullRequestMarkdownTextarea";
import { msg, useGT, useMessages } from "gt-react";
import { m } from "~/i18n/messages";
import type { ChangeRequestTermKind } from "./changeRequestTerm";

const VERDICTS: ReadonlyArray<{
  readonly value: PullRequestReviewVerdict;
  readonly label: string;
  readonly sent: (term: ChangeRequestTermKind) => string;
  readonly icon: ReactNode;
}> = [
  {
    value: "comment",
    label: msg("Comment", { $context: "review verdict" }),
    sent: () => m(msg("Review submitted")),
    icon: <MessageSquareIcon className="size-3" />,
  },
  {
    value: "approve",
    label: msg("Approve", { $context: "review verdict" }),
    sent: (term) =>
      m(
        msg(
          "{term, select, mr {Merge request} cr {Change request} other {Pull request}} approved",
          { term },
        ),
      ),
    icon: <CheckIcon className="size-3" />,
  },
  {
    value: "request-changes",
    label: msg("Request changes"),
    sent: () => m(msg("Changes requested")),
    icon: <CircleXIcon className="size-3" />,
  },
];

export function PullRequestReviewForm({
  environmentId,
  reference,
  headSha,
  completionScope,
  term,
  verdicts,
  requestChangesSummaryRequired,
  textareaRef,
  pending,
  onPendingChange,
  onSubmitted,
  onRefused,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** The head on screen, which the review is pinned to. */
  headSha: string | undefined;
  completionScope: PullRequestCompletionScope | null;
  term: ChangeRequestTermKind;
  verdicts: ReadonlyArray<PullRequestReviewVerdict>;
  requestChangesSummaryRequired: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onSubmitted: () => void;
  onRefused: () => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const [requestedVerdict, setRequestedVerdict] = useState<PullRequestReviewVerdict>("comment");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const comments = usePendingReviewComments(reference);
  const reviewKey = pullRequestReviewKey(reference);
  const body = usePullRequestReviewStore((store) => store.summaries[reviewKey] ?? "");
  const removeComments = usePullRequestReviewStore((store) => store.removeComments);
  const setSummary = usePullRequestReviewStore((store) => store.setSummary);
  const clearSummary = usePullRequestReviewStore((store) => store.clearSummary);
  const submitReview = useAtomCommand(pullRequestEnvironment.submitReview, {
    reportFailure: false,
  });

  const offered = VERDICTS.filter((verdict) => verdicts.includes(verdict.value));
  const selectedVerdict =
    offered.find((verdict) => verdict.value === requestedVerdict) ?? offered[0];

  const submit = async (verdict: (typeof VERDICTS)[number]) => {
    if (pending || voiceBusy) return;
    const submittedBody = body;
    const submittedComments = comments;
    onPendingChange(true);
    const result = await submitReview({
      environmentId,
      input: {
        ...reference,
        ...(headSha === undefined ? {} : { expectedHeadSha: headSha }),
        verdict: verdict.value,
        body: submittedBody,
        comments: submittedComments,
      },
    });
    onPendingChange(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: m(msg("The review could not be submitted")),
        description: readableFailure(
          squashAtomCommandFailure(result),
          m(msg("The host refused the review. Your draft is still here to try again.")),
        ),
      });
      onRefused();
      return;
    }
    // Preserve comments and summary edits made during submission.
    removeComments(
      reviewKey,
      submittedComments.map((comment) => comment.id),
    );
    clearSummary(reviewKey, submittedBody);
    toastManager.add({ type: "success", title: verdict.sent(term) });
    onSubmitted();
  };

  // Forgejo requires a summary when requesting changes, even with inline comments.
  const canSubmit = (verdict: PullRequestReviewVerdict, summary: string) =>
    verdict === "request-changes" && requestChangesSummaryRequired
      ? summary.trim().length > 0
      : verdict === "approve" || summary.trim().length > 0 || comments.length > 0;
  const placeholder =
    selectedVerdict === undefined || canSubmit(selectedVerdict.value, "")
      ? gt("Summarize your review (optional)")
      : selectedVerdict.value === "request-changes" && requestChangesSummaryRequired
        ? gt("Summarize your review (required to request changes)")
        : gt("Summarize your review or add line comments");

  return (
    <>
      <PullRequestMarkdownTextarea
        ref={textareaRef}
        completionScope={completionScope}
        rows={3}
        readOnly={voiceBusy}
        value={body}
        placeholder={placeholder}
        aria-label={gt("Review summary")}
        onValueChange={(next) => setSummary(reviewKey, next)}
      />
      <div className="mt-2 flex justify-end gap-2">
        <TextFieldVoiceInput
          environmentId={environmentId}
          disabled={pending}
          fieldRef={textareaRef}
          onChange={(text) => setSummary(reviewKey, text)}
          onBusyChange={setVoiceBusy}
        />
        {offered.length > 1 ? (
          <Select
            value={selectedVerdict?.value ?? null}
            disabled={pending}
            onValueChange={(value) => {
              if (value !== null) setRequestedVerdict(value);
            }}
          >
            <SelectTrigger
              size="xs"
              className="mr-auto w-auto min-w-0"
              aria-label={gt("Review verdict")}
            >
              <span className="flex items-center gap-1.5">
                {selectedVerdict?.icon}
                {selectedVerdict ? resolve(selectedVerdict.label) : null}
              </span>
            </SelectTrigger>
            <SelectPopup side="top" alignItemWithTrigger={false}>
              {offered.map((verdict) => (
                <SelectItem key={verdict.value} value={verdict.value}>
                  <span className="flex items-center gap-1.5">
                    {verdict.icon}
                    {resolve(verdict.label)}
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        <Button
          size="xs"
          disabled={
            pending ||
            voiceBusy ||
            selectedVerdict === undefined ||
            !canSubmit(selectedVerdict.value, body)
          }
          onClick={() => {
            if (selectedVerdict !== undefined) void submit(selectedVerdict);
          }}
        >
          {pending ? gt("Submitting...") : gt("Submit review")}
        </Button>
      </div>
    </>
  );
}
