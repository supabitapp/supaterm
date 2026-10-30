import { resolvePullRequestDetailChecks } from "@supaterm/client-runtime/pull-request-checks";
import {
  capitalizeTerm,
  sourceControlClients,
} from "@supaterm/client-runtime/source-control-clients";
import { PullRequestChangeBreakdownRows } from "../pullRequest/PullRequestChangeBreakdownStat";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
/**
 * The trailing slot shows the one action that unblocks the merge next. While checks run it offers
 * "Auto-merge", since a merge offered mid-run would race the runs that gate it. "Fix" and "Resolve"
 * fill this thread's composer because this thread already holds the pull request's context. Until
 * the detail arrives, or without pull request support, the row renders from the linked snapshot.
 */
import { selectEnvironmentQueryData } from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestMergeMethod,
  PullRequestRef,
  ScopedThreadRef,
} from "@supaterm/contracts";
import {
  ArrowUpRightIcon,
  DiffIcon,
  EyeIcon,
  EyeOffIcon,
  GitBranchIcon,
  EllipsisIcon,
  SquarePenIcon,
  TriangleAlertIcon,
} from "@supaterm/icons";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { DraftId } from "~/composerDraftStore";
import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { readLocalApi } from "~/localApi";
import { usePullRequestChecksRefresh } from "~/hooks/usePullRequestChecksRefresh";
import { cn } from "~/lib/utils";
import { useServerConfigs } from "~/state/entities";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { usePullRequestStackGate } from "~/state/usePullRequestStack";
import { useUiStateStore } from "~/uiStateStore";
import {
  useEnvironmentQueryIsNewer,
  useEnvironmentQueryRefresh,
  useEnvironmentQuerySelector,
} from "~/state/query";

import {
  buildFixFindingsHandoff,
  buildResolveConflictsPrompt,
  buildSubagentFixChecksPrompt,
  buildSubagentResolveConflictsPrompt,
  classifyPullRequestChecks,
  describePullRequestChecks,
  isPullRequestConflicting,
  resolvePullRequestMergeMethod,
  allowedPullRequestMergeMethods,
  canPerformPullRequestAction,
  PULL_REQUEST_MERGE_METHOD_LABELS,
  resolvePullRequestMenuActions,
  resolveThreadPanelPullRequestAction,
} from "../pullRequest/pullRequestDetail.logic";
import { PullRequestMergeMenuItems } from "../pullRequest/PullRequestActionsMenu";
import { openOnHostLabel } from "../pullRequest/pullRequestLinkContextMenu";
import { PullRequestChecksPopover } from "../pullRequest/PullRequestChecksPopover";
import {
  pullRequestChecksState,
  PullRequestCheckStatusIcon,
  PullRequestDiffStat,
  resolvePullRequestState,
} from "../pullRequest/pullRequestPresentation";
import {
  usePullRequestActionRunner,
  usePullRequestDefaultMergeMethod,
  usePullRequestHandoffs,
  writePullRequestTaskToComposer,
} from "../pullRequest/usePullRequestActions";
import {
  ChangeRequestStatusIcon,
  type PrStatusIndicator,
  type ThreadPr,
} from "../ThreadStatusIndicators";
import { InlineConfirmLabel, InlineConfirmTooltip } from "../InlineConfirm";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";

// A null checks response is settled; polling cannot find checks.
const isSettledWithoutChecks = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  result._tag === "Success" && result.value === null;

type HandoffKind = "conflicts" | "findings";

