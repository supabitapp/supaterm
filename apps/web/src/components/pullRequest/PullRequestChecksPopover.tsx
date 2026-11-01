import type * as React from "react";
import { useState } from "react";
import type {
  EnvironmentId,
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestRef,
  ScopedThreadRef,
} from "@supaterm/contracts";
import { withOccurrenceKeys } from "@supaterm/shared/occurrenceKeys";
import { ChevronDownIcon } from "@supaterm/icons";

import { useOpenLink } from "~/browser/useOpenLink";
import { cn } from "~/lib/utils";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { groupPullRequestChecks } from "./pullRequestDetail.logic";
import {
  PullRequestCheckStatusIcon,
  PullRequestChecksRing,
  pullRequestCheckStatusLabel,
  pullRequestChecksStatePresentation,
  summarizePullRequestChecks,
} from "./pullRequestPresentation";

// Fetch only on open to avoid per-row requests.
function LazyChecksBody({
  environmentId,
  reference,
  threadRef,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  threadRef: ScopedThreadRef | null;
}) {
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({ environmentId, input: reference }),
  );
  if (detailQuery.error !== null) {
    return <p className="text-muted-foreground text-xs">{detailQuery.error}</p>;
  }
  if (detailQuery.data === null) {
    return (
      <p className="text-muted-foreground text-xs">
        {detailQuery.isPending ? "Loading checks…" : "No checks reported"}
      </p>
    );
  }
  return <ChecksBody checks={detailQuery.data.checks} threadRef={threadRef} />;
}

function ChecksBody({
  checks,
  threadRef,
}: {
  checks: ReadonlyArray<PullRequestCheck>;
  threadRef: ScopedThreadRef | null;
}) {
  const openLink = useOpenLink(threadRef);
  const { attention, running, completed } = groupPullRequestChecks(checks);
  const [showAll, setShowAll] = useState(false);
  const canCollapse = attention.length + running.length > 0 && completed.length > 0;
  const orderedChecks = [...attention, ...running, ...(showAll || !canCollapse ? completed : [])];
  if (checks.length === 0) {
    return <p className="text-muted-foreground text-xs">No checks reported</p>;
  }
  return (
    <>
      <ScrollArea className="max-h-60">
        <ul className="flex flex-col">
          {/* Keyed by name and occurrence: the host is the one that decides how many runs
          share a name, and a repeated key is a rendering fault rather than a wrong list. */}
          {withOccurrenceKeys(orderedChecks, (check) => check.name).map(({ item: check, key }) => {
            const rowClassName = cn(
              "flex min-h-5 w-full min-w-0 items-center gap-2 rounded-sm py-0.5 text-left text-xs leading-4 pointer-coarse:min-h-11",
              check.url !== null &&
                "cursor-pointer transition-[background-color,scale] duration-150 ease-out hover:bg-accent/60 active:scale-[0.96] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
            );
            return (
              <li key={key}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      check.url === null ? (
                        <span className={rowClassName} />
                      ) : (
                        <button
                          type="button"
                          className={rowClassName}
                          onClick={(event) => {
                            if (!check.url) return;
                            void openLink(check.url, { event }).catch((error: unknown) => {
                              console.error(error);
                              toastManager.add({
                                type: "error",
                                title: "Unable to open check details",
                              });
                            });
                          }}
                        />
                      )
                    }
                  >
                    <PullRequestCheckStatusIcon status={check.status} />
                    <span className="min-w-0 flex-1 truncate">{check.name}</span>
                    <span className="sr-only">: {pullRequestCheckStatusLabel(check)}</span>
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    <div className="flex flex-col gap-1">
                      <span>{check.name}</span>
                      <span className="text-muted-foreground">
                        {pullRequestCheckStatusLabel(check)}
                      </span>
                      {check.description ? <span>{check.description}</span> : null}
                    </div>
                  </TooltipPopup>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
      {canCollapse ? (
        <Button
          variant="ghost"
          size="xs"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show less" : "Show all"}
        </Button>
      ) : null}
    </>
  );
}

export function PullRequestChecksPopover({
  checksState,
  checks,
  stale = false,
  environmentId,
  reference,
  threadRef = null,
  variant = "icon",
  className,
  render,
}: {
  checksState: PullRequestChecksState;
  checks?: ReadonlyArray<PullRequestCheck>;
  stale?: boolean;
  environmentId?: EnvironmentId;
  reference?: PullRequestRef;
  threadRef?: ScopedThreadRef | null;
  variant?: "icon" | "button";
  className?: string;
  render?: React.ReactElement;
}) {
  const presentation = pullRequestChecksStatePresentation(checksState);
  const summary = checks === undefined || stale ? null : summarizePullRequestChecks(checks);
  return (
    <Popover>
      <PopoverTrigger
        nativeButton={variant === "button"}
        openOnHover
        delay={150}
        closeDelay={150}
        aria-label={
          variant === "button"
            ? `Open checks: ${summary ?? presentation.label}`
            : `Checks: ${presentation.label}`
        }
        render={
          variant === "button" ? (
            (render ?? <Button variant="ghost" size="sm" className={className} />)
          ) : (
            <span
              role="button"
              tabIndex={0}
              className={cn("inline-flex shrink-0 cursor-pointer items-center", className)}
            />
          )
        }
        onClick={(event) => event.stopPropagation()}
      >
        {checks !== undefined && checks.length > 0 && !stale ? (
          <PullRequestChecksRing checks={checks} />
        ) : (
          <presentation.Icon aria-hidden className={cn("size-3.5", presentation.toneClassName)} />
        )}
        {variant === "button" ? <ChevronDownIcon aria-hidden className="size-3" /> : null}
      </PopoverTrigger>
      <PopoverPopup align="start" width="md" side="bottom">
        <PullRequestChecksDetails
          checksState={checksState}
          checks={checks}
          stale={stale}
          environmentId={environmentId}
          reference={reference}
          threadRef={threadRef}
        />
      </PopoverPopup>
    </Popover>
  );
}

/**
 * What a checks popover lists: the rollup's headline, its counts, then every check. Shared by
 * every popover that opens on checks, whatever its trigger.
 */
export function PullRequestChecksDetails({
  checksState,
  checks,
  stale = false,
  environmentId,
  reference,
  threadRef,
}: {
  checksState: PullRequestChecksState;
  checks?: ReadonlyArray<PullRequestCheck> | undefined;
  stale?: boolean;
  environmentId?: EnvironmentId | undefined;
  reference?: PullRequestRef | undefined;
  threadRef: ScopedThreadRef | null;
}) {
  const presentation = pullRequestChecksStatePresentation(checksState);
  const summary = checks === undefined || stale ? null : summarizePullRequestChecks(checks);
  return (
    <>
      <p className="mb-1 font-medium text-sm">{presentation.label}</p>
      {summary === null ? null : (
        <p className="mb-2 text-muted-foreground text-xs tabular-nums">{summary}</p>
      )}
      {stale ? (
        <p className="text-muted-foreground text-xs">
          Check details are out of date. Refresh the pull request to update them.
        </p>
      ) : checks !== undefined ? (
        <ChecksBody checks={checks} threadRef={threadRef} />
      ) : environmentId !== undefined && reference !== undefined ? (
        <LazyChecksBody environmentId={environmentId} reference={reference} threadRef={threadRef} />
      ) : null}
    </>
  );
}
