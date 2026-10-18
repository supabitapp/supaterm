import { useAtomValue } from "@effect/atom-react";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadHoverCardPopup } from "../ThreadHoverCard";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Collapsible, CollapsiblePanel } from "../ui/collapsible";
import { SubagentTooltipContent } from "./SubagentTooltipContent";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  deriveWorkflowGroups,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
} from "@supaterm/client-runtime/state/subagentRuntime";
import { formatSubagentDisplayTitle } from "@supaterm/client-runtime/state/subagent-display";
import {
  deriveThreadRelationshipGraph,
  immediateThreadRelationships,
  isParentThreadRelationship,
  threadRelationshipRowStatus,
  orderWebThreadLineageRows,
  resolveMergeBackTargetThreadId,
  type ThreadRelationshipEdge,
  type ThreadRelationshipWalkRow,
} from "@supaterm/client-runtime/state/thread-relationships";
import { resolveLatestMergeBackRun } from "@supaterm/client-runtime/state/thread-workflows";
import {
  AuthOrchestrationOperateScope,
  NodeId,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@supaterm/contracts";
import { groupBy } from "effect/Array";
import * as DateTime from "effect/DateTime";
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  CornerLeftUpIcon,
  GitForkIcon,
  LoaderCircleIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  useProjects,
  useServerConfigs,
  useThreadProjection,
  useThreadRelationshipShells,
} from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useEnvironmentScope } from "../../state/session";
import { AgentElapsed } from "./AgentElapsed";
import { ThreadRelationshipIcon, threadRelationshipStatusLabel } from "./ThreadRelationshipIcon";
import { ThreadLineageWorkflowRow } from "./ThreadLineageWorkflowRow";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
  THREAD_DETAILS_PANEL_ROW_HEIGHT_CLASS,
} from "./threadDetailsPanelStyles";

const THREAD_LINEAGE_INITIAL_COUNT = 6;
const THREAD_LINEAGE_PAGE_COUNT = 12;

export function resolveThreadLineageWindow<Row>(
  rows: ReadonlyArray<Row>,
  visibleCount: number,
): { readonly visibleRows: ReadonlyArray<Row>; readonly hiddenCount: number } {
  const visibleRows = rows.slice(0, visibleCount);
  return { visibleRows, hiddenCount: rows.length - visibleRows.length };
}

export function ThreadLineageRowList(props: {
  readonly label?: string;
  readonly hiddenCount: number;
  readonly onShowMore: () => void;
  readonly children: ReactNode;
}) {
  return (
    <>
      {/*
        Plain overflow, not a ScrollArea
        component: this sits inside an already scrolling panel, where a
        max-height-only virtual viewport measures badly.
      */}
      <ul
        aria-label={props.label ?? "Related threads"}
        className="m-0 max-h-[13.5rem] list-none overflow-y-auto overscroll-contain p-0 has-data-workflow-expanded:max-h-[min(28rem,55dvh)]"
      >
        {props.children}
      </ul>
      {props.hiddenCount > 0 ? (
        <ThreadDetailsControl onClick={props.onShowMore} tone="muted">
          <PlusIcon aria-hidden className="size-4 shrink-0" />
          Show {Math.min(props.hiddenCount, THREAD_LINEAGE_PAGE_COUNT)} more
        </ThreadDetailsControl>
      ) : null}
    </>
  );
}