export function ThreadDetailsPrRow({
  environmentId,
  pr,
  number,
  reference: linkedReference,
  status,
  project,
  label,
  openAriaLabel,
  composerTarget,
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
  composerTarget: ScopedThreadRef | DraftId;
  onOpen: (event: ReactMouseEvent<HTMLElement>) => void;
  onActed?: () => void;
  onStopWatching?: (() => void) | undefined;
}) {
  const serverConfigs = useServerConfigs();
  const supportsPullRequests = serverConfigs.has(environmentId);
  const repository = sourceControlClients.repositorySelector(project?.repositoryIdentity);
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
  // Select query parts because polling rebuilds unchanged results.
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
  const detail = resolvePullRequestDetailChecks(detailData, checksData, checksAreNewer);
  const terminology = sourceControlClients.get(
    detail?.provider ?? project?.repositoryIdentity?.provider,
  ).changeRequest;
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

  const { actionPending, pendingAction, perform } = usePullRequestActionRunner({
    environmentId,
    reference,
    terminology,
    onSuccess: () => {
      detailQuery.refresh();
      checksQuery.refresh();
      onActed?.();
    },
  });
  const { handoff, startHandoff } = usePullRequestHandoffs({ environmentId, detail });
  const lastSelectedMergeMethod = useUiStateStore((state) => state.pullRequestMergeMethod);
  const setLastSelectedMergeMethod = useUiStateStore((state) => state.setPullRequestMergeMethod);
  const [mergeMethodSelection, setMergeMethodSelection] = useState<{
    key: string;
    method: PullRequestMergeMethod;
  } | null>(null);
  const projectDefaultMergeMethod = usePullRequestDefaultMergeMethod(
    environmentId,
    (project?.id as ProjectId | undefined) ?? null,
  );
  const confirm = useInlineConfirm<"merge" | "enable-auto-merge" | "close">();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const { canMergeSinglePullRequest } = usePullRequestStackGate({
    environmentId,
    reference,
    detail,
    environmentSupported: supportsPullRequests,
  });

  const rowAction = resolveThreadPanelPullRequestAction(detail, canMergeSinglePullRequest);
  const menuActions = resolvePullRequestMenuActions({
    detail,
    primaryAction: rowAction,
    canMergeSinglePullRequest,
  });
  const conflicting = isPullRequestConflicting(detail);
  const checksState = detail === null ? "none" : classifyPullRequestChecks(detail.checks);
  // Checks stop refreshing once the pull request is no longer open, so jobs that start on merge or
  // close would otherwise show as pending forever.
  const checksRollup = detail?.state === "open" ? pullRequestChecksState(detail.checks) : null;
  const allowedMergeMethods = allowedPullRequestMergeMethods(detail);
  const selectedMergeMethod = resolvePullRequestMergeMethod(
    allowedMergeMethods,
    mergeMethodSelection?.key === refreshKey
      ? mergeMethodSelection.method
      : (detail?.autoMergeMethod ?? null),
    projectDefaultMergeMethod,
    lastSelectedMergeMethod,
  );
  const selectMergeMethod = (method: PullRequestMergeMethod) => {
    setMergeMethodSelection({ key: refreshKey, method });
    setLastSelectedMergeMethod(method);
  };
  const autoMergeArmed = detail?.state === "open" && detail.autoMergeEnabled === true;
  const armedAutoMergeLabel = detail?.autoMergeMethod
    ? `Auto-merge (${PULL_REQUEST_MERGE_METHOD_LABELS[detail.autoMergeMethod].toLowerCase()})`
    : "Auto-merge";

  const startInNewThread = (kind: HandoffKind) => {
    if (detail === null) return;
    void startHandoff(
      kind,
      kind === "conflicts"
        ? {
            prompt: buildResolveConflictsPrompt({
              number: detail.number,
              url: detail.url,
              headBranch: detail.headBranch,
              baseBranch: detail.baseBranch,
            }),
          }
        : buildFixFindingsHandoff({
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

  const draftSubagentHandoff = (kind: HandoffKind) => {
    if (detail === null) return;
    writePullRequestTaskToComposer(composerTarget, {
      prompt:
        kind === "conflicts"
          ? buildSubagentResolveConflictsPrompt(detail)
          : buildSubagentFixChecksPrompt(detail),
    });
    toastManager.add({
      type: "success",
      title: "Added to the composer",
      description: "The task is in the composer. Read it over, then send.",
    });
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
      <TooltipPopup side="top">
        {status?.tooltip ?? `${capitalizeTerm(terminology.singular)} #${number}`}
      </TooltipPopup>
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
            {autoMergeArmed ? (
              <div className="flex min-w-0 items-center gap-2">
                <PullRequestGlyph.merged aria-hidden className="size-3 shrink-0 text-info" />
                <div className="min-w-0 truncate text-foreground/75">
                  {armedAutoMergeLabel} enabled
                </div>
              </div>
            ) : null}
            {detail.isDraft && conflicting ? (
              <div className="flex min-w-0 items-start gap-2 text-destructive">
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
                <div className="min-w-0 flex-1 wrap-break-word">
                  Merge conflicts with {detail.baseBranch}
                </div>
              </div>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              <DiffIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 flex items-baseline gap-1 truncate text-foreground/75">
                {detail.changedFiles.toLocaleString()}{" "}
                {detail.changedFiles === 1 ? "file" : "files"}
                <PullRequestDiffStat additions={detail.additions} deletions={detail.deletions} />
              </div>
            </div>
            {reference !== null && (detail.additions > 0 || detail.deletions > 0) ? (
              <PullRequestChangeBreakdownRows
                environmentId={environmentId}
                reference={reference}
                className="pl-5 text-foreground/75"
              />
            ) : null}
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
          suffix: null,
          tooltip: "Draft a prompt in this thread for a subagent to resolve the conflicts",
          controlProps: { onClick: () => draftSubagentHandoff("conflicts") },
        }
      : rowAction === "ready"
        ? {
            label: "Ready",
            pendingLabel: "Marking...",
            pending: pendingAction === "ready",
            destructive: false,
            suffix: null,
            tooltip: `Mark this ${terminology.singular} as ready for review`,
            controlProps: { onClick: () => void perform("ready") },
          }
        : rowAction === "fix"
          ? {
              label: "Fix",
              pendingLabel: "Preparing...",
              pending: handoff === "findings",
              destructive: true,
              suffix: null,
              tooltip: "Draft a prompt in this thread for a subagent to fix the failing checks",
              controlProps: { onClick: () => draftSubagentHandoff("findings") },
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
                pending: pendingAction === "merge",
                destructive: false,
                suffix: null,
                tooltip: `Merge this ${terminology.singular} (${selectedMergeMethod})`,
                armedTooltip: `Click again to merge #${number} into ${detail?.baseBranch} (${selectedMergeMethod})`,
                controlProps: confirm.bind(
                  "merge",
                  () => void perform("merge", selectedMergeMethod),
                ),
              }
            : rowAction === "enable-auto-merge"
              ? {
                  label: (
                    <InlineConfirmLabel
                      armed={confirm.armed === "enable-auto-merge"}
                      idle="Auto-merge"
                      confirm="Confirm"
                    />
                  ),
                  pendingLabel: "Enabling...",
                  pending: pendingAction === "enable-auto-merge",
                  destructive: false,
                  suffix: null,
                  tooltip: `Merge into ${detail?.baseBranch} (${selectedMergeMethod}) once its checks pass`,
                  armedTooltip: `Click again to enable auto-merge. The host may merge #${number} right away.`,
                  controlProps: confirm.bind(
                    "enable-auto-merge",
                    () => void perform("enable-auto-merge", selectedMergeMethod),
                  ),
                }
              : null;

  const rowContent = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {autoMergeArmed ? (
        <PullRequestGlyph.merged
          role="img"
          aria-label={`${armedAutoMergeLabel} enabled`}
          className="size-3.5 shrink-0 text-info"
        />
      ) : null}
    </>
  );

  // The server ends a watch when the pull request closes, so only an open one shows the eye.
  // It takes the row's rounded end unless the detail's actions menu follows it.
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
                part={detail === null ? "secondary" : "checks"}
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

  const canClose = detail?.state === "open" && canPerformPullRequestAction(detail, "close");
  const canReopen = detail?.state === "closed" && canPerformPullRequestAction(detail, "reopen");
  const actionsMenu =
    detail === null ? null : (
      <>
        <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <ThreadDetailsControl
                      type="button"
                      variant="ghost"
                      size="sm"
                      part="secondary"
                      aria-label={`More ${terminology.singular} actions`}
                    />
                  }
                >
                  <EllipsisIcon aria-hidden className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
                </MenuTrigger>
              }
            />
            <TooltipPopup side="top">More {terminology.singular} actions</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end" anchor={rowRef} className="w-(--anchor-width)">
            {rowAction === "fix" || rowAction === "resolve" ? (
              <>
                <MenuItem
                  disabled={actionPending || handoff !== null}
                  onClick={() => startInNewThread(rowAction === "fix" ? "findings" : "conflicts")}
                >
                  <SquarePenIcon className="size-3.5" />
                  {rowAction === "fix" ? "Fix in a new thread" : "Resolve in a new thread"}
                </MenuItem>
                <MenuSeparator />
              </>
            ) : null}
            <PullRequestMergeMenuItems
              isDraft={detail.isDraft}
              actions={menuActions}
              allowedMergeMethods={allowedMergeMethods}
              selectedMergeMethod={selectedMergeMethod}
              onSelectMergeMethod={selectMergeMethod}
              actionPending={actionPending}
              perform={perform}
            />
            <MenuItem onClick={() => void readLocalApi()?.shell.openExternal(detail.url)}>
              <ArrowUpRightIcon className="size-3.5" />
              {openOnHostLabel(sourceControlClients.get(detail.provider))}
            </MenuItem>
            {canClose ? (
              <>
                <MenuSeparator />
                <MenuItem
                  {...confirm.bind("close", () => void perform("close"))}
                  variant="destructive"
                  disabled={actionPending}
                >
                  <PullRequestGlyph.closed className="size-3.5" />
                  {confirm.armed === "close" ? "Confirm close" : `Close ${terminology.singular}`}
                </MenuItem>
              </>
            ) : canReopen ? (
              <>
                <MenuSeparator />
                <MenuItem disabled={actionPending} onClick={() => void perform("reopen")}>
                  <PullRequestGlyph.reopen className="size-3.5" />
                  Reopen {terminology.singular}
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      </>
    );

  return (
    <>
      {detail ? (
        <div ref={rowRef} className={THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS}>
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
              <InlineConfirmTooltip
                armed={confirm.armed === rowAction}
                required={rowAction === "merge" || rowAction === "enable-auto-merge"}
                tip={trailingAction.tooltip}
                armedTip={trailingAction.armedTooltip}
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
              </InlineConfirmTooltip>
            </>
          ) : null}
          {actionsMenu}
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
