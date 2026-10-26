import type { WorkGroupScrollAnchor, MessagesTimelineRow } from "./MessagesTimeline.logic";
import type {
  ScopedThreadRef,
  ServerProviderSkill,
  EnvironmentId,
  MessageId,
  RunId,
  OrchestrationV2TurnItem,
  ThreadId,
  RunAttemptId,
  TurnItemId,
  WorktreeSetupSnapshot,
} from "@supaterm/contracts";
import type { WorkflowOpening } from "@supaterm/client-runtime/state/subagentRuntime";
import { type MouseEvent, createContext } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import type { CodexArtifactTemplate } from "@supaterm/shared/codexArtifactTemplates";
import type { ChatFileAttachment } from "../../types";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import type { AssistantCitationTarget } from "./AssistantCitationSource";
import type { TimestampFormat } from "@supaterm/contracts/settings";
import type { HandoffTimelineRun } from "./V2LifecycleRow";
import type { PinnableProjectedItem } from "./PinnedMessages";

export interface TimelineRowSharedState {
  citationRequest: AssistantCitationTarget | null;
  listRef: React.RefObject<LegendListRef | null>;
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  threadRef: ScopedThreadRef | null;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  skills: ReadonlyArray<ServerProviderSkill>;
  runs: ReadonlyArray<HandoffTimelineRun>;
  activeThreadEnvironmentId: EnvironmentId;
  onRevertToTurnCount: (targetTurnCount: number, messageId: MessageId) => void;
  onUseArtifactTemplate: (template: CodexArtifactTemplate) => void;

  onSendAppMessage: ((text: string) => Promise<void>) | undefined;

  onAppFullscreenChange: (rowId: string, fullscreen: boolean) => void;
  onRunShellCommand: ((command: string) => void) | undefined;
  findActive: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  displayThreadKey?: string;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  onOpenThread: (threadId: OrchestrationV2TurnItem["threadId"]) => void;
  workflowOpening: WorkflowOpening | null;
  onForkFromRun: (input: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => Promise<void>;
  pinnedItemIds: ReadonlySet<TurnItemId>;
  onTogglePinnedMessage: ((projectedItem: PinnableProjectedItem, pinned: boolean) => void) | null;
  onToggleTurnFold: (runId: RunId) => void;
  onToggleAttemptFold: (attemptId: RunAttemptId) => void;
  onFileOpen: (attachment: ChatFileAttachment) => void;
  onFileDownload: (attachment: ChatFileAttachment) => void;
  openPullRequest: (event: MouseEvent<HTMLElement>, url: string) => void;
  onToggleWorkGroup: (groupId: string, anchorKey: string) => void;
  onToggleWorkEntry: (anchorKey: string, collapsed: boolean) => void;
  onCancelWorktreeSetup: (() => void) | null;
  retryableWorkspacePreparationRunIds: ReadonlySet<RunId>;
  onRetryWorkspacePreparation: ((runId: RunId) => void) | null;
  onWorktreeSetupWorkLocally: (() => void) | null;
  onOpenWorktreeSetupTerminal: ((terminalId: string) => void) | null;
  workGroupViewState: WorkGroupViewState;
}

export interface TimelineRowActivityState {
  isWorking: boolean;
  isCompacting: boolean;
  isRevertingCheckpoint: boolean;
  activeTurnInProgress: boolean;

  awaitingUser: boolean;
  isPreparingWorktree: boolean;
  latestRunId: RunId | null;
  backgroundWorktreeSetup: WorktreeSetupSnapshot | null;
}

export const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);

export const TimelineRowActivityCtx = createContext<TimelineRowActivityState>(null!);

export interface WorkGroupViewState {
  scrollPositions: Map<string, WorkGroupScrollAnchor>;
  expandedEntries: Set<string>;
}

export const WorkGroupViewCtx = createContext<{
  state: WorkGroupViewState;
  onToggleEntry: (entryId: string, collapsed: boolean) => void;
} | null>(null);

export type TimelineWorkEntry = Extract<
  MessagesTimelineRow,
  { kind: "work" }
>["groupedEntries"][number];

export type TimelineRow = MessagesTimelineRow;
