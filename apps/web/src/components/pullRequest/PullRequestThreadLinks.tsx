import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId, PullRequestRef, ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import { MessageSquareIcon } from "@supaterm/icons";
import { useState } from "react";
import { usePullRequestLinking } from "~/hooks/usePullRequestLinking";

import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";
import { normalizeThreadPullRequestKey } from "@supaterm/client-runtime/thread-pull-requests";
import { useServerConfigs, useThreadShell } from "~/state/entities";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { openCommandPalette } from "~/commandPaletteBus";
import { Button } from "../ui/button";
import { ThreadLinkPicker } from "../ThreadLinkPicker";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { MenuItem } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { PullRequestGlyph } from "./pullRequestIcons";

interface PullRequestThreadLinksProps {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  url: string;
  threadRef: ScopedThreadRef | null;
  display: "count" | "menu-item" | "picker";
  onPickerOpenChange?: (open: boolean) => void;
}

export function PullRequestThreadLinks(props: PullRequestThreadLinksProps) {
  const configs = useServerConfigs();
  if (configs.get(props.environmentId) === undefined) return null;
  return <EnabledPullRequestThreadLinks key={`${props.environmentId}:${props.url}`} {...props} />;
}

function EnabledPullRequestThreadLinks({
  environmentId,
  reference,
  url,
  threadRef,
  display,
  onPickerOpenChange,
}: PullRequestThreadLinksProps) {
  const parsedUrl = sourceControlClients.parseChangeRequestUrl(url);
  const parsed = parsedUrl?.link ?? null;
  const term = (parsedUrl?.definition ?? sourceControlClients.get(undefined)).changeRequest
    .singular;
  const thread = useThreadShell(threadRef?.environmentId === environmentId ? threadRef : null);
  const currentThreadRef = thread === null ? null : threadRef;
  const linking = usePullRequestLinking(environmentId);
  const linkedHere = linking.isLinked(thread, url);
  const relations = useEnvironmentQuery(
    display !== "menu-item"
      ? pullRequestEnvironment.linkedThreads({
          environmentId,
          input:
            parsed === null
              ? reference
              : { ...reference, ...normalizeThreadPullRequestKey(parsed) },
        })
      : null,
  );
  // Retain the last count while refresh temporarily clears query data.
  const [lastRelations, setLastRelations] = useState(relations.data);
  if (relations.data !== null && relations.data !== lastRelations) {
    setLastRelations(relations.data);
  }
  const [pending, setPending] = useState(false);

  const changeLink = async (threadId: ThreadId, remove: boolean) => {
    if (parsed === null || pending) return;
    setPending(true);
    const result = await settlePromise(() =>
      linking.changeLink(scopeThreadRef(environmentId, threadId), url, !remove),
    );
    setPending(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: remove ? `Could not unlink the ${term}` : `Could not link the ${term}`,
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    appAtomRegistry.refresh(
      pullRequestEnvironment.linkedThreads({
        environmentId,
        input: { ...reference, ...normalizeThreadPullRequestKey(parsed) },
      }),
    );
    onPickerOpenChange?.(false);
  };

  if (parsed === null || (!linkedHere && !linking.canLink(url))) return null;
  const linkedThreads = (relations.data ?? lastRelations)?.threads ?? [];
  const linkedThreadsLabel =
    linkedThreads.length > 0
      ? `Linked from ${linkedThreads.length} ${linkedThreads.length === 1 ? "thread" : "threads"}`
      : "Linked threads";
  return (
    <>
      {display === "count" && (linkedThreads.length > 0 || relations.error !== null) ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                aria-label={linkedThreadsLabel}
                onClick={() =>
                  openCommandPalette({
                    query: url,
                    ...((relations.data ?? lastRelations) === null
                      ? {}
                      : { linkedThreads: { environmentId, threads: linkedThreads } }),
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
      {display === "menu-item" ? (
        <MenuItem
          disabled={pending}
          onClick={() => {
            if (currentThreadRef !== null) {
              void changeLink(currentThreadRef.threadId, linkedHere);
            } else {
              onPickerOpenChange?.(true);
            }
          }}
        >
          {linkedHere ? (
            <PullRequestGlyph.unlink aria-hidden className="size-3.5" />
          ) : (
            <PullRequestGlyph.link aria-hidden className="size-3.5" />
          )}
          {linkedHere
            ? "Unlink from this thread"
            : currentThreadRef
              ? "Link to this thread"
              : "Link to thread"}
        </MenuItem>
      ) : null}
      {display === "picker" ? (
        <Dialog open onOpenChange={onPickerOpenChange}>
          <DialogPopup className="max-w-md" showCloseButton={false}>
            <DialogTitle className="sr-only">Link {term} to a thread</DialogTitle>
            <ThreadLinkPicker
              environmentId={environmentId}
              pending={pending}
              isLinked={(candidate) => linking.isLinked(candidate, url)}
              onSelect={(threadId) => void changeLink(threadId, false)}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}
