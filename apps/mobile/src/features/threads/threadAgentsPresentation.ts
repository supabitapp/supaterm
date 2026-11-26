import { resolveLinkedThreadOpen } from "@supaterm/client-runtime/linked-thread";
import {
  formatSubagentDisplayTitle,
  resolveSubagentMetadata,
  subagentCardDetail,
  subagentDetailPreview,
} from "@supaterm/client-runtime/state/subagent-display";
import {
  isActiveSubagentStatus,
  type RuntimeSubagent,
  type SubagentWorkflowGroup,
} from "@supaterm/client-runtime/state/subagentRuntime";
import { REASONING_EFFORT_OPTION_IDS } from "@supaterm/client-runtime/state/thread-execution";
import type {
  EnvironmentId,
  OrchestrationV2Subagent,
  ServerProvider,
  ThreadId,
} from "@supaterm/contracts";
import { splitsSurrogatePair } from "@supaterm/shared/assistantCitations";
import { resolveSelectableModel } from "@supaterm/shared/model";
import { msg } from "gt-react-native";

const PROMPT_TITLE_LIMIT = 80;

export type SubagentRowTone = "working" | "completed" | "failed" | "stopped";

export interface SubagentRowPresentation {
  readonly title: string;
  readonly detail: string | null;
  readonly statusLabel: string;
  readonly tone: SubagentRowTone;
  readonly live: boolean;
  readonly canOpenThread: boolean;
  /** The linked environment the task runs in, when it runs in one. */
  readonly runsOn: string | null;
}

export interface SubagentThreadTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** Set when the thread is read through the environment that links to it, not opened there. */
  readonly linked?: { readonly viaEnvironmentId: EnvironmentId; readonly label: string };
}

/**
 * Where an agent's thread opens: here, in the linked environment when this app is connected there,
 * or read-only through this environment's link (a saved environment opens in place once the link is
 * gone). Null without a thread, or on an older server for a machine this app does not have.
 */
export function subagentThreadTarget(
  subagent: Pick<OrchestrationV2Subagent, "childThreadId" | "remoteChild">,
  environmentId: EnvironmentId,
  ownConnection: (environmentId: EnvironmentId) => { readonly connected: boolean } | undefined,
  /** Whether `environmentId` still holds a link to the given environment; null on an older server. */
  isLinked: ((environmentId: EnvironmentId) => boolean) | null,
): SubagentThreadTarget | null {
  if (subagent.childThreadId !== null) {
    return { environmentId, threadId: subagent.childThreadId };
  }
  const remote = subagent.remoteChild;
  if (remote === undefined) return null;
  const target = { environmentId: remote.environmentId, threadId: remote.threadId };
  const own = ownConnection(remote.environmentId);
  if (isLinked === null) return own === undefined ? null : target;
  const open = resolveLinkedThreadOpen({
    environmentId: remote.environmentId,
    viaEnvironmentId: environmentId,
    own,
    linked: isLinked(remote.environmentId),
  });
  return open === "direct"
    ? target
    : { ...target, linked: { viaEnvironmentId: environmentId, label: remote.label } };
}

function rowTitle(subagent: Pick<OrchestrationV2Subagent, "title" | "prompt">): string {
  const title = subagent.title?.trim();
  if (title) return formatSubagentDisplayTitle(title);
  const prompt = subagent.prompt.trim();
  if (prompt.length === 0) return msg("Subagent");
  if (prompt.length <= PROMPT_TITLE_LIMIT) return prompt;
  const end = PROMPT_TITLE_LIMIT - 1;
  return `${prompt.slice(0, splitsSurrogatePair(prompt, end) ? end - 1 : end).trimEnd()}…`;
}

function rowTone(status: OrchestrationV2Subagent["status"]): SubagentRowTone {
  if (isActiveSubagentStatus(status)) return "working";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "stopped";
}

function rowStatusLabel(status: OrchestrationV2Subagent["status"]): string {
  switch (status) {
    case "pending":
    case "running":
      return "Working";
    case "waiting":
      return "Waiting";
    case "idle":
      return "Idle";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
  }
}

export function resolveSubagentRowPresentation(
  subagent: Pick<
    OrchestrationV2Subagent,
    "title" | "prompt" | "status" | "progress" | "result" | "childThreadId" | "remoteChild"
  >,
  canOpenRemote = false,
): SubagentRowPresentation {
  const live = isActiveSubagentStatus(subagent.status);
  return {
    title: rowTitle(subagent),
    detail: subagentDetailPreview(subagent),
    statusLabel: rowStatusLabel(subagent.status),
    tone: rowTone(subagent.status),
    live,
    canOpenThread:
      subagent.childThreadId !== null || (subagent.remoteChild !== undefined && canOpenRemote),
    runsOn: subagent.remoteChild?.label ?? null,
  };
}