function ThreadLineageGroup(props: {
  readonly label: string;
  readonly rows: ReadonlyArray<ThreadRelationshipWalkRow>;
  readonly expanded: boolean;
  readonly runningCount?: number;
  readonly pendingCount?: number;
  readonly children: (rows: ReadonlyArray<ThreadRelationshipWalkRow>) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(props.expanded);
  const [visibleCount, setVisibleCount] = useState(THREAD_LINEAGE_INITIAL_COUNT);
  const panelId = useId();
  const { visibleRows, hiddenCount } = resolveThreadLineageWindow(props.rows, visibleCount);
  const count = props.rows.length + (props.pendingCount ?? 0);
  const label = props.runningCount ? `${props.label} · ${props.runningCount} running` : props.label;
  const failedCount = props.rows.filter(
    ({ edge }) => edge.status === "failed" || edge.status === "error",
  ).length;
  if (count === 0) return null;
  return (
    <Collapsible open={expanded}>
      <CollapsibleSectionHeader
        size="sm"
        variant="panel"
        expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(!expanded)}
        accessory={
          failedCount > 0 ? <SectionHeaderStatus>{failedCount} failed</SectionHeaderStatus> : null
        }
      >
        {label}
        {!expanded && ` (${count})`}
      </CollapsibleSectionHeader>
      <CollapsiblePanel id={panelId}>
        <ThreadLineageRowList
          label={props.label}
          hiddenCount={hiddenCount}
          onShowMore={() => setVisibleCount((count) => count + THREAD_LINEAGE_PAGE_COUNT)}
        >
          {props.children(visibleRows)}
        </ThreadLineageRowList>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function relationshipLabel(edge: ThreadRelationshipEdge, currentThreadId: ThreadId) {
  if (edge.kind === "transfer") return "Context transfer";
  if (edge.kind === "subagent") {
    return edge.sourceThreadId === currentThreadId ? "Subagent" : "Parent agent";
  }
  return edge.sourceThreadId === currentThreadId ? "Fork" : "Parent thread";
}

function relationshipThreadTitle(input: {
  readonly title: string;
  readonly isSubagent: boolean;
}): string {
  if (!input.isSubagent) return input.title;
  return formatSubagentDisplayTitle(input.title);
}

function currentSubagent<Agent extends RuntimeSubagent>(
  agent: Agent | undefined,
  childThread: OrchestrationV2ThreadShell | null | undefined,
): Agent | undefined {
  const liveStatus =
    childThread?.activityRunStatus ?? (childThread?.status === "queued" ? "queued" : null);
  if (!agent || !childThread) return agent;
  const newerRun =
    childThread.latestRunRequestedAt &&
    DateTime.toEpochMillis(childThread.latestRunRequestedAt) >
      Date.parse(agent.completedAt ?? agent.startedAt ?? agent.updatedAt);
  if (!liveStatus && !newerRun) return agent;
  const status = liveStatus ?? childThread.status;
  const startedAt = liveStatus ? childThread.activityRunStartedAt : childThread.latestRunStartedAt;
  const completedAt = liveStatus ? null : childThread.latestRunCompletedAt;
  return {
    ...agent,
    status:
      status === "preparing" || status === "starting" || status === "queued"
        ? "pending"
        : status === "rolled_back"
          ? "interrupted"
          : status,
    startedAt: startedAt ? DateTime.formatIso(startedAt) : null,
    completedAt: completedAt ? DateTime.formatIso(completedAt) : null,
    progress: null,
    result: null,
    error: null,
  };
}

export function ThreadRelationshipsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const projection = useThreadProjection(ref)?.projection ?? null;
  const serverConfigs = useServerConfigs();
  const relationshipShells = useThreadRelationshipShells(ref);
  const allProjects = useProjects();
  const archived = useArchivedThreadSnapshots([props.environmentId]);
  const canOperateThread = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const navigate = useNavigate();
  const mergeBack = useAtomCommand(threadEnvironment.mergeBack);
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn);
  const stopWorkflowCommand = useAtomCommand(orchestrationEnvironment.stopWorkflow);
  const canOperateWorkflow = useAtomValue(
    orchestrationEnvironment.stopWorkflow.permissionAtom(props.environmentId),
  );
  const [isMerging, setIsMerging] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  // These lookups and the graph walk every subagent and thread, so they sit below
  // the panel's hooks where the compiler can cache them.
  const providers = serverConfigs.get(props.environmentId)?.providers;
  const projects = allProjects.filter((project) => project.environmentId === props.environmentId);
  const archivedShells = archived.snapshots.find(
    (entry) => entry.environmentId === props.environmentId,
  )?.snapshot.threads;
  const projected = projection?.subagents ?? [];
  const runtimeSubagents = projectedSubagentsToRuntime(projected);
  const byId = new Map(runtimeSubagents.map((agent) => [agent.id, agent]));
  const subagentsByThreadId = new Map(
    projected
      .filter((subagent) => subagent.childThreadId !== null)
      .map((subagent) => [
        subagent.childThreadId,
        {
          ...byId.get(subagent.id)!,
          id: subagent.id,
          threadId: subagent.threadId,
          runId: subagent.runId,
          nativeTaskRef: subagent.nativeTaskRef,
          nativeStatus: subagent.status,
          driver: subagent.driver,
          providerInstanceId: subagent.providerInstanceId,
          origin: subagent.origin,
          modelSelection: subagent.modelSelection,
        },
      ]),
  );
  const workflowGroupsById = new Map(
    deriveWorkflowGroups(runtimeSubagents).map((group) => [group.workflow.id, group]),
  );
  const shells: ReadonlyArray<OrchestrationV2ThreadShell> = [
    ...relationshipShells,
    ...(archivedShells ?? []),
  ];
  const graph = deriveThreadRelationshipGraph({ threads: shells, projection });
  const currentThread = projection?.thread ?? graph.nodes.get(props.threadId)?.thread;
  const currentProject = projects.find((project) => project.id === currentThread?.projectId);
  const latestMergeBackRun = projection === null ? null : resolveLatestMergeBackRun(projection);
  const mergeTargetThreadId = resolveMergeBackTargetThreadId(projection);
  const relationshipRows = orderWebThreadLineageRows({
    graph,
    rows: immediateThreadRelationships(graph, props.threadId),
    currentThreadId: props.threadId,
    mergeTargetThreadId,
  }).map((row) => {
    const agent =
      row.edge.kind === "subagent" && !isParentThreadRelationship(row.edge, props.threadId)
        ? subagentsByThreadId.get(row.threadId)
        : undefined;
    const workflowGroup = agent === undefined ? undefined : workflowGroupsById.get(agent.id);
    const status = workflowGroup?.workflow.status ?? threadRelationshipRowStatus(graph, row);
    return status === row.edge.status ? row : { ...row, edge: { ...row.edge, status } };
  });
  const canMerge = mergeTargetThreadId !== null && latestMergeBackRun !== null;

  const {
    parent = [],
    forks = [],
    transfers = [],
    active = [],
    previous = [],
  } = groupBy(relationshipRows, ({ edge }) => {
    if (isParentThreadRelationship(edge, props.threadId)) return "parent";
    if (edge.kind === "fork") return "forks";
    if (edge.kind === "transfer") return "transfers";
    return ["completed", "failed", "error", "cancelled", "interrupted", "idle"].includes(
      edge.status ?? "",
    )
      ? "previous"
      : "active";
  });
  const pendingRunningCount =
    projection?.subagents.filter(
      (agent) => agent.childThreadId === null && agent.status === "running",
    ).length ?? 0;
  const runningCount =
    pendingRunningCount + active.filter(({ edge }) => edge.status === "running").length;
  const groups = [
    { id: "parent", label: "Parent", rows: parent, expanded: true },
    { id: "forks", label: "Forks", rows: forks, expanded: true },
    { id: "transfers", label: "Context transfers", rows: transfers, expanded: true },
    {
      id: "active",
      label: "Subagents",
      rows: active,
      expanded: true,
      runningCount,
      pendingCount: pendingRunningCount,
    },
    { id: "previous", label: "Previous agents", rows: previous, expanded: false },
  ];

  if (relationshipRows.length === 0 && runningCount === 0) {
    return null;
  }

  const openThread = (threadId: ThreadId) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
    });
  };

  const merge = async () => {
    if (!latestMergeBackRun || mergeTargetThreadId === null || isMerging) return;
    setIsMerging(true);
    const result = await mergeBack({
      environmentId: props.environmentId,
      input: {
        sourceThreadId: props.threadId,
        targetThreadId: mergeTargetThreadId,
        runId: latestMergeBackRun.id,
      },
    });
    setIsMerging(false);
    if (result._tag === "Success") openThread(mergeTargetThreadId);
  };

  const stopSubagent = async (
    childThreadId: ThreadId,
    agent: Pick<OrchestrationV2Subagent, "id" | "origin" | "threadId">,
  ) => {
    if (stoppingId !== null) return;
    setStoppingId(childThreadId);
    const result = await interruptTurn({
      environmentId: props.environmentId,
      input:
        agent.origin === "provider_native"
          ? { threadId: agent.threadId, subagentId: agent.id }
          : { threadId: childThreadId },
    });
    setStoppingId(null);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not stop subagent" });
    }
  };

  const stopWorkflow = async (subagentId: string) => {
    if (stoppingId !== null) return;
    setStoppingId(subagentId);
    const result = await stopWorkflowCommand({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, subagentId: NodeId.make(subagentId) },
    });
    setStoppingId(null);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not stop workflow" });
    }
  };

  const parentTitle =
    mergeTargetThreadId === null
      ? null
      : (graph.nodes.get(mergeTargetThreadId)?.thread?.title ?? null);

  return (
    <ThreadDetailsSection
      headingId="thread-details-lineage-heading"
      title="Related threads"
      data-thread-relationships-panel
      showHeading={false}
    >
      {groups.map((group) => (
        <ThreadLineageGroup key={`${scopedThreadKey(ref)}:${group.id}`} {...group}>
          {(visibleRows) =>
            visibleRows.map(({ threadId, edge }) => {
              const node = graph.nodes.get(threadId);
              const isSubagent = edge.kind === "subagent";
              const isMergeTarget = threadId === mergeTargetThreadId;
              const isParent = isParentThreadRelationship(edge, props.threadId);
              const rowStatus = threadRelationshipRowStatus(graph, { threadId, edge });
              const RelationshipIcon = isParent
                ? CornerLeftUpIcon
                : isSubagent
                  ? BotIcon
                  : GitForkIcon;
              const relationship = relationshipLabel(edge, props.threadId);
              const projectedAgent =
                isSubagent && !isParent ? subagentsByThreadId.get(threadId) : undefined;
              const workflowGroup =
                projectedAgent === undefined
                  ? undefined
                  : workflowGroupsById.get(projectedAgent.id);
              const agent = workflowGroup
                ? projectedAgent
                : currentSubagent(projectedAgent, node?.thread);
              const canStop =
                canOperateThread &&
                agent &&
                (agent.origin === "app_owned" ||
                  (agent.origin === "provider_native" &&
                    agent.driver === "claudeAgent" &&
                    agent.runId != null &&
                    agent.nativeTaskRef?.strength === "strong" &&
                    agent.nativeTaskRef.nativeId !== null &&
                    ["pending", "running", "waiting"].includes(agent.nativeStatus))) &&
                agent.startedAt &&
                ["pending", "running", "waiting"].includes(agent.status);
              const threadTitle = relationshipThreadTitle({
                title:
                  workflowGroup?.workflow.workflowName ??
                  node?.thread?.title ??
                  agent?.title ??
                  threadId,
                isSubagent,
              });
              const provider = providers?.find(
                (entry) =>
                  entry.instanceId ===
                  (agent?.providerInstanceId ?? node?.thread?.providerInstanceId),
              );
              const providerDriver = agent?.driver ?? provider?.driver;
              const canStopWorkflow =
                canOperateWorkflow &&
                workflowGroup?.workflow.status === "running" &&
                agent?.origin === "provider_native" &&
                providerDriver === "claudeAgent";
              const trailingVisibilityClass = (workflowGroup ? canStopWorkflow : canStop)
                ? "group-hover:opacity-0 group-focus-within:opacity-0 pointer-coarse:opacity-0 [@media(hover:none)]:opacity-0"
                : "";
              const project = projects.find((project) => project.id === node?.thread?.projectId);
              const relationshipHint = node?.missing
                ? "This related thread is unavailable"
                : `Open ${relationship.toLowerCase()} in this chat`;
              const RelationshipPopup = agent ? ThreadHoverCardPopup : TooltipPopup;
              const relationshipTooltip = agent ? (
                <SubagentTooltipContent
                  title={threadTitle}
                  model={agent.model}
                  providerInstanceId={agent.providerInstanceId}
                  origin={agent.origin}
                  modelSelection={agent.modelSelection}
                  provider={provider}
                  providers={providers}
                  driver={providerDriver}
                  elapsed={<AgentElapsed agent={agent} />}
                  status={agent.status}
                  result={agent.result}
                  progress={agent.progress}
                  parentThread={currentThread ?? undefined}
                  childThread={node?.thread ?? undefined}
                  parentProject={currentProject}
                  childProject={project}
                />
              ) : (
                relationshipHint
              );
              const relationshipContent = (
                <>
                  <ThreadRelationshipIcon
                    driver={isSubagent && !isParent ? providerDriver : undefined}
                    provider={provider}
                    fallbackIcon={RelationshipIcon}
                    status={rowStatus}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-left">{threadTitle}</span>
                  </span>
                  {agent &&
                  agent.status !== "failed" &&
                  (agent.startedAt !== null || canStopWorkflow) ? (
                    <span
                      className={`shrink-0 text-2xs font-normal tabular-nums text-muted-foreground ${canStopWorkflow ? "min-w-6 text-end" : ""} ${trailingVisibilityClass}`}
                    >
                      <AgentElapsed agent={agent} />
                    </span>
                  ) : !isMergeTarget ? (
                    <span
                      className={
                        workflowGroup
                          ? "sr-only"
                          : `shrink-0 text-2xs ${agent?.status === "failed" ? "text-destructive" : "text-muted-foreground"} ${trailingVisibilityClass}`
                      }
                    >
                      {threadRelationshipStatusLabel(rowStatus)}
                    </span>
                  ) : null}
                </>
              );
              const relationshipLink = (
                <Tooltip>
                  <TooltipTrigger
                    delay={200}
                    render={
                      <ThreadDetailsControl
                        size="sm"
                        variant="ghost"
                        part={workflowGroup ? "primary" : "row"}
                        disabled={node?.missing === true}
                        onClick={() => openThread(threadId)}
                      />
                    }
                  >
                    {relationshipContent}
                  </TooltipTrigger>
                  <RelationshipPopup side="left">{relationshipTooltip}</RelationshipPopup>
                </Tooltip>
              );
              if (workflowGroup && agent) {
                return (
                  <ThreadLineageWorkflowRow
                    key={threadId}
                    group={workflowGroup}
                    providerInstanceId={agent.providerInstanceId}
                    provider={provider}
                    providers={providers}
                    driver={providerDriver}
                    onOpenThread={(memberThreadId) => openThread(memberThreadId as ThreadId)}
                    isThreadAvailable={(memberThreadId) =>
                      graph.nodes.get(memberThreadId as ThreadId)?.missing === false
                    }
                    onStop={canStopWorkflow ? () => void stopWorkflow(agent.id) : undefined}
                    stopping={stoppingId === agent.id}
                    stopDisabled={stoppingId !== null}
                    header={relationshipLink}
                  />
                );
              }
              return (
                <li
                  key={threadId}
                  className={`group relative flex items-center rounded-lg ${THREAD_DETAILS_PANEL_ROW_HEIGHT_CLASS}`}
                >
                  {isMergeTarget ? (
                    <div className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}>
                      <Tooltip>
                        <TooltipTrigger
                          delay={200}
                          render={
                            <ThreadDetailsControl
                              size="sm"
                              variant="ghost"
                              part="primary"
                              aria-label={`${threadTitle} ${threadRelationshipStatusLabel(rowStatus)}`}
                              disabled={node?.missing === true}
                              onClick={() => openThread(threadId)}
                            />
                          }
                        >
                          {relationshipContent}
                        </TooltipTrigger>
                        <RelationshipPopup side="left">{relationshipTooltip}</RelationshipPopup>
                      </Tooltip>
                      <span
                        aria-hidden="true"
                        className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS}
                      />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <ThreadDetailsControl
                              size="sm"
                              variant="ghost"
                              part="secondary"
                              aria-label={
                                parentTitle
                                  ? `Merge back to ${parentTitle}`
                                  : "Merge back to source conversation"
                              }
                              disabled={!canMerge || isMerging}
                              onClick={() => void merge()}
                            >
                              {isMerging ? (
                                <LoaderCircleIcon className="size-3" />
                              ) : (
                                <PullRequestGlyph.merged className="size-3" />
                              )}
                            </ThreadDetailsControl>
                          }
                        />
                        <TooltipPopup side="left">
                          {latestMergeBackRun === null
                            ? "Complete a run in this fork before merging it back"
                            : parentTitle
                              ? `Merge this conversation back into ${parentTitle}`
                              : "Merge this conversation back into its source"}
                        </TooltipPopup>
                      </Tooltip>
                      <span className="shrink-0 border border-transparent ps-1 pe-2.5 text-2xs font-medium text-muted-foreground">
                        {threadRelationshipStatusLabel(rowStatus)}
                      </span>
                    </div>
                  ) : (
                    relationshipLink
                  )}
                  {canStop && agent ? (
                    <div className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <ThreadDetailsControl
                              size="icon-xs"
                              variant="ghost"
                              part="icon"
                              tone="destructive"
                              aria-label={`Stop subagent ${threadTitle}`}
                              disabled={stoppingId !== null}
                              onClick={() => void stopSubagent(threadId, agent)}
                            />
                          }
                        >
                          {stoppingId === threadId ? (
                            <LoaderCircleIcon aria-hidden className="size-3" />
                          ) : (
                            <SquareIcon aria-hidden className="size-3 fill-current" />
                          )}
                        </TooltipTrigger>
                        <TooltipPopup side="left">Stop subagent</TooltipPopup>
                      </Tooltip>
                    </div>
                  ) : null}
                </li>
              );
            })
          }
        </ThreadLineageGroup>
      ))}
    </ThreadDetailsSection>
  );
}
