import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
/**
 * The thread details panel's pull request row: what the thread's pull request is, and the one
 * thing worth doing to it right now.
 *
 * The row itself opens the pull request in the right panel, exactly as it always has. Around
 * that, the host's richer answer collapses into a single trailing slot, ranked by what unblocks
 * the merge next: "Resolve" on conflicts, "Ready" on a draft, "Fix" under failing checks, and
 * "Merge" only once the branch is clean and its checks pass. While checks run the slot reports
 * that instead — a merge offered mid-run would race the very runs that gate it. Everything else
 * the host knows (title, state, checks tally, diff size) lives in the row's tooltip, so a hover
 * answers what previously took opening the panel.
 *
 * Until the detail arrives — or where pull requests are not supported at all — the row renders
 * from the linked snapshot or branch summary, or just the link when status is unavailable.
 */
import { selectEnvironmentQueryData } from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, PullRequestRef } from "@supaterm/contracts";
import { sourceControlRepositorySelector } from "@supaterm/shared/sourceControl";
import {
  ArrowUpRightIcon,
  EyeIcon,
  EyeOffIcon,
  FileDiffIcon,
  GitBranchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import type { MouseEvent as ReactMouseEvent } from "react";

import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { usePullRequestChecksRefresh } from "~/hooks/usePullRequestChecksRefresh";
import { cn } from "~/lib/utils";
import { useServerConfigs } from "~/state/entities";
import { pullRequestEnvironment } from "~/state/pullRequests";
import {
  useEnvironmentQueryIsNewer,
  useEnvironmentQueryRefresh,
  useEnvironmentQuerySelector,
} from "~/state/query";

import {
  buildFixFindingsHandoff,
  buildResolveConflictsPrompt,
  classifyPullRequestChecks,
  describePullRequestChecks,
  isPullRequestConflicting,
  resolveSelectedMergeMethod,
  allowedPullRequestMergeMethods,
  resolveThreadPanelPullRequestAction,
} from "../pullRequest/pullRequestDetail.logic";
import { PullRequestChecksPopover } from "../pullRequest/PullRequestChecksPopover";
import {
  pullRequestChecksState,
  PullRequestCheckStatusIcon,
  PullRequestDiffStat,
  resolvePullRequestState,
} from "../pullRequest/pullRequestPresentation";
import {
  usePullRequestActionRunner,
  usePullRequestHandoffs,
} from "../pullRequest/usePullRequestActions";
import {
  ChangeRequestStatusIcon,
  type PrStatusIndicator,
  type ThreadPr,
} from "../ThreadStatusIndicators";
import { InlineConfirmLabel } from "../InlineConfirm";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";

// A server without checks for this pull request answers null; polling it again finds nothing new.
const isSettledWithoutChecks = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  result._tag === "Success" && result.value === null;

export function ThreadDetailsPrRow({
  environmentId,
  pr,
  number,
  reference: linkedReference,
  status,
  project,
  label,
  openAriaLabel,
  onOpen,
  onActed,
  onStopWatching,
}: {
  environmentId: EnvironmentId;
  pr: ThreadPr;
  number: number;
  reference?: Pick<PullRequestRef, "host" | "repository" | "number"> | null;
  status: PrStatusIndicator | null;
  project: EnvironmentProject | null;
  label: string;
  openAriaLabel: string;
  onOpen: (event: ReactMouseEvent<HTMLElement>) => void;
  onActed?: () => void;
  onStopWatching?: (() => void) | undefined;
}) {
  const serverConfigs = useServerConfigs();
  const supportsPullRequests = serverConfigs.has(environmentId);
  const repository = sourceControlRepositorySelector(project?.repositoryIdentity);
  const reference: PullRequestRef | null =
    supportsPullRequests && project !== null
      ? linkedReference
        ? { ...linkedReference, projectId: project.id as ProjectId }
        : repository !== null
          ? { projectId: project.id as ProjectId, repository, number }
          : null
      : null;
  const detailAtom =
    reference === null
      ? null
      : pullRequestEnvironment.detail({
          environmentId,
          input: { ...reference, allowStale: false },
        });
  // Read the queries part by part: every poll publishes a new result (a new
  // timestamp, `waiting` on and off) even when nothing in it changed.
  const detailData = useEnvironmentQuerySelector(detailAtom, selectEnvironmentQueryData);
  const detailQuery = useEnvironmentQueryRefresh(detailAtom);
  const supportsChecks = serverConfigs.has(environmentId);
  const checksAtom =
    supportsChecks && reference !== null && detailData !== null
      ? pullRequestEnvironment.checks({ environmentId, input: reference })
      : null;
  const checksData = useEnvironmentQuerySelector(checksAtom, selectEnvironmentQueryData);
  const checksSettledEmpty = useEnvironmentQuerySelector(checksAtom, isSettledWithoutChecks);
  const checksQuery = useEnvironmentQueryRefresh(checksAtom);
  const checksAreNewer = useEnvironmentQueryIsNewer(checksAtom, detailAtom);
  const detail =
    detailData === null
      ? null
      : checksData !== null && checksAreNewer
        ? { ...detailData, ...checksData }
        : detailData;
  const open = reference !== null && (detail?.state ?? pr?.state) === "open";
  const refreshKey = `${environmentId}:${project?.id}:${reference?.host}:${reference?.repository}:${number}`;
  useLiveRefresh(
    () => {
      if (!detailQuery.isPending()) detailQuery.refresh();
    },
    { enabled: open, key: `workspace-pr:${refreshKey}`, intervalMs: 10 * 60_000 },
  );
  usePullRequestChecksRefresh({
    refresh: () => {
      if (!checksQuery.isPending() && !detailQuery.isPending()) checksQuery.refresh();
    },
    enabled: open && supportsChecks && !checksSettledEmpty,
    key: `workspace-pr-checks:${refreshKey}`,
    checks: detail?.checks ?? [],
  });

  const { actionPending, perform } = usePullRequestActionRunner({
    environmentId,
    reference,
    onSuccess: () => {
      detailQuery.refresh();
      checksQuery.refresh();
      onActed?.();
    },
  });
  const { handoff, startHandoff } = usePullRequestHandoffs({ environmentId, detail });
  const confirm = useInlineConfirm<"merge">();

  const rowAction = resolveThreadPanelPullRequestAction(detail);
  const conflicting = isPullRequestConflicting(detail);
  const checksState = detail === null ? "none" : classifyPullRequestChecks(detail.checks);
  const checksRollup = detail === null ? null : pullRequestChecksState(detail.checks);
  const selectedMergeMethod = resolveSelectedMergeMethod(
    allowedPullRequestMergeMethods(detail),
    "merge",
  );

  const startResolveConflicts = () => {
    if (detail === null) return;
    void startHandoff("conflicts", {
      prompt: buildResolveConflictsPrompt({
        number: detail.number,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
      }),
    });
  };

  const startFixChecks = () => {
    if (detail === null) return;
    void startHandoff(
      "findings",
      buildFixFindingsHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        reviewThreads: [],
        comments: [],
        checks: detail.checks,
        commentsTruncated: false,
      }),
    );
  };

  const statePresentation =
    detail === null
      ? null
      : resolvePullRequestState({
          state: detail.state,
          isDraft: detail.isDraft,
        });
  const icon = statePresentation ? (
    <statePresentation.Icon
      aria-hidden
      className={cn("size-4 shrink-0", statePresentation.toneClassName)}
    />
  ) : pr && status ? (
    <ChangeRequestStatusIcon
      state={pr.state}
      className={cn(THREAD_DETAILS_PANEL_ICON_CLASS, status.colorClass)}
    />
  ) : (
    <PullRequestGlyph.pullRequest className={THREAD_DETAILS_PANEL_ICON_CLASS} />
  );

  // Everything the host reported, at a glance. The row stays one line; the tooltip is where the
  // rest of the answer lives — styled like the sidebar's thread tooltip, title above icon-led
  // detail rows, so the two read as one family.
  const rowTooltip =
    detail === null || statePresentation === null ? (
      <TooltipPopup side="top">{status?.tooltip ?? `Pull request #${number}`}</TooltipPopup>
    ) : (
      <TooltipPopup
        side="top"
        align="start"
        sideOffset={4}
        variant="glass"
        className="max-w-80 text-left whitespace-normal"
      >
        <div className="flex min-w-0 max-w-80 flex-col gap-2 px-1 py-2">
          <div className="flex min-w-0 items-baseline gap-1.5 text-xs leading-none">
            <span className="min-w-0 truncate font-medium text-foreground">{detail.title}</span>
            <span className="shrink-0 text-muted-foreground">#{detail.number}</span>
          </div>
          <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <statePresentation.Icon
                aria-hidden
                className={cn("size-3 shrink-0", statePresentation.toneClassName)}
              />
              <div className="min-w-0 truncate text-foreground/75">{statePresentation.label}</div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 truncate text-foreground/75">
                {detail.baseBranch} ← {detail.headBranch}
              </div>
            </div>
            {detail.state === "open" && checksState !== "none" ? (
              <div className="flex min-w-0 items-center gap-2">
                <PullRequestCheckStatusIcon
                  status={
                    checksState === "failing"
                      ? "failure"
                      : checksState === "pending"
                        ? "pending"
                        : "success"
                  }
                />
                <div className="min-w-0 truncate text-foreground/75">
                  {describePullRequestChecks(detail.checks)}
                </div>
              </div>
            ) : null}
            {detail.isDraft && conflicting ? (
              <div className="flex min-w-0 items-start gap-2 text-destructive">
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
                <div className="min-w-0 flex-1 wrap-break-word leading-5">
                  Merge conflicts with {detail.baseBranch}
                </div>
              </div>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              <FileDiffIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 flex items-baseline gap-1 truncate text-foreground/75">
                {detail.changedFiles.toLocaleString()}{" "}
                {detail.changedFiles === 1 ? "file" : "files"}
                <PullRequestDiffStat additions={detail.additions} deletions={detail.deletions} />
              </div>
            </div>
          </div>
        </div>
      </TooltipPopup>
    );

  const trailingAction =
    rowAction === "resolve"
      ? {
          label: "Resolve",
          pendingLabel: "Preparing...",
          pending: handoff === "conflicts",
          destructive: true,
          suffix: <ArrowUpRightIcon aria-hidden className="size-3 shrink-0" />,
          tooltip: "Check the branch out and resolve the conflicts in a new thread",
          controlProps: { onClick: startResolveConflicts },
        }
      : rowAction === "ready"
        ? {
            label: "Ready",
            pendingLabel: "Marking...",
            pending: actionPending,
            destructive: false,
            suffix: null,
            tooltip: "Mark this pull request as ready for review",
            controlProps: { onClick: () => void perform("ready") },
          }
        : rowAction === "fix"
          ? {
              label: "Fix",
              pendingLabel: "Preparing...",
              pending: handoff === "findings",
              destructive: true,
              suffix: <ArrowUpRightIcon aria-hidden className="size-3 shrink-0" />,
              tooltip: "Fix the failing checks in a new thread",
              controlProps: { onClick: startFixChecks },
            }
          : rowAction === "merge"
            ? {
                label: (
                  <InlineConfirmLabel
                    armed={confirm.armed === "merge"}
                    idle="Merge"
                    confirm="Confirm"
                  />
                ),
                pendingLabel: "Merging...",
                pending: actionPending,
                destructive: false,
                suffix: null,
                tooltip:
                  confirm.armed === "merge"
                    ? `Click again to merge #${number} into ${detail?.baseBranch} (${selectedMergeMethod})`
                    : `Merge this pull request (${selectedMergeMethod})`,
                controlProps: confirm.bind(
                  "merge",
                  () => void perform("merge", selectedMergeMethod),
                ),
              }
            : null;

  const rowContent = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </>
  );

  // The server ends a watch when the pull request closes, so only an open one shows the eye.
  // It takes the row's rounded end when nothing follows it.
  const watchIsLast =
    detail === null ||
    ((checksRollup === null || conflicting || detail.isDraft) && trailingAction === null);
  const watchSegment =
    onStopWatching && (detail?.state ?? pr?.state ?? "open") === "open" ? (
      <>
        <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                type="button"
                variant="ghost"
                size="sm"
                part={watchIsLast ? "secondary" : "checks"}
                className="group/watch"
                aria-label={`Stop watching #${number}`}
                onClick={onStopWatching}
              />
            }
          >
            <EyeIcon aria-hidden className="size-4 group-hover/watch:hidden" />
            <EyeOffIcon aria-hidden className="hidden size-4 group-hover/watch:block" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            Watching: the agent wakes when checks finish, someone comments, or the branch conflicts.
            Click to stop.
          </TooltipPopup>
        </Tooltip>
      </>
    ) : null;

  return (
    <>
      {detail ? (
        <div className={THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS}>
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  type="button"
                  variant="ghost"
                  size="sm"
                  part="link-primary"
                  aria-label={openAriaLabel}
                  onClick={onOpen}
                  onAuxClick={onOpen}
                />
              }
            >
              {rowContent}
            </TooltipTrigger>
            {rowTooltip}
          </Tooltip>
          {watchSegment}
          {checksRollup !== null && !conflicting && !detail.isDraft ? (
            <>
              <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
              <PullRequestChecksPopover
                checksState={checksRollup}
                checks={detail.checks}
                variant="button"
                render={<ThreadDetailsControl part="checks" />}
              />
            </>
          ) : null}
          {trailingAction ? (
            <>
              <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ThreadDetailsControl
                      type="button"
                      variant="ghost"
                      size="sm"
                      part="action"
                      tone={trailingAction.destructive ? "destructive" : "default"}
                      disabled={actionPending || handoff !== null}
                      {...trailingAction.controlProps}
                    />
                  }
                >
                  {trailingAction.pending ? trailingAction.pendingLabel : trailingAction.label}
                  {trailingAction.suffix}
                </TooltipTrigger>
                <TooltipPopup side="top">{trailingAction.tooltip}</TooltipPopup>
              </Tooltip>
            </>
          ) : null}
        </div>
      ) : watchSegment ? (
        <div className={THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS}>
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  type="button"
                  variant="ghost"
                  size="sm"
                  part="link-primary"
                  aria-label={openAriaLabel}
                  onClick={onOpen}
                  onAuxClick={onOpen}
                />
              }
            >
              {rowContent}
            </TooltipTrigger>
            {rowTooltip}
          </Tooltip>
          {watchSegment}
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                type="button"
                variant="ghost"
                size="sm"
                part="row"
                aria-label={openAriaLabel}
                onClick={onOpen}
                onAuxClick={onOpen}
              />
            }
          >
            {rowContent}
          </TooltipTrigger>
          {rowTooltip}
        </Tooltip>
      )}
    </>
  );
}
