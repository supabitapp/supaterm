import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, threadIssueKeysEqual } from "@supaterm/contracts";
import type {
  EnvironmentId,
  IssueDetail,
  IssueRef,
  ScopedThreadRef,
  ThreadId,
} from "@supaterm/contracts";
import { LinkIcon, UnlinkIcon, MessageSquareIcon } from "@supaterm/icons";
import { useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs, useThreadShell } from "~/state/entities";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { readableFailure } from "../pullRequest/pullRequestDetail.logic";
import { ThreadLinkPicker } from "../ThreadLinkPicker";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The threads an issue is linked to, and the control that links it to one more: the thread it is
 * shown beside, or one picked from the environment when it is shown on its own.
 */
export function IssueThreadLinks({
  environmentId,
  reference,
  issue,
  threadRef,
}: {
  environmentId: EnvironmentId;
  reference: IssueRef & { readonly host: string };
  issue: Pick<IssueDetail, "url" | "displayKey" | "title">;
  threadRef: ScopedThreadRef | null;
}) {
  const thread = useThreadShell(threadRef?.environmentId === environmentId ? threadRef : null);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const listsThreads =
    useServerConfigs().get(environmentId)?.environment.capabilities.issueLinkedThreads === true;
  const link = useAtomCommand(threadEnvironment.linkIssue, { reportFailure: false });
  const unlink = useAtomCommand(threadEnvironment.unlinkIssue, { reportFailure: false });
  const key = {
    tracker: reference.tracker,
    host: reference.host,
    scope: reference.scope,
    key: reference.key,
  };
  const relationsAtom = issueEnvironment.linkedThreads({ environmentId, input: key });
  const relations = useEnvironmentQuery(listsThreads ? relationsAtom : null);
  // Retain the last count while refresh temporarily clears query data.
  const [lastRelations, setLastRelations] = useState(relations.data);
  if (relations.data !== null && relations.data !== lastRelations) {
    setLastRelations(relations.data);
  }
  const [pending, setPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const linkedHere = (thread?.issues ?? []).some((existing) => threadIssueKeysEqual(existing, key));
  const changeLink = async (threadId: ThreadId, remove: boolean) => {
    if (pending) return;
    setPending(true);
    const result = await (remove
      ? unlink({ environmentId, input: { threadId, ...key } })
      : link({
          environmentId,
          input: {
            threadId,
            ...key,
            projectId: reference.projectId,
            url: issue.url,
            displayKey: issue.displayKey,
            title: issue.title,
            source: "manual",
          },
        }));
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: remove ? "Could not unlink the issue" : "Could not link the issue",
        description: readableFailure(squashAtomCommandFailure(result), "The server refused it."),
      });
      return;
    }
    if (listsThreads) appAtomRegistry.refresh(relationsAtom);
    setPickerOpen(false);
  };

  const linkedThreads = (relations.data ?? lastRelations)?.threads ?? [];
  const linkedThreadsLabel =
    linkedThreads.length > 0
      ? `Linked from ${linkedThreads.length} ${linkedThreads.length === 1 ? "thread" : "threads"}`
      : "Linked threads";
  // A failed read shows "?" and falls back to searching threads for the issue's link.
  const relationsKnown = (relations.data ?? lastRelations) !== null;
  return (
    <>
      {linkedThreads.length > 0 || (!relationsKnown && relations.error !== null) ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                aria-label={linkedThreadsLabel}
                onClick={() =>
                  openCommandPalette({
                    query: issue.url,
                    ...(relationsKnown
                      ? { linkedThreads: { environmentId, threads: linkedThreads } }
                      : {}),
                  })
                }
              >
                <MessageSquareIcon aria-hidden className="size-3.5" />
                <span aria-hidden>{linkedThreads.length || "?"}</span>
              </Button>
            }
          />
          <TooltipPopup>{linkedThreadsLabel}. Search in the command palette.</TooltipPopup>
        </Tooltip>
      ) : null}
      {canOperate ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={linkedHere ? "Unlink from thread" : "Link to thread"}
                aria-pressed={thread === null ? undefined : linkedHere}
                disabled={pending}
                onClick={() => {
                  if (thread === null) setPickerOpen(true);
                  else void changeLink(thread.id, linkedHere);
                }}
              />
            }
          >
            {linkedHere ? (
              <UnlinkIcon aria-hidden className="size-3.5" />
            ) : (
              <LinkIcon aria-hidden className="size-3.5" />
            )}
          </TooltipTrigger>
          <TooltipPopup>
            {linkedHere
              ? "Unlink from this thread"
              : thread === null
                ? "Link to thread"
                : "Link to this thread"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {pickerOpen ? (
        <Dialog open onOpenChange={setPickerOpen}>
          <DialogPopup className="max-w-md" showCloseButton={false}>
            <DialogTitle className="sr-only">Link issue to a thread</DialogTitle>
            <ThreadLinkPicker
              environmentId={environmentId}
              pending={pending}
              isLinked={(candidate) =>
                (candidate.issues ?? []).some((existing) => threadIssueKeysEqual(existing, key))
              }
              onSelect={(threadId) => void changeLink(threadId, false)}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}
