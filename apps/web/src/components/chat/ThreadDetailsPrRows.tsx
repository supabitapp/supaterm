import { ThreadDetailsControl } from "./ThreadDetailsControl";
import type { EnvironmentId, ScopedThreadRef, ThreadPullRequestLink } from "@supaterm/contracts";
import {
  pullRequestListLines,
  resolveThreadPullRequestChains,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@supaterm/shared/threadPullRequests";
import { Minus, Plus } from "@supaterm/icons/nodes";
import { useState, type ComponentProps, type MouseEvent as ReactMouseEvent } from "react";

import { findProjectOnChangeRequestHost, parseChangeRequestUrl } from "~/lib/openPullRequestLink";

import { useProjects } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { MorphIcon } from "~/components/MorphIcon";
import { Collapsible, CollapsiblePanel } from "~/components/ui/collapsible";
import { linkedPullRequestSnapshotStatus, prStatusIndicator } from "../ThreadStatusIndicators";

import { ThreadDetailsPrRow } from "./ThreadDetailsPrRow";

function ThreadDetailsPrLinkRow({
  environmentId,
  link,
  composerTarget,
  onOpen,
  onActed,
  onStopWatching,
}: {
  environmentId: EnvironmentId;
  link: ThreadPullRequestLink;
  composerTarget: ComponentProps<typeof ThreadDetailsPrRow>["composerTarget"];
  onOpen: (event: ReactMouseEvent<HTMLElement>) => void;
  onActed?: (() => void) | undefined;
  onStopWatching?: (() => void) | undefined;
}) {
  const projects = useProjects();
  const parsed = parseChangeRequestUrl(link.url);
  const project =
    parsed === null
      ? null
      : (findProjectOnChangeRequestHost(
          projects.filter((candidate) => candidate.environmentId === environmentId),
          parsed,
        ) ?? null);
  const linked = linkedPullRequestSnapshotStatus(link);
  const pr = linked?.pr ?? null;
  return (
    <ThreadDetailsPrRow
      environmentId={environmentId}
      pr={pr}
      number={link.number}
      reference={link}
      status={prStatusIndicator(pr, linked?.sourceControlProvider)}
      project={project}
      label={`#${link.number}${link.snapshot === null ? "" : `: ${link.snapshot.title}`}`}
      openAriaLabel={link.url}
      composerTarget={composerTarget}
      onOpen={onOpen}
      onStopWatching={onStopWatching}
      {...(onActed ? { onActed } : {})}
    />
  );
}

export function ThreadDetailsPrRows({
  threadRef,
  links,
  currentLink,
  onOpenLink,
  ...row
}: ComponentProps<typeof ThreadDetailsPrRow> & {
  threadRef: ScopedThreadRef;
  links: ReadonlyArray<ThreadPullRequestLink>;
  currentLink: ThreadPullRequestLink | null;
  onOpenLink: (event: ReactMouseEvent<HTMLElement>, url: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const watch = useAtomCommand(threadEnvironment.watchPullRequest, { reportFailure: true });
  const stopWatching = (link: ThreadPullRequestLink | null) =>
    link?.watch === undefined
      ? undefined
      : () =>
          void watch({
            environmentId: threadRef.environmentId,
            input: {
              threadId: threadRef.threadId,
              host: link.host,
              repository: link.repository,
              number: link.number,
              watching: false,
            },
          });
  const currentRow = <ThreadDetailsPrRow {...row} onStopWatching={stopWatching(currentLink)} />;
  const rest =
    currentLink === null
      ? []
      : pullRequestListLines(resolveThreadPullRequestChains(visibleThreadPullRequests(links)))
          .map((line) => line.link)
          .filter((link) => threadPullRequestKeyOf(link) !== threadPullRequestKeyOf(currentLink));
  if (rest.length === 0) return currentRow;

  return (
    <>
      {currentRow}
      <Collapsible open={expanded} className="-mx-1">
        <CollapsiblePanel>
          <div data-thread-details-pr-list className="flex flex-col px-1">
            {rest.map((link) => (
              <ThreadDetailsPrLinkRow
                key={threadPullRequestKeyOf(link)}
                environmentId={row.environmentId}
                link={link}
                composerTarget={row.composerTarget}
                onOpen={(event) => onOpenLink(event, link.url)}
                onActed={row.onActed}
                onStopWatching={stopWatching(link)}
              />
            ))}
          </div>
        </CollapsiblePanel>
      </Collapsible>
      <ThreadDetailsControl
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        part="row"
        tone="muted"
        className="w-full active:scale-100"
      >
        <MorphIcon aria-hidden className="size-4 shrink-0" icon={expanded ? Minus : Plus} />
        {expanded ? "Show less" : `Show ${rest.length} more`}
      </ThreadDetailsControl>
    </>
  );
}
