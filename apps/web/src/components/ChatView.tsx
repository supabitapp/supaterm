import { canQueueComposerMessageAtom } from "../state/composerQueue";
import {
  pendingThreadCreationMessage,
  resolvePendingThreadCreation,
} from "@supaterm/client-runtime/pending-thread-creation";
import {
  pendingThreadCreation as presentPendingThreadCreation,
  type WebPendingThreadCreation,
} from "../state/pendingThreadCreation";
import { useThreadOutboxAttachments } from "../state/threadOutboxEditing";
import { ThreadFind, ThreadFindCanvas, type ThreadFindControls } from "./chat/ThreadFindProvider";
import { THREAD_FIND_BAR_RESERVED_HEIGHT } from "./chat/ThreadFindBar";
import { usageLimitRecoveryBannerItem } from "./chat/UsageLimitRecoveryBanner";
import {
  deriveAvailableRevertTurnCounts,
  deriveThreadPendingBackgroundTasks,
  deriveWorkspaceMutationId,
  presentThreadShellFromProjection,
  isCompactCommandMessage,
  type LocalThreadErrorEntry,
  makeThreadErrorSetter,
  resolveDraftHeroState,
} from "./ChatView.logic";
import { useQueuedRunEditWithOutbox } from "./chat/useQueuedRunEditWithOutbox";
import { ThreadVisitWatermark } from "./chat/ThreadVisitWatermark";
import { ChatTerminalDrawers } from "./chat/ChatTerminalDrawers";
import { ChatRightPanel } from "./chat/ChatRightPanel";
import { ChatBannerLane } from "./chat/ChatBannerLane";
import { useProjectCloneBanner } from "./chat/useProjectCloneBanner";
import { useAttachmentPreviewHandoff } from "./chat/useAttachmentPreviewHandoff";
import { usePullRequestDraftThread } from "./chat/usePullRequestDraftThread";
import { useTimelineFollow } from "./chat/useTimelineFollow";
import { useTimelineRewind } from "./chat/useTimelineRewind";
import { useComposerSelection } from "./chat/useComposerSelection";
import { useRightPanelActions } from "./chat/useRightPanelActions";
import { useThreadLifecycle } from "./chat/useThreadLifecycle";
import { useComposerSend } from "./chat/useComposerSend";
import { useComposerResume } from "./chat/useComposerResume";
import { type TerminalLaunchContext, useChatTerminalActions } from "./chat/useChatTerminalActions";
import { useDraftEnvironmentRouting } from "./chat/useDraftEnvironmentRouting";
import { branchMismatchBannerItem } from "./chat/ThreadActivityBanners";
import {
  type EnvironmentUnavailableState,
  useSystemComposerBanners,
} from "./chat/useSystemComposerBanners";
import { usePasteToFocusComposer } from "./chat/usePasteToFocusComposer";
import { useDraftHeroLayoutTransition } from "./chat/useDraftHeroLayoutTransition";
import { useLocalDispatchState } from "./chat/useLocalDispatchState";
import { draftFanoutSelectionsAtom, draftSendState } from "./chat/chatViewSend";
import {
  isPaintOnlyThreadTimeline,
  peekHeldThreadTimeline,
  peekRememberedThreadTimeline,
  rememberReadyThreadTimeline,
  resolveThreadSwitchTimeline,
  timelineHasEphemeralPreviewUrls,
  recallCheckoutIsRepo,
  rememberCheckoutIsRepo,
} from "./ChatView.logic";
import { useLogicalProjectEnvironments } from "../hooks/useLogicalProjectEnvironments";
import { useStableCallback } from "../hooks/useStableCallback";
import { useProjectScriptEditing } from "./chat/useProjectScriptEditing";
import { RightPanelSurfaceContent } from "./chat/RightPanelSurfaceContent";
import { usePendingThreadRequestsWithTimerPause } from "./chat/usePendingThreadRequestsWithTimerPause";
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import { visibleThreadPullRequests } from "@supaterm/shared/threadPullRequests";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@supaterm/shared/orchestrationV2ThreadError";
import { headlineUsageWindows } from "@supaterm/shared/usageLimits";
import { feedbackBannerItem } from "./chat/ComposerFeedback";
import { useUsageLimitsPanel } from "./chat/useUsageLimitsPanel";
import { useWorktreeSetup } from "./chat/useWorktreeSetup";
import { useChatShortcuts } from "./chat/useChatShortcuts";
import { ComposerUsageMeter } from "./chat/ComposerUsageMeter";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  type AssistantCitation,
  type ChatFileAttachment,
  isProviderNativeSubagentThread,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type PreviewAnnotationPayload,
  type ServerProvider,
  type ScopedThreadRef,
  type ThreadId,
  type RunId,
  ProviderInteractionMode,
  RuntimeMode,
} from "@supaterm/contracts";
import { SPEED_TOGGLE_LABELS } from "@supaterm/client-runtime/provider-speed-toggle";
import {
  deriveProviderSubagentStatus,
  deriveReportedModelSelection,
  formatModelSelectionEffort,
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveLatestThreadRun,
  deriveThreadRuntime,
} from "@supaterm/client-runtime/state/thread-execution";
import {
  resolveWorkflowOpening,
  workflowOpeningParentThreadId,
} from "@supaterm/client-runtime/state/subagentRuntime";
import { threadSupportsProviderHandoff } from "@supaterm/client-runtime/state/thread-workflows";
import { resolvePendingHandoff } from "@supaterm/client-runtime/handoff";
import { HandoffRow } from "./chat/V2LifecycleRow";
import {
  codexFeedbackMessage,
  shouldShowLoadEarlierControl,
  type CodexFeedbackSubmission,
} from "@supaterm/client-runtime/state/threads";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@supaterm/client-runtime/environment";
import { formatModelSlugName, resolveSelectableModel } from "@supaterm/shared/model";
import { projectScriptCwd, resolveProjectScripts } from "@supaterm/shared/projectScripts";
import { resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { sourceControlRepositorySelector } from "@supaterm/shared/sourceControl";
import { resolveThreadReferenceCopyTarget } from "@supaterm/shared/threadReference";
import { resolveTerminalSessionLabel } from "@supaterm/shared/terminalLabels";
import { useAtomValue } from "@effect/atom-react";
import {
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { assistantCitationFromLocation } from "../lib/assistantCitationNavigation";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { useShallow } from "zustand/react/shallow";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { isElectron } from "../env";
import { useDiffPanelStore } from "../diffPanelStore";
import { useActiveThreadRef } from "../hooks/useActiveThreadRef";
import { composerRequiresModifier } from "../composer-logic";
import {
  derivePhase,
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  type TimelineEntriesInput,
  type TimelineEntriesProjection,
  deriveActivePlanState,
  selectComposerTasksPlan,
  deriveActiveWorkStartedAt,
  deriveCanInterruptRunningThread,
  findRevertCheckpoint,
  isLatestRunSettled,
} from "../session-logic";
import { type LegendListRef } from "@legendapp/list/react";
import { useWorkspaceMutationRefresh } from "../hooks/useWorkspaceMutationRefresh";
import { DEFAULT_INTERACTION_MODE, type ChatMessage } from "../types";
import { useTheme } from "../hooks/useTheme";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { subscribeSnapShotComposerFocus } from "../lib/desktopSnapShot";
import { useIsPaneInputOwner, usePaneInputOwner, usePaneScope } from "../chatPanes/paneScope";
import { useChatPaneStore } from "../chatPanes/store";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { FileMetadataThreadProvider } from "../hooks/FileMetadataThreadProvider";
import {
  RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY,
  type ThreadPanelPresentation,
} from "../rightPanelLayout";
import { PopoverCreateHandle } from "./ui/popover";
import {
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectThreadPanelOpen,
  selectThreadRightPanelState,
  type RightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import { isPreviewSupportedInRuntime, useThreadPreviewState } from "../previewStateStore";
import { previewRuntimeTabId } from "../browser/previewRuntimeTabId";
import { ThreadPreviewMiniPlayer } from "./preview/ThreadPreviewMiniPlayer";
import { usePreviewSession } from "./preview/usePreviewSession";
import { getConfiguredPreviewUrls } from "./preview/previewEmptyStateLogic";

import {
  previewMiniPlayerSourceKey,
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "../previewMiniPlayerStore";
import { threadPullRequestPanelTarget } from "./pullRequest/pullRequestDetail.logic";
import { useDeviceState } from "~/state/device";
import { BranchToolbar, type BranchToolbarHandle } from "./BranchToolbar";
import {
  makeWorkspaceFileDropHandlers,
  type WorkspaceFileDropHost,
} from "./chat/workspaceFileDrop";
import { isEditableFocused } from "../lib/editableFocus";
import { hasTextSelection } from "../lib/textSelection";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { shortcutLabelForCommand } from "../keybindings";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { projectScriptIdFromCommand } from "~/projectScripts";
import { newMessageId } from "~/lib/utils";
import { registerFaviconProjectForThread } from "~/browserFaviconStore";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
  shouldShowInstanceBadge,
  sortProviderInstanceEntries,
} from "../providerInstances";
import {
  useClientSettings,
  useClientSettingsHydrated,
  useEnvironmentSettings,
} from "../hooks/useSettings";
import { usePanelAnimationSettings, usePanelPresence } from "../panelAnimations";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useOpenPanelPullRequestUrl } from "../hooks/useOpenPanelPullRequestUrl";
import { isPreviewFocused } from "../lib/previewFocus";
import { getTerminalFocusOwner } from "../lib/terminalFocus";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import {
  isSameSidebarThreadRef,
  useSidebarPendingFileDropStore,
} from "../sidebarPendingFileDropStore";
import {
  composerDraftHasUserContent,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  useComposerDraftStore,
  DraftId,
} from "../composerDraftStore";
import { type TerminalContextDraft } from "../lib/terminalContext";
import { collectInlineContextIds } from "../lib/composerContextReferences";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useKnownTerminalSessions, useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useEnvironmentQuery } from "../state/query";
import { usePaginatedBranches } from "../state/queries";
import { useEnvironmentScope } from "~/state/session";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
  serverEnvironment,
} from "../state/server";
import { threadEnvironment } from "../state/threads";
import { resolveProviderSkillsForCwd } from "@supaterm/client-runtime/providerSkills";
import { vcsEnvironment } from "../state/vcs";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironment,
} from "../state/environments";
import {
  resolveThreadDetailRef,
  useEnvironmentSupportsServerBrowser,
  useProject,
  useThreadProjection,
  useThreadStatus,
  useThreadHistory,
  useQuietThreadShell,
  useThreadVisibleTurnItems,
  useThreadCheckpointSummaries,
} from "../state/entities";
import { useEnvironmentShellHasSnapshot } from "../state/shell";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { DraftProjectPicker } from "./chat/DraftProjectPicker";
import { ExpandedImageDialogHost, openExpandedImagePreview } from "./chat/ExpandedImageDialog";
import {
  DeviceSetupDialogHost,
  PullRequestThreadDialogHost,
  RevertConfirmHost,
} from "./chat/ChatOverlayHosts";
import type { AssistantCitationRequest } from "./chat/AssistantCitationSource";
import { MessagesTimeline, type MessagesTimelineHistoryControls } from "./chat/MessagesTimeline";
import { ProviderSubagentBar } from "./chat/ProviderSubagentBar";
import { getTriggerDisplayModelName } from "./chat/providerIconUtils";
import {
  overlayComposerIsResting,
  resolveComposerTimelineInset,
  resolveComposerUsageMeterSlot,
  resolveScrollToEndClearance,
} from "./composerFooterLayout";
import { ChatHeader } from "./chat/ChatHeader";
import { useRemoteOpenState } from "~/remoteOpen";
import { shouldShowOpenInPicker } from "./chat/OpenInPicker.logic";
import { useOpenFavoriteEditorShortcut } from "./chat/OpenInPickerShortcut";
import {
  PanelLayoutControls,
  type PanelLayoutControlsProps,
  ThreadPanelHeaderControl,
  WorkspaceTitlebarControls,
} from "./chat/PanelLayoutControls";
import type { ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { ThreadDetailsPanel } from "./chat/ThreadDetailsPanel";
import { NoActiveThreadState } from "./NoActiveThreadState";
import {
  resolveEffectiveEnvMode,
  resolveLocalCheckoutBranchMismatch,
  resolveWorktreeBaseBranch,
  shouldShowComposerContextStrip,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import {
  getProviderStatusBannerKey,
  shouldShowProviderStatusBanner,
} from "./chat/ProviderStatusBanner";
import {
  getThreadErrorBannerKey,
  isThreadErrorBannerDismissedForSession,
  shouldShowThreadErrorBanner,
} from "./chat/ThreadErrorBanner";
import { QueuedRunsControl, type QueuedRunsControlHandle } from "./chat/QueuedRunsControl";
import { useThreadLinkedPullRequest } from "./pullRequest/useThreadLinkedPullRequest";
import { useProactivePanels } from "../hooks/useProactivePanels";
import { useRightPanelSurfaceClose } from "../hooks/useRightPanelSurfaceClose";
import { useAgentOpenedPreviews } from "./preview/useAgentOpenedPreviews";
import type { ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { ComposerSurface } from "./chat/ComposerSurface";
import { resolveThreadSyncPhase } from "../threadSync";
import { hasAvailableCompactionProvider } from "./chat/ContextWindow.logic";
import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "../lib/contextWindow";
import { MOBILE_COMPOSER_VIEW_TRANSITION_NAME } from "./chat/draftHeroTransition";
import { animationsSettled } from "../lib/motion";
import { ScrollToEndPill } from "./chat/ScrollToEndPill";
import { WorkspaceDropOverlay } from "./WorkspaceDropOverlay";
import {
  buildLocalDraftThread,
  collectUserMessageBlobPreviewUrls,
  deriveCommittedServerUserMessageIds,
  dismissBranchMismatchForSession,
  shouldRenderPreviewMiniPlayer,
  deriveLockedProvider,
  resolveFileAttachmentUrl,
  resolveComposerProviderSelection,
  resolveThreadMetadataUpdateForNextTurn,
  resolveSendEnvMode,
  revokeUserMessagePreviewUrls,
  startNewThreadForProject,
  codexArtifactTemplatePromptToAppend,
  shouldRefocusComposerOnWindowFocus,
} from "./ChatView.logic";
import { useComposerHandleContext } from "../composerHandleContext";
import { clampFileAttachmentUploadBytes } from "@supaterm/client-runtime/state/attachments";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { enqueueThreadOutboxTurns, usePendingThreadCreation } from "../state/threadOutbox";
import { ThreadOutboxControl, type ThreadOutboxControlHandle } from "./chat/ThreadOutboxControl";
import { assetEnvironment } from "../state/assets";
import { readEnvironmentScope, readPreparedConnection } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { TooltipProvider } from "./ui/tooltip";
import { PreviewPanelGroup, PreviewPanelSibling } from "./preview/PreviewPanelLayout";
import { observeResize } from "~/lib/observeResize";
import {
  focusAdjacentPaneFromKeyboard,
  focusPaneIndexFromKeyboard,
  openThreadPickerBeside,
} from "../chatPanes/actions";
import { ChatPaneHeaderControls } from "./chatPanes/ChatPaneHeaderControls";

const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_MODELS: ServerProvider["models"] = [];
import type { CodexArtifactTemplate } from "@supaterm/shared/codexArtifactTemplates";

const EMPTY_FEEDBACK_SUBMISSIONS: ReadonlyArray<CodexFeedbackSubmission> = [];
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];

const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      routeKind: "draft";
      draftId: DraftId;
    };

function isAnimatingSize(element: Element): boolean {
  return element
    .getAnimations({ subtree: true })
    .some(
      (animation) =>
        animation.playState === "running" &&
        animation.effect instanceof KeyframeEffect &&
        animation.effect.getComputedTiming().iterations !== Infinity &&
        animation.effect
          .getKeyframes()
          .some((keyframe) => "height" in keyframe || "gridTemplateRows" in keyframe),
    );
}

const EMPTY_HELD_TURN_DIFF_SUMMARIES: readonly never[] = [];
const noopHeldTurnDiff = (_turnId: RunId, _filePath?: string) => {};
const noopHeldRevert = (_targetTurnCount: number) => {};
const noopHeldAttachment = (_attachment: ChatFileAttachment) => {};

function useChatComposerRef() {
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  return useComposerHandleContext() ?? localComposerRef;
}

function createTimelineEntriesProjector() {
  let previous: {
    readonly threadKey: string | null;
    readonly projection: TimelineEntriesProjection;
  } | null = null;
  return (input: TimelineEntriesInput, threadKey: string | null) => {
    const projection = deriveTimelineEntriesFromVisibleTurnItemsWithState(
      input,
      previous?.threadKey === threadKey ? previous.projection : null,
    );
    previous = { threadKey, projection };
    return projection.entries;
  };
}

export default function ChatView(props: ChatViewProps) {
  const {
    environmentId,
    threadId,
    routeKind,
    onDiffPanelOpen,
    reserveTitleBarControlInset = true,
    forceExpandedMobileComposer = false,
  } = props;
  const canOperateThread = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const isPaneInputOwner = usePaneInputOwner();
  const paneScope = usePaneScope();
  const paneSplit = useChatPaneStore((state) => (state.layout?.cells.length ?? 1) > 1);
  const ownsPaneInput = useIsPaneInputOwner();
  const canQueueMessage = useAtomValue(canQueueComposerMessageAtom(environmentId));
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const draftId = routeKind === "draft" ? props.draftId : null;
  const handleNewThread = useNewThreadHandler();
  const routeThreadRef = scopeThreadRef(environmentId, threadId);
  const routeThreadKey = scopedThreadKey(routeThreadRef);
  const pendingCreationEntry = usePendingThreadCreation(routeThreadRef);
  const queuedCreation = pendingCreationEntry
    ? presentPendingThreadCreation(pendingCreationEntry)
    : null;
  const currentRouteThreadKeyRef = useRef<string | null>(routeThreadKey);
  useLayoutEffect(() => {
    currentRouteThreadKeyRef.current = routeThreadKey;
    return () => {
      currentRouteThreadKeyRef.current = null;
    };
  }, [routeThreadKey]);
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const setThreadRuntimeMode = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const setThreadInteractionMode = useOrchestrationCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const createAttachmentAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const interruptThreadTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const loadEarlierThreadHistory = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier thread history",
    reportFailure: false,
  });
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentById = new Map(
    environments.map((environment) => [environment.environmentId, environment]),
  );
  const baseComposerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const serverThreadShell = useQuietThreadShell(routeThreadRef);
  const routeThreadDetailRef = resolveThreadDetailRef(routeThreadRef, {
    shellExists: serverThreadShell !== null,
    waitForShell: draftThread !== null || pendingCreationEntry !== null,
  });
  const serverThreadProjection = useThreadProjection(routeThreadDetailRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
  const serverThread =
    serverThreadShell !== null || serverProjection === null
      ? serverThreadShell
      : presentThreadShellFromProjection(environmentId, threadId, serverProjection);
  const promptRef = useRef("");
  const composerRef = useChatComposerRef();
  const queuedRunEdit = useQueuedRunEditWithOutbox({
    environmentId,
    routeThreadRef,
    threadDraftTarget: baseComposerDraftTarget,
    activeThreadId: serverThread !== null || draftThread !== null ? threadId : null,
    serverProjection,
    promptRef,
    composerRef,
  });
  const composerDraftTarget = queuedRunEdit.draftTarget;
  const [previousCreation, setPreviousCreation] = useState<WebPendingThreadCreation | null>(null);
  const pendingThreadCreation = resolvePendingThreadCreation({
    threadKey: routeThreadKey,
    pending: queuedCreation,
    previous: routeKind === "draft" && !draftThread?.promotedTo ? null : previousCreation,
    detail: serverProjection,
  });
  if (previousCreation !== pendingThreadCreation) setPreviousCreation(pendingThreadCreation);
  const pendingCreationAttachments = useThreadOutboxAttachments(
    pendingThreadCreation?.message.entry,
  );
  const pendingCreationMessages = ((): ChatMessage[] => {
    const message = pendingThreadCreation?.message;
    if (!message || serverProjection?.messages.some((item) => item.id === message.messageId))
      return [];
    return [
      {
        ...pendingThreadCreationMessage(message),
        attachments: pendingCreationAttachments.map(({ attachment, url }) => ({
          ...attachment,
          ...(url ? { previewUrl: url } : {}),
        })),
      },
    ];
  })();
  const reportedModelSelection = serverProjection
    ? deriveReportedModelSelection(serverProjection)
    : null;
  const threadStatus = useThreadStatus(routeThreadDetailRef);
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverProjection !== null,
    shellExists: serverThread !== null,
    status: threadStatus,
  });
  const threadDetailLoading = threadSyncPhase === "loading";
  const activeProviderThread = serverProjection?.providerThreads.find(
    (thread) => thread.id === serverProjection.thread.activeProviderThreadId,
  );
  const activeThreadLiveTokenUsage = latestProviderTurnTokenUsage(
    serverProjection?.providerTurns ?? [],
    serverProjection,
    activeProviderThread,
  );
  const serverVisibleTurnItems = useThreadVisibleTurnItems(routeThreadDetailRef);
  const serverThreadHistory = useThreadHistory(routeThreadDetailRef);
  const threadHistoryControls = ((): MessagesTimelineHistoryControls | undefined => {
    if (routeThreadDetailRef === null || !shouldShowLoadEarlierControl(serverThreadHistory)) {
      return undefined;
    }
    return {
      historyCursor: serverThreadHistory.historyCursor,
      hasMoreHistory: serverThreadHistory.hasMoreHistory,
      loading: serverThreadHistory.loading,
      error: serverThreadHistory.error,
      onLoadEarlier: (throughEntryId) => {
        void loadEarlierThreadHistory({
          environmentId: routeThreadDetailRef.environmentId,
          input: {
            threadId: routeThreadDetailRef.threadId,
            ...(throughEntryId === undefined ? {} : { throughEntryId }),
          },
        });
      },
    };
  })();
  const committedServerMessageIds = deriveCommittedServerUserMessageIds(serverVisibleTurnItems);
  // Queued messages have no turn item until their run starts, so the
  // turn-item-derived set alone can never retire their optimistic rows —
  // cancelling such a run would leave a phantom "pending" queue row behind.
  const serverAcknowledgedUserMessageIds = (() => {
    const ids = new Set(committedServerMessageIds);
    for (const message of serverProjection?.messages ?? []) {
      if (message.role === "user") ids.add(message.id);
    }
    return ids;
  })();
  const settings = useEnvironmentSettings(environmentId);
  const clientSettingsHydrated = useClientSettingsHydrated();
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  // Selects primitives: an object here is new on every router store update, which
  // re-renders ChatView on unrelated navigation state changes.
  const citationHref = useLocation({ select: (location) => location.href });
  const citationKey = useLocation({
    select: (location) => location.state.assistantCitationActivation ?? location.state.__TSR_key,
  });
  const citationLocation = { href: citationHref, key: citationKey };
  const citationRequest = ((): AssistantCitationRequest | null => {
    const citation = assistantCitationFromLocation(citationLocation.href);
    return citation && citation.environmentId === environmentId && citation.threadId === threadId
      ? { citation, key: citationLocation.key ?? citationLocation.href }
      : null;
  })();
  const { resolvedTheme } = useTheme();
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.runtimeMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const composerSelectedModelSelection = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft?.activeProvider
      ? (draft.modelSelectionByProvider[draft.activeProvider] ?? null)
      : null;
  });
  const composerHasAttachments = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return (draft?.images.length ?? 0) > 0 || (draft?.files.length ?? 0) > 0;
  });
  const referencedThreadContexts = useComposerDraftStore(
    useShallow((store) => {
      const draft = store.getComposerDraft(composerDraftTarget);
      if (!draft?.threadContexts.length) return [];
      // Linked prompts can replace text without pruning stored context records.
      const referenced = new Set(collectInlineContextIds(draft.prompt));
      return draft.threadContexts.filter((record) => referenced.has(record.contextId));
    }),
  );
  const composerHasNonPromptContent = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft ? composerDraftHasUserContent({ ...draft, prompt: "" }) : false;
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const branchToolbarRef = useRef<BranchToolbarHandle>(null);
  const [restingComposerControlsHost, setRestingComposerControlsHost] =
    useState<HTMLDivElement | null>(null);
  const [restingComposerControlsVisible, setRestingComposerControlsVisible] = useState(false);
  const citeAssistantText = (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => {
    const inserted = composerRef.current?.citeAssistantText(citation, sourceAnchor) ?? false;
    if (!inserted) {
      toastManager.add({
        type: "warning",
        title: "The composer is not ready",
        description: "Try citing the selection after the connection or pending input is resolved.",
      });
    }
    return inserted;
  };
  const citeAssistantTextStable = useStableCallback(citeAssistantText);
  const [isWorkspaceFileDragActive, setIsWorkspaceFileDragActive] = useState(false);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const [workLocallyResendDraftId, setWorkLocallyResendDraftId] = useState<DraftId | null>(null);
  if (workLocallyResendDraftId !== null && workLocallyResendDraftId !== draftId) {
    setWorkLocallyResendDraftId(null);
  }
  const [feedbackSubmissionsByThreadKey, setFeedbackSubmissionsByThreadKey] = useState<
    Record<string, ReadonlyArray<CodexFeedbackSubmission>>
  >({});
  const feedbackSubmissions =
    feedbackSubmissionsByThreadKey[routeThreadKey] ?? EMPTY_FEEDBACK_SUBMISSIONS;
  const feedbackUploading = feedbackSubmissions.some(
    (submission) => submission.status === "uploading",
  );
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [localServerErrorsByThreadKey, setLocalServerErrorsByThreadKey] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [isConnecting, _setIsConnecting] = useState(false);
  const isRevertingCheckpoint = useComposerDraftStore((store) =>
    store.rewindingThreadKeys.has(routeThreadKey),
  );

  const [workspaceFileDragScope, setWorkspaceFileDragScope] = useState({ draftId, routeThreadKey });
  if (
    workspaceFileDragScope.draftId !== draftId ||
    workspaceFileDragScope.routeThreadKey !== routeThreadKey
  ) {
    setWorkspaceFileDragScope({ draftId, routeThreadKey });
    setIsWorkspaceFileDragActive(false);
  }

  useEffect(() => {
    if (!isWorkspaceFileDragActive) return;
    const clearWorkspaceFileDrag = () => setIsWorkspaceFileDragActive(false);
    window.addEventListener("dragend", clearWorkspaceFileDrag);
    return () => window.removeEventListener("dragend", clearWorkspaceFileDrag);
  }, [isWorkspaceFileDragActive]);
  const viewportUsesPlanSidebarSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const shouldUsePlanSidebarSheet = viewportUsesPlanSidebarSheet || paneScope?.narrow === true;
  const isMobileViewport = useMediaQuery("max-sm");
  const threadPanelPopoverAnchorRef = useRef<HTMLElement | null>(null);
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [terminalUiLaunchContext, setTerminalUiLaunchContext] =
    useState<TerminalLaunchContext | null>(null);
  const legendListRef = useRef<LegendListRef | null>(null);
  const getTimelineScrollableNode = () => legendListRef.current?.getScrollableNode() ?? null;
  const getTimelineScrollableNodeStable = useStableCallback(getTimelineScrollableNode);
  const [composerOverlayElement, setComposerOverlayElement] = useState<HTMLDivElement | null>(null);
  const [composerTimelineInset, setComposerTimelineInset] = useState(0);
  const composerTimelineInsetRef = useRef(0);
  const [composerReservedHeight, setComposerReservedHeight] = useState(0);
  const composerReservedHeightRef = useRef(0);
  const composerExpandedHeightRef = useRef(0);
  const composerRestingRef = useRef(false);
  const [composerResting, setComposerResting] = useState(false);
  const composerMountedRef = useRef(true);
  const [scrollToEndClearance, setScrollToEndClearance] = useState(0);
  const [timelineOverflows, setTimelineOverflows] = useState(false);
  const fanoutSelectionsAtom = draftFanoutSelectionsAtom(routeThreadKey);
  const { sendInFlight: sendInFlightRef } = draftSendState(routeThreadKey);
  const isSendInFlight = useEffectEvent(() => sendInFlightRef.current);
  const isSendInFlightStable = useStableCallback(() => sendInFlightRef.current);
  const multipleModelSelections = useAtomValue(fanoutSelectionsAtom);
  const setMultipleModelSelections = (
    selections: SetStateAction<ReadonlyArray<ModelSelection> | null>,
  ) => {
    appAtomRegistry.update(fanoutSelectionsAtom, (current) =>
      typeof selections === "function" ? selections(current) : selections,
    );
  };
  const setMultipleModelSelectionsStable = useStableCallback(setMultipleModelSelections);
  const feedbackUploadsInFlightRef = useRef(new Set<string>());
  const terminalUiOpenByThreadRef = useRef<Record<string, boolean>>({});

  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef),
  );

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useProject(fallbackDraftProjectRef);
  const localDraftError = serverThread
    ? null
    : ((draftId ? localDraftErrorsByDraftId[draftId]?.message : null) ?? null);
  const localServerError = localServerErrorsByThreadKey[routeThreadKey]?.message ?? null;
  const pendingDraftErrorEntry =
    serverThread && draftId ? localDraftErrorsByDraftId[draftId] : undefined;
  if (draftId && pendingDraftErrorEntry !== undefined) {
    setLocalDraftErrorsByDraftId((existing) => {
      if (existing[draftId] === undefined) {
        return existing;
      }
      const next = { ...existing };
      delete next[draftId];
      return next;
    });
    setLocalServerErrorsByThreadKey((existing) => {
      const currentEntry = existing[routeThreadKey];
      if (
        currentEntry !== undefined &&
        (currentEntry.at > pendingDraftErrorEntry.at ||
          currentEntry.message === pendingDraftErrorEntry.message)
      ) {
        return existing;
      }
      return {
        ...existing,
        [routeThreadKey]: pendingDraftErrorEntry,
      };
    });
  }
  const localDraftThread = draftThread
    ? buildLocalDraftThread(
        threadId,
        draftThread,
        resolveProjectSettings(
          settings,
          fallbackDraftProject?.id ?? null,
          fallbackDraftProject ?? undefined,
        ).settings.defaultModelSelection ?? NO_PROVIDER_MODEL_SELECTION,
      )
    : undefined;
  const isServerThread = serverThread !== null;
  const activeThread = serverThread ?? pendingThreadCreation?.message.shell ?? localDraftThread;
  const serverLatestRun =
    serverProjection === null ? null : deriveLatestThreadRun(serverProjection);
  const serverActivityRun =
    serverProjection === null ? null : deriveThreadActivityRun(serverProjection);
  const serverRuntime = serverProjection === null ? null : deriveThreadRuntime(serverProjection);
  const runlessWorkStartedAt =
    serverProjection === null ? null : deriveRunlessWorkStartedAt(serverProjection);
  const providerSubagentStatus =
    serverProjection === null ? null : deriveProviderSubagentStatus(serverProjection);
  const isProviderSubagent =
    serverThread !== null && isProviderNativeSubagentThread(serverThread.source);
  const supportsProviderSwitchingViaHandoff = threadSupportsProviderHandoff(serverProjection);
  const activeLatestRun = isServerThread ? serverLatestRun : (activeThread?.latestRun ?? null);
  const activeActivityRun = isServerThread ? serverActivityRun : (activeThread?.latestRun ?? null);
  const activeRuntime = isServerThread ? serverRuntime : (activeThread?.runtime ?? null);
  const hasHeldQueuedRuns =
    isServerThread &&
    serverProjection?.runs.some((run) => run.status === "queued" && run.queueHeld === true) ===
      true;
  const resumableRunId = (() => {
    if (!isServerThread || serverProjection === null) return null;
    const run = latestExecutedRun(serverProjection.runs);
    if (run?.status === "interrupted") return run.id;
    return run?.status === "failed" &&
      serverRuntime?.lastErrorClass === "usage_limit" &&
      latestRootProviderFailure(run, serverProjection.turnItems)?.class === "usage_limit"
      ? run.id
      : null;
  })();
  const parentSubagentThreadId =
    activeThread?.lineage.relationshipToParent === "subagent"
      ? activeThread.lineage.parentThreadId
      : null;
  const parentSubagentEnvironmentId = activeThread?.environmentId ?? null;
  const parentSubagentThreadRef = (() => {
    if (parentSubagentEnvironmentId === null || parentSubagentThreadId === null) {
      return null;
    }
    return scopeThreadRef(parentSubagentEnvironmentId, parentSubagentThreadId);
  })();
  const parentSubagentThread = useQuietThreadShell(parentSubagentThreadRef);
  // A workflow coordinator's thread opens with its script; the plan that replaces it lives on
  // the parent's coordinator row, so the parent's detail loads only for such a thread.
  const workflowOpeningParentId =
    serverProjection === null
      ? null
      : workflowOpeningParentThreadId({
          thread: serverProjection.thread,
          messages: serverProjection.messages,
        });
  const workflowOpeningParentProjection = useThreadProjection(
    workflowOpeningParentId === null || parentSubagentEnvironmentId === null
      ? null
      : scopeThreadRef(parentSubagentEnvironmentId, workflowOpeningParentId),
  );
  const workflowOpening =
    serverProjection === null || workflowOpeningParentId === null
      ? null
      : resolveWorkflowOpening({
          thread: serverProjection.thread,
          messages: serverProjection.messages,
          parentSubagents: workflowOpeningParentProjection?.projection.subagents ?? null,
        });
  const parentThreadLink =
    parentSubagentThreadRef === null
      ? null
      : {
          threadId: parentSubagentThreadRef.threadId,
          title: parentSubagentThread?.title ?? "Parent thread",
        };
  const threadError = isServerThread
    ? (localServerError ?? serverRuntime?.lastError ?? null)
    : localDraftError;
  const threadErrorBannerKey = getThreadErrorBannerKey(routeThreadKey, threadError);
  const visibleThreadError = shouldShowThreadErrorBanner(
    routeThreadKey,
    threadError,
    isThreadErrorBannerDismissedForSession(threadErrorBannerKey),
  )
    ? threadError
    : null;
  const [, setThreadErrorBannerDismissTick] = useState(0);
  const defaultRuntimeMode = resolveProjectSettings(settings, activeThread?.projectId ?? null)
    .settings.defaultRuntimeMode;
  const runtimeMode =
    composerRuntimeMode ??
    (isServerThread || pendingThreadCreation ? activeThread?.runtimeMode : undefined) ??
    defaultRuntimeMode;
  const isLocalDraftThread =
    !isServerThread && !pendingThreadCreation && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = canWriteSourceControl && isLocalDraftThread;
  const activeThreadId = activeThread?.id ?? null;
  // Prefer the larger of turn-item-committed ids and projection messages so
  // env lock does not unlock while turn items lag projection hydration.
  const activeMessageCount = isServerThread
    ? Math.max(committedServerMessageIds.size, serverProjection?.messages.length ?? 0)
    : 0;
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessionsRaw = useKnownTerminalSessions({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessions = (() => {
    if (activeThreadId === null || activeThreadKnownSessionsRaw === null) {
      return [];
    }
    return activeThreadKnownSessionsRaw.filter(
      (session) => session.target.threadId === activeThreadId,
    );
  })();
  const activeServerOrderedTerminalIds = activeThreadKnownSessions.map(
    (session) => session.target.terminalId,
  );
  const activeTerminalLabelsById = (() => {
    const labels = new Map<string, string>();
    for (const session of activeThreadKnownSessions) {
      labels.set(
        session.target.terminalId,
        resolveTerminalSessionLabel(session.target.terminalId, session.state.summary),
      );
    }
    return labels;
  })();
  const activeTerminalHasRunningSubprocessById = new Map(
    activeThreadKnownSessions.map((session) => [
      session.target.terminalId,
      session.state.hasRunningSubprocess,
    ]),
  );
  const activeThreadRef = useActiveThreadRef(activeThread);
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const activeEnvironmentServerBrowser = useEnvironmentSupportsServerBrowser(
    activeThreadRef?.environmentId ?? null,
  );
  const browserAvailable = isPreviewSupportedInRuntime() || activeEnvironmentServerBrowser;
  const activeThreadShell = serverThread;
  const timelineThreadError =
    serverRuntime?.status === "failed" &&
    serverRuntime.lastErrorClass === "usage_limit" &&
    activeThreadShell?.latestRun &&
    visibleThreadError === serverRuntime.lastError
      ? null
      : visibleThreadError;

  const [timelineAnchor, setTimelineAnchor] = useState<{
    readonly threadKey: string | null;
    readonly messageId: MessageId | null;
  }>({ threadKey: activeThreadKey, messageId: null });
  if (timelineAnchor.threadKey !== activeThreadKey) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const timelineAnchorMessageId = timelineAnchor.messageId;
  // LegendList sizes the anchored end-space filler for the geometry at anchor
  // time and never recomputes it, so a lingering anchor leaves stale filler
  // height behind the composer — phantom scroll range on threads whose content
  // fits.
  const anchorRunSettled = (() => {
    if (timelineAnchorMessageId === null) return false;
    const anchorRun = serverProjection?.runs.find(
      (run) => run.userMessageId === timelineAnchorMessageId,
    );
    if (anchorRun === undefined) return false;
    return (
      anchorRun.status !== "preparing" &&
      anchorRun.status !== "queued" &&
      anchorRun.status !== "starting" &&
      anchorRun.status !== "running" &&
      anchorRun.status !== "waiting"
    );
  })();
  if (anchorRunSettled) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const activeRightPanelKind = useRightPanelStore((state) =>
    selectActiveRightPanel(state.byThreadKey, activeThreadRef),
  );
  const diffOpen = activeRightPanelKind === "diff";
  const explicitDiffOpenRef = useRef<ScopedThreadRef | null>(null);
  useLayoutEffect(() => {
    const explicitThreadRef = explicitDiffOpenRef.current;
    explicitDiffOpenRef.current = null;
    if (diffOpen && activeThreadRef && explicitThreadRef !== activeThreadRef) {
      useDiffPanelStore.getState().selectGitScope(activeThreadRef, "branch");
    }
  }, [activeThreadRef, diffOpen]);
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, activeThreadRef),
  );
  const activeRightPanelSurface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, activeThreadRef),
  );
  const activePreviewState = useThreadPreviewState(activeThreadRef);
  const activePreviewServerEpoch = activePreviewState.serverEpoch;
  const previewSessionsReady = !activeEnvironmentServerBrowser || activePreviewState.listLoaded;
  const resolvePreviewRuntimeTabId = activeThreadRef
    ? (tabId: string) => previewRuntimeTabId(activeThreadRef, activePreviewServerEpoch, tabId)
    : undefined;
  const activePreviewMiniPlayer = usePreviewMiniPlayerStore((state) =>
    selectThreadPreviewMiniPlayer(state.byThreadKey, activeThreadRef),
  );
  const panelTerminalIds = new Set(
    rightPanelState.surfaces.flatMap((surface) =>
      surface.kind === "terminal" ? surface.terminalIds : [],
    ),
  );
  const canReuseTerminal = activeThreadKnownSessionsRaw !== null;
  const previewPanelOpen = activeRightPanelKind === "preview" && browserAvailable;
  const rightPanelOpen = rightPanelState.isOpen;
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const rightPanelPresenceValue = {
    activeSurface: activeRightPanelSurface,
    surfaces: rightPanelState.surfaces,
  };
  const rightPanelPresence = usePanelPresence(
    rightPanelOpen && activeThreadRef !== null,
    rightPanelPresenceValue,
    panelAnimationsActive,
    activeThreadKey,
    panelAnimationDurationMs,
  );
  const rightPanelPresent = rightPanelPresence.present;
  const rightPanelControlsInPanel =
    shouldUsePlanSidebarSheet && rightPanelPresent && rightPanelOpen;
  const rightPanelControlsAtRoot = rightPanelPresent && !shouldUsePlanSidebarSheet;
  const renderedRightPanelSurface = rightPanelPresence.value?.activeSurface ?? null;
  const renderedRightPanelSurfaces = rightPanelPresence.value?.surfaces ?? [];
  const previewMiniPlayerVisible = shouldRenderPreviewMiniPlayer(
    activePreviewMiniPlayer?.source ?? null,
    renderedRightPanelSurface,
  );
  const canMaximizeRightPanel = rightPanelOpen && !shouldUsePlanSidebarSheet;
  const rightPanelMaximized = canMaximizeRightPanel && rightPanelState.maximized === true;
  const inlineRightPanelOwnsTitleBar = rightPanelOpen && !shouldUsePlanSidebarSheet;
  const [threadPanelPresentation, setThreadPanelPresentation] =
    useState<ThreadPanelPresentation>("inline");
  const [threadPanelPopoverHandle] = useState(PopoverCreateHandle);
  const [backgroundWorkChecksHandle] = useState(PopoverCreateHandle);
  const threadPanelOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(
      state.threadPanelVisibilityByThreadKey,
      activeThreadRef,
      threadPanelPresentation,
    ),
  );

  useEffect(() => {
    if (!activeThreadRef || !previewSessionsReady) return;
    const hiddenTabIds = new Set(
      Object.values(activePreviewState.sessions)
        .filter((session) => session.runtime === "server" && session.reveal === false)
        .map((session) => session.tabId),
    );
    useRightPanelStore
      .getState()
      .reconcileBrowserSurfaces(
        activeThreadRef,
        Object.keys(activePreviewState.sessions),
        hiddenTabIds,
      );
  }, [activePreviewState.sessions, activeThreadRef, previewSessionsReady]);

  useEffect(() => {
    const source = activePreviewMiniPlayer?.source;
    if (
      activeThreadRef &&
      previewSessionsReady &&
      source?.kind === "browser" &&
      !activePreviewState.sessions[source.tabId]
    ) {
      usePreviewMiniPlayerStore.getState().close(activeThreadRef);
    }
  }, [activePreviewMiniPlayer, activePreviewState.sessions, activeThreadRef, previewSessionsReady]);

  const latestRunSettled = isLatestRunSettled(activeLatestRun, activeRuntime);
  const activePlan = deriveActivePlanState(serverProjection, activeActivityRun?.runId);
  const activeActivityRunSettled = isLatestRunSettled(activeActivityRun, activeRuntime);
  const composerTasksPlan = selectComposerTasksPlan(
    serverProjection,
    activePlan,
    activeActivityRun?.runId ?? null,
    activeActivityRunSettled,
  );
  const activeComposerTasksProgress = (() => {
    if (!composerTasksPlan) return null;
    const live = !activeActivityRunSettled && composerTasksPlan.runId === activeActivityRun?.runId;
    const totalSteps = composerTasksPlan.steps.length;
    if (totalSteps === 0) return null;
    const completedSteps = composerTasksPlan.steps.filter(
      (step) => step.status === "completed",
    ).length;
    const step =
      composerTasksPlan.steps.find((candidate) => candidate.status === "inProgress")?.step ??
      composerTasksPlan.steps.find((candidate) => candidate.status === "pending")?.step ??
      composerTasksPlan.steps.at(-1)!.step;
    return { step, completedSteps, totalSteps, live };
  })();
  const activeComposerTaskSteps =
    activeComposerTasksProgress && composerTasksPlan ? composerTasksPlan.steps : null;
  const activeThreadEnvironmentId = activeThread?.environmentId ?? null;
  const activeThreadProjectId = activeThread?.projectId ?? null;
  const activeProjectRef =
    activeThreadEnvironmentId !== null && activeThreadProjectId !== null
      ? scopeProjectRef(activeThreadEnvironmentId, activeThreadProjectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const activeProjectSettings = resolveProjectSettings(
    settings,
    activeProject?.id ?? null,
    activeProject ?? undefined,
  );
  const activeProjectScripts = activeProject ? resolveProjectScripts(settings, activeProject) : [];
  const { projectCloneBannerItem, projectCloneSendBlockReason } =
    useProjectCloneBanner(activeProjectRef);
  const activeProjectDefaultModelSelection = activeProjectSettings.settings.defaultModelSelection;
  const handleNewThreadInActiveProject = () => {
    startNewThreadForProject(activeProjectRef, handleNewThread);
  };
  const handleNewThreadInActiveProjectStable = useStableCallback(handleNewThreadInActiveProject);
  const projectGroupingSettings = selectProjectGroupingSettings(settings);
  const activeDraftLogicalProjectKey =
    !isServerThread && activeProject
      ? deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings)
      : undefined;
  const handleOpenDraftProjectSettings = () => {
    if (!activeDraftLogicalProjectKey) return;
    void navigate({
      to: "/projects/$projectKey",
      params: { projectKey: activeDraftLogicalProjectKey },
    });
  };
  const handleOpenDraftProjectSettingsStable = useStableCallback(handleOpenDraftProjectSettings);
  const activeEnvironmentBootstrapComplete = useEnvironmentShellHasSnapshot(
    activeThread?.environmentId ?? null,
  );
  const activeProjectKey = activeProject
    ? `${activeProject.environmentId}:${activeProject.workspaceRoot}`
    : null;
  const [pendingFileSurfaceIdsByProject, setPendingFileSurfaceIdsByProject] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
  const pendingFileSurfaceIds = activeProjectKey
    ? (pendingFileSurfaceIdsByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS)
    : EMPTY_PENDING_FILE_SURFACE_IDS;
  const handleFilePendingChange = (relativePath: string, pending: boolean) => {
    if (!activeProjectKey) return;
    setPendingFileSurfaceIdsByProject((currentByProject) => {
      const current = currentByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS;
      const surfaceId = `file:${relativePath}`;
      if (current.has(surfaceId) === pending) return currentByProject;
      const next = new Set(current);
      if (pending) next.add(surfaceId);
      else next.delete(surfaceId);
      const nextByProject = new Map(currentByProject);
      if (next.size === 0) nextByProject.delete(activeProjectKey);
      else nextByProject.set(activeProjectKey, next);
      return nextByProject;
    });
  };
  const handleFilePendingChangeStable = useStableCallback(handleFilePendingChange);
  const configuredPreviewUrls = getConfiguredPreviewUrls(activeProjectScripts);

  useEffect(() => {
    if (!activeThreadRef || !activeEnvironmentBootstrapComplete) return;
    useRightPanelStore.getState().reconcileFileSurfaces(activeThreadRef, activeProject !== null);
  }, [activeEnvironmentBootstrapComplete, activeProject, activeThreadRef]);

  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  useEffect(() => {
    if (!activeThreadRef || !activeProjectRef) return;
    registerFaviconProjectForThread(activeThreadRef, activeProjectRef);
  }, [activeProjectRef, activeThreadRef]);
  const activeEnvironment =
    activeThread == null ? null : (environmentById.get(activeThread.environmentId) ?? null);
  const activeEnvironmentConnectionPhase = activeEnvironment?.connection.phase ?? "available";
  const activeEnvironmentUnavailable =
    activeEnvironment !== null && activeEnvironmentConnectionPhase !== "connected";
  const activeEnvironmentUnavailableLabel = activeEnvironment?.label ?? null;
  const activeEnvironmentUnavailableState = ((): EnvironmentUnavailableState | null => {
    if (!activeEnvironmentUnavailable || !activeEnvironmentUnavailableLabel || !activeEnvironment) {
      return null;
    }

    return {
      environmentId: activeEnvironment.environmentId,
      label: activeEnvironmentUnavailableLabel,
      connection: activeEnvironment.connection,
    };
  })();
  const activeProjectIsScratch =
    activeProject !== null &&
    isScratchProject(
      activeProject,
      environmentById.get(activeProject.environmentId)?.serverConfig?.scratchWorkspaceRoot ?? null,
    );
  const logicalProjectEnvironments = useLogicalProjectEnvironments(
    activeProject,
    activeProjectIsScratch && draftId !== null,
  );
  const hasMultipleEnvironments = logicalProjectEnvironments.length > 1;
  const canAutoBalanceEnvironments = hasMultipleEnvironments && !activeProjectIsScratch;
  const activeEnvironmentOption =
    logicalProjectEnvironments.find(
      (environment) => environment.environmentId === activeThread?.environmentId,
    ) ?? null;
  const showComposerEnvironmentIndicator = shouldShowEnvironmentIndicator({
    activeEnvironment: activeEnvironmentOption,
    canPickEnvironment: hasMultipleEnvironments,
  });

  const { handlePreparedPullRequestThreadStable, openPullRequestDialogStable } =
    usePullRequestDraftThread({
      routeKind,
      draftId: draftId ?? null,
      settings,
      projectGroupingSettings,
      activeProject,
      activeThreadKey,
      isServerThread,
      canCheckoutPullRequestIntoThread,
    });
  const serverConfig = activeThread
    ? (activeEnvironment?.serverConfig ?? null)
    : (primaryEnvironment?.serverConfig ?? null);
  const providerEnvironmentId = (activeThread ? activeEnvironment : primaryEnvironment)
    ?.environmentId;
  const providerStatuses =
    (providerEnvironmentId === undefined
      ? undefined
      : providersByEnvironment.get(providerEnvironmentId)) ?? EMPTY_PROVIDERS;
  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProjectDefaultModelSelection?.instanceId ??
    null;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
    providers: providerStatuses,
    supportsProviderSwitchingViaHandoff,
  });
  const pullRequestsCapabilityKnown = serverConfig !== null;
  const supportsPullRequests = serverConfig != null;
  const attachmentEnvironmentConfig = environmentById.get(environmentId)?.serverConfig ?? null;
  const attachmentUploadsCapabilityKnown = attachmentEnvironmentConfig !== null;
  const supportsQuestionAttachments = attachmentEnvironmentConfig != null;
  const supportsAttachmentUploads = attachmentEnvironmentConfig != null;
  const advertisedFileAttachmentBytes =
    attachmentEnvironmentConfig?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null;
  const maxFileAttachmentBytes =
    advertisedFileAttachmentBytes === null
      ? null
      : clampFileAttachmentUploadBytes(advertisedFileAttachmentBytes);
  const envLocked = Boolean(activeThread && (activeMessageCount > 0 || activeRuntime !== null));

  const canChangeEnvironment =
    hasMultipleEnvironments && !envLocked && draftId !== null && !draftThread?.promotedTo;

  const loadBalancingSettings = useClientSettings((settings) => ({
    loadBalancingEnabled: settings.loadBalancingEnabled,
    loadBalancingWeights: settings.loadBalancingWeights,
  }));
  const automaticEnvironment = Boolean(
    clientSettingsHydrated &&
    draftId &&
    !envLocked &&
    canAutoBalanceEnvironments &&
    loadBalancingSettings.loadBalancingEnabled &&
    draftThread?.environmentSelection !== "manual" &&
    (!composerHasAttachments || Boolean(draftThread?.loadBalancedEnvironmentId)) &&
    (!draftThread?.branch || draftThread.environmentSelection === "auto") &&
    !draftThread?.worktreePath,
  );
  const autoUpdateEnvironments = automaticEnvironment
    ? logicalProjectEnvironments.flatMap(({ environmentId }) => {
        const environment = environmentById.get(environmentId);
        return environment ? [environment] : [];
      })
    : [];
  const systemComposerBannerItems = useSystemComposerBanners({
    activeEnvironment,
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableState,
    activeThreadEnvironmentId: activeThread?.environmentId ?? null,
    serverConfig,
    hasMultipleRegisteredEnvironments: environments.length > 1,
    automaticEnvironment,
    autoUpdateEnvironments,
  });
  const providerInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providerStatuses),
      settings,
      activeProject?.id ?? null,
    ),
  );
  useEffect(() => {
    if (!isLocalDraftThread) return;
    const disabled = new Set(
      providerInstanceEntries.filter((entry) => !entry.enabled).map((entry) => entry.instanceId),
    );
    appAtomRegistry.update(fanoutSelectionsAtom, (current) => {
      if (current === null) return current;
      const next = current.filter((selection) => !disabled.has(selection.instanceId));
      return next.length === current.length ? current : next;
    });
  }, [fanoutSelectionsAtom, isLocalDraftThread, providerInstanceEntries]);
  const { selectedProviderEntry, requestedDriverKind } = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds: [
      selectedProviderByThreadId,
      activeRuntime?.providerInstanceId,
      activeThread?.modelSelection.instanceId,
      activeProjectDefaultModelSelection?.instanceId,
    ],
    lockedProvider,
    lockedInstanceId: activeRuntime?.providerInstanceId ?? activeThread?.modelSelection.instanceId,
  });
  const selectedProvider = selectedProviderEntry?.driverKind ?? requestedDriverKind;
  const activeProviderInstanceId = selectedProviderEntry?.instanceId ?? null;
  const activeProviderStatus = selectedProviderEntry?.snapshot ?? null;
  const interactionMode = DEFAULT_INTERACTION_MODE;
  const conversationProviderStatus =
    providerStatuses.find((status) => status.instanceId === activeRuntime?.providerInstanceId) ??
    activeProviderStatus;
  const supportsConversationRollback =
    canOperateThread &&
    conversationProviderStatus !== null &&
    conversationProviderStatus.supportsConversationRollback !== false;
  const phase = derivePhase(activeRuntime);
  const serverThreadId = serverThread?.id;
  const serverThreadEnvironmentId = serverThread?.environmentId;
  const setThreadError = makeThreadErrorSetter({
    routeThreadRef,
    routeThreadKey,
    draftId,
    serverThreadRef:
      serverThreadId && serverThreadEnvironmentId
        ? { threadId: serverThreadId, environmentId: serverThreadEnvironmentId }
        : null,
    setLocalServerErrorsByThreadKey,
    setLocalDraftErrorsByDraftId,
  });
  const {
    pendingApprovals,
    pendingUserInputs,
    activePendingApproval,
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    respondingRequestIds,
    supportsQuestionAutoDismiss,
    onRespondToApproval: onRespondToApprovalStable,
    onDismissUserInput: onDismissUserInputStable,
    onSelectActivePendingUserInputOption: onSelectActivePendingUserInputOptionStable,
    onChangeActivePendingUserInputCustomAnswer,
    onAdvanceActivePendingUserInput,
    onAdvanceActivePendingUserInputStable,
    onPreviousActivePendingUserInputQuestion: onPreviousActivePendingUserInputQuestionStable,
  } = usePendingThreadRequestsWithTimerPause({
    environmentId,
    activeThreadId,
    activeThread,
    serverProjection,
    supportsQuestionAttachments,
    composerDraftTarget,
    setComposerDraftPrompt,
    promptRef,
    composerRef,
    setThreadError,
  });
  // A pending approval or question is part of the key: once it is answered,
  // from this client or any other, the agent resumes and spends quota.
  const usageLimitsKey =
    activeProviderInstanceId === null || (isServerThread && activeThread === undefined)
      ? null
      : [
          routeThreadKey,
          activeProviderInstanceId,
          activeThread?.latestRun?.runId ?? "",
          activePendingApproval?.requestId ?? activePendingUserInput?.requestId ?? "",
        ].join(":");
  const {
    banner: usageLimitsBanner,
    offered: usageLimitsOffered,
    open: openUsageLimits,
    clearFor: clearUsageLimitsFor,
  } = useUsageLimitsPanel({
    environmentId,
    threadKey: routeThreadKey,
    panelKey: usageLimitsKey,
    providerInstanceId: activeProviderInstanceId,
    providerDriver: activeProviderStatus?.driver ?? null,
    providers: providerStatuses,
  });
  const {
    resetLocalDispatch,
    localDispatchStartedAt,
    isPreparingWorktree: isLocallyPreparingWorktree,
    isSendBusy,
    backgroundSubmissionPending,
  } = useLocalDispatchState({
    activeThread,
    activeLatestRun,
    latestUserMessageId:
      serverProjection?.messages.findLast((message) => message.role === "user")?.id ?? null,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError,
  });
  const optimisticCompactionMessage = optimisticUserMessages.at(-1);
  const latestServerUserItem = serverVisibleTurnItems.findLast(
    (row) => row.item.type === "user_message",
  )?.item;
  const compactRequestIsActive =
    (isSendBusy &&
      optimisticCompactionMessage !== undefined &&
      isCompactCommandMessage(optimisticCompactionMessage)) ||
    (latestServerUserItem?.type === "user_message" &&
      latestServerUserItem.text.trim().toLowerCase() === "/compact" &&
      latestServerUserItem.attachments.length === 0 &&
      latestServerUserItem.runId === activeActivityRun?.runId &&
      !isLatestRunSettled(activeActivityRun, activeRuntime));
  const compactionSettled = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId === activeActivityRun?.runId &&
      (item.status === "completed" ||
        item.status === "failed" ||
        item.status === "interrupted" ||
        item.status === "cancelled"),
  );
  const compactionRunning = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId !== null &&
      item.runId === activeRuntime?.activeRunId &&
      item.status === "running",
  );
  const isCompacting =
    (isSendBusy || phase === "connecting" || phase === "running") &&
    (compactionRunning || (compactRequestIsActive && !compactionSettled));
  const isWorking =
    phase === "running" ||
    isSendBusy ||
    isConnecting ||
    isCompacting ||
    runlessWorkStartedAt !== null;
  const activeContextWindow = deriveLatestContextWindowSnapshot(
    serverVisibleTurnItems ?? [],
    activeThreadLiveTokenUsage,
    activeProviderThread,
  );
  const pendingBackgroundTasks = deriveThreadPendingBackgroundTasks(serverProjection);
  const activeWorkStartedAt =
    deriveActiveWorkStartedAt(activeActivityRun, activeRuntime, localDispatchStartedAt) ??
    runlessWorkStartedAt;
  const activeRunPreparing = activeActivityRun?.status === "preparing";
  // The server queues a message behind a run that is still preparing its
  // worktree or starting its agent, so a send during setup waits there and
  // starts on its own instead of being refused. Before the server has the
  // thread, a send waits in the outbox behind the pending task creating it.
  const sendQueuesBehindSetup = isServerThread
    ? activeRunPreparing || activeActivityRun?.status === "starting"
    : pendingThreadCreation !== null;
  const downloadFileAttachment = async (attachment: ChatFileAttachment) => {
    const connection = readPreparedConnection(environmentId);
    if (!connection) {
      toastManager.add({ type: "error", title: "The environment is not connected." });
      return;
    }

    try {
      const url = await resolveFileAttachmentUrl({
        attachment,
        environmentId,
        httpBaseUrl: connection.httpBaseUrl,
        createAssetUrl: createAttachmentAssetUrl,
      });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name;
      anchor.click();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not download " + attachment.name,
        description: error instanceof Error ? error.message : "The attachment is unavailable.",
      });
    }
  };
  const downloadFileAttachmentStable = useStableCallback(downloadFileAttachment);
  const openFileAttachment = (attachment: ChatFileAttachment) => {
    if (activeThreadRef) {
      useRightPanelStore.getState().openAttachment(activeThreadRef, attachment);
      return;
    }
  };
  const openFileAttachmentStable = useStableCallback(openFileAttachment);
  const { handoffAttachmentPreviewsStable, timelineAttachmentUrlById } =
    useAttachmentPreviewHandoff({ environmentId, serverVisibleTurnItems, optimisticUserMessages });
  const anchoredTimelineMessages = feedbackSubmissions.flatMap((submission) =>
    submission.status === "interrupted"
      ? []
      : [
          { ...codexFeedbackMessage(submission), runId: null },
          { ...codexFeedbackMessage(submission, "assistant"), runId: null },
        ],
  );
  const [projectTimelineEntries] = useState(createTimelineEntriesProjector);
  const serverTimelineEntries = projectTimelineEntries(
    {
      visibleTurnItems: serverVisibleTurnItems,
      optimisticMessages: optimisticUserMessages,
      anchoredMessages: [...pendingCreationMessages, ...anchoredTimelineMessages],
      attachmentUrlById: timelineAttachmentUrlById,
      ...(serverProjection === null
        ? {}
        : {
            attempts: serverProjection.attempts,
            nodes: serverProjection.nodes,
            plans: serverProjection.plans,
          }),
    },
    activeThreadKey,
  );
  const draftTimelineEntries = [...pendingCreationMessages, ...optimisticUserMessages].map(
    (message) =>
      ({
        id: message.id,
        kind: "message",
        createdAt: message.createdAt,
        message,
      }) as const,
  );
  const timelineEntries = isServerThread ? serverTimelineEntries : draftTimelineEntries;
  const timelineMessages = timelineEntries.flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : [],
  );
  const displayedTimeline = resolveThreadSwitchTimeline({
    loading: timelineEntries.length === 0 && threadSyncPhase !== null,
    activeThreadKey,
    nextEntries: timelineEntries,
    rememberedForActive: peekRememberedThreadTimeline<typeof timelineEntries>(activeThreadKey),
    scope: paneScope?.paneId,
  });
  const displayedTimelineKey = displayedTimeline.displayThreadKey ?? routeThreadKey;
  const paintOnlyDisplayedTimeline = isPaintOnlyThreadTimeline(
    displayedTimeline.displayThreadKey,
    activeThreadKey,
  );
  const displayedThreadRef = parseScopedThreadKey(displayedTimelineKey);
  const {
    worktreeSetup,
    isPreparingWorktree,
    blocksSend: worktreeSetupBlocksSend,
    retryableRunIds: retryableWorkspacePreparationRunIds,
    begin: beginWorktreeSetup,
    cancel: cancelWorktreeSetup,
    retryPreparation: onRetryWorkspacePreparationStable,
    openSetupTerminal: onOpenWorktreeSetupTerminal,
  } = useWorktreeSetup({
    routeThreadRef,
    ownerKey: draftId ?? routeThreadKey,
    activeThread,
    threadRef: activeThreadRef,
    serverProjection,
    activityRun: activeActivityRun,
    localPreparing: isLocallyPreparingWorktree,
    sendQueuesBehindSetup,
    followUpSent: timelineMessages.filter((message) => message.role === "user").length > 1,
  });
  const onCancelWorktreeSetupStable = useStableCallback(() => void cancelWorktreeSetup());
  const [dockedDraftHeroThreadKey, setDockedDraftHeroThreadKey] = useState<string | null>(null);
  if (isLocalDraftThread && !draftThread?.promotedTo && dockedDraftHeroThreadKey !== null) {
    setDockedDraftHeroThreadKey(null);
  }
  const draftHeroDockRequested =
    activeThreadKey !== null && dockedDraftHeroThreadKey === activeThreadKey;
  const isDraftHeroState = resolveDraftHeroState({
    isLocalDraftThread,
    hasTimelineEntries: timelineEntries.length > 0,
    isWorking,
    draftHeroDockRequested,
    backgroundSubmissionPending,
    hasWorktreeSetupCard: worktreeSetup !== null,
  });
  const {
    transitionGroupRef: draftHeroTransitionGroupRef,
    composerAnchorRef: draftHeroComposerAnchorRef,
    captureLayout: captureDraftHeroLayout,
  } = useDraftHeroLayoutTransition(
    isDraftHeroState,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const turnDiffSummaries = useThreadCheckpointSummaries(routeThreadDetailRef);
  const availableRevertTurnCounts = deriveAvailableRevertTurnCounts(serverProjection);
  // A paged history window cannot identify the first loaded run as the thread start.
  const threadStartCheckpointReady =
    !serverThreadHistory.hasMoreHistory &&
    findRevertCheckpoint(serverProjection?.checkpoints ?? [], 0) !== undefined;

  const workspaceMutationId = deriveWorkspaceMutationId(
    serverVisibleTurnItems,
    turnDiffSummaries.at(-1)?.completedAt ?? null,
  );

  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.workspaceRoot },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitStatusCwd = activeThread?.worktreePath ?? gitCwd;
  const gitStatusQuery = useEnvironmentQuery(
    gitStatusCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: gitStatusCwd },
        }),
  );
  useWorkspaceMutationRefresh({
    enabled: gitStatusCwd !== null,
    mutationId: workspaceMutationId,
    refresh: gitStatusQuery.refresh,
    resourceKey: `git-status:${activeThreadKey ?? ""}:${gitStatusCwd ?? ""}`,
  });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const scriptKeybindings =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.keybindings ??
    DEFAULT_RESOLVED_KEYBINDINGS;
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const remoteOpenState = useRemoteOpenState(activeThread?.environmentId ?? environmentId);
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName: activeProject?.title,
    activeThreadEnvironmentId: activeThread?.environmentId ?? environmentId,
    primaryEnvironmentId,
    remoteOpenMode: remoteOpenState.mode,
  });
  useOpenFavoriteEditorShortcut({
    enabled: showOpenInPicker,
    environmentId: activeThread?.environmentId ?? environmentId,
    keybindings,
    availableEditors,
    openInCwd: gitCwd,
  });
  const manualCompactionProviderAvailable = hasAvailableCompactionProvider({
    providers: providerInstanceEntries,
    driverKind: selectedProvider,
    instanceId: activeProviderInstanceId,
    lockedInstanceId: lockedProvider
      ? (activeRuntime?.providerInstanceId ?? activeThread?.modelSelection.instanceId ?? null)
      : null,
  });
  const providerStatusBannerKey = getProviderStatusBannerKey(activeProviderStatus);
  const [dismissedProviderStatusBannerKey, setDismissedProviderStatusBannerKey] = useState<
    string | null
  >(null);
  if (providerStatusBannerKey === null && dismissedProviderStatusBannerKey !== null) {
    setDismissedProviderStatusBannerKey(null);
  }
  const visibleProviderStatus = shouldShowProviderStatusBanner(
    activeProviderStatus,
    dismissedProviderStatusBannerKey,
  )
    ? activeProviderStatus
    : null;
  const hasTimelineTopBanner = Boolean(timelineThreadError) || visibleProviderStatus !== null;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  useLayoutEffect(() => {
    if (
      threadDetailLoading ||
      timelineEntries.length === 0 ||
      timelineHasEphemeralPreviewUrls(timelineEntries)
    ) {
      return;
    }
    rememberReadyThreadTimeline(
      {
        threadKey: activeThreadKey,
        entries: timelineEntries,
        markdownCwd: gitCwd,
        workspaceRoot: activeWorkspaceRoot ?? null,
      },
      paneScope?.paneId,
    );
  }, [
    activeThreadKey,
    activeWorkspaceRoot,
    gitCwd,
    paneScope?.paneId,
    threadDetailLoading,
    timelineEntries,
  ]);
  const heldPaintContext = paintOnlyDisplayedTimeline
    ? peekHeldThreadTimeline<typeof timelineEntries>(paneScope?.paneId)
    : null;
  const activeTerminalLaunchContext =
    terminalUiLaunchContext?.threadId === activeThreadId ? terminalUiLaunchContext : null;
  const liveIsGitRepo = gitStatusQuery.data?.isRepo;
  useEffect(() => {
    if (gitStatusCwd !== null && liveIsGitRepo !== undefined) {
      rememberCheckoutIsRepo(environmentId, gitStatusCwd, liveIsGitRepo);
    }
  }, [environmentId, gitStatusCwd, liveIsGitRepo]);
  const isGitRepo = liveIsGitRepo ?? recallCheckoutIsRepo(environmentId, gitStatusCwd) ?? true;
  // A provider-native subagent cannot take messages: a status bar replaces the
  // composer and its strips. Its approvals and questions are asked on the
  // top-level parent thread.
  const showProviderSubagentBar = isProviderSubagent;
  const composerMounted = !showProviderSubagentBar;
  const providerSubagentModels = selectedProviderEntry?.models ?? EMPTY_PROVIDER_MODELS;
  // Providers can report a dated id or alias (claude-haiku-4-5-20251001).
  const providerSubagentModelSlug = selectedProviderEntry
    ? resolveSelectableModel(
        selectedProviderEntry.driverKind,
        activeThread?.modelSelection.model,
        providerSubagentModels,
      )
    : null;
  const providerSubagentCatalogModel = providerSubagentModels.find(
    (model) => model.slug === providerSubagentModelSlug,
  );
  const providerSubagentModelLabel = providerSubagentCatalogModel
    ? getTriggerDisplayModelName(providerSubagentCatalogModel)
    : formatModelSlugName(activeThread?.modelSelection.model ?? "");
  const providerSubagentEffortLabel =
    activeThread === undefined
      ? null
      : formatModelSelectionEffort(
          activeThread.modelSelection,
          providerSubagentModels,
          reportedModelSelection,
        );
  const showDraftProjectPicker = isDraftHeroState && !showProviderSubagentBar;
  const composerContextStripPlacement = showDraftProjectPicker ? "top" : "bottom";
  const composerContextStripInput = {
    showProjectPicker: showDraftProjectPicker,
    persistInActiveThreads: settings.persistComposerContextStrip,
    hasActiveProject: activeProject !== null && !showProviderSubagentBar,
  };
  const mountComposerContextStrip = shouldShowComposerContextStrip({
    ...composerContextStripInput,
    hostsRestingComposerControls: routeKind === "server",
  });
  const mountComposerModelStrip =
    routeKind === "server" && !mountComposerContextStrip && !showProviderSubagentBar;
  const composerUsageWindows = headlineUsageWindows(activeProviderStatus);
  const composerUsageMeterSlot = resolveComposerUsageMeterSlot({
    hasUsageWindows: composerUsageWindows.length > 0,
    isMobileViewport,
    isDraftHero: isDraftHeroState,
    contextStripMounted: mountComposerContextStrip,
  });
  // A resting composer is a bare input, so the meter's strips close with it.
  const showComposerContextStrip =
    shouldShowComposerContextStrip({
      ...composerContextStripInput,
      hostsRestingComposerControls: routeKind === "server" && restingComposerControlsVisible,
    }) ||
    (composerUsageMeterSlot === "context-strip" && !composerResting);
  const showComposerModelStrip = mountComposerModelStrip && restingComposerControlsVisible;
  const composerUsageMeter = <ComposerUsageMeter windows={composerUsageWindows} />;
  const terminalShortcutLabelOptions = {
    context: {
      terminalFocus: true,
      terminalOpen: Boolean(terminalUiState.terminalOpen),
    },
  };
  const splitTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.split",
    terminalShortcutLabelOptions,
  );
  const splitTerminalVerticalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.splitVertical",
    terminalShortcutLabelOptions,
  );
  const newTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.new",
    terminalShortcutLabelOptions,
  );
  const closeTerminalShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "terminal.close",
    terminalShortcutLabelOptions,
  );

  const {
    needsLoadBalancing,
    loadBalancing,
    onAutoEnvironmentStable,
    autoEnvironmentLabel,
    isEnvironmentChanging,
    readPendingEnvironmentChange,
    onEnvironmentChangeStable,
  } = useDraftEnvironmentRouting({
    draftId: draftId ?? null,
    draftThread,
    envLocked,
    automaticEnvironment,
    logicalProjectEnvironments,
    environmentById,
    providersByEnvironment,
    loadBalancingSettings,
    referencedThreadContexts,
    activeProviderInstanceId,
    selectedProvider,
    composerHasAttachments,
    activeProjectKey,
    activeProjectIsScratch,
    projectGroupingSettings,
    sendInFlightRef,
  });

  // Focus moving into a pane makes it the focused pane, so a pane in the background never takes it.
  const focusComposer = () => {
    if (!isPaneInputOwner()) return;
    composerRef.current?.focusAtEnd();
  };
  const focusComposerStable = useStableCallback(focusComposer);
  const canInterruptRunningThread =
    canOperateThread && deriveCanInterruptRunningThread(activeThread !== undefined, activeRuntime);
  const onInterrupt = async () => {
    if (
      !activeThread ||
      !readEnvironmentScope(activeThread.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const result = await interruptThreadTurn({
      environmentId,
      input: { threadId: activeThread.id },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : "Failed to interrupt the current turn.",
      );
    }
  };
  const onInterruptStable = useStableCallback(onInterrupt);
  useEffect(() => subscribeSnapShotComposerFocus(focusComposerStable), [focusComposerStable]);
  const scheduleComposerFocus = () => {
    window.requestAnimationFrame(() => {
      focusComposerStable();
    });
  };
  const scheduleComposerFocusStable = useStableCallback(scheduleComposerFocus);
  const insertArtifactTemplate = (template: CodexArtifactTemplate) => {
    const composer = composerRef.current;
    if (!composer) return;

    const currentDraft = composer.getSendContext().prompt;
    const prompt = codexArtifactTemplatePromptToAppend(currentDraft, template);
    if (prompt !== null && !composer.insertTextAtEnd(prompt, { ensureLeadingBoundary: true })) {
      toastManager.add({
        type: "error",
        title: "Unable to add to chat",
        description: "The composer is busy; try again once it is ready.",
      });
      return;
    }
    scheduleComposerFocus();
  };
  const insertArtifactTemplateStable = useStableCallback(insertArtifactTemplate);

  const sendAppMessage = async (text: string) => {
    if (!isServerThread || activeThreadId === null) {
      throw new Error("Messages from apps need a started thread.");
    }
    await enqueueThreadOutboxTurns([
      {
        environmentId,
        input: {
          threadId: activeThreadId,
          message: { messageId: newMessageId(), role: "user", text, attachments: [] },
          runtimeMode,
          interactionMode,
          dispatchMode: "queue",
          createdAt: new Date().toISOString(),
        },
      },
    ]);
  };
  const sendAppMessageStable = useStableCallback(sendAppMessage);
  const queuedRunsControlRef = useRef<QueuedRunsControlHandle>(null);
  const threadOutboxControlRef = useRef<ThreadOutboxControlHandle>(null);
  // Outbox messages have not reached the server yet, so they are newer than any queued run.
  const editLatestQueuedMessage = (repeat: boolean) =>
    !queuedRunEdit.isEditing &&
    !queuedRunEdit.outbox.isEditing &&
    (threadOutboxControlRef.current?.editLatest(repeat) === true ||
      (routeKind !== "draft" && queuedRunsControlRef.current?.editLatest(repeat) === true));
  const editLatestQueuedMessageStable = useStableCallback(editLatestQueuedMessage);
  const cancelQueuedMessageEdit = () =>
    queuedRunEdit.outbox.isEditing ? queuedRunEdit.outbox.cancelEdit() : queuedRunEdit.cancelEdit();
  const cancelQueuedMessageEditStable = useStableCallback(cancelQueuedMessageEdit);

  const {
    shortcuts: terminalShortcuts,
    activatePanelTerminalStable,
    addTerminalContextToDraftStable,
    addTerminalSurfaceStable,
    closePanelTerminalStable,
    lastInvokedScriptByProjectId,
    runProjectScriptStable,
    runShellCommandStable,
    splitPanelTerminalStable,
    splitPanelTerminalVerticalStable,
    toggleTerminalVisibilityStable,
  } = useChatTerminalActions({
    environmentId,
    composerRef,
    terminalUiState,
    activeThread,
    activeThreadId,
    activeThreadRef,
    activeProject,
    activeRightPanelSurface,
    runningTerminalIds,
    activeServerOrderedTerminalIds,
    activeTerminalLabelsById,
    activeTerminalHasRunningSubprocessById,
    panelTerminalIds,
    canReuseTerminal,
    gitCwd,
    setTerminalFocusRequestId,
    setTerminalUiLaunchContext,
    setThreadError,
  });

  const {
    saveProjectScript: saveProjectScriptStable,
    updateProjectScript: updateProjectScriptStable,
    deleteProjectScript: deleteProjectScriptStable,
  } = useProjectScriptEditing({
    environmentId,
    project: activeProject,
    scripts: activeProjectScripts,
    settings,
  });

  const {
    getModelDisabledReason,
    handleRuntimeModeChangeStable,
    onEnvModeChangeStable,
    onProviderModelSelectStable,
    onStartFromOriginChange,
    openProviderSetupStable,
  } = useComposerSelection({
    environmentId,
    composerDraftTarget,
    draftThread,
    activeThread,
    activeRuntime,
    activeProjectSettings,
    settings,
    providerStatuses,
    lockedProvider,
    supportsProviderSwitchingViaHandoff,
    multipleModelSelections,
    runtimeMode,
    isLocalDraftThread,
    scheduleComposerFocus,
  });
  const canOperatePreview = useEnvironmentScope(
    activeThreadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  const visiblePullRequests = visibleThreadPullRequests(
    (activeThreadShell ?? activeThread)?.pullRequests ?? [],
  );
  const visiblePullRequestCount = visiblePullRequests.length;
  const pullRequestsSurfaceAvailable = isServerThread && visiblePullRequestCount > 0;
  const { state: deviceState, loaded: deviceStateLoaded } = useDeviceState(
    activeThreadRef?.environmentId ?? null,
  );
  useAgentOpenedPreviews({
    threadRef: activeThreadRef,
    deviceState,
    deviceStateLoaded,
    previewState: activePreviewState,
    serverBrowserAvailable: activeEnvironmentServerBrowser,
    panelSurfaces: rightPanelState.surfaces,
    miniPlayerSource: activePreviewMiniPlayer?.source ?? null,
    sheetLayout: shouldUsePlanSidebarSheet,
  });
  const activeProjectRepository = sourceControlRepositorySelector(
    activeProject?.repositoryIdentity,
  );
  const {
    linked: linkedThreadPullRequest,
    linkedKey: linkedThreadPullRequestKey,
    hasDetail: hasLinkedPullRequestDetail,
  } = useThreadLinkedPullRequest({
    serverThreadRef: isServerThread ? activeThreadRef : null,
    environmentId: activeThreadRef?.environmentId ?? null,
    persisted: isServerThread
      ? (activeThreadShell?.linkedPullRequest ?? activeThread?.linkedPullRequest ?? null)
      : (activeThread?.linkedPullRequest ?? null),
    pullRequests: activeThreadShell?.pullRequests,
    branchPullRequest: activeThreadShell?.branchPullRequest,
    projectId: activeProject?.id ?? null,
    projectRepository: activeProjectRepository,
    threadBranch: activeThread?.branch ?? null,
    gitStatus: gitStatusQuery.data ?? null,
  });
  const proactivePullRequestsKey = pullRequestsSurfaceAvailable
    ? JSON.stringify(
        visiblePullRequests.map((link) => [link.host, link.repository, link.number]).sort(),
      )
    : linkedThreadPullRequestKey;
  const activeRunningTurnId = activeRuntime?.activeRunId ?? null;
  useProactivePanels({
    threadRef: isServerThread ? activeThreadRef : null,
    enabled: settings.proactivePanelsEnabled && !shouldUsePlanSidebarSheet,
    settingsHydrated: clientSettingsHydrated,
    threadDetailLoading,
    runningTurnId: activeRunningTurnId,
    latestRun: activeLatestRun,
    latestRunSettled,
    turnDiffSummaries,
    isGitRepo: gitStatusQuery.data?.isRepo,
    linkedPullRequest: linkedThreadPullRequest,
    hasLinkedPullRequestDetail,
    pullRequestsKey: proactivePullRequestsKey,
    pullRequestsCapabilityKnown,
    supportsPullRequests,
    pullRequestsSurfaceAvailable,
    visiblePullRequestCount,
    onDiffPanelOpen,
  });
  useEffect(() => {
    if (!canMaximizeRightPanel || !activeThreadRef) return;
    if (useRightPanelStore.getState().consumeMaximizeRequest(activeThreadRef))
      useRightPanelStore.getState().setMaximized(activeThreadRef, true);
  }, [canMaximizeRightPanel, activeThreadRef]);
  const {
    closeSurface: closeRightPanelSurfaceStable,
    closeOtherSurfaces: closeOtherRightPanelSurfacesStable,
    closeSurfacesToRight: closeRightPanelSurfacesToRightStable,
    closeAllSurfaces: closeAllRightPanelSurfacesStable,
    closeSurfacesNow: closeRightPanelSurfacesNow,
  } = useRightPanelSurfaceClose({
    threadRef: activeThreadRef,
    terminalLabelsById: activeTerminalLabelsById,
    terminalHasRunningSubprocessById: activeTerminalHasRunningSubprocessById,
  });
  const closeRightPanelSurfaceNow = useStableCallback((surface: RightPanelSurface) =>
    closeRightPanelSurfacesNow([surface]),
  );
  const persistThreadSettingsForNextTurn = async (input: {
    threadId: ThreadId;
    createdAt: string;
    branch?: string;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }): Promise<AtomCommandResult<void, unknown>> => {
    if (!serverThread) {
      return AsyncResult.success(undefined);
    }

    let result: AtomCommandResult<void, unknown> = AsyncResult.success(undefined);
    const metadataUpdate = resolveThreadMetadataUpdateForNextTurn({
      currentModelSelection: serverThread.modelSelection,
      currentBranch: serverThread.branch,
      ...(input.branch ? { nextBranch: input.branch } : {}),
    });
    if (metadataUpdate) {
      result = mapAtomCommandResult(
        await updateThreadMetadata({
          environmentId,
          input: {
            threadId: input.threadId,
            ...metadataUpdate,
          },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        return result;
      }
    }

    if (input.runtimeMode !== serverThread.runtimeMode) {
      result = mapAtomCommandResult(
        await setThreadRuntimeMode({
          environmentId,
          input: {
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            createdAt: input.createdAt,
          },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        return result;
      }
    }

    if (input.interactionMode !== serverThread.interactionMode) {
      result = mapAtomCommandResult(
        await setThreadInteractionMode({
          environmentId,
          input: {
            threadId: input.threadId,
            interactionMode: input.interactionMode,
            createdAt: input.createdAt,
          },
        }),
        () => undefined,
      );
    }
    return result;
  };

  const {
    shortcuts: timelineFollowShortcuts,
    showScrollToBottom,
    timelineLiveFollowEnabled,
    cancelPositionRestoreRef,
    isTimelineAtLogicalEndStable,
    cancelTimelineLiveFollowForUserNavigationStable,
    onComposerPageScrollKeyDownStable,
    onComposerPageScrollKeyUpStable,
    onComposerPageScrollReleaseStable,
    scrollToEnd,
    onTimelineAnchorReadyStable,
    onTimelineAnchorSizeChangedStable,
    onToolOutputCollapsedAtEndStable,
    onIsAtEndChangeStable,
    anchorNewTurn,
  } = useTimelineFollow({
    legendListRef,
    composerRef,
    composerOverlayElement,
    composerTimelineInset,
    routeThreadKey,
    activeThreadKey,
    activeThreadId: activeThread?.id,
    isServerThread,
    serverProjection,
    threadStatus,
    activeActivityRun,
    activeRunningTurnId,
    timelineEntries,
    timelineAnchorMessageId,
    setTimelineAnchor,
  });

  useEffect(() => {
    if (!activeThread?.id || terminalUiState.terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposerStable();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposerStable, terminalUiState.terminalOpen]);

  useEffect(() => {
    if (!activeThread?.id || terminalUiState.terminalOpen || isMobileViewport) return;
    let frame: number | null = null;
    const onWindowFocus = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      // The element that held focus receives it again after the window's own event, and the
      // composer ignores that same frame so a restored focus does not lift a scroll-collapsed
      // composer. Wait one more frame so this focus counts as a request to expand it.
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          frame = null;

          if (document.querySelector("[data-mcp-app-fullscreen]") !== null) return;
          if (!isPaneInputOwner()) return;
          if (shouldRefocusComposerOnWindowFocus(document.activeElement)) focusComposerStable();
        });
      });
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [
    activeThread?.id,
    focusComposerStable,
    isMobileViewport,
    isPaneInputOwner,
    terminalUiState.terminalOpen,
  ]);

  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeMessageCount === 0) {
      return;
    }
    const removedMessages = optimisticUserMessages.filter((message) =>
      serverAcknowledgedUserMessageIds.has(message.id),
    );
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverAcknowledgedUserMessageIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviewsStable(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeMessageCount,
    activeThread?.id,
    serverAcknowledgedUserMessageIds,
    handoffAttachmentPreviewsStable,
    optimisticUserMessages,
  ]);

  // Keyed on the thread, not the draft: a draft's promotion to its server
  // route keeps this instance and drops `draftId`, and the send it is still
  // dispatching must survive that swap.
  const [optimisticUserMessagesThreadId, setOptimisticUserMessagesThreadId] = useState(threadId);
  if (optimisticUserMessagesThreadId !== threadId) {
    setOptimisticUserMessagesThreadId(threadId);
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    resetLocalDispatch();
  }

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const envMode: DraftThreadEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread: isServerThread,
    draftThreadEnvMode: isLocalDraftThread ? draftThread?.envMode : undefined,
    preparingWorktree: isPreparingWorktree,
  });
  const selectedThreadBranch = activeThread?.branch ?? null;
  const startFromOrigin = isLocalDraftThread && (draftThread?.startFromOrigin ?? false);
  const sendEnvMode = resolveSendEnvMode({
    requestedEnvMode: envMode,
    isGitRepo,
  });
  const isSelectingWorktreeBase =
    !activeWorktreePath && (sendEnvMode === "worktree" || multipleModelSelections !== null);
  // Keep the default lookup unfiltered: searching the picker must not change
  // the base branch submitted by an otherwise untouched draft.
  const worktreeBaseRefs = usePaginatedBranches({
    environmentId,
    cwd: isSelectingWorktreeBase && !selectedThreadBranch ? gitStatusCwd : null,
  });
  const worktreeBaseRefsLoading =
    worktreeBaseRefs.isRefreshing ||
    (worktreeBaseRefs.data === null && worktreeBaseRefs.error === null);
  const activeThreadBranch = isSelectingWorktreeBase
    ? resolveWorktreeBaseBranch({
        selectedBranch: selectedThreadBranch,
        refs: worktreeBaseRefs.refs,
        refsLoading: worktreeBaseRefsLoading,
        currentGitBranch: gitStatusQuery.data?.refName ?? null,
      })
    : selectedThreadBranch;
  const worktreeBaseRefsSettled = worktreeBaseRefs.data !== null && !worktreeBaseRefs.isRefreshing;
  const localCheckoutBranchMismatch = isServerThread
    ? resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: envMode,
        activeWorktreePath,
        activeThreadBranch,
        currentGitBranch: gitStatusQuery.data?.refName ?? null,
      })
    : null;
  const publishComposerOverlayHeight = (height: number) => {
    const nextHeight = Math.ceil(height);
    if (nextHeight <= 0) return;
    const isResting = overlayComposerIsResting({
      composerMounted: composerMountedRef.current,
      composerReportedResting: composerRestingRef.current,
    });
    const modelStrip = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-composer-model-strip="true"]',
    );
    const restingOnlyHeight =
      modelStrip && isResting
        ? Math.max(
            0,
            modelStrip.offsetHeight + Number.parseFloat(getComputedStyle(modelStrip).marginTop),
          )
        : 0;
    const noticeStack = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-composer-banner-stack="true"]',
    );
    const expandedNoticesHeight = noticeStack
      ? Math.max(
          0,
          noticeStack.getBoundingClientRect().height -
            Number.parseFloat(getComputedStyle(noticeStack).minHeight),
        )
      : 0;
    const nextInset = resolveComposerTimelineInset({
      currentInset: composerTimelineInsetRef.current,
      overlayHeight: height,
      isResting,
      restingOnlyHeight,
      expandedNoticesHeight,
    });
    if (composerTimelineInsetRef.current !== nextInset) {
      composerTimelineInsetRef.current = nextInset;
      setComposerTimelineInset(nextInset);
    }
    // The terminal drawer and the empty placeholder lay out against the
    // expanded composer. The timeline inset already holds it through the
    // desktop resting row; remembering it while the mobile strip is collapsed
    // keeps both still when focus moves between the composer and the
    // terminal, instead of re-clamping the drawer against each intermediate
    // composer height. A collapsed strip can still grow (approvals, tasks), so
    // the reservation follows it up. A hero composer's overlay fills the pane,
    // so only its stack counts there.
    const stack = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-chat-composer-stack="true"]',
    );
    const expandedComposerHeight =
      isDraftHeroState && stack ? Math.ceil(stack.getBoundingClientRect().height) : nextInset;
    const mobileCollapsed = Boolean(
      stack?.querySelector('[data-chat-composer-mobile-collapsed="true"]'),
    );
    if (!mobileCollapsed) composerExpandedHeightRef.current = expandedComposerHeight;
    const reservedHeight = Math.max(composerExpandedHeightRef.current, expandedComposerHeight);
    if (composerReservedHeightRef.current !== reservedHeight) {
      composerReservedHeightRef.current = reservedHeight;
      setComposerReservedHeight(reservedHeight);
    }
    const mainSurface = composerOverlayElement?.querySelector<HTMLElement>(
      '[data-chat-composer-main-surface="true"]',
    );
    const button = composerOverlayElement?.parentElement?.querySelector<HTMLElement>(
      'button[aria-label="Scroll to end"]',
    );
    const clearance =
      composerOverlayElement && mainSurface && button
        ? resolveScrollToEndClearance({
            overlayHeight: nextHeight,
            mainSurfaceTop: mainSurface.getBoundingClientRect().top,
            button: button.getBoundingClientRect(),
            // A resting composer keeps its docked banners mounted but hidden.
            attachments: Array.from(
              composerOverlayElement.querySelectorAll<HTMLElement>(
                '[data-composer-banner-surface="attached"]',
              ),
            )
              .filter((element) => element.getClientRects().length > 0)
              .map((element) => element.getBoundingClientRect()),
          })
        : nextHeight;
    setScrollToEndClearance(clearance);
  };
  const publishComposerOverlayHeightStable = useStableCallback(publishComposerOverlayHeight);
  // The composer reports its resting flag from a layout effect, which runs
  // before this component's own layout effects and before any resize
  // observation, so every measurement below sees the flag for its layout.
  const onComposerRestingChange = (resting: boolean) => {
    composerRestingRef.current = resting;
    setComposerResting(resting);
  };
  const onComposerRestingChangeStable = useStableCallback(onComposerRestingChange);
  const composerTimelineInsetOwnerRef = useRef<{
    readonly threadKey: string | null;
    readonly overlay: HTMLDivElement;
  } | null>(null);
  useLayoutEffect(() => {
    if (!composerOverlayElement) return;
    const owner = composerTimelineInsetOwnerRef.current;
    if (owner?.threadKey === activeThreadKey && owner.overlay === composerOverlayElement) return;
    composerTimelineInsetOwnerRef.current = {
      threadKey: activeThreadKey,
      overlay: composerOverlayElement,
    };
    composerTimelineInsetRef.current = 0;
    composerReservedHeightRef.current = 0;
    composerExpandedHeightRef.current = 0;
    publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
  }, [activeThreadKey, composerOverlayElement, publishComposerOverlayHeightStable]);

  useLayoutEffect(() => {
    if (!composerOverlayElement) return;

    // A drawer or tray easing its height resizes the overlay every frame. Publishing only the
    // landed height keeps ChatView and the timeline to one render per resize; meanwhile a
    // growing composer briefly overlaps the timeline end and a shrinking one leaves a gap.
    let settling = false;
    let disposed = false;
    const updateHeight = () => {
      if (settling || disposed) return;
      if (isAnimatingSize(composerOverlayElement)) {
        settling = true;
        void animationsSettled(composerOverlayElement, { subtree: true }).then(() => {
          settling = false;
          updateHeight();
        });
        return;
      }
      publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
    };

    updateHeight();
    // The hero overlay fills the pane, so the composer's own growth only shows on its stack.
    const stack = isDraftHeroState
      ? composerOverlayElement.querySelector<HTMLElement>('[data-chat-composer-stack="true"]')
      : null;
    const stopObserving = observeResize(
      stack ? [composerOverlayElement, stack] : composerOverlayElement,
      updateHeight,
    );
    return () => {
      disposed = true;
      stopObserving();
    };
  }, [composerOverlayElement, isDraftHeroState, publishComposerOverlayHeightStable]);
  const measuredScrollToEndVisibleRef = useRef(showScrollToBottom);
  useLayoutEffect(() => {
    if (!composerOverlayElement || measuredScrollToEndVisibleRef.current === showScrollToBottom) {
      return;
    }
    measuredScrollToEndVisibleRef.current = showScrollToBottom;
    publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
  }, [composerOverlayElement, publishComposerOverlayHeightStable, showScrollToBottom]);
  useLayoutEffect(() => {
    if (composerMountedRef.current === composerMounted) return;
    composerMountedRef.current = composerMounted;
    if (!composerOverlayElement) return;
    composerTimelineInsetRef.current = 0;
    composerReservedHeightRef.current = 0;
    composerExpandedHeightRef.current = 0;
    publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
  }, [composerMounted, composerOverlayElement, publishComposerOverlayHeightStable]);
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(activeThreadRef);
  const activeThreadReferenceCopyTarget =
    activeThreadId === null || !isServerThread
      ? null
      : resolveThreadReferenceCopyTarget({
          threadId: activeThreadId,
          openPanelPullRequestUrl,
          pullRequests: activeThread?.pullRequests,
          linkedPullRequestUrl: linkedThreadPullRequest?.url ?? null,
        });
  const copyActiveThreadReference = () => {
    const target = activeThreadReferenceCopyTarget;
    if (target === null) return;
    void writeTextToClipboard(target.value, target.clipboardTarget).then(
      (didCopy) => {
        if (!didCopy) return;
        toastManager.add({
          type: "success",
          title: target.successTitle,
          description: target.value,
        });
      },
      (error) => {
        console.error(error);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: target.failureTitle,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  };
  const copyActiveThreadReferenceStable = useStableCallback(copyActiveThreadReference);
  const pullRequestPanelTarget = activeThread
    ? threadPullRequestPanelTarget({
        projectId: activeThread.projectId,
        pullRequests: visiblePullRequests,
        linkedPullRequest: linkedThreadPullRequest,
        branchPullRequest: activeThreadShell?.branchPullRequest ?? activeThread.branchPullRequest,
      })
    : null;
  const {
    shortcuts: rightPanelShortcuts,
    activateRightPanelSurfaceStable,
    addDeviceSurfaceStable,
    addDiffSurfaceStable,
    addFilesSurfaceStable,
    addPullRequestSurfaceStable,
    addPullRequestsSurfaceStable,
    closePreviewPanelStable,
    copyRightPanelFilePathStable,
    createBrowserSurface,
    createBrowserSurfaceStable,
    moveRightPanelSurfaceStable,
    onOpenTurnDiffStable,
    openChangesFromThreadPanelStable,
    openFileSurfaceStable,
    toggleRightPanelMaximizedStable,
    toggleRightPanelStable,
    toggleThreadPanelStable,
  } = useRightPanelActions({
    routeKind,
    activeThreadRef,
    activeProject,
    activeRightPanelSurface,
    activePreviewState,
    deviceState,
    pullRequestPanelTarget,
    threadPanelPresentation,
    isServerThread,
    isGitRepo,
    browserAvailable,
    canOperatePreview,
    diffOpen,
    previewPanelOpen,
    rightPanelOpen,
    canMaximizeRightPanel,
    rightPanelMaximized,
    supportsPullRequests,
    pullRequestsSurfaceAvailable,
    gitCwd,
    activeProjectCwd,
    explicitDiffOpenRef,
    setTerminalFocusRequestId,
    onDiffPanelOpen,
    closeRightPanelSurface: closeRightPanelSurfaceStable,
  });
  const pullRequestSurfaceAvailable = supportsPullRequests && pullRequestPanelTarget !== null;
  const {
    shortcuts: threadLifecycleShortcuts,
    activeBranchMismatchKey,
    backgroundWorkBanner,
    childInputBanner,
    goalBanner,
    handleSwitchCheckoutToThreadStable,
    isRestoringThreadBranch,
    onOpenRelatedThread,
    onOpenRelatedThreadStable,
    sendStandaloneCommand,
    setBranchMismatchDismissTick,
    showBranchMismatchBanner,
    threadStatusLine,
  } = useThreadLifecycle({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    canOperateThread,
    clientSettingsHydrated,
    activeThread,
    activeThreadId,
    activeThreadRef,
    activeThreadKey,
    activeThreadShell,
    isServerThread,
    activeLatestRun,
    activeProjectCwd,
    serverConfig,
    serverProjection,
    runtimeMode,
    isWorking,
    pendingBackgroundTasks,
    activePendingApproval,
    activePendingUserInput,
    localCheckoutBranchMismatch,
    gitStatusQuery,
    backgroundWorkChecksHandle,
    composerRef,
    composerDraftTarget,
    sendInFlightRef,
    setThreadError,
    clearUsageLimitsFor,
    scheduleComposerFocus,
    scrollToEnd,
  });
  const activeThreadHasCompactableConversation = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "user_message" &&
      (item.text.trim().toLowerCase() !== "/compact" || item.attachments.length > 0),
  );
  const pendingHandoffSelection = composerSelectedModelSelection ?? activeThread?.modelSelection;
  const pendingHandoffSelectionUsable = providerInstanceEntries.some(
    (entry) =>
      entry.instanceId === pendingHandoffSelection?.instanceId &&
      entry.enabled &&
      entry.isAvailable,
  );
  const pendingHandoff = resolvePendingHandoff(
    serverProjection,
    pendingHandoffSelectionUsable ? pendingHandoffSelection : null,
    providerStatuses,
  );
  const compactThreadUnavailable =
    !canOperateThread ||
    !activeThread ||
    !activeThreadHasCompactableConversation ||
    !activeProject ||
    !isServerThread ||
    !manualCompactionProviderAvailable ||
    isWorking ||
    isRevertingCheckpoint ||
    threadDetailLoading ||
    isPreparingWorktree ||
    activeEnvironmentUnavailable ||
    feedbackUploading ||
    pendingApprovals.length > 0 ||
    pendingUserInputs.length > 0;
  const compactDisabled = compactThreadUnavailable;
  const compactDisabledReason = compactDisabled
    ? !canOperateThread
      ? "This connection cannot change threads."
      : !activeProject
        ? "Choose a project before compacting"
        : !manualCompactionProviderAvailable
          ? "Compaction is unavailable for this provider"
          : "Compacting is unavailable right now"
    : null;
  const feedbackBannerItems = feedbackSubmissions.flatMap((submission) => {
    const item = feedbackBannerItem(submission, () => {
      setFeedbackSubmissionsByThreadKey((current) => ({
        ...current,
        [routeThreadKey]: (current[routeThreadKey] ?? []).filter(
          (entry) => entry.id !== submission.id,
        ),
      }));
    });
    return item ? [item] : [];
  });
  const limitRecoveryBanner =
    serverRuntime?.status === "failed" &&
    serverRuntime.lastErrorClass === "usage_limit" &&
    activeThreadShell?.latestRun
      ? usageLimitRecoveryBannerItem({
          runId: activeThreadShell.latestRun.runId,
          resetAt: serverRuntime.usageLimitResetAt ?? null,
          stoppedAt: activeThreadShell.latestRun.completedAt ?? activeThreadShell.updatedAt,
          recovery: activeThreadShell.limitRecovery ?? null,
          snoozedUntil: activeThreadShell.snoozedUntil,
          onChange: async (limitRecovery) => {
            const result = await updateThreadMetadata({
              environmentId,
              input: { threadId: activeThreadShell.id, limitRecovery },
            });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          },
        })
      : null;
  const composerBannerItems = ((): ComposerBannerStackItem[] => {
    const limitRecoveryItems = limitRecoveryBanner === null ? [] : [limitRecoveryBanner];
    const backgroundWorkItems = [childInputBanner, goalBanner, backgroundWorkBanner].filter(
      (item) => item !== null,
    );
    const usageLimitsItems = usageLimitsBanner === null ? [] : [usageLimitsBanner];
    const projectCloneItems = projectCloneBannerItem === null ? [] : [projectCloneBannerItem];
    if (!localCheckoutBranchMismatch || !showBranchMismatchBanner || !activeBranchMismatchKey) {
      return [
        ...feedbackBannerItems,
        ...limitRecoveryItems,
        ...usageLimitsItems,
        ...projectCloneItems,
        ...systemComposerBannerItems,
        ...backgroundWorkItems,
      ];
    }
    return [
      ...feedbackBannerItems,
      ...limitRecoveryItems,
      ...usageLimitsItems,
      ...projectCloneItems,
      ...systemComposerBannerItems,
      ...backgroundWorkItems,
      branchMismatchBannerItem({
        mismatchKey: activeBranchMismatchKey,
        mismatch: localCheckoutBranchMismatch,
        restoreDisabled: !canWriteSourceControl || isRestoringThreadBranch,
        restoring: isRestoringThreadBranch,
        hasWorkingTreeChanges: gitStatusQuery.data?.hasWorkingTreeChanges === true,
        onRestore: () => void handleSwitchCheckoutToThreadStable(),
        onDismiss: () => {
          dismissBranchMismatchForSession(activeBranchMismatchKey);
          setBranchMismatchDismissTick((tick) => tick + 1);
        },
      }),
    ];
  })();

  const [terminalLaunchContextInputs, setTerminalLaunchContextInputs] = useState({
    activeThreadId,
    activeProjectCwd,
    activeThreadWorktreePath,
    terminalOpen: terminalUiState.terminalOpen,
  });
  const terminalLaunchThreadChanged = terminalLaunchContextInputs.activeThreadId !== activeThreadId;
  const terminalLaunchCheckoutChanged =
    terminalLaunchThreadChanged ||
    terminalLaunchContextInputs.activeProjectCwd !== activeProjectCwd ||
    terminalLaunchContextInputs.activeThreadWorktreePath !== activeThreadWorktreePath;
  const terminalLaunchVisibilityChanged =
    terminalLaunchThreadChanged ||
    terminalLaunchContextInputs.terminalOpen !== terminalUiState.terminalOpen;
  if (terminalLaunchCheckoutChanged || terminalLaunchVisibilityChanged) {
    setTerminalLaunchContextInputs({
      activeThreadId,
      activeProjectCwd,
      activeThreadWorktreePath,
      terminalOpen: terminalUiState.terminalOpen,
    });
    if (terminalLaunchThreadChanged) {
      setTerminalUiLaunchContext((current) =>
        !activeThreadId || current?.threadId !== activeThreadId ? null : current,
      );
    }
    if (terminalLaunchCheckoutChanged && activeThreadId && activeProjectCwd) {
      setTerminalUiLaunchContext((current) => {
        if (!current || current.threadId !== activeThreadId) {
          return current;
        }
        const settledCwd = projectScriptCwd({
          project: { cwd: activeProjectCwd },
          worktreePath: activeThreadWorktreePath,
        });
        if (
          settledCwd === current.cwd &&
          (activeThreadWorktreePath ?? null) === current.worktreePath
        ) {
          return null;
        }
        return current;
      });
    }
    if (terminalLaunchVisibilityChanged && !terminalUiState.terminalOpen) {
      setTerminalUiLaunchContext((current) =>
        current?.threadId === activeThreadId ? null : current,
      );
    }
  }

  useEffect(() => {
    if (!activeThreadKey) return;
    const previous = terminalUiOpenByThreadRef.current[activeThreadKey] ?? false;
    const current = Boolean(terminalUiState.terminalOpen);

    if (!previous && current) {
      terminalUiOpenByThreadRef.current[activeThreadKey] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalUiOpenByThreadRef.current[activeThreadKey] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposerStable();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalUiOpenByThreadRef.current[activeThreadKey] = current;
  }, [activeThreadKey, focusComposerStable, terminalUiState.terminalOpen]);

  const {
    shortcuts: timelineRewindShortcuts,
    forkSource,
    forkDisabled,
    onConfirmRevertStable,
    onForkFromRunStable,
    onRevertTimelineTurnStable,
  } = useTimelineRewind({
    environmentId,
    routeThreadRef,
    routeThreadKey,
    currentRouteThreadKeyRef,
    serverProjection,
    activeThread,
    isServerThread,
    timelineMessages,
    phase,
    isConnecting,
    isSendBusy,
    isRevertingCheckpoint,
    threadDetailLoading,
    supportsConversationRollback,
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableLabel,
    promptRef,
    composerRef,
    composerDraftTarget,
    setThreadError,
    focusComposer: focusComposerStable,
  });

  const getShortcutContext = (eventTarget: EventTarget | null = document.activeElement) => ({
    terminalFocus: getTerminalFocusOwner() !== null,
    terminalOpen: Boolean(terminalUiState.terminalOpen),
    previewFocus: isPreviewFocused(),
    previewOpen: previewPanelOpen,
    editableFocus: isEditableFocused(eventTarget),
    textSelected: hasTextSelection(),
    modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
    composerFocus: document.activeElement?.getAttribute("data-testid") === "composer-editor",
    draftThreadRoute: routeKind === "draft",
    turnRunning: phase === "running",
    composerRequiresModifier: composerRequiresModifier(settings.sendShortcut, promptRef.current),
    paneClosable: paneSplit && !activeRightPanelSurface,
    isWeb: !isElectron,
    isDesktop: isElectron,
  });
  const getShortcutContextStable = useStableCallback(getShortcutContext);
  const timelineSkills = activeProviderStatus
    ? resolveProviderSkillsForCwd(activeProviderStatus, gitCwd)
    : EMPTY_PROVIDER_SKILLS;
  const threadFindControlsRef = useRef<ThreadFindControls | null>(null);
  const [isThreadFindActive, setIsThreadFindActive] = useState(false);
  const openThreadFind = () => threadFindControlsRef.current?.open();
  const openThreadFindStable = useStableCallback(openThreadFind);
  const closeThreadFind = () => threadFindControlsRef.current?.close();
  const closeThreadFindStable = useStableCallback(closeThreadFind);

  const respondToActiveApproval = (decision: "accept" | "decline", repeat: boolean) => {
    const approval = activePendingApproval;
    if (!approval || approval.responseCapability !== "live") return false;
    if (approval.options && !approval.options.some((option) => option.decision === decision)) {
      return false;
    }
    if (repeat || respondingRequestIds.includes(approval.requestId)) return;
    void onRespondToApprovalStable(approval.requestId, decision);
  };
  useChatShortcuts({
    enabled: activeThreadId !== null,
    isInputOwner: isPaneInputOwner,
    keybindings,
    scriptKeybindings,
    getShortcutContext: getShortcutContextStable,
    threadFindActive: isThreadFindActive,
    composerRef,
    branchToolbarRef,
    composerShortcutAvailability: {
      draftProjectControls: showDraftProjectPicker,
      branchPicker: isGitRepo && showDraftProjectPicker,
    },
    closeThreadFind: () => {
      closeThreadFindStable();
      focusComposerStable();
    },
    commands: {
      ...terminalShortcuts,
      ...rightPanelShortcuts,
      ...threadLifecycleShortcuts,
      ...timelineRewindShortcuts,
      ...timelineFollowShortcuts,
      "pane.close": ({ repeat }) => {
        if (!paneScope || !paneSplit) return false;
        if (!repeat) useChatPaneStore.getState().close(paneScope.paneId);
      },
      "pane.closeOthers": () => {
        if (!paneScope || !paneSplit) return false;
        useChatPaneStore.getState().closeOthers(paneScope.paneId);
      },
      "pane.splitRight": () => openThreadPickerBeside("right"),
      "pane.splitDown": () => openThreadPickerBeside("bottom"),
      "pane.focusNext": () => focusAdjacentPaneFromKeyboard(1),
      "pane.focusPrevious": () => focusAdjacentPaneFromKeyboard(-1),
      "pane.focus.1": () => focusPaneIndexFromKeyboard(0),
      "pane.focus.2": () => focusPaneIndexFromKeyboard(1),
      "pane.focus.3": () => focusPaneIndexFromKeyboard(2),
      "pane.focus.4": () => focusPaneIndexFromKeyboard(3),
      "thread.copyReference": ({ repeat }) => {
        if (!repeat) copyActiveThreadReferenceStable();
      },
      "chat.find": () => {
        if (!isServerThread || serverConfig?.threadFind !== true) return false;
        openThreadFindStable();
      },
      "composer.cycleHost": ({ repeat }) => {
        if (!canChangeEnvironment) return false;
        if (repeat) return;
        const currentId = readPendingEnvironmentChange()?.environmentId ?? environmentId;
        const index = logicalProjectEnvironments.findIndex(
          (env) => env.environmentId === currentId,
        );
        const next = logicalProjectEnvironments[(index + 1) % logicalProjectEnvironments.length];
        if (next) onEnvironmentChangeStable(next.environmentId);
      },
      "thread.steerQueuedMessage": ({ repeat }) =>
        routeKind !== "draft" && queuedRunsControlRef.current?.steerNext(repeat) === true,
      "thread.editQueuedMessage": ({ repeat }) =>
        composerRef.current?.isCaretAtStart() === true && editLatestQueuedMessage(repeat),
      "thread.stop": ({ repeat }) => {
        if (!canInterruptRunningThread) return false;
        if (!repeat) void onInterruptStable();
      },
      "thread.approve": ({ repeat }) => respondToActiveApproval("accept", repeat),
      "thread.decline": ({ repeat }) => respondToActiveApproval("decline", repeat),
      "composer.submit": ({ repeat }) => {
        if (!composerRef.current) return false;
        if (!repeat) composerRef.current.submit();
      },
      "composer.toggleFastMode": ({ repeat }) => {
        if (repeat) return;
        const level = composerRef.current?.toggleFastMode() ?? null;
        if (level === null) return false;
        toastManager.add({
          id: "fast-mode-toggle",
          title: SPEED_TOGGLE_LABELS[level],
          timeout: 1500,
        });
      },
    },
    fallback: (command) => {
      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject || !canOperateTerminal) return undefined;
      const script = activeProjectScripts.find((entry) => entry.id === scriptId);
      return script ? () => void runProjectScriptStable(script) : undefined;
    },
  });

  useEffect(() => {
    return window.desktopBridge?.onMenuAction((action) => {
      if (!isPaneInputOwner()) return;
      if (action === "rightPanel.toggle") toggleRightPanelStable();
      else if (action === "rightPanel.toggleMaximized") toggleRightPanelMaximizedStable();
    });
  }, [isPaneInputOwner, toggleRightPanelStable, toggleRightPanelMaximizedStable]);

  usePasteToFocusComposer(activeThreadId, composerRef);

  const onCompactContext = () => {
    if (compactDisabled) return;
    void sendStandaloneCommand("/compact", "Failed to compact context.");
  };

  const { onResume, isResuming } = useComposerResume({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    activeThread,
    resumableRunId,
    hasHeldQueuedRuns,
    isSendBusy,
    isConnecting,
    isRevertingCheckpoint,
    threadDetailLoading,
    activeEnvironmentUnavailable,
    runtimeMode,
    interactionMode,
    localCheckoutBranchMismatch,
    composerRef,
    persistThreadSettingsForNextTurn,
    clearUsageLimitsFor,
    scrollToEnd,
    setThreadError,
  });
  const { onSend } = useComposerSend({
    environmentId,
    routeThreadKey,
    currentRouteThreadKeyRef,
    draftId,
    activeThread,
    activeThreadKey,
    activeThreadBranch,
    activeProject,
    isServerThread,
    isLocalDraftThread,
    isGitRepo,
    phase,
    runtimeMode,
    sendEnvMode,
    startFromOrigin,
    worktreeBaseRefsSettled,
    localCheckoutBranchMismatch,
    logicalProjectEnvironments,
    providerInstanceEntries,
    composerRef,
    composerDraftTarget,
    promptRef,
    feedbackUploadsInFlightRef,
    queuedRunEdit,
    isConnecting,
    isRevertingCheckpoint,
    threadDetailLoading,
    activeEnvironmentUnavailable,
    isSendBusy,
    sendQueuesBehindSetup,
    isDraftHeroState,
    panelAnimationsActive,
    panelAnimationDurationMs,
    usageLimitsKey,
    usageLimitsOffered,
    openUsageLimits,
    clearUsageLimitsFor,
    needsLoadBalancing,
    loadBalancing,
    readPendingEnvironmentChange,
    pendingApprovals,
    respondingRequestIds,
    activePendingProgress,
    onAdvanceActivePendingUserInput,
    onRespondToApproval: onRespondToApprovalStable,
    beginWorktreeSetup,
    captureDraftHeroLayout,
    setDockedDraftHeroThreadKey,
    setFeedbackSubmissionsByThreadKey,
    setThreadError,
    anchorNewTurn,
    handleNewThreadInActiveProject,
  });

  const onWorktreeSetupWorkLocally = () => {
    if (!worktreeSetup || worktreeSetup.phase !== "running" || !draftId) {
      return;
    }
    void cancelWorktreeSetup().then((cancelled) => {
      if (cancelled) setWorkLocallyResendDraftId(draftId);
    });
  };
  const onWorktreeSetupWorkLocallyStable = useStableCallback(onWorktreeSetupWorkLocally);
  const onComposerSendStable = useStableCallback(onSend);
  const sendPreviewAnnotation = (
    annotation: PreviewAnnotationPayload,
    image: ComposerImageAttachment | null,
  ) => {
    void onSend(undefined, "auto", "foreground", { annotation, image });
  };
  const sendPreviewAnnotationStable = useStableCallback(sendPreviewAnnotation);
  const onComposerResumeStable = useStableCallback(onResume);
  const onComposerCompactContextStable = useStableCallback(onCompactContext);
  const queuedRunsControl = (
    <>
      <ThreadOutboxControl
        ref={threadOutboxControlRef}
        environmentId={environmentId}
        threadId={threadId}
        editingMessageId={queuedRunEdit.outbox.editingMessageId}
        onEditMessage={queuedRunEdit.outbox.beginEdit}
        onCancelEdit={queuedRunEdit.outbox.cancelEdit}
      />
      {isServerThread && activeThread ? (
        <QueuedRunsControl
          ref={queuedRunsControlRef}
          steerShortcutLabel={shortcutLabelForCommand(keybindings, "thread.steerQueuedMessage", {
            context: { terminalFocus: false },
          })}
          editShortcutLabel={shortcutLabelForCommand(keybindings, "thread.editQueuedMessage", {
            context: { composerFocus: true },
          })}
          environmentId={activeThread.environmentId}
          threadId={activeThread.id}
          optimisticMessages={optimisticUserMessages}
          editingRunId={queuedRunEdit.editingRunId}
          onEditQueuedRun={queuedRunEdit.beginEdit}
          onCancelEdit={queuedRunEdit.cancelEdit}
        />
      ) : null}
    </>
  );
  const workLocallyResendReady =
    workLocallyResendDraftId !== null &&
    workLocallyResendDraftId === draftId &&
    isLocalDraftThread &&
    !isSendBusy &&
    !isConnecting &&
    !isRevertingCheckpoint &&
    !threadDetailLoading &&
    clientSettingsHydrated &&
    !needsLoadBalancing &&
    !activeEnvironmentUnavailable &&
    !activePendingProgress &&
    !feedbackUploading;
  useEffect(() => {
    if (
      !workLocallyResendReady ||
      isSendInFlight() ||
      feedbackUploadsInFlightRef.current.has(routeThreadKey)
    ) {
      return;
    }
    if (sendEnvMode !== "local") {
      setDraftThreadContext(composerDraftTarget, { envMode: "local", startFromOrigin: false });
      return;
    }
    // oxlint-disable-next-line react/set-state-in-effect -- consumes the resend request before sending it
    setWorkLocallyResendDraftId(null);
    void onComposerSendStable();
  }, [
    composerDraftTarget,
    feedbackUploadsInFlightRef,
    onComposerSendStable,
    routeThreadKey,
    sendEnvMode,
    setDraftThreadContext,
    workLocallyResendReady,
  ]);

  const onExpandTimelineImage = (preview: ExpandedImagePreview) => {
    openExpandedImagePreview(routeThreadKey, preview);
  };
  const onExpandTimelineImageStable = useStableCallback(onExpandTimelineImage);

  const pendingSidebarFileDrops = useSidebarPendingFileDropStore((state) => state.pending);
  const consumePendingFileDrop = useSidebarPendingFileDropStore(
    (state) => state.consumePendingFileDrop,
  );
  useEffect(() => {
    if (pendingSidebarFileDrops.length === 0) return;
    if (
      typeof composerDraftTarget === "string" ||
      !pendingSidebarFileDrops.some((drop) =>
        isSameSidebarThreadRef(composerDraftTarget, drop.threadRef),
      )
    ) {
      return;
    }
    if (!activeThread) return;
    if (!composerRef.current) {
      const raf = window.requestAnimationFrame(() => {
        if (!composerRef.current || typeof composerDraftTarget === "string") return;
        const files = consumePendingFileDrop(composerDraftTarget);
        if (files !== null) composerRef.current?.addDroppedFiles(files);
      });
      return () => window.cancelAnimationFrame(raf);
    }
    const files = consumePendingFileDrop(composerDraftTarget);
    if (files !== null) composerRef.current.addDroppedFiles(files);
  }, [
    activeThread,
    composerDraftTarget,
    composerRef,
    consumePendingFileDrop,
    pendingSidebarFileDrops,
  ]);

  if (!activeThread) {
    return <NoActiveThreadState />;
  }

  const rightPanelContent = activeThreadRef ? (
    <RightPanelSurfaceContent
      surface={renderedRightPanelSurface}
      activeSurfaceId={activeRightPanelSurface?.id ?? null}
      threadRef={activeThreadRef}
      environmentId={activeThread.environmentId}
      visible={rightPanelOpen}
      composerDraftTarget={composerDraftTarget}
      keybindings={keybindings}
      configuredPreviewUrls={configuredPreviewUrls}
      workspaceMutationId={workspaceMutationId}
      getShortcutContext={getShortcutContextStable}
      onSendAnnotation={sendPreviewAnnotationStable}
      onCloseSurface={closeRightPanelSurfaceNow}
      terminal={{
        launchContext: activeTerminalLaunchContext ?? null,
        focusRequestId: terminalFocusRequestId,
        keybindings,
        onAddTerminalContext: addTerminalContextToDraftStable,
        onSplitTerminal: splitPanelTerminalStable,
        onSplitTerminalVertical: splitPanelTerminalVerticalStable,
        onNewTerminal: addTerminalSurfaceStable,
        onActiveTerminalChange: activatePanelTerminalStable,
        onCloseTerminal: closePanelTerminalStable,
        splitShortcutLabel: splitTerminalShortcutLabel ?? undefined,
        splitVerticalShortcutLabel: splitTerminalVerticalShortcutLabel ?? undefined,
        newShortcutLabel: newTerminalShortcutLabel ?? undefined,
        closeShortcutLabel: closeTerminalShortcutLabel ?? undefined,
      }}
      pullRequest={{
        capabilityKnown: pullRequestsCapabilityKnown,
        supported: supportsPullRequests,
        projectId: activeThread.projectId,
        pullRequests: visiblePullRequests,
        linkedPullRequest: linkedThreadPullRequest,
        branchPullRequest: activeThreadShell?.branchPullRequest ?? activeThread.branchPullRequest,
        onBack:
          pullRequestsSurfaceAvailable && visiblePullRequestCount > 1
            ? addPullRequestsSurfaceStable
            : undefined,
      }}
      files={{
        projectName: activeProject?.title ?? null,
        workspaceRoot: activeWorkspaceRoot,
        availableEditors,
        pendingSurfaceIds: pendingFileSurfaceIds,
        onOpenFile: openFileSurfaceStable,
        onPendingChange: handleFilePendingChangeStable,
      }}
    />
  ) : null;
  const panelToggleControlProps = {
    showThreadPanelControl: routeKind === "server",
    terminalAvailable: activeProject !== null,
    terminalOpen: terminalUiState.terminalOpen,
    terminalShortcutLabel: shortcutLabelForCommand(keybindings, "terminal.toggle"),
    threadPanelOpen,
    threadPanelPresentation,
    threadPanelPopoverHandle,
    threadPanelShortcutLabel: shortcutLabelForCommand(keybindings, "threadPanel.toggle"),
    threadPanelHasAttention: activeEnvironmentUnavailableState !== null,
    rightPanelAvailable: activeProject !== null,
    rightPanelOpen,
    rightPanelShortcutLabel: shortcutLabelForCommand(keybindings, "rightPanel.toggle"),
    onToggleTerminal: toggleTerminalVisibilityStable,
    onToggleThreadPanel: toggleThreadPanelStable,
    onToggleRightPanel: toggleRightPanelStable,
  } satisfies PanelLayoutControlsProps;
  const panelToggleControls = (
    <PanelLayoutControls
      {...panelToggleControlProps}
      showThreadPanelControl={routeKind === "server" && !inlineRightPanelOwnsTitleBar}
    />
  );
  const threadPanelHeaderControl = <ThreadPanelHeaderControl {...panelToggleControlProps} />;
  const panelLayoutControls = (
    <WorkspaceTitlebarControls
      showMaximizeControl={!shouldUsePlanSidebarSheet}
      rightPanelOpen={rightPanelOpen}
      animationsActive={panelAnimationsActive}
      maximized={rightPanelMaximized}
      onToggleMaximized={toggleRightPanelMaximizedStable}
    >
      {panelToggleControls}
    </WorkspaceTitlebarControls>
  );
  const workspaceFileDropHost: WorkspaceFileDropHost = {
    setDragActive: setIsWorkspaceFileDragActive,
    addFiles: (files) => composerRef.current?.addDroppedFiles(files),
    addFolders: (folders) => composerRef.current?.addDroppedFolders(folders),
  };
  const composerContextStrip = mountComposerContextStrip ? (
    <BranchToolbar
      forceNewWorktree={multipleModelSelections !== null}
      ref={branchToolbarRef}
      projectId={activeThread.projectId}
      worktreePath={activeThread.worktreePath}
      isServerThread={isServerThread}
      environmentId={activeThread.environmentId}
      threadId={activeThread.id}
      showGitControls={isGitRepo && showDraftProjectPicker}
      showEnvironmentIndicator={showComposerEnvironmentIndicator && showDraftProjectPicker}
      {...(routeKind === "draft" && draftId ? { draftId } : {})}
      onEnvModeChange={onEnvModeChangeStable}
      startFromOrigin={startFromOrigin}
      onStartFromOriginChange={onStartFromOriginChange}
      envMode={envMode}
      activeThreadBranchOverride={activeThreadBranch}
      envLocked={envLocked}
      onComposerFocusRequest={scheduleComposerFocusStable}
      {...(canCheckoutPullRequestIntoThread
        ? { onCheckoutPullRequestRequest: openPullRequestDialogStable }
        : {})}
      {...(hasMultipleEnvironments ? { onEnvironmentChange: onEnvironmentChangeStable } : {})}
      autoEnvironmentLabel={autoEnvironmentLabel}
      onAutoEnvironment={
        draftId &&
        !envLocked &&
        canAutoBalanceEnvironments &&
        loadBalancingSettings.loadBalancingEnabled
          ? onAutoEnvironmentStable
          : undefined
      }
      availableEnvironments={logicalProjectEnvironments}
      composerControlsHostRef={setRestingComposerControlsHost}
      contextStripVisible={showComposerContextStrip}
      contextStripPlacement={composerContextStripPlacement}
      usageMeter={composerUsageMeterSlot === "context-strip" ? composerUsageMeter : null}
      projectPicker={
        showDraftProjectPicker ? (
          <DraftProjectPicker
            draftId={draftId}
            activeProjectRef={activeProjectRef}
            activeProjectTitle={activeProject?.title ?? null}
            isSendInFlight={isSendInFlightStable}
          />
        ) : null
      }
    />
  ) : null;

  const rightPanelProps = {
    open: rightPanelOpen,
    maximized: rightPanelMaximized,
    keybindings,
    getShortcutContext: getShortcutContextStable,
    layoutControls: rightPanelOpen ? (
      <TooltipProvider>
        <div className="mr-px flex items-center">{panelToggleControls}</div>
      </TooltipProvider>
    ) : null,
    widthStorageKey: `supaterm:preview-panel-width:${activeThreadKey}`,
    // A sheet is modal, so in a split only the pane in use shows its own.
    sheetOpen: rightPanelOpen && ownsPaneInput,
    sheetContainer: paneScope?.element,
    sheetAnimationDurationMs: panelAnimationsActive ? panelAnimationDurationMs : 0,
    onClose: closePreviewPanelStable,
    surfaces: renderedRightPanelSurfaces,
    environmentId: activeThreadRef?.environmentId ?? null,
    activeSurfaceId: renderedRightPanelSurface?.id ?? null,
    pendingSurfaceIds: pendingFileSurfaceIds,
    previewSessions: activePreviewState.sessions,
    desktopByTabId: activePreviewState.desktopByTabId,
    previewRuntimeTabId: resolvePreviewRuntimeTabId,
    terminalLabelsById: activeTerminalLabelsById,
    onActivate: activateRightPanelSurfaceStable,
    onCloseSurface: closeRightPanelSurfaceStable,
    onRenameDevice: (surfaceId: string, title: string) => {
      if (activeThreadRef)
        useRightPanelStore.getState().renameDevice(activeThreadRef, surfaceId, title);
    },
    onCloseOtherSurfaces: closeOtherRightPanelSurfacesStable,
    onCloseSurfacesToRight: closeRightPanelSurfacesToRightStable,
    onCloseAllSurfaces: closeAllRightPanelSurfacesStable,
    onMoveSurface: moveRightPanelSurfaceStable,
    onCopyFilePath: copyRightPanelFilePathStable,
    onAddBrowser: () => createBrowserSurface(),
    onAddBrowserInProfile: createBrowserSurfaceStable,
    onAddTerminal: addTerminalSurfaceStable,
    onAddDiff: addDiffSurfaceStable,
    onAddFiles: addFilesSurfaceStable,
    onAddPullRequest: addPullRequestSurfaceStable,
    onAddPullRequests: addPullRequestsSurfaceStable,
    onAddDevice: addDeviceSurfaceStable,
    browserAvailable: canOperatePreview && browserAvailable,
    terminalAvailable: activeProject !== null && canOperateTerminal,
    diffAvailable: isServerThread && isGitRepo,
    filesAvailable: activeProject !== null,
    pullRequestAvailable: pullRequestSurfaceAvailable,
    pullRequestsAvailable: pullRequestsSurfaceAvailable,
    deviceAvailable: activeThreadRef !== null,
    children: rightPanelContent,
  };
  const content = (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      <DeviceSetupDialogHost
        threadKey={activeThreadKey}
        threadRef={activeThreadRef}
        state={deviceState}
      />
      {rightPanelControlsAtRoot ? panelLayoutControls : null}
      <PreviewPanelGroup className="min-h-0 min-w-0 flex-1" maximized={rightPanelMaximized}>
        <PreviewPanelSibling>
          <div
            data-chat-column
            className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-background"
          >
            <header
              ref={threadPanelPopoverAnchorRef}
              data-chat-header
              className={cn(
                "relative bg-background [[data-panel-animations=true]_&]:motion-safe:transition-[padding-left] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-drawer",
                isElectron
                  ? cn(
                      "drag-region flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center px-3 sm:px-5",
                      reserveTitleBarControlInset &&
                        !inlineRightPanelOwnsTitleBar &&
                        "wco:pr-(--workspace-native-controls-inset)",
                    )
                  : "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)",
                COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
              )}
            >
              {isElectron && rightPanelControlsAtRoot ? (
                <span
                  aria-hidden
                  className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] h-[var(--workspace-topbar-height)] w-28 [-webkit-app-region:no-drag]"
                />
              ) : null}
              {!rightPanelControlsAtRoot && !rightPanelControlsInPanel ? panelLayoutControls : null}
              {inlineRightPanelOwnsTitleBar ? threadPanelHeaderControl : null}
              <TooltipProvider>
                <ChatPaneHeaderControls title={activeThread.title} />
                <ChatHeader
                  activeThreadEnvironmentId={activeThread.environmentId}
                  activeThreadId={activeThread.id}
                  isServerThread={isServerThread}
                  activeThreadTitle={activeThread.title}
                  activeProject={activeProject ?? null}
                  parentThreadLink={parentThreadLink}
                  onOpenThread={onOpenRelatedThreadStable}
                  rightPanelOpen={inlineRightPanelOwnsTitleBar}
                  onNewThreadInProject={handleNewThreadInActiveProjectStable}
                  {...(activeDraftLogicalProjectKey
                    ? { onOpenProjectSettings: handleOpenDraftProjectSettingsStable }
                    : {})}
                />
              </TooltipProvider>
            </header>

            <div className="relative flex min-h-0 min-w-0 flex-1">
              <ThreadFindCanvas
                findOptions={{
                  skills: timelineSkills,
                  progressive: serverConfig?.threadFindProgressive === true,
                  thread: activeThreadRef,
                  enabled:
                    isServerThread &&
                    serverConfig?.threadFind === true &&
                    !paintOnlyDisplayedTimeline,
                  content: serverProjection ?? undefined,
                }}
                controlsRef={threadFindControlsRef}
                onOpenChange={setIsThreadFindActive}
                detailsCardTopInset={isThreadFindActive ? THREAD_FIND_BAR_RESERVED_HEIGHT : 0}
                composerOverlayElement={isDraftHeroState ? null : composerOverlayElement}
                data-chat-workspace-drop-target="true"
                onDragEnter={(event) =>
                  makeWorkspaceFileDropHandlers(workspaceFileDropHost).onDragEnter(event)
                }
                onDragOver={(event) =>
                  makeWorkspaceFileDropHandlers(workspaceFileDropHost).onDragOver(event)
                }
                onDragLeave={(event) =>
                  makeWorkspaceFileDropHandlers(workspaceFileDropHost).onDragLeave(event)
                }
                onDrop={(event) =>
                  makeWorkspaceFileDropHandlers(workspaceFileDropHost).onDrop(event)
                }
              >
                <ThreadFind onClose={focusComposerStable} />
                <WorkspaceDropOverlay active={isWorkspaceFileDragActive} />
                <ChatBannerLane
                  routeThreadKey={routeThreadKey}
                  providerStatus={visibleProviderStatus}
                  providerStatusBannerKey={providerStatusBannerKey}
                  setDismissedProviderStatusBannerKey={setDismissedProviderStatusBannerKey}
                  onOpenProviderSetup={openProviderSetupStable}
                  threadId={activeThread.id}
                  threadError={timelineThreadError}
                  threadErrorClass={
                    localServerError === null && visibleThreadError === serverRuntime?.lastError
                      ? (serverRuntime?.lastErrorClass ?? null)
                      : null
                  }
                  threadErrorBannerKey={threadErrorBannerKey}
                  setThreadError={setThreadError}
                  setThreadErrorBannerDismissTick={setThreadErrorBannerDismissTick}
                />
                <div className="relative flex min-h-0 flex-1 flex-col bg-background">
                  <MessagesTimeline
                    citationRequest={paintOnlyDisplayedTimeline ? null : citationRequest}
                    citationHistoryLoading={threadDetailLoading}
                    {...(!paintOnlyDisplayedTimeline
                      ? {
                          onCiteAssistantText: citeAssistantTextStable,
                          ...(activeProject ? { onRunShellCommand: runShellCommandStable } : {}),
                        }
                      : {})}
                    isWorking={!paintOnlyDisplayedTimeline && isWorking}
                    runlessWorkActive={runlessWorkStartedAt !== null}
                    activeTurnInProgress={
                      !paintOnlyDisplayedTimeline && (isWorking || !latestRunSettled)
                    }
                    isCompacting={!paintOnlyDisplayedTimeline && isCompacting}
                    awaitingUser={
                      !paintOnlyDisplayedTimeline &&
                      (activePendingApproval !== null ||
                        activePendingUserInput !== null ||
                        activeThreadShell?.hasPendingUserInput === true)
                    }
                    activeTurnStartedAt={paintOnlyDisplayedTimeline ? null : activeWorkStartedAt}
                    worktreeSetup={paintOnlyDisplayedTimeline ? null : worktreeSetup}
                    onCancelWorktreeSetup={onCancelWorktreeSetupStable}
                    {...(paintOnlyDisplayedTimeline
                      ? {}
                      : {
                          retryableWorkspacePreparationRunIds,
                          onRetryWorkspacePreparation: onRetryWorkspacePreparationStable,
                        })}
                    {...(draftId
                      ? { onWorktreeSetupWorkLocally: onWorktreeSetupWorkLocallyStable }
                      : {})}
                    {...(onOpenWorktreeSetupTerminal ? { onOpenWorktreeSetupTerminal } : {})}
                    isPreparingWorktree={!paintOnlyDisplayedTimeline && isPreparingWorktree}
                    footer={
                      paintOnlyDisplayedTimeline ? null : pendingHandoff === null ? (
                        threadStatusLine
                      ) : (
                        <>
                          <div className="chat-content-lane">
                            <HandoffRow
                              environmentId={environmentId}
                              endpoints={pendingHandoff}
                              providers={providerStatuses}
                              pending
                            />
                          </div>
                          {threadStatusLine}
                        </>
                      )
                    }
                    listRef={legendListRef}
                    timelineEntries={displayedTimeline.entries}
                    runs={paintOnlyDisplayedTimeline ? [] : (serverProjection?.runs ?? [])}
                    latestRun={paintOnlyDisplayedTimeline ? null : activeActivityRun}
                    runningRunId={paintOnlyDisplayedTimeline ? null : activeRunningTurnId}
                    turnDiffSummaries={
                      paintOnlyDisplayedTimeline
                        ? EMPTY_HELD_TURN_DIFF_SUMMARIES
                        : turnDiffSummaries
                    }
                    activeThreadEnvironmentId={
                      displayedThreadRef?.environmentId ?? activeThread.environmentId
                    }
                    routeThreadKey={displayedTimelineKey}
                    displayThreadKey={displayedTimelineKey}
                    paintOnly={paintOnlyDisplayedTimeline}
                    onOpenTurnDiff={
                      paintOnlyDisplayedTimeline ? noopHeldTurnDiff : onOpenTurnDiffStable
                    }
                    onOpenThread={onOpenRelatedThreadStable}
                    parentThreadLink={paintOnlyDisplayedTimeline ? null : parentThreadLink}
                    workflowOpening={paintOnlyDisplayedTimeline ? null : workflowOpening}
                    onForkFromRun={
                      paintOnlyDisplayedTimeline ? async () => {} : onForkFromRunStable
                    }
                    supportsConversationRollback={
                      !paintOnlyDisplayedTimeline && supportsConversationRollback
                    }
                    threadStartCheckpointReady={threadStartCheckpointReady}
                    availableRevertTurnCounts={availableRevertTurnCounts}
                    onRevertToTurnCount={
                      paintOnlyDisplayedTimeline ? noopHeldRevert : onRevertTimelineTurnStable
                    }
                    {...(!paintOnlyDisplayedTimeline
                      ? {
                          onUseArtifactTemplate: insertArtifactTemplateStable,
                          onSendAppMessage: sendAppMessageStable,
                        }
                      : {})}
                    isRevertingCheckpoint={isRevertingCheckpoint}
                    onImageExpand={onExpandTimelineImageStable}
                    onFileOpen={
                      paintOnlyDisplayedTimeline ? noopHeldAttachment : openFileAttachmentStable
                    }
                    onFileDownload={
                      paintOnlyDisplayedTimeline ? noopHeldAttachment : downloadFileAttachmentStable
                    }
                    markdownCwd={
                      paintOnlyDisplayedTimeline
                        ? (heldPaintContext?.markdownCwd ?? undefined)
                        : (gitCwd ?? undefined)
                    }
                    resolvedTheme={resolvedTheme}
                    timestampFormat={timestampFormat}
                    workspaceRoot={
                      paintOnlyDisplayedTimeline
                        ? (heldPaintContext?.workspaceRoot ?? undefined)
                        : activeWorkspaceRoot
                    }
                    skills={timelineSkills}
                    anchorMessageId={paintOnlyDisplayedTimeline ? null : timelineAnchorMessageId}
                    onAnchorReady={onTimelineAnchorReadyStable}
                    onAnchorSizeChanged={onTimelineAnchorSizeChangedStable}
                    contentInsetEndAdjustment={composerTimelineInset}
                    emptyPlaceholderInset={composerReservedHeight}
                    liveFollowEnabled={!paintOnlyDisplayedTimeline && timelineLiveFollowEnabled}
                    onIsAtEndChange={onIsAtEndChangeStable}
                    onContentOverflowChange={setTimelineOverflows}
                    onToolOutputCollapsedAtEnd={onToolOutputCollapsedAtEndStable}
                    onManualNavigation={cancelTimelineLiveFollowForUserNavigationStable}
                    cancelPositionRestoreRef={cancelPositionRestoreRef}
                    hideEmptyPlaceholder={isDraftHeroState}
                    loading={!isDraftHeroState && threadDetailLoading}
                    topFadeEnabled={!hasTimelineTopBanner}
                    {...(paintOnlyDisplayedTimeline || threadHistoryControls === undefined
                      ? {}
                      : { historyControls: threadHistoryControls })}
                  />

                  <ScrollToEndPill
                    key={routeThreadKey}
                    show={showScrollToBottom && !isThreadFindActive}
                    bottom={scrollToEndClearance + 4}
                    onScrollToEnd={() => {
                      composerRef.current?.restoreAfterTimelineReachedEnd();
                      scrollToEnd(true);
                    }}
                  />
                </div>

                <div
                  ref={setComposerOverlayElement}
                  inert={isRevertingCheckpoint}
                  data-chat-composer-overlay="true"
                  className={
                    isDraftHeroState
                      ? "pointer-events-none absolute inset-0 z-20 flex items-center"
                      : "pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
                  }
                >
                  <div ref={draftHeroTransitionGroupRef} className="chat-composer-lane w-full">
                    <div
                      data-chat-composer-stack="true"
                      className="pointer-events-auto relative z-10 mx-auto w-full max-w-(--chat-content-max-width)"
                    >
                      <div
                        ref={draftHeroComposerAnchorRef}
                        className="relative z-10"
                        style={
                          forceExpandedMobileComposer
                            ? { viewTransitionName: MOBILE_COMPOSER_VIEW_TRANSITION_NAME }
                            : undefined
                        }
                      >
                        <ComposerSurface.Shell
                          bottomStrip={
                            (composerContextStripPlacement === "bottom" &&
                              showComposerContextStrip) ||
                            showComposerModelStrip
                          }
                        >
                          <ComposerSurface.Host
                            inert={queuedRunEdit.isSaving}
                            aria-busy={queuedRunEdit.isSaving}
                          >
                            <div className="relative z-10">
                              {showProviderSubagentBar ? (
                                <ProviderSubagentBar
                                  provider={selectedProviderEntry ?? null}
                                  showInstanceBadge={
                                    selectedProviderEntry !== undefined &&
                                    shouldShowInstanceBadge(
                                      selectedProviderEntry,
                                      providerInstanceEntries,
                                    )
                                  }
                                  modelLabel={providerSubagentModelLabel}
                                  effortLabel={providerSubagentEffortLabel}
                                  status={providerSubagentStatus}
                                  onOpenParent={
                                    parentThreadLink
                                      ? () => onOpenRelatedThread(parentThreadLink.threadId)
                                      : null
                                  }
                                />
                              ) : null}
                              {!composerMounted ? null : (
                                <ChatComposer
                                  canOperateThread={canOperateThread}
                                  canQueueMessage={canQueueMessage}
                                  reportedModelSelection={reportedModelSelection}
                                  multipleModelSelections={
                                    queuedRunEdit.outbox.isEditing ? null : multipleModelSelections
                                  }
                                  supportsMultipleModels={serverConfig != null}
                                  onMultipleModelSelectionsChange={setMultipleModelSelectionsStable}
                                  composerRef={composerRef}
                                  composerDraftTarget={composerDraftTarget}
                                  environmentId={environmentId}
                                  attachmentUploadsCapabilityKnown={
                                    attachmentUploadsCapabilityKnown
                                  }
                                  supportsAttachmentUploads={supportsAttachmentUploads}
                                  supportsQuestionAttachments={supportsQuestionAttachments}
                                  maxFileAttachmentBytes={maxFileAttachmentBytes}
                                  routeKind={routeKind}
                                  routeThreadRef={routeThreadRef}
                                  draftId={draftId}
                                  activeThreadId={activeThreadId}
                                  activeThreadEnvironmentId={activeThread?.environmentId}
                                  activeThread={activeThread}
                                  activeThreadShell={activeThreadShell}
                                  promptHistoryMessages={timelineMessages}
                                  isServerThread={isServerThread}
                                  isLocalDraftThread={isLocalDraftThread}
                                  forceExpandedOnMobile={
                                    forceExpandedMobileComposer && isDraftHeroState
                                  }
                                  projectSelectionRequired={
                                    isLocalDraftThread && activeProject === null
                                  }
                                  phase={phase}
                                  isCompacting={isCompacting}
                                  canInterrupt={canInterruptRunningThread}
                                  isConnecting={isConnecting}
                                  isSendBusy={isSendBusy || queuedRunEdit.isSaving || isResuming}
                                  canResume={resumableRunId !== null || hasHeldQueuedRuns}
                                  isRevertingCheckpoint={isRevertingCheckpoint}
                                  sendDisabledReason={
                                    !canQueueMessage
                                      ? "This connection cannot change threads."
                                      : queuedRunEdit.outbox.isEditing
                                        ? null
                                        : isEnvironmentChanging
                                          ? "Preparing machine"
                                          : isRevertingCheckpoint
                                            ? "Rewinding conversation"
                                            : feedbackUploading
                                              ? "Sending feedback"
                                              : threadDetailLoading && !activeEnvironmentUnavailable
                                                ? "Messages loading"
                                                : worktreeSetupBlocksSend
                                                  ? "Preparing worktree"
                                                  : projectCloneSendBlockReason
                                  }
                                  isPreparingWorktree={
                                    isPreparingWorktree && !sendQueuesBehindSetup
                                  }
                                  attachedContextStrip={
                                    composerContextStripPlacement === "top"
                                      ? composerContextStrip
                                      : null
                                  }
                                  queuedRunsControl={queuedRunsControl}
                                  bannerItems={composerBannerItems}
                                  onUsageLimitsCommand={
                                    usageLimitsOffered &&
                                    usageLimitsKey !== null &&
                                    !composerHasNonPromptContent
                                      ? openUsageLimits
                                      : undefined
                                  }
                                  environmentUnavailable={activeEnvironmentUnavailableState}
                                  activePendingApproval={
                                    queuedRunEdit.outbox.isEditing ? null : activePendingApproval
                                  }
                                  pendingApprovals={
                                    queuedRunEdit.outbox.isEditing ? [] : pendingApprovals
                                  }
                                  pendingUserInputs={
                                    queuedRunEdit.outbox.isEditing ? [] : pendingUserInputs
                                  }
                                  supportsQuestionAutoDismiss={supportsQuestionAutoDismiss}
                                  activePendingProgress={
                                    queuedRunEdit.outbox.isEditing ? null : activePendingProgress
                                  }
                                  activePendingResolvedAnswers={activePendingResolvedAnswers}
                                  activePendingIsResponding={activePendingIsResponding}
                                  activePendingDraftAnswers={activePendingDraftAnswers}
                                  activePendingQuestionIndex={activePendingQuestionIndex}
                                  respondingRequestIds={respondingRequestIds}
                                  threadSyncPhase={
                                    activeEnvironmentUnavailable ? null : threadSyncPhase
                                  }
                                  runtimeMode={runtimeMode}
                                  lockedProvider={lockedProvider}
                                  providerStatuses={providerStatuses as ServerProvider[]}
                                  providerCatalogKnown={serverConfig !== null}
                                  activeProjectDefaultModelSelection={
                                    activeProjectDefaultModelSelection
                                  }
                                  activeThreadModelSelection={activeThread?.modelSelection}
                                  activeProjectId={activeProject?.id ?? null}
                                  activeTasksProgress={activeComposerTasksProgress}
                                  activeTaskSteps={activeComposerTaskSteps}
                                  compactThreadUnavailable={compactThreadUnavailable}
                                  compactDisabled={compactDisabled}
                                  compactDisabledReason={compactDisabledReason}
                                  resolvedTheme={resolvedTheme}
                                  settings={settings}
                                  keybindings={keybindings}
                                  terminalOpen={Boolean(terminalUiState.terminalOpen)}
                                  gitCwd={gitCwd}
                                  pullRequestProjectId={
                                    supportsPullRequests ? (activeProject?.id ?? null) : null
                                  }
                                  pullRequestRepository={
                                    supportsPullRequests ? activeProjectRepository : null
                                  }
                                  threadPullRequests={
                                    (activeThreadShell ?? activeThread)?.pullRequests
                                  }
                                  restingControlsHost={restingComposerControlsHost}
                                  restingControlsHaveLeadingContext={showDraftProjectPicker}
                                  onRestingControlsVisibilityChange={
                                    setRestingComposerControlsVisible
                                  }
                                  getTimelineScrollableNode={getTimelineScrollableNodeStable}
                                  isTimelineAtLogicalEnd={isTimelineAtLogicalEndStable}
                                  timelineOverflows={timelineOverflows}
                                  onComposerOverlayHeightChange={publishComposerOverlayHeightStable}
                                  onRestingChange={onComposerRestingChangeStable}
                                  promptRef={promptRef}
                                  composerImagesRef={composerImagesRef}
                                  composerFilesRef={composerFilesRef}
                                  composerTerminalContextsRef={composerTerminalContextsRef}
                                  onPageScrollKeyDown={onComposerPageScrollKeyDownStable}
                                  onPageScrollKeyUp={onComposerPageScrollKeyUpStable}
                                  onPageScrollRelease={onComposerPageScrollReleaseStable}
                                  onCompactContext={onComposerCompactContextStable}
                                  onSend={onComposerSendStable}
                                  onResume={onComposerResumeStable}
                                  onInterrupt={onInterruptStable}
                                  onRespondToApproval={onRespondToApprovalStable}
                                  onSelectActivePendingUserInputOption={
                                    onSelectActivePendingUserInputOptionStable
                                  }
                                  onAdvanceActivePendingUserInput={
                                    onAdvanceActivePendingUserInputStable
                                  }
                                  onDismissActivePendingUserInput={onDismissUserInputStable}
                                  onPreviousActivePendingUserInputQuestion={
                                    onPreviousActivePendingUserInputQuestionStable
                                  }
                                  onChangeActivePendingUserInputCustomAnswer={
                                    onChangeActivePendingUserInputCustomAnswer
                                  }
                                  onProviderModelSelect={onProviderModelSelectStable}
                                  onOpenProviderSetup={openProviderSetupStable}
                                  getModelDisabledReason={getModelDisabledReason}
                                  handleRuntimeModeChange={handleRuntimeModeChangeStable}
                                  focusComposer={focusComposerStable}
                                  scheduleComposerFocus={scheduleComposerFocusStable}
                                  setThreadError={setThreadError}
                                  onExpandImage={onExpandTimelineImageStable}
                                  onFileOpen={openFileAttachmentStable}
                                  editingQueuedAttachments={queuedRunEdit.editingAttachments}
                                  onRemoveEditingQueuedAttachment={
                                    queuedRunEdit.removeEditingAttachment
                                  }
                                  onEditLatestQueuedMessage={editLatestQueuedMessageStable}
                                  onCancelQueuedMessageEdit={cancelQueuedMessageEditStable}
                                />
                              )}
                            </div>
                          </ComposerSurface.Host>
                          <div className="min-h-0">
                            <div
                              data-terminal-open={terminalUiState.terminalOpen ? "true" : undefined}
                              className="relative z-0"
                            >
                              {mountComposerModelStrip ? (
                                <ComposerSurface.ContextStrip
                                  data-composer-model-strip="true"
                                  aria-hidden={showComposerModelStrip ? undefined : true}
                                  inert={showComposerModelStrip ? undefined : true}
                                  className={cn(
                                    "group-data-model-strip-transition/composer-surface:before:backdrop-blur-(--glass-blur) group-data-model-strip-transition/composer-surface:before:bg-(--chat-composer-glass-surface)/(--glass-opacity)",

                                    !showComposerModelStrip &&
                                      "pointer-events-none invisible absolute inset-x-0 top-full",
                                  )}
                                >
                                  <div
                                    ref={setRestingComposerControlsHost}
                                    className="min-w-0 flex-1"
                                  />
                                </ComposerSurface.ContextStrip>
                              ) : null}
                              {composerContextStripPlacement === "bottom"
                                ? composerContextStrip
                                : null}
                            </div>
                          </div>
                        </ComposerSurface.Shell>
                        {composerUsageMeterSlot === "row" ? (
                          <div className="px-3 pt-1">{composerUsageMeter}</div>
                        ) : null}
                        <div
                          aria-hidden
                          className="h-[calc(env(safe-area-inset-bottom)+1rem)] sm:h-[calc(env(safe-area-inset-bottom)+1.25rem)]"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {canOperatePreview && activeThreadRef && activeEnvironmentServerBrowser ? (
                  <PreviewSessionSync threadRef={activeThreadRef} />
                ) : null}
                {activeThreadRef &&
                activePreviewMiniPlayer &&
                previewMiniPlayerVisible &&
                (activePreviewMiniPlayer.source.kind === "device" || canOperatePreview) ? (
                  <ThreadPreviewMiniPlayer
                    key={`${activeThreadKey}:${previewMiniPlayerSourceKey(activePreviewMiniPlayer.source)}`}
                    threadRef={activeThreadRef}
                    miniPlayer={activePreviewMiniPlayer}
                  />
                ) : null}

                {routeKind === "server" ? (
                  <ThreadDetailsPanel
                    anchor={threadPanelPopoverAnchorRef}
                    handle={threadPanelPopoverHandle}
                    onPresentationChange={setThreadPanelPresentation}
                    forceNewWorktree={multipleModelSelections !== null}
                    environmentId={activeThread.environmentId}
                    threadId={activeThread.id}
                    projectId={activeThread.projectId}
                    worktreePath={activeThread.worktreePath}
                    isServerThread={isServerThread}
                    {...(draftId ? { draftId } : {})}
                    activeProjectName={activeProject?.title}
                    activeProjectScripts={activeProject ? activeProjectScripts : undefined}
                    preferredScriptId={
                      activeProject
                        ? (lastInvokedScriptByProjectId[activeProject.id] ?? null)
                        : null
                    }
                    keybindings={keybindings}
                    availableEditors={availableEditors}
                    showOpenInPicker={showOpenInPicker}
                    openInShortcutEnabled={
                      !(
                        rightPanelOpen &&
                        renderedRightPanelSurface?.kind === "file" &&
                        renderedRightPanelSurface.attachment === undefined
                      )
                    }
                    gitCwd={gitCwd}
                    isGitRepo={isGitRepo}
                    envLocked={envLocked}
                    availableEnvironments={logicalProjectEnvironments}
                    autoEnvironmentLabel={autoEnvironmentLabel}
                    onAutoEnvironment={
                      draftId &&
                      !envLocked &&
                      canAutoBalanceEnvironments &&
                      loadBalancingSettings.loadBalancingEnabled
                        ? onAutoEnvironmentStable
                        : undefined
                    }
                    {...(canChangeEnvironment
                      ? { onEnvironmentChange: onEnvironmentChangeStable }
                      : {})}
                    onEnvModeChange={onEnvModeChangeStable}
                    envMode={envMode}
                    activeThreadBranchOverride={activeThreadBranch}
                    startFromOrigin={startFromOrigin}
                    onStartFromOriginChange={onStartFromOriginChange}
                    {...(canCheckoutPullRequestIntoThread
                      ? { onCheckoutPullRequestRequest: openPullRequestDialogStable }
                      : {})}
                    onComposerFocusRequest={scheduleComposerFocusStable}
                    {...(isServerThread && isGitRepo
                      ? { onOpenChanges: openChangesFromThreadPanelStable }
                      : {})}
                    onRunProjectScript={runProjectScriptStable}
                    onAddProjectScript={saveProjectScriptStable}
                    onUpdateProjectScript={updateProjectScriptStable}
                    onDeleteProjectScript={deleteProjectScriptStable}
                    contextWindow={
                      activeContextWindow
                        ? {
                            usage: activeContextWindow,
                            modelDisplayName: providerSubagentModelLabel,
                            ...(manualCompactionProviderAvailable
                              ? { onCompact: onCompactContext }
                              : {}),
                            compactDisabled: compactDisabled || isSendBusy || isConnecting,
                            compactDisabledReason,
                          }
                        : null
                    }
                    forkSource={forkSource}
                    forkDisabled={forkDisabled}
                    onForkFromRun={onForkFromRunStable}
                  />
                ) : null}

                <PullRequestThreadDialogHost
                  threadKey={activeThreadKey}
                  environmentId={activeThread.environmentId}
                  threadId={activeThread.id}
                  cwd={activeProject?.workspaceRoot ?? null}
                  onPrepared={handlePreparedPullRequestThreadStable}
                />
              </ThreadFindCanvas>
            </div>

            <ChatTerminalDrawers
              activeThreadKey={activeThreadKey}
              activeTerminalOpen={Boolean(terminalUiState.terminalOpen)}
              composerHeight={composerReservedHeight}
              launchContext={activeTerminalLaunchContext ?? null}
              focusRequestId={terminalFocusRequestId}
              splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
              splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
              newShortcutLabel={newTerminalShortcutLabel ?? undefined}
              closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
              keybindings={keybindings}
              onAddTerminalContext={addTerminalContextToDraftStable}
            />
          </div>
        </PreviewPanelSibling>

        {rightPanelPresent && !shouldUsePlanSidebarSheet && activeThreadRef ? (
          <ChatRightPanel sheet={false} {...rightPanelProps} />
        ) : null}
      </PreviewPanelGroup>
      {rightPanelPresent && shouldUsePlanSidebarSheet && activeThreadRef ? (
        <ChatRightPanel sheet {...rightPanelProps} />
      ) : null}

      <RevertConfirmHost threadKey={routeThreadKey} onConfirm={onConfirmRevertStable} />
      <ThreadVisitWatermark threadRef={routeThreadRef} />
      <ExpandedImageDialogHost threadKey={routeThreadKey} />
    </div>
  );
  return (
    <FileMetadataThreadProvider
      threadRef={activeThreadRef}
      cwd={activeWorkspaceRoot}
      checkpoints={serverProjection?.checkpoints}
    >
      {content}
    </FileMetadataThreadProvider>
  );
}

function PreviewSessionSync(props: { readonly threadRef: ScopedThreadRef }) {
  usePreviewSession(props.threadRef);
  return null;
}