export type WorkflowRailTone = SubagentRowTone | "queued";

export interface WorkflowRailItem {
  readonly key: string;
  readonly title: string;
  readonly members: ReadonlyArray<RuntimeSubagent>;
  readonly completedCount: number;
  readonly tone: WorkflowRailTone;
}

function railTone(members: ReadonlyArray<RuntimeSubagent>): WorkflowRailTone {
  if (members.every((member) => member.status === "pending")) return "queued";
  if (members.some((member) => isActiveSubagentStatus(member.status) || member.status === "idle")) {
    return "working";
  }
  if (members.some((member) => member.status === "failed")) return "failed";
  return members.every((member) => member.status === "completed") ? "completed" : "stopped";
}

export function workflowRail(group: SubagentWorkflowGroup): ReadonlyArray<WorkflowRailItem> {
  const items = group.phases.map((phase) => ({
    key: String(phase.index),
    title: phase.title,
    members: phase.members,
  }));
  if (group.unphasedMembers.length > 0) {
    items.push({
      key: "unphased",
      title: items.length === 0 ? msg("Agents") : "Other",
      members: group.unphasedMembers,
    });
  }
  return items.map((item) => ({
    ...item,
    completedCount: item.members.filter((member) => member.status === "completed").length,
    tone: railTone(item.members),
  }));
}

export function nextWorkflowSelection(
  rail: ReadonlyArray<WorkflowRailItem>,
  selected: string | null,
  tapped?: string,
): string | null {
  const open = rail.some((item) => item.key === selected) ? selected : null;
  if (tapped !== undefined) return tapped === open ? null : tapped;
  if (open !== null) return null;
  const filled = rail.filter((item) => item.members.length > 0);
  return (
    (
      filled.find((item) => item.tone === "working") ??
      filled.find((item) => item.tone === "failed") ??
      filled.at(-1)
    )?.key ?? null
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function workflowMemberMetadata(
  member: Pick<RuntimeSubagent, "model" | "effort" | "speed">,
  provider: Pick<ServerProvider, "driver" | "models"> | undefined,
) {
  const model = member.model?.trim()
    ? resolveSubagentMetadata({ model: member.model, provider }).modelLabel
    : null;
  const slug = provider
    ? resolveSelectableModel(provider.driver, member.model, provider.models)
    : null;
  const effortChoice = provider?.models
    .find((candidate) => candidate.slug === slug)
    ?.capabilities?.optionDescriptors?.flatMap((descriptor) =>
      descriptor.type === "select" &&
      (descriptor.role === "reasoning" || REASONING_EFFORT_OPTION_IDS.includes(descriptor.id))
        ? descriptor.options
        : [],
    )
    .find((option) => option.id === member.effort);
  return {
    model,
    effort: member.effort ? (effortChoice?.label ?? capitalize(member.effort)) : null,
    speed: member.speed ? capitalize(member.speed) : null,
    fast: member.speed === "fast",
  };
}

export function workflowMemberDetail(
  member: Pick<RuntimeSubagent, "status" | "progress" | "result" | "error">,
) {
  return {
    detail: subagentCardDetail(subagentDetailPreview(member)),
    error: member.status === "failed" ? subagentCardDetail(member.error) : null,
  };
}

export function resolveSubagentStopTarget(
  subagent: Pick<
    OrchestrationV2Subagent,
    | "id"
    | "threadId"
    | "childThreadId"
    | "status"
    | "origin"
    | "driver"
    | "runId"
    | "nativeTaskRef"
    | "workflow"
  >,
) {
  if (!isActiveSubagentStatus(subagent.status)) return null;
  if (subagent.workflow !== undefined) {
    return subagent.status === "running" &&
      subagent.origin === "provider_native" &&
      subagent.driver === "claudeAgent" &&
      Boolean(subagent.nativeTaskRef?.nativeId)
      ? {
          kind: "workflow" as const,
          input: { threadId: subagent.threadId, subagentId: subagent.id },
        }
      : null;
  }
  if (subagent.origin === "app_owned" && subagent.childThreadId !== null) {
    return {
      kind: "subagent" as const,
      input: { threadId: subagent.threadId, subagentId: subagent.id },
    };
  }
  if (
    subagent.origin === "provider_native" &&
    subagent.driver === "claudeAgent" &&
    subagent.runId !== null &&
    subagent.nativeTaskRef?.strength === "strong" &&
    subagent.nativeTaskRef.nativeId !== null
  ) {
    return {
      kind: "subagent" as const,
      input: { threadId: subagent.threadId, subagentId: subagent.id },
    };
  }
  return null;
}
