import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId, IssueRef } from "@supaterm/contracts";
import { ArrowUpIcon } from "@supaterm/icons";
import { useRef, useState } from "react";

import { isImeComposing } from "~/lib/imeComposition";

import { issueEnvironment } from "~/state/issues";
import { useAtomCommand } from "~/state/use-atom-command";

import { ComposerSurface } from "../chat/ComposerSurface";
import { TextFieldVoiceInput } from "../chat/TextFieldVoiceInput";
import { readableFailure } from "../pullRequest/pullRequestDetail.logic";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

/** The thread composer's card, floating over the issue's timeline, with a comment as its message. */
export function IssueCommentComposer({
  environmentId,
  reference,
  blocked,
}: {
  environmentId: EnvironmentId;
  reference: IssueRef;
  /** Why the viewer cannot comment here; null when they can. */
  blocked: string | null;
}) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const comment = useAtomCommand(issueEnvironment.comment, { reportFailure: false });
  const locked = blocked !== null || submitting;

  const submit = async (text: string) => {
    if (text.trim().length === 0 || locked) return;
    setSubmitting(true);
    const result = await comment({ environmentId, input: { ...reference, body: text } });
    setSubmitting(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "The comment could not be posted",
        description: readableFailure(squashAtomCommandFailure(result), "The tracker refused it."),
      });
      return;
    }
    setBody("");
  };
  const submitDisabled = voiceBusy || body.trim().length === 0 || locked;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3">
      <ComposerSurface.Shell className="pointer-events-auto">
        <ComposerSurface.Host>
          <form
            className="relative z-10 flex flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              if (!voiceBusy) void submit(body);
            }}
          >
            <textarea
              ref={textareaRef}
              rows={2}
              className="field-sizing-content max-h-64 min-h-[2lh] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-base text-foreground outline-none wrap-anywhere placeholder:text-muted-foreground/70 disabled:opacity-64 sm:text-sm"
              aria-label="Add a comment"
              placeholder={blocked ?? "Leave a comment"}
              value={body}
              // Lock while posting because success clears the draft.
              disabled={locked}
              readOnly={voiceBusy}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (isImeComposing(event)) return;
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
                  event.preventDefault();
                  if (!event.repeat && !voiceBusy) void submit(body);
                }
              }}
            />
            <div className="flex flex-wrap items-center justify-end gap-2 px-2.5 pb-2.5">
              <TextFieldVoiceInput
                environmentId={environmentId}
                projectId={reference.projectId}
                disabled={locked}
                fieldRef={textareaRef}
                onChange={setBody}
                onBusyChange={setVoiceBusy}
              />
              <button
                type="submit"
                className="flex size-8 items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs transition-[scale,background-color] duration-150 enabled:cursor-pointer enabled:shadow-message-action/24 enabled:inset-shadow-control-highlight hover:scale-105 hover:bg-message-action-hover active:shadow-none active:inset-shadow-control-pressed disabled:pointer-events-none disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none"
                disabled={submitDisabled}
                aria-label={submitting ? "Posting comment" : "Comment"}
              >
                {submitting ? (
                  <Spinner size="sm" aria-hidden />
                ) : (
                  <ArrowUpIcon aria-hidden className="size-4" />
                )}
              </button>
            </div>
          </form>
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
      {/* The chat composer's bottom inset, so the two cards line up side by side. */}
      <div
        aria-hidden
        className="h-[calc(env(safe-area-inset-bottom)+1rem)] sm:h-[calc(env(safe-area-inset-bottom)+1.25rem)]"
      />
    </div>
  );
}
