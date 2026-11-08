import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import type { ThreadContextRecord, ProjectId } from "@supaterm/contracts";
import { Link } from "@tanstack/react-router";
import { MessagesSquareIcon } from "@supaterm/icons";

import {
  useProject,
  useShellOmitsThreads,
  useThreadLinkMetadataSupported,
  useThreadShell,
} from "~/state/entities";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { ProjectFavicon } from "./ProjectFavicon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ThreadContextChip(props: {
  record: Pick<ThreadContextRecord, "environmentId" | "threadId" | "title">;
  projectId?: ProjectId | null;
  copyMarkdown?: string;
  unreadable?: boolean;
}) {
  const { environmentId, threadId } = props.record;
  const shell = useThreadShell({ environmentId, threadId });
  const canLookUp = useThreadLinkMetadataSupported(environmentId);
  const lookup = useEnvironmentQuery(
    shell === null && props.projectId === undefined && canLookUp
      ? orchestrationEnvironment.threadLinkMetadata({
          environmentId,
          input: { threadIds: [threadId] },
        })
      : null,
  );
  const metadata = lookup.data?.[threadId];
  const mayBeOmitted = useShellOmitsThreads(environmentId);
  const available =
    shell !== null ||
    props.projectId !== undefined ||
    (canLookUp ? metadata !== undefined || !lookup.isSuccess || lookup.isPending : mayBeOmitted);
  const projectId = shell?.projectId ?? props.projectId ?? metadata?.projectId;
  const project = useProject(projectId ? scopeProjectRef(environmentId, projectId) : null);
  const title = shell?.title?.trim() || metadata?.title.trim() || props.record.title;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="thread"
            {...(props.unreadable ? { state: "invalid" as const } : {})}
            render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
            aria-label={`Thread, ${title}`}
            data-markdown-copy={props.copyMarkdown}
            className="no-underline"
          >
            {project ? (
              <ProjectFavicon project={project} className="size-[1.17em] self-center" />
            ) : (
              <MessagesSquareIcon />
            )}
            <ContextChipLabel>{title}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">
        {props.unreadable
          ? "On another machine, so this machine's agent can't read it. Remove it or switch back to send."
          : available
            ? `Open ${title}`
            : "Thread no longer available"}
      </TooltipPopup>
    </Tooltip>
  );
}
