import { imageMimeType } from "@supaterm/shared/image";
import type {
  ChatFileAttachment as ContractChatFileAttachment,
  ChatImageAttachment as ContractChatImageAttachment,
  ChatUnknownAttachment as ContractChatUnknownAttachment,
  MessageId,
  OrchestrationV2Actor,
  OrchestrationV2CreationSource,
  OrchestrationV2PlanArtifact,
  OrchestrationV2UserMessageInputIntent,
  PlanId,
  ProjectScript as ContractProjectScript,
  ProviderInteractionMode,
  RunId,
  RuntimeMode,
  ScheduledTaskId,
  ThreadId,
} from "@supaterm/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
  ThreadRuntimeSummary,
} from "@supaterm/client-runtime/state/shell";
import type { ThreadCheckpointSummary } from "@supaterm/client-runtime/state/thread-checkpoints";
import { videoMimeType } from "@supaterm/shared/video";

export { videoMimeType } from "@supaterm/shared/video";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "term-1";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectScript = ContractProjectScript;

/** Percent of the split each terminal takes, keyed by terminal id. */
export type TerminalSplitLayout = Record<string, number>;

/** Stored layouts outlive splits and closes, so one only applies while it covers exactly these terminals. */
export function terminalSplitLayoutMatches(
  layout: TerminalSplitLayout | undefined,
  terminalIds: readonly string[],
): layout is TerminalSplitLayout {
  if (!layout || Object.keys(layout).length !== terminalIds.length) return false;
  return terminalIds.every((terminalId) => {
    const size = layout[terminalId];
    return size !== undefined && Number.isFinite(size) && size > 0;
  });
}

export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
  splitDirection?: "horizontal" | "vertical";
  layout?: TerminalSplitLayout;
}

export interface ChatImageAttachment extends ContractChatImageAttachment {
  readonly previewUrl?: string;
}

export interface ChatFileAttachment extends ContractChatFileAttachment {
  readonly previewUrl?: string;
  readonly downloadable?: boolean;
  readonly htmlRender?: boolean;
}

// Render unknown attachment contracts as inert rows so newer servers cannot crash older clients.
export type ChatUnknownAttachment = ContractChatUnknownAttachment;

export type ChatAttachment = ChatImageAttachment | ChatFileAttachment | ChatUnknownAttachment;

export function isImageAttachment(attachment: ChatAttachment): attachment is ChatImageAttachment {
  // Legacy file attachments can be images; unknown types must never be reclassified by name.
  if (attachment.type === "image") return true;
  return attachment.type === "file" && imageMimeType(attachment) !== null;
}

export function isFileAttachment(attachment: ChatAttachment): attachment is ChatFileAttachment {
  // Keep disjoint from isImageAttachment so independently filtered sets do not render legacy images twice.
  return attachment.type === "file" && !isImageAttachment(attachment);
}

export function isVideoAttachment(attachment: ChatFileAttachment): boolean {
  return videoMimeType(attachment) !== null;
}

export interface ChatMessage {
  readonly context?: import("@supaterm/contracts").OrchestrationMessageContext | undefined;
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  readonly runId: RunId | null;
  readonly streaming: boolean;
  readonly createdBy?: OrchestrationV2Actor;
  readonly creationSource?: OrchestrationV2CreationSource;
  readonly scheduledTaskId?: ScheduledTaskId;
  readonly senderThreadId?: ThreadId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly inputIntent?: OrchestrationV2UserMessageInputIntent | undefined;
}

export interface ProposedPlan {
  readonly id: PlanId;
  readonly runId: RunId | null;
  readonly planMarkdown: string;
  readonly status: OrchestrationV2PlanArtifact["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
}
export type TurnDiffFileChange = ThreadCheckpointSummary["files"][number];
export type TurnDiffSummary = ThreadCheckpointSummary;

export type Project = EnvironmentProject;
export type Thread = EnvironmentThreadShell;
export type ThreadShell = EnvironmentThreadShell;

export type SidebarThreadSummary = EnvironmentThreadShell;
export type ThreadSession = ThreadRuntimeSummary;
