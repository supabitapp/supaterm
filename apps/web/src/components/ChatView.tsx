import { canQueueComposerMessageAtom, readCanQueueComposerMessage } from "../state/composerQueue";
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
  isThreadWokeUnseen,
  resolveDraftHeroState,
  shouldDockDraftHeroForSubmission,
  resolveVisibleWorktreeSetup,
  resolveWorktreeSetupProgress,
} from "./ChatView.logic";
import * as DateTime from "effect/DateTime";
import { assistantCitationsToPlainText } from "@supaterm/shared/assistantCitations";
import { prepareQueuedEditAttachments, recoverQueuedMessageEdit } from "./chat/queuedMessageEdit";
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
import { useLoadBalancedEnvironment } from "../hooks/useLoadBalancedEnvironment";
import { useScratchProject } from "../hooks/useScratchProject";
import { useStableCallback } from "../hooks/useStableCallback";
import { useThreadTerminalActions } from "./terminal/useThreadTerminalActions";
import { usePendingThreadRequests } from "./chat/usePendingThreadRequests";
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import { visibleThreadPullRequests } from "@supaterm/shared/threadPullRequests";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@supaterm/shared/orchestrationV2ThreadError";
import type { UsageLimitSourceSnapshots } from "@supaterm/contracts";
import {
  collectProviderUsageLimits,
  hasProviderUsageLimits,
  headlineUsageWindows,
  isUsageLimitsCommand,
} from "@supaterm/shared/usageLimits";
import { feedbackBannerItem } from "./chat/ComposerFeedback";
import { usageLimitsBannerItem } from "./chat/ComposerUsageLimits";
import { ComposerUsageMeter } from "./chat/ComposerUsageMeter";
import { getTerminalLabel } from "@supaterm/shared/terminalLabels";
import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  AuthSourceControlWriteScope,
  AuthPreviewOperateScope,
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  type AssistantCitation,
  type ChatFileAttachment,
  CommandId,
  isProviderNativeSubagentThread,
  type ChatAttachment as ContractChatAttachment,
  EnvironmentAuthorizationError,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectScript,
  type ProjectId,
  type PreviewAnnotationPayload,
  ProviderInstanceId,
  type ServerProvider,
  type ScopedThreadRef,
  type ThreadId,
  type ThreadLinkedPullRequest,
  type RunId,
  type RuntimeRequestId,
  type KeybindingCommand,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  ProviderInteractionMode,
  ProviderDriverKind,
  resolveEnvironmentMachineKind,
  resolveProjectProviderInstanceEnabled,
  RuntimeMode,
  type WorktreeSetupSnapshot,
} from "@supaterm/contracts";
import { type EnvironmentConnectionPresentation } from "@supaterm/client-runtime/connection";
import { readPastedComposerContext } from "./composerInlineTokenPaste";
import { isPasteAsTextShortcut } from "@supaterm/client-runtime/text-paste";
import { effectiveSnoozed, threadWokeAt } from "@supaterm/client-runtime/state/thread-snooze";
import { childThreadInputsTitle } from "@supaterm/client-runtime/state/threads";
import { useAcknowledgeThreadWoke, useThreadActions } from "../hooks/useThreadActions";
import {
  deriveProviderSubagentStatus,
  deriveReportedModelSelection,
  formatModelSelectionEffort,
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveLatestThreadRun,
  deriveThreadRuntime,
  presentPendingBackgroundWork,
  presentProviderGoal,
} from "@supaterm/client-runtime/state/thread-execution";
import {
  resolveThreadForkSource,
  threadSupportsProviderHandoff,
} from "@supaterm/client-runtime/state/thread-workflows";
import { resolvePendingHandoff } from "@supaterm/client-runtime/handoff";
import { HandoffRow } from "./chat/V2LifecycleRow";
import {
  codexFeedbackMessage,
  parseCodexFeedbackCommand,
  shouldShowLoadEarlierControl,
  submitCodexFeedback,
  type CodexFeedbackSubmission,
} from "@supaterm/client-runtime/state/threads";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@supaterm/client-runtime/environment";
import {
  applyClaudePromptEffortPrefix,
  createModelSelection,
  formatModelSlugName,
  resolvePromptInjectedEffort,
  resolveSelectableModel,
} from "@supaterm/shared/model";
import { projectScriptCwd, resolveProjectScripts } from "@supaterm/shared/projectScripts";
import { CHAT_LIST_ANCHOR_OFFSET } from "@supaterm/shared/chatList";
import { derivePendingBackgroundWork } from "@supaterm/shared/orchestrationV2PendingBackgroundWork";
import {
  latestUnheldRun,
  usageLimitRunPresentedAsLatest,
} from "@supaterm/shared/orchestrationV2ThreadError";
import {
  projectSettingsOverridesForWrite,
  resolveProjectSettings,
} from "@supaterm/shared/projectSettings";
import { sourceControlRepositorySelector } from "@supaterm/shared/sourceControl";
import { truncate } from "@supaterm/shared/String";
import { resolveThreadReferenceCopyTarget } from "@supaterm/shared/threadReference";
import { resolveTerminalSessionLabel } from "@supaterm/shared/terminalLabels";
import { Debouncer } from "@tanstack/react-pacer";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  Fragment,
  lazy,
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { assistantCitationFromLocation } from "../lib/assistantCitationNavigation";
import { isMacPlatform } from "../lib/utils";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { useShallow } from "zustand/react/shallow";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { useDiffPanelStore } from "../diffPanelStore";
import { useActiveThreadRef } from "../hooks/useActiveThreadRef";
import { useForkThread } from "../hooks/useForkThread";
import { type ComposerSubmissionIntent } from "../composer-logic";
import {
  derivePhase,
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  selectHandoffImageResources,
  type TimelineEntriesInput,
  type TimelineEntriesProjection,
  deriveActivePlanState,
  deriveActiveWorkStartedAt,
  deriveCanInterruptRunningThread,
  isLatestRunSettled,
} from "../session-logic";
import { type LegendListRef } from "@legendapp/list/react";
import {
  CHAT_TIMELINE_ANCHOR_OFFSET,
  timelineContentOverflowsViewport,
  readTimelinePosition,
  observeTimelineRun,
  type TimelineRunObservation,
  type TimelineScrollMode,
} from "./chat/timelineScrollAnchoring";
import { useWorkspaceMutationRefresh } from "../hooks/useWorkspaceMutationRefresh";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type SessionPhase,
  type Thread,
} from "../types";
import { useTheme } from "../hooks/useTheme";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { markDoneAndAdvance } from "../markDoneAndAdvance";
import { subscribeSnapShotComposerFocus } from "../lib/desktopSnapShot";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { FileMetadataThreadProvider } from "../hooks/FileMetadataThreadProvider";
import {
  RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY,
  type ThreadPanelPresentation,
} from "../rightPanelLayout";
import { PopoverCreateHandle } from "./ui/popover";
import {
  pullRequestSurface,
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectThreadPanelOpen,
  selectThreadRightPanelState,
  type RightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import {
  isPreviewSupportedInRuntime,
  setActivePreviewTab,
  useThreadPreviewState,
} from "../previewStateStore";
import { BrowserSettingsReadError, openUrlInPreview } from "../browser/openFileInPreview";
import { resolveDiscoveredServerUrl } from "../browser/browserTargetResolver";
import { previewRuntimeTabId } from "../browser/previewRuntimeTabId";
import { addBrowserSurface } from "./preview/addBrowserSurface";
import { closePreviewSession } from "./preview/closePreviewSession";
import { ThreadPreviewMiniPlayer } from "./preview/ThreadPreviewMiniPlayer";
import { usePreviewSession } from "./preview/usePreviewSession";
import { subscribePreviewAction } from "./preview/previewActionBus";
import { getConfiguredPreviewUrls } from "./preview/previewEmptyStateLogic";

import {
  browserMiniPlayerSource,
  previewMiniPlayerSourceKey,
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "../previewMiniPlayerStore";
import {
  pullRequestPanelContext,
  threadPullRequestPanelTarget,
} from "./pullRequest/pullRequestDetail.logic";
import { PullRequestDetailPanel } from "./pullRequest/PullRequestDetailPanel";
import { PullRequestDetailGhost } from "./pullRequest/PullRequestGhosts";
import { PullRequestsUnavailableState } from "./pullRequest/PullRequestsUnavailableState";
import { RightPanelTabs } from "./RightPanelTabs";
import { LinkPullRequestDialogHost } from "./pullRequest/LinkPullRequestDialog";
import { ThreadPullRequestsPanel } from "./pullRequest/ThreadPullRequestsPanel";
import { BackgroundWorkIcon, BackgroundWorkTitle } from "./chat/BackgroundWork";
import { useDeviceState } from "~/state/device";
import { DeviceSetup } from "./device/DeviceSetup";
import { Dialog } from "./ui/dialog";
import { WizardPopup } from "./ui/wizard";
import { BranchToolbar, type BranchToolbarHandle } from "./BranchToolbar";
import {
  makeWorkspaceFileDropHandlers,
  type WorkspaceFileDropHost,
} from "./chat/workspaceFileDrop";
import { isEditableFocused } from "../lib/editableFocus";
import { hasTextSelection } from "../lib/textSelection";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { resolveChatShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import {
  PersistentThreadTerminalDrawer,
  PersistentThreadTerminalPanel,
} from "./PersistentThreadTerminals";
import {
  AlarmClockIcon,
  CheckCircle2Icon,
  MessageCircleIcon,
  DownloadIcon,
  GitBranchIcon,
  ShieldQuestionIcon,
  TargetIcon,
  WifiOffIcon,
} from "lucide-react";
import { cn, randomUUID } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { stackedThreadToast, toastManager } from "./ui/toast";
import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "~/lib/projectScriptKeybindings";
import { type NewProjectScriptInput } from "./ProjectScriptsControl";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  projectScriptIdFromCommand,
  releaseClaimedRoles,
} from "~/projectScripts";
import { newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { registerFaviconProjectForThread } from "~/browserFaviconStore";
import { getProviderModelCapabilities } from "../providerModels";
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
import { useNowMinute } from "../hooks/useNowMinute";
import { usePanelAnimationSettings, usePanelPresence } from "../panelAnimations";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useRemoveClonedProject } from "../hooks/useRemoveClonedProject";
import { useOpenPanelPullRequestUrl } from "../hooks/useOpenPanelPullRequestUrl";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
} from "./chat/composerProviderState";
import { confirmTerminalClose, isTerminalCloseConfirmPending } from "../lib/terminalCloseConfirm";
import { confirmRightPanelSurfacesClose } from "../lib/rightPanelCloseConfirm";
import { isPreviewFocused } from "../lib/previewFocus";
import { getTerminalFocusOwner } from "../lib/terminalFocus";
import {
  preventRepeatedTerminalCloseShortcut,
  preventTerminalCloseShortcut,
} from "../lib/terminalCloseShortcut";
import { resolveNewDraftStartFromOrigin } from "../lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import {
  isSameSidebarThreadRef,
  useSidebarPendingFileDropStore,
} from "../sidebarPendingFileDropStore";
import {
  markPromotedDraftThreadByRef,
  composerDraftHasUserContent,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  useComposerDraftStore,
  DraftId,
} from "../composerDraftStore";
import {
  formatTerminalContextLabel,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";
import {
  ensureInlineContextReferences,
  removeInlineContextReference,
  stripInlineContextReferences,
} from "../lib/composerContextReferences";
import {
  buildMessageContext,
  previewAnnotationContextReference,
  terminalContextReference,
} from "../lib/composerContextRecords";
import { type ReviewCommentContext } from "../reviewCommentContext";
import { environmentCatalog } from "../connection/catalog";
import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { useEnvironmentDisconnectDelay } from "../hooks/useEnvironmentDisconnectDelay";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useKnownTerminalSessions, useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useEnvironmentQuery } from "../state/query";
import { usePaginatedBranches } from "../state/queries";
import { useEnvironmentScope } from "~/state/session";
import {
  environmentServerConfigsAtom,
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
  serverEnvironment,
} from "../state/server";
import { threadEnvironment } from "../state/threads";
import { workspacePreparationRetryRunIds } from "@supaterm/client-runtime/state/turn-item-presentation";
import { resolveProviderSkillsForCwd } from "@supaterm/client-runtime/providerSkills";
import { vcsEnvironment } from "../state/vcs";
import { sourceControlEnvironment } from "../state/sourceControl";
import { useProjectClone } from "../state/projectClones";
import { projectCloneDisplayName, projectCloneProgressSummary } from "@supaterm/contracts";
import { useEnvironments, usePrimaryEnvironment } from "../state/environments";
import {
  resolveThreadDetailRef,
  useEnvironmentSupportsServerBrowser,
  useProject,
  useProjects,
  useThreadProjection,
  useThreadStatus,
  useThreadHistory,
  useThreadShell,
  useChildThreadInputs,
  useThreadRefs,
  useThreadVisibleTurnItems,
} from "../state/entities";
import { environmentShell } from "../state/shell";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { createPageScrollController, type PageScrollKey } from "./chat/pageScrollController";
import { isTimelineScrollTarget } from "./chat/timelineScrollTarget";
import { DraftProjectPicker } from "./chat/DraftProjectPicker";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";
import type { AssistantCitationRequest } from "./chat/AssistantCitationSource";
import { MessagesTimeline, type MessagesTimelineHistoryControls } from "./chat/MessagesTimeline";
import { ProviderSubagentBar } from "./chat/ProviderSubagentBar";
import { getTriggerDisplayModelName } from "./chat/providerIconUtils";
import { resolveTimelineIsAtEnd, worktreeSetupAgentStarted } from "./chat/MessagesTimeline.logic";
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
  RightPanelMaximizeControl,
} from "./chat/PanelLayoutControls";
import { expandedImageKey, type ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { ThreadDetailsPanel, type ThreadDetailsPanelProps } from "./chat/ThreadDetailsPanel";
import { NoActiveThreadState } from "./NoActiveThreadState";
import {
  type EnvironmentOption,
  resolveEffectiveEnvMode,
  resolveLocalCheckoutBranchMismatch,
  resolveWorktreeBaseBranch,
  shouldShowComposerContextStrip,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import {
  getProviderStatusBannerKey,
  ProviderStatusBanner,
  shouldShowProviderStatusBanner,
} from "./chat/ProviderStatusBanner";
import {
  dismissThreadErrorBannerForSession,
  getThreadErrorBannerKey,
  isThreadErrorBannerDismissedForSession,
  shouldShowThreadErrorBanner,
  ThreadErrorBanner,
} from "./chat/ThreadErrorBanner";
import {
  QueuedRunsControl,
  type QueuedRunsControlHandle,
  type EditQueuedRunRequest,
} from "./chat/QueuedRunsControl";
import { useLinkedThreadPullRequest } from "./ThreadStatusIndicators";
import type { ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { ThreadStatusLine } from "./chat/ThreadStatusLine";
import { formatRelativeTimeLabel, formatRelativeTimeUntilLabel } from "../timestampFormat";
import { ComposerSurface } from "./chat/ComposerSurface";
import { resolveThreadSyncPhase } from "../threadSync";
import { hasAvailableCompactionProvider } from "./chat/ContextWindow.logic";
import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "../lib/contextWindow";
import {
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
  MOBILE_COMPOSER_VIEW_TRANSITION_NAME,
  runMobileComposerTransition,
} from "./chat/draftHeroTransition";
import { EASE_DRAWER, animationsSettled, prefersReducedMotion } from "../lib/motion";
import { ScrollToEndPill } from "./chat/ScrollToEndPill";
import { WorkspaceDropOverlay } from "./WorkspaceDropOverlay";
import type { ComposerDispatchMode } from "@supaterm/client-runtime/state/composer-dispatch";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  branchMismatchKey,
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftThread,
  collectUserMessageBlobPreviewUrls,
  deriveCommittedServerUserMessageIds,
  deriveComposerSendState,
  dismissBranchMismatchForSession,
  hasEnvironmentReconnectWarningGraceElapsed,
  scheduleEnvironmentReconnectWarning,
  hasServerAcknowledgedLocalDispatch,
  isBranchMismatchDismissedForSession,
  shouldShowBranchMismatchBanner,
  shouldOpenProactivePullRequest,
  shouldRetargetThreadPullRequestPanel,
  shouldOpenProactiveTurnDiff,
  shouldReleaseTimelineAnchorForToolActivity,
  shouldRenderPreviewMiniPlayer,
  getStartedThreadModelChangeBlockReason,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  PullRequestDialogState,
  deriveLockedProvider,
  readFileAsDataUrl,
  resolveFileAttachmentUrl,
  prepareRevertedMessageAttachments,
  waitForRevertedMessage,
  reconcileMountedTerminalThreadIds,
  resolveComposerProviderSelection,
  getAntigravitySendBlockReason,
  observeProactivePanelUserChoice,
  resolveProactiveTurnDiffAction,
  resolveThreadMetadataUpdateForNextTurn,
  resolveSendEnvMode,
  shouldRequireWorktreeBaseBranch,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  startNewThreadForProject,
  codexArtifactTemplatePromptToAppend,
  shouldRefocusComposerOnWindowFocus,
} from "./ChatView.logic";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useComposerHandleContext } from "../composerHandleContext";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "../lib/attachmentUploadQueue";
import { sanitizeThreadErrorMessage } from "~/rpc/transportError";
import { RightPanelSheet } from "./RightPanelSheet";
import { previewEnvironment } from "../state/preview";
import { clampFileAttachmentUploadBytes } from "@supaterm/client-runtime/state/attachments";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  enqueueThreadOutboxTurns,
  usePendingThreadCreation,
  type PendingThreadTurn,
} from "../state/threadOutbox";
import { buildEditedThreadOutboxTurn, useThreadOutboxEditor } from "../state/threadOutboxEditing";
import { ThreadOutboxControl } from "./chat/ThreadOutboxControl";
import { fileAttachmentCapabilityBlockReason } from "./chat/composerAttachmentFiles";
import { assetEnvironment } from "../state/assets";
import { readEnvironmentScope, readPreparedConnection } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { Button, InlineButton } from "./ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import {
  PreviewPanelGroup,
  PreviewPanelInline,
  PreviewPanelSibling,
} from "./preview/PreviewPanelLayout";
import { ServerUpdateAction } from "./ServerUpdateAction";
import { useAutoBalanceUpdateBanner } from "./chat/useAutoBalanceUpdateBanner";
import { InlineConfirmButton } from "./InlineConfirm";
import {
  ComposerServerUpdateIcon,
  ComposerServerUpdateStatus,
} from "./chat/ComposerServerUpdateStatus";
import {
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  serverUpdateGuidance,
  supportsDesktopAppUpdate,
} from "../versionSkew";
import { useAssetUrls } from "../assets/assetUrls";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@supaterm/shared/composerContextReferences";
import { recallableComposerPrompt } from "./chat/composerPromptHistory";
import { observeResize } from "~/lib/observeResize";

const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PROVIDER_MODELS: ServerProvider["models"] = [];
const EMPTY_USAGE_LIMIT_SOURCES: UsageLimitSourceSnapshots = [];
import type { CodexArtifactTemplate } from "@supaterm/shared/codexArtifactTemplates";

const TIMELINE_SCROLL_CANCEL_SENTINEL = Object.freeze({});
const EMPTY_FEEDBACK_SUBMISSIONS: ReadonlyArray<CodexFeedbackSubmission> = [];
// During an active turn the thread's updatedAt advances several times per
// second, and every server-side visit is a full command dispatch plus a
// broadcast to all shell subscribers.
const VISIT_DISPATCH_THROTTLE_MS = 10_000;
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
// Measures the prompt surface, not its anchor: the hero's context strip above it
// and a thread's strip below it come and go with the state change.
function measureComposerSurface(anchor: HTMLElement | null): DOMRect | null {
  const surface = anchor?.querySelector('[data-chat-composer-main-surface="true"]') ?? anchor;
  return surface?.getBoundingClientRect() ?? null;
}

function useDraftHeroLayoutTransition(
  isDraftHeroState: boolean,
  animationsActive: boolean,
  animationDurationMs: number,
) {
  const transitionGroupRef = useRef<HTMLDivElement | null>(null);
  const composerAnchorRef = useRef<HTMLDivElement | null>(null);
  const previousStateRef = useRef(isDraftHeroState);
  const previousComposerRectRef = useRef<DOMRect | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const attachTransitionGroupRef = (element: HTMLDivElement | null) => {
    transitionGroupRef.current = element;
  };
  const attachComposerAnchorRef = (element: HTMLDivElement | null) => {
    composerAnchorRef.current = element;
  };

  const captureLayout = () => {
    previousComposerRectRef.current = measureComposerSurface(composerAnchorRef.current);
  };

  useLayoutEffect(() => {
    const transitionGroup = transitionGroupRef.current;
    const nextComposerRect = measureComposerSurface(composerAnchorRef.current);
    const stateChanged = previousStateRef.current !== isDraftHeroState;
    const mobileComposerTransitionActive =
      typeof document !== "undefined" &&
      document.documentElement.dataset.mobileComposerRouteTransition === "true";

    animationRef.current?.cancel();
    animationRef.current = null;
    const previousComposerRect = previousComposerRectRef.current;
    if (
      stateChanged &&
      animationsActive &&
      !mobileComposerTransitionActive &&
      transitionGroup &&
      previousComposerRect &&
      nextComposerRect &&
      typeof transitionGroup.animate === "function"
    ) {
      const translateX = previousComposerRect.left - nextComposerRect.left;
      const translateY = previousComposerRect.top - nextComposerRect.top;
      if (Math.abs(translateX) >= 0.5 || Math.abs(translateY) >= 0.5) {
        const animation = transitionGroup.animate(
          [
            { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: animationDurationMs,
            easing: EASE_DRAWER,
          },
        );
        animation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
        animationRef.current = animation;
        void animation.finished
          .catch(() => undefined)
          .then(() => {
            if (animationRef.current === animation) animationRef.current = null;
          });
      }
    }
    previousStateRef.current = isDraftHeroState;
    previousComposerRectRef.current = nextComposerRect;
  }, [animationDurationMs, animationsActive, isDraftHeroState]);

  return {
    transitionGroupRef: attachTransitionGroupRef,
    composerAnchorRef: attachComposerAnchorRef,
    captureLayout,
  } as const;
}

const PreviewPanel = lazy(() =>
  import("./preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const DiffPanel = lazy(() => import("./DiffPanel"));
const selectAutoShowFloatingPreview = (settings: { browserAutoShowFloatingPreview: boolean }) =>
  settings.browserAutoShowFloatingPreview;
const DevicePanel = lazy(() =>
  import("./device/DevicePanel").then((module) => ({ default: module.DevicePanel })),
);
const FilePreviewPanel = lazy(() => import("./files/FilePreviewPanel"));
const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();
const TYPE_TO_FOCUS_EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(",");
const TYPE_TO_FOCUS_INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(",");
// Popups match only while open or closing: some stay mounted when closed,
// such as the chat header actions menu.
const TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR = [
  '[role="dialog"][aria-modal="true"]',
  '[data-slot="alert-dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="command-dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="dialog-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="sheet-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="sidebar"][data-mobile="true"]:is([data-open],[data-ending-style])',
  '[data-slot="menu-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="select-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="popover-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="combobox-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="autocomplete-popup"]:is([data-open],[data-ending-style])',
].join(",");

type EnvironmentUnavailableState = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: EnvironmentConnectionPresentation;
};

function eventPathContainsSelector(event: Event, selector: string): boolean {
  const path = event.composedPath();
  if (path.length === 0 && event.target) {
    path.push(event.target);
  }
  return path.some((target) => target instanceof Element && target.closest(selector));
}

function shouldRedirectInputToComposer(event: Event): boolean {
  if (event.defaultPrevented) return false;
  if (eventPathContainsSelector(event, TYPE_TO_FOCUS_EDITABLE_SELECTOR)) return false;
  if (eventPathContainsSelector(event, TYPE_TO_FOCUS_INTERACTIVE_SELECTOR)) return false;
  if (document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR)) return false;
  return true;
}

function shouldTypeToFocusComposer(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key.length !== 1) return false;
  if (!shouldRedirectInputToComposer(event)) return false;

  return true;
}

function pasteTextToFocusComposer(event: ClipboardEvent): string | null {
  if (!event.clipboardData || event.clipboardData.files.length > 0) return null;
  if (!shouldRedirectInputToComposer(event)) return null;
  const text = event.clipboardData.getData("text/plain");
  return text.length > 0 ? text : null;
}

const draftFanoutStateAtom = Atom.family((_routeKey: string) =>
  Atom.make({
    selections: null as ReadonlyArray<ModelSelection> | null,
    sendInFlight: { current: false },
    uncertainSubmissions: { current: new Map<string, ThreadId>() },
  }).pipe(Atom.keepAlive),
);
const selectDraftFanoutSelections = (state: {
  readonly selections: ReadonlyArray<ModelSelection> | null;
}) => state.selections;

function formatOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  const promptEffort = resolvePromptInjectedEffort(caps, params.effort);
  return applyClaudePromptEffortPrefix(params.text, promptEffort);
}
const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

function isCompactCommandMessage(message: ChatMessage): boolean {
  const text = message.text.trim().toLowerCase();
  return message.role === "user" && text === "/compact" && !message.attachments?.length;
}

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

interface TerminalLaunchContext {
  threadId: ThreadId;
  cwd: string;
  worktreePath: string | null;
}

function useLocalDispatchState(input: {
  activeThread: Thread | undefined;
  activeLatestRun: Thread["latestRun"] | null;
  latestUserMessageId: MessageId | null;
  phase: SessionPhase;
  activePendingApproval: RuntimeRequestId | null;
  activePendingUserInput: RuntimeRequestId | null;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null);
  }, []);

  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: input.phase,
        latestRun: input.activeLatestRun,
        latestUserMessageId: input.latestUserMessageId,
        runtime: input.activeThread?.runtime ?? null,
        hasPendingApproval: input.activePendingApproval !== null,
        hasPendingUserInput: input.activePendingUserInput !== null,
        threadError: input.threadError,
      }),
    [
      input.activeLatestRun,
      input.latestUserMessageId,
      input.activePendingApproval,
      input.activePendingUserInput,
      input.activeThread?.runtime,
      input.phase,
      input.threadError,
      localDispatch,
    ],
  );
  const activeLocalDispatch = serverAcknowledgedLocalDispatch ? null : localDispatch;
  return {
    resetLocalDispatch,
    localDispatchStartedAt: activeLocalDispatch?.startedAt ?? null,
    isPreparingWorktree: activeLocalDispatch?.preparingWorktree ?? false,
    isSendBusy: activeLocalDispatch !== null,
    backgroundSubmissionPending: activeLocalDispatch?.submissionIntent === "background",
  };
}

type LocalThreadErrorEntry = {
  readonly message: string | null;
  readonly at: number;
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

function chatActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

const EMPTY_HELD_TURN_DIFF_SUMMARIES: readonly never[] = [];
const noopHeldTurnDiff = (_turnId: RunId, _filePath?: string) => {};
const noopHeldRevert = (_targetTurnCount: number) => {};
const noopHeldAttachment = (_attachment: ChatFileAttachment) => {};

function releaseChatTimelineAnchor<T extends { readonly messageId: MessageId | null }>(
  current: T,
): T {
  return current.messageId === null ? current : { ...current, messageId: null };
}

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

const retryingWorkspacePreparationRunIds = new Set<RunId>();

function makeThreadErrorSetter(input: {
  readonly routeThreadRef: ScopedThreadRef;
  readonly routeThreadKey: string;
  readonly draftId: DraftId | null;
  readonly serverThreadRef: ScopedThreadRef | null;
  readonly setLocalServerErrorsByThreadKey: (
    update: SetStateAction<Record<string, LocalThreadErrorEntry>>,
  ) => void;
  readonly setLocalDraftErrorsByDraftId: (
    update: SetStateAction<Record<string, LocalThreadErrorEntry>>,
  ) => void;
}) {
  return (targetThreadId: ThreadId | null, error: string | null) => {
    if (!targetThreadId) return;
    const nextError = sanitizeThreadErrorMessage(error);
    const nextEntry: LocalThreadErrorEntry = { message: nextError, at: Date.now() };
    const { routeThreadRef, serverThreadRef } = input;
    if (
      serverThreadRef &&
      targetThreadId === routeThreadRef.threadId &&
      serverThreadRef.environmentId === routeThreadRef.environmentId &&
      serverThreadRef.threadId === targetThreadId
    ) {
      input.setLocalServerErrorsByThreadKey((existing) => {
        if ((existing[input.routeThreadKey]?.message ?? null) === nextError) {
          return existing;
        }
        return { ...existing, [input.routeThreadKey]: nextEntry };
      });
      return;
    }
    const localDraftErrorKey = input.draftId ?? targetThreadId;
    input.setLocalDraftErrorsByDraftId((existing) => {
      if ((existing[localDraftErrorKey]?.message ?? null) === nextError) {
        return existing;
      }
      return { ...existing, [localDraftErrorKey]: nextEntry };
    });
  };
}

function makeQueuedEditDraftTarget(threadRef: ScopedThreadRef) {
  return (runId: RunId) => DraftId.make(`queued-edit:${scopedThreadKey(threadRef)}:${runId}`);
}

function makeModelDisabledReason(
  context: Omit<
    Parameters<typeof getStartedThreadModelChangeBlockReason>[0],
    "nextModelSelection"
  > | null,
) {
  return (instanceId: ProviderInstanceId, model: string): string | null => {
    if (!context) return null;
    const reason = getStartedThreadModelChangeBlockReason({
      ...context,
      nextModelSelection: { instanceId, model },
    });
    return reason ? `${reason.description} Start a new thread to use this model.` : null;
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
  const canQueueMessage = useAtomValue(canQueueComposerMessageAtom(environmentId));
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const hasTerminalWriteAccess = () =>
    readEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const canReadTerminal = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  const draftId = routeKind === "draft" ? props.draftId : null;
  const handleNewThread = useNewThreadHandler();
  const { markThreadDone, pinThread, confirmAndUnpinThread } = useThreadActions();
  const routeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const routeThreadKey = useMemo(() => scopedThreadKey(routeThreadRef), [routeThreadRef]);
  const pendingCreationEntry = usePendingThreadCreation(routeThreadRef);
  const queuedCreation = useMemo(
    () => (pendingCreationEntry ? presentPendingThreadCreation(pendingCreationEntry) : null),
    [pendingCreationEntry],
  );
  const currentRouteThreadKeyRef = useRef<string | null>(routeThreadKey);
  useLayoutEffect(() => {
    currentRouteThreadKeyRef.current = routeThreadKey;
    return () => {
      currentRouteThreadKeyRef.current = null;
    };
  }, [routeThreadKey]);
  const updateProjectScriptSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, {
    reportFailure: false,
  });
  const removeKeybinding = useAtomCommand(serverEnvironment.removeKeybinding, {
    reportFailure: false,
  });
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const switchGitRef = useAtomCommand(vcsEnvironment.switchRef, { reportFailure: false });
  const setThreadRuntimeMode = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const setThreadInteractionMode = useOrchestrationCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const resumeThreadQueue = useOrchestrationCommand(threadEnvironment.resumeThreadQueue, {
    reportFailure: false,
  });
  const uploadThreadFeedback = useOrchestrationCommand(threadEnvironment.uploadFeedback, {
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
  const revertThreadCheckpoint = useOrchestrationCommand(threadEnvironment.revertCheckpoint, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const { environments } = useEnvironments();
  const primaryEnvironment = usePrimaryEnvironment();
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const setEnvironmentEnabled = useAtomCommand(environmentCatalog.setEnabled, {
    reportFailure: false,
  });
  const environmentById = useMemo(
    () => new Map(environments.map((environment) => [environment.environmentId, environment])),
    [environments],
  );
  const [editingQueuedRun, setEditingQueuedRun] = useState<{
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly messageId: MessageId;
    readonly originalText: string;
    readonly existingAttachments: ReadonlyArray<ContractChatAttachment>;
    readonly context?: import("@supaterm/contracts").OrchestrationMessageContext | undefined;
  } | null>(null);
  const queuedEditDraftTargetFor = useMemo(
    () => makeQueuedEditDraftTarget(routeThreadRef),
    [routeThreadRef],
  );
  const baseComposerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const outboxEditor = useThreadOutboxEditor(scopedThreadKey(routeThreadRef));
  const composerDraftTarget: ScopedThreadRef | DraftId =
    outboxEditor.editing?.draftTarget ??
    (editingQueuedRun === null
      ? baseComposerDraftTarget
      : queuedEditDraftTargetFor(editingQueuedRun.runId));
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const serverThread = useThreadShell(routeThreadRef);
  const routeThreadDetailRef = resolveThreadDetailRef(routeThreadRef, {
    shellExists: serverThread !== null,
    waitForShell: draftThread !== null || pendingCreationEntry !== null,
  });
  const serverThreadProjection = useThreadProjection(routeThreadDetailRef);
  const serverProjection = serverThreadProjection?.projection ?? null;
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
  const pendingCreationMessages = useMemo<ChatMessage[]>(() => {
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
  }, [pendingThreadCreation, pendingCreationAttachments, serverProjection]);
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
  const activeThreadLiveTokenUsage = useMemo(
    () => latestProviderTurnTokenUsage(serverProjection?.providerTurns ?? []),
    [serverProjection?.providerTurns],
  );
  const serverVisibleTurnItems = useThreadVisibleTurnItems(routeThreadDetailRef);
  const serverThreadHistory = useThreadHistory(routeThreadDetailRef);
  const threadHistoryControls = useMemo<MessagesTimelineHistoryControls | undefined>(() => {
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
  }, [loadEarlierThreadHistory, routeThreadDetailRef, serverThreadHistory]);
  const committedServerMessageIds = useMemo(
    () => deriveCommittedServerUserMessageIds(serverVisibleTurnItems),
    [serverVisibleTurnItems],
  );
  // Queued messages have no turn item until their run starts, so the
  // turn-item-derived set alone can never retire their optimistic rows —
  // cancelling such a run would leave a phantom "pending" queue row behind.
  const serverAcknowledgedUserMessageIds = useMemo(() => {
    const ids = new Set(committedServerMessageIds);
    for (const message of serverProjection?.messages ?? []) {
      if (message.role === "user") ids.add(message.id);
    }
    return ids;
  }, [committedServerMessageIds, serverProjection]);
  const visitThreadMutation = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const lastDispatchedVisitRef = useRef<string | null>(null);
  const lastVisitDispatchAtRef = useRef(0);
  const settings = useEnvironmentSettings(environmentId);
  const clientSettingsHydrated = useClientSettingsHydrated();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  const citationLocation = useLocation({
    select: (location) => ({
      href: location.href,
      key: location.state.assistantCitationActivation ?? location.state.__TSR_key,
    }),
  });
  const citationRequest = useMemo<AssistantCitationRequest | null>(() => {
    const citation = assistantCitationFromLocation(citationLocation.href);
    return citation && citation.environmentId === environmentId && citation.threadId === threadId
      ? { citation, key: citationLocation.key ?? citationLocation.href }
      : null;
  }, [citationLocation.href, citationLocation.key, environmentId, threadId]);
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
  const composerHasNonPromptContent = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft ? composerDraftHasUserContent({ ...draft, prompt: "" }) : false;
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (store) => store.getDraftSessionByLogicalProjectKey,
  );
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const composerRef = useChatComposerRef();
  const branchToolbarRef = useRef<BranchToolbarHandle>(null);
  const pasteAsTextShortcutUntilRef = useRef(0);
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
  const [showScrollToBottom, setShowScrollToBottom] = useState(
    () => readTimelinePosition(routeThreadKey)?.atEnd === false,
  );
  const [isWorkspaceFileDragActive, setIsWorkspaceFileDragActive] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  useEffect(() => {
    const item = expandedImage?.images[expandedImage.index];
    if (item?.type !== "video" || item.src === null || !item.src.startsWith("blob:")) return;
    const src = item.src;
    return () => revokeBlobPreviewUrl(src);
  }, [expandedImage]);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  // Last live snapshot from the setup stream. The server drops a finished
  // snapshot after a grace period and emits null; holding it here bridges the
  // gap until the settled activity arrives on the thread projection.
  const [worktreeSetupRef, setWorktreeSetupRef] = useState<{
    environmentId: EnvironmentId;
    threadId: ThreadId;
    ownerKey: string;
  } | null>(null);
  const [heldWorktreeSetup, setHeldWorktreeSetup] = useState<WorktreeSetupSnapshot | null>(null);
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
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  useLayoutEffect(() => {
    optimisticUserMessagesRef.current = optimisticUserMessages;
  });
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
  const shouldUsePlanSidebarSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const isMobileViewport = useMediaQuery("max-sm");
  const threadPanelPopoverAnchorRef = useRef<HTMLElement | null>(null);
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [terminalUiLaunchContext, setTerminalUiLaunchContext] =
    useState<TerminalLaunchContext | null>(null);
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const legendListRef = useRef<LegendListRef | null>(null);
  const getTimelineScrollableNode = () => legendListRef.current?.getScrollableNode() ?? null;
  const getTimelineScrollableNodeStable = useStableCallback(getTimelineScrollableNode);
  const [composerOverlayElement, setComposerOverlayElement] = useState<HTMLDivElement | null>(null);
  const [composerTimelineInset, setComposerTimelineInset] = useState(0);
  const composerTimelineInsetRef = useRef(0);
  const composerRestingRef = useRef(false);
  const [composerResting, setComposerResting] = useState(false);
  const composerMountedRef = useRef(true);
  const [scrollToEndClearance, setScrollToEndClearance] = useState(0);
  const isAtEndRef = useRef(true);
  const isTimelineAtLogicalEnd = () =>
    resolveTimelineIsAtEnd(legendListRef.current?.getState()) ?? isAtEndRef.current;
  const isTimelineAtLogicalEndStable = useStableCallback(isTimelineAtLogicalEnd);
  const [timelineOverflows, setTimelineOverflows] = useState(false);
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewPromotionInFlightByMessageIdRef = useRef<Record<string, true>>({});
  const fanoutStateAtom = draftFanoutStateAtom(routeThreadKey);
  const fanoutState = useAtomValue(fanoutStateAtom);
  const sendInFlightRef = fanoutState.sendInFlight;
  const isSendInFlight = useEffectEvent(() => sendInFlightRef.current);
  const [resumingThreadKeys, setResumingThreadKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const isResuming = resumingThreadKeys.has(routeThreadKey);
  const multipleModelSelections = useAtomValue(fanoutStateAtom, selectDraftFanoutSelections);
  const setMultipleModelSelections = (
    selections: SetStateAction<ReadonlyArray<ModelSelection> | null>,
  ) => {
    appAtomRegistry.update(fanoutStateAtom, (current) => ({
      ...current,
      selections: typeof selections === "function" ? selections(current.selections) : selections,
    }));
  };
  const setMultipleModelSelectionsStable = useStableCallback(setMultipleModelSelections);
  const multipleModelSelectionsRef = useRef(multipleModelSelections);
  useLayoutEffect(() => {
    multipleModelSelectionsRef.current = multipleModelSelections;
  });
  const feedbackUploadsInFlightRef = useRef(new Set<string>());
  const terminalUiOpenByThreadRef = useRef<Record<string, boolean>>({});

  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef),
  );
  const openTerminalThreadKeys = useTerminalUiStateStore(
    useShallow((state) =>
      Object.entries(state.terminalUiStateByThreadKey).flatMap(
        ([nextThreadKey, nextTerminalUiState]) =>
          nextTerminalUiState.terminalOpen ? [nextThreadKey] : [],
      ),
    ),
  );
  const storeSetTerminalOpen = useTerminalUiStateStore((s) => s.setTerminalOpen);
  const storeEnsureTerminal = useTerminalUiStateStore((state) => state.ensureTerminal);
  const storeSplitTerminal = useTerminalUiStateStore((s) => s.splitTerminal);
  const storeSplitTerminalVertical = useTerminalUiStateStore((s) => s.splitTerminalVertical);
  const storeNewTerminal = useTerminalUiStateStore((s) => s.newTerminal);
  const storeSetActiveTerminal = useTerminalUiStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalUiStateStore((s) => s.closeTerminal);
  const serverThreadRefs = useThreadRefs();
  const serverThreadKeys = useMemo(() => serverThreadRefs.map(scopedThreadKey), [serverThreadRefs]);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadKeys = useMemo(
    () =>
      Object.values(draftThreadsByThreadKey).map((draftThread) =>
        scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
      ),
    [draftThreadsByThreadKey],
  );
  const [mountedTerminalThreadKeys, setMountedTerminalThreadKeys] = useState<string[]>([]);
  const mountedTerminalThreadRefs = useMemo(
    () =>
      mountedTerminalThreadKeys.flatMap((mountedThreadKey) => {
        const mountedThreadRef = parseScopedThreadKey(mountedThreadKey);
        return mountedThreadRef ? [{ key: mountedThreadKey, threadRef: mountedThreadRef }] : [];
      }),
    [mountedTerminalThreadKeys],
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
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            resolveProjectSettings(
              settings,
              fallbackDraftProject?.id ?? null,
              fallbackDraftProject ?? undefined,
            ).settings.defaultModelSelection ?? NO_PROVIDER_MODEL_SELECTION,
          )
        : undefined,
    [draftThread, fallbackDraftProject, settings, threadId],
  );
  const isServerThread = serverThread !== null;
  const activeThread = serverThread ?? pendingThreadCreation?.message.shell ?? localDraftThread;
  const serverLatestRun = useMemo(
    () => (serverProjection === null ? null : deriveLatestThreadRun(serverProjection)),
    [serverProjection],
  );
  const serverActivityRun = useMemo(
    () => (serverProjection === null ? null : deriveThreadActivityRun(serverProjection)),
    [serverProjection],
  );
  const serverRuntime = useMemo(
    () => (serverProjection === null ? null : deriveThreadRuntime(serverProjection)),
    [serverProjection],
  );
  const runlessWorkStartedAt = useMemo(
    () => (serverProjection === null ? null : deriveRunlessWorkStartedAt(serverProjection)),
    [serverProjection],
  );
  const providerSubagentStatus = useMemo(
    () => (serverProjection === null ? null : deriveProviderSubagentStatus(serverProjection)),
    [serverProjection],
  );
  const isProviderSubagent =
    serverThread !== null && isProviderNativeSubagentThread(serverThread.source);
  const supportsProviderSwitchingViaHandoff = useMemo(
    () => threadSupportsProviderHandoff(serverProjection),
    [serverProjection],
  );
  const activeLatestRun = isServerThread ? serverLatestRun : (activeThread?.latestRun ?? null);
  const activeActivityRun = isServerThread ? serverActivityRun : (activeThread?.latestRun ?? null);
  const activeRuntime = isServerThread ? serverRuntime : (activeThread?.runtime ?? null);
  const hasHeldQueuedRuns =
    isServerThread &&
    serverProjection?.runs.some((run) => run.status === "queued" && run.queueHeld === true) ===
      true;
  const resumableRunId = useMemo(() => {
    if (!isServerThread || serverProjection === null) return null;
    const run = latestExecutedRun(serverProjection.runs);
    if (run?.status === "interrupted") return run.id;
    return run?.status === "failed" &&
      serverRuntime?.lastErrorClass === "usage_limit" &&
      latestRootProviderFailure(run, serverProjection.turnItems)?.class === "usage_limit"
      ? run.id
      : null;
  }, [isServerThread, serverProjection, serverRuntime?.lastErrorClass]);
  const parentSubagentThreadId =
    activeThread?.lineage.relationshipToParent === "subagent"
      ? activeThread.lineage.parentThreadId
      : null;
  const parentSubagentEnvironmentId = activeThread?.environmentId ?? null;
  const parentSubagentThreadRef = useMemo(() => {
    if (parentSubagentEnvironmentId === null || parentSubagentThreadId === null) {
      return null;
    }
    return scopeThreadRef(parentSubagentEnvironmentId, parentSubagentThreadId);
  }, [parentSubagentEnvironmentId, parentSubagentThreadId]);
  const parentSubagentThread = useThreadShell(parentSubagentThreadRef);
  const parentThreadLink = useMemo(
    () =>
      parentSubagentThreadRef === null
        ? null
        : {
            threadId: parentSubagentThreadRef.threadId,
            title: parentSubagentThread?.title ?? "Parent thread",
          },
    [parentSubagentThread?.title, parentSubagentThreadRef],
  );
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
  const activeThreadKnownSessions = useMemo(() => {
    if (activeThreadId === null || activeThreadKnownSessionsRaw === null) {
      return [];
    }
    return activeThreadKnownSessionsRaw.filter(
      (session) => session.target.threadId === activeThreadId,
    );
  }, [activeThreadId, activeThreadKnownSessionsRaw]);
  const activeServerOrderedTerminalIds = useMemo(
    () => activeThreadKnownSessions.map((session) => session.target.terminalId),
    [activeThreadKnownSessions],
  );
  const activeKnownTerminalIds = useMemo(
    () => [...new Set([...activeServerOrderedTerminalIds, ...terminalUiState.terminalIds])],
    [activeServerOrderedTerminalIds, terminalUiState.terminalIds],
  );
  const activeTerminalLabelsById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const session of activeThreadKnownSessions) {
      labels.set(
        session.target.terminalId,
        resolveTerminalSessionLabel(session.target.terminalId, session.state.summary),
      );
    }
    return labels;
  }, [activeThreadKnownSessions]);
  const activeTerminalHasRunningSubprocessById = useMemo(
    () =>
      new Map(
        activeThreadKnownSessions.map((session) => [
          session.target.terminalId,
          session.state.hasRunningSubprocess,
        ]),
      ),
    [activeThreadKnownSessions],
  );
  const activeThreadRef = useActiveThreadRef(activeThread);
  const terminalActions = useThreadTerminalActions(activeThreadRef);
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const activeEnvironmentServerBrowser = useEnvironmentSupportsServerBrowser(
    activeThreadRef?.environmentId ?? null,
  );
  const browserAvailable = isPreviewSupportedInRuntime() || activeEnvironmentServerBrowser;
  const activeThreadShell = useThreadShell(isServerThread ? activeThreadRef : null);
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
  const anchorRunSettled = useMemo(() => {
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
  }, [serverProjection, timelineAnchorMessageId]);
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
  const resolvePreviewRuntimeTabId = useMemo(
    () =>
      activeThreadRef
        ? (tabId: string) => previewRuntimeTabId(activeThreadRef, activePreviewServerEpoch, tabId)
        : undefined,
    [activeThreadRef, activePreviewServerEpoch],
  );
  const activePreviewMiniPlayer = usePreviewMiniPlayerStore((state) =>
    selectThreadPreviewMiniPlayer(state.byThreadKey, activeThreadRef),
  );
  const panelTerminalIds = useMemo(
    () =>
      new Set(
        rightPanelState.surfaces.flatMap((surface) =>
          surface.kind === "terminal" ? surface.terminalIds : [],
        ),
      ),
    [rightPanelState.surfaces],
  );
  const canReuseTerminal = activeThreadKnownSessionsRaw !== null;
  const previewPanelOpen = activeRightPanelKind === "preview" && browserAvailable;
  const rightPanelOpen = rightPanelState.isOpen;
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const activeTerminalDrawerPresence = usePanelPresence(
    Boolean(activeThreadKey && terminalUiState.terminalOpen),
    true,
    panelAnimationsActive,
    activeThreadKey,
    panelAnimationDurationMs,
  );
  const rightPanelPresenceValue = useMemo(
    () => ({
      activeSurface: activeRightPanelSurface,
      surfaces: rightPanelState.surfaces,
    }),
    [activeRightPanelSurface, rightPanelState.surfaces],
  );
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

  const existingOpenTerminalThreadKeys = useMemo(() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter((nextThreadKey) => existingThreadKeys.has(nextThreadKey));
  }, [draftThreadKeys, openTerminalThreadKeys, serverThreadKeys]);
  const reconciledMountedTerminalThreadKeys = reconcileMountedTerminalThreadIds({
    currentThreadIds: mountedTerminalThreadKeys,
    openThreadIds: existingOpenTerminalThreadKeys,
    activeThreadId: activeThreadKey,
    activeThreadTerminalOpen: activeTerminalDrawerPresence.present,
    maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  });
  if (
    mountedTerminalThreadKeys.length !== reconciledMountedTerminalThreadKeys.length ||
    mountedTerminalThreadKeys.some(
      (mountedThreadKey, index) => mountedThreadKey !== reconciledMountedTerminalThreadKeys[index],
    )
  ) {
    setMountedTerminalThreadKeys(reconciledMountedTerminalThreadKeys);
  }
  const latestRunSettled = isLatestRunSettled(activeLatestRun, activeRuntime);
  const activePlan = useMemo(
    () => deriveActivePlanState(serverProjection, activeActivityRun?.runId),
    [activeActivityRun?.runId, serverProjection],
  );
  // Tasks progress for the running turn's own plan only — deriveActivePlanState
  // falls back to older runs' plans, which must not label fresh work.
  const activeComposerTasksProgress = useMemo(() => {
    if (
      isLatestRunSettled(activeActivityRun, activeRuntime) ||
      !activePlan ||
      activePlan.runId !== (activeActivityRun?.runId ?? null)
    ) {
      return null;
    }
    const totalSteps = activePlan.steps.length;
    if (totalSteps === 0) return null;
    const completedSteps = activePlan.steps.filter((step) => step.status === "completed").length;
    const step =
      activePlan.steps.find((candidate) => candidate.status === "inProgress")?.step ??
      activePlan.steps.find((candidate) => candidate.status === "pending")?.step ??
      activePlan.steps.at(-1)!.step;
    return { step, completedSteps, totalSteps };
  }, [activeActivityRun, activePlan, activeRuntime]);
  const activeComposerTaskSteps =
    activeComposerTasksProgress && activePlan ? activePlan.steps : null;
  const activeThreadEnvironmentId = activeThread?.environmentId ?? null;
  const activeThreadProjectId = activeThread?.projectId ?? null;
  const activeProjectRef = useMemo(
    () =>
      activeThreadEnvironmentId !== null && activeThreadProjectId !== null
        ? scopeProjectRef(activeThreadEnvironmentId, activeThreadProjectId)
        : null,
    [activeThreadEnvironmentId, activeThreadProjectId],
  );
  const activeProject = useProject(activeProjectRef);
  const activeProjectSettings = useMemo(
    () => resolveProjectSettings(settings, activeProject?.id ?? null, activeProject ?? undefined),
    [activeProject, settings],
  );
  const activeProjectScripts = useMemo(
    () => (activeProject ? resolveProjectScripts(settings, activeProject) : []),
    [activeProject, settings],
  );
  const activeProjectClone = useProjectClone(activeProjectRef);
  const cancelProjectClone = useAtomCommand(sourceControlEnvironment.cancelProjectClone, {
    reportFailure: false,
  });
  const retryProjectClone = useAtomCommand(sourceControlEnvironment.retryProjectClone, {
    reportFailure: false,
  });
  const removeClonedProject = useRemoveClonedProject();
  const runProjectCloneAction = async (
    title: string,
    action: () => Promise<AtomCommandResult<unknown, unknown>>,
  ): Promise<void> => {
    const result = await action();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  };
  const runProjectCloneActionStable = useStableCallback(runProjectCloneAction);
  const projectCloneSendBlockReason =
    activeProjectClone === null
      ? null
      : activeProjectClone.phase === "running"
        ? "Cloning repository"
        : activeProjectClone.phase === "done"
          ? null
          : "Repository not cloned";
  const projectCloneBannerItem = useMemo<ComposerBannerStackItem | null>(() => {
    if (!activeProjectClone || !activeProjectRef || activeProjectClone.phase === "done") {
      return null;
    }
    const name = projectCloneDisplayName(activeProjectClone);
    const { environmentId, projectId } = activeProjectRef;
    if (activeProjectClone.phase === "running") {
      return {
        id: `project-clone:${projectId}`,
        variant: "info",
        priority: "activity",
        icon: <DownloadIcon />,
        title: `Cloning ${name}`,
        description: projectCloneProgressSummary(activeProjectClone),
        actions: (
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void runProjectCloneActionStable("Failed to cancel clone", () =>
                cancelProjectClone({ environmentId, input: { projectId } }),
              )
            }
          >
            Cancel
          </Button>
        ),
      };
    }
    const cancelled = activeProjectClone.phase === "cancelled";
    return {
      id: `project-clone:${projectId}`,
      variant: cancelled ? "warning" : "error",
      icon: <DownloadIcon />,
      title: cancelled ? `Cancelled cloning ${name}` : `Failed to clone ${name}`,
      description: cancelled ? "Retry to bring in the repository." : activeProjectClone.error,
      actions: (
        <>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void removeClonedProject({ environmentId, projectId })}
          >
            Remove project
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void runProjectCloneActionStable("Failed to retry clone", () =>
                retryProjectClone({ environmentId, input: { projectId } }),
              )
            }
          >
            Retry
          </Button>
        </>
      ),
    };
  }, [
    activeProjectClone,
    activeProjectRef,
    cancelProjectClone,
    removeClonedProject,
    retryProjectClone,
    runProjectCloneActionStable,
  ]);
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
  const activeEnvironmentShell = useEnvironmentQuery(
    activeThread ? environmentShell.stateAtom(activeThread.environmentId) : null,
  );
  const activeEnvironmentBootstrapComplete = activeEnvironmentShell.data?.snapshot._tag === "Some";
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
  const configuredPreviewUrls = useMemo(
    () => getConfiguredPreviewUrls(activeProjectScripts),
    [activeProjectScripts],
  );

  useEffect(() => {
    if (!activeThreadRef || !activeEnvironmentBootstrapComplete) return;
    useRightPanelStore.getState().reconcileFileSurfaces(activeThreadRef, activeProject !== null);
  }, [activeEnvironmentBootstrapComplete, activeProject, activeThreadRef]);

  const allProjects = useProjects();
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
  const activeReconnectingEnvironmentId =
    activeEnvironmentConnectionPhase === "connecting" ||
    activeEnvironmentConnectionPhase === "reconnecting"
      ? (activeEnvironment?.environmentId ?? null)
      : null;
  const [reconnectWarningGraceElapsedEnvironmentId, setReconnectWarningGraceElapsedEnvironmentId] =
    useState<EnvironmentId | null>(null);
  const reconnectWarningGraceElapsed = hasEnvironmentReconnectWarningGraceElapsed(
    activeReconnectingEnvironmentId,
    reconnectWarningGraceElapsedEnvironmentId,
  );
  useEffect(() => {
    if (activeReconnectingEnvironmentId === null) return;
    const cancelReconnectWarning = scheduleEnvironmentReconnectWarning(() =>
      setReconnectWarningGraceElapsedEnvironmentId(activeReconnectingEnvironmentId),
    );
    return () => {
      cancelReconnectWarning();
      setReconnectWarningGraceElapsedEnvironmentId(null);
    };
  }, [activeReconnectingEnvironmentId]);
  const activeEnvironmentUnavailableLabel = activeEnvironment?.label ?? null;
  const activeEnvironmentUnavailableState = useMemo<EnvironmentUnavailableState | null>(() => {
    if (!activeEnvironmentUnavailable || !activeEnvironmentUnavailableLabel || !activeEnvironment) {
      return null;
    }

    return {
      environmentId: activeEnvironment.environmentId,
      label: activeEnvironmentUnavailableLabel,
      connection: activeEnvironment.connection,
    };
  }, [activeEnvironment, activeEnvironmentUnavailable, activeEnvironmentUnavailableLabel]);
  const handleReconnectActiveEnvironment = async (environmentId: EnvironmentId) => {
    const result = await retryEnvironment(environmentId);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not reconnect environment",
          description: error instanceof Error ? error.message : "Failed to reconnect.",
        }),
      );
    }
  };
  const handleReconnectActiveEnvironmentStable = useStableCallback(
    handleReconnectActiveEnvironment,
  );
  const disconnectDelayElapsed = useEnvironmentDisconnectDelay(
    activeEnvironmentUnavailable ? activeEnvironment.environmentId : null,
  );
  const canDisconnectActiveEnvironment =
    disconnectDelayElapsed &&
    activeEnvironment !== null &&
    activeEnvironment.entry.target._tag !== "PrimaryConnectionTarget" &&
    !isDesktopLocalConnectionTarget(activeEnvironment.entry.target);
  const [disconnectingEnvironment, setDisconnectingEnvironment] = useState(false);
  const handleDisconnectActiveEnvironment = async (environmentId: EnvironmentId) => {
    setDisconnectingEnvironment(true);
    const result = await setEnvironmentEnabled({ environmentId, enabled: false });
    setDisconnectingEnvironment(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not disconnect server",
            description: error instanceof Error ? error.message : "Failed to disconnect.",
          }),
        );
      }
      return;
    }
    void navigate({ to: "/", replace: true });
  };
  const handleDisconnectActiveEnvironmentStable = useStableCallback(
    handleDisconnectActiveEnvironment,
  );
  const { scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const activeProjectIsScratch =
    activeProject !== null &&
    isScratchProject(
      activeProject,
      environmentById.get(activeProject.environmentId)?.serverConfig?.scratchWorkspaceRoot ?? null,
    );
  const logicalProjectEnvironments = useMemo(() => {
    if (!activeProject) return [];
    const envs: EnvironmentOption[] = [];
    const pushEnvironment = (environmentId: EnvironmentId, projectId: ProjectId | null) => {
      const environment = environmentById.get(environmentId) ?? null;
      envs.push({
        environmentId,
        projectId,
        label: environment?.label ?? environmentId,
        isPrimary: environmentId === primaryEnvironmentId,
        machine: resolveEnvironmentMachineKind(environment?.serverConfig ?? null),
      });
    };
    if (activeProjectIsScratch && draftId) {
      for (const environment of environments) {
        const scratchRoot = scratchWorkspaceRootFor(environment.environmentId);
        if (scratchRoot === null && environment.environmentId !== activeProject.environmentId)
          continue;
        const scratchProject =
          environment.environmentId === activeProject.environmentId
            ? activeProject
            : allProjects.find(
                (p) =>
                  p.environmentId === environment.environmentId && isScratchProject(p, scratchRoot),
              );
        pushEnvironment(environment.environmentId, scratchProject?.id ?? null);
      }
    } else {
      const logicalKey = deriveLogicalProjectKeyFromSettings(
        activeProject,
        projectGroupingSettings,
      );
      const seen = new Set<string>();
      for (const p of allProjects) {
        if (seen.has(p.environmentId)) continue;
        if (deriveLogicalProjectKeyFromSettings(p, projectGroupingSettings) !== logicalKey)
          continue;
        seen.add(p.environmentId);
        pushEnvironment(p.environmentId, p.id);
      }
    }
    envs.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return envs;
  }, [
    activeProject,
    activeProjectIsScratch,
    allProjects,
    draftId,
    environments,
    projectGroupingSettings,
    primaryEnvironmentId,
    environmentById,
    scratchWorkspaceRootFor,
  ]);
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
  const openPullRequestDialog = (reference?: string) => {
    if (!canCheckoutPullRequestIntoThread) {
      return;
    }
    setPullRequestDialogState({
      initialReference: reference ?? null,
      key: Date.now(),
    });
  };
  const openPullRequestDialogStable = useStableCallback(openPullRequestDialog);

  const closePullRequestDialog = () => {
    setPullRequestDialogState(null);
  };

  const openOrReuseProjectDraftThread = async (input: {
    branch: string;
    worktreePath: string | null;
    envMode: DraftThreadEnvMode;
  }) => {
    if (!activeProject) {
      throw new Error("No active project is available for this pull request.");
    }
    const activeProjectRef = scopeProjectRef(activeProject.environmentId, activeProject.id);
    const logicalProjectKey = deriveLogicalProjectKeyFromSettings(
      activeProject,
      projectGroupingSettings,
    );
    const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
    if (storedDraftSession) {
      setDraftThreadContext(storedDraftSession.draftId, input);
      setLogicalProjectDraftThreadId(
        logicalProjectKey,
        activeProjectRef,
        storedDraftSession.draftId,
        {
          threadId: storedDraftSession.threadId,
          ...input,
        },
      );
      if (routeKind !== "draft" || draftId !== storedDraftSession.draftId) {
        await navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(storedDraftSession.draftId),
        });
      }
      return storedDraftSession.threadId;
    }

    const activeDraftSession = routeKind === "draft" && draftId ? getDraftSession(draftId) : null;
    if (!isServerThread && activeDraftSession?.logicalProjectKey === logicalProjectKey && draftId) {
      setDraftThreadContext(draftId, input);
      setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, draftId, {
        threadId: activeDraftSession.threadId,
        createdAt: activeDraftSession.createdAt,
        runtimeMode: activeDraftSession.runtimeMode,
        ...input,
      });
      return activeDraftSession.threadId;
    }

    const nextDraftId = newDraftId();
    const nextThreadId = newThreadId();
    setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
      threadId: nextThreadId,
      createdAt: new Date().toISOString(),
      runtimeMode: resolveProjectSettings(settings, activeProject.id, activeProject).settings
        .defaultRuntimeMode,
      ...input,
    });
    await navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(nextDraftId),
    });
    return nextThreadId;
  };

  const handlePreparedPullRequestThread = async (input: {
    branch: string;
    worktreePath: string | null;
  }) => {
    await openOrReuseProjectDraftThread({
      branch: input.branch,
      worktreePath: input.worktreePath,
      envMode: input.worktreePath ? "worktree" : "local",
    });
  };
  const handlePreparedPullRequestThreadStable = useStableCallback(handlePreparedPullRequestThread);

  useEffect(() => {
    if (!serverThread?.id || serverThread.lastVisitedAt === undefined) return;
    const threadUpdatedAt = Date.parse(serverThread.updatedAt);
    if (Number.isNaN(threadUpdatedAt)) return;
    const lastVisitedAt = serverThread.lastVisitedAt ? Date.parse(serverThread.lastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= threadUpdatedAt) return;

    // Server-tracked visited state: record the watermark server-side so it
    // syncs across every device connected to the environment. Dedupe per
    // watermark — the effect re-runs before the command's echo lands. The
    // dedupe also keeps a mark-unread on the open thread sticky: the rewind
    // leaves updatedAt untouched, so the already-dispatched key skips a
    // fresh visit until new activity lands or the thread is reopened.
    const dispatchKey = `${routeThreadKey}:${serverThread.updatedAt}`;
    if (lastDispatchedVisitRef.current === dispatchKey) return;
    const dispatch = () => {
      lastDispatchedVisitRef.current = dispatchKey;
      lastVisitDispatchAtRef.current = Date.now();
      void visitThreadMutation({
        environmentId: serverThread.environmentId,
        input: { threadId: serverThread.id, visitedAt: serverThread.updatedAt },
      });
    };
    const latestRunCompletedAtMs = serverThread.latestRun?.completedAt
      ? Date.parse(serverThread.latestRun.completedAt)
      : NaN;
    const hasUnseenCompletion =
      !Number.isNaN(latestRunCompletedAtMs) &&
      (Number.isNaN(lastVisitedAt) || latestRunCompletedAtMs > lastVisitedAt);
    const elapsed = Date.now() - lastVisitDispatchAtRef.current;
    if (hasUnseenCompletion || elapsed >= VISIT_DISPATCH_THROTTLE_MS) {
      dispatch();
      return;
    }
    const timer = setTimeout(dispatch, VISIT_DISPATCH_THROTTLE_MS - elapsed);
    return () => clearTimeout(timer);
  }, [
    routeThreadKey,
    serverThread?.environmentId,
    serverThread?.id,
    serverThread?.lastVisitedAt,
    serverThread?.latestRun?.completedAt,
    serverThread?.updatedAt,
    visitThreadMutation,
  ]);

  const serverConfig = activeThread
    ? (activeEnvironment?.serverConfig ?? null)
    : (primaryEnvironment?.serverConfig ?? null);
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
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

  const loadBalancingSettings = useClientSettings();
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
  const autoUpdateEnvironments = useMemo(
    () =>
      automaticEnvironment
        ? logicalProjectEnvironments.flatMap(({ environmentId }) => {
            const environment = environmentById.get(environmentId);
            return environment ? [environment] : [];
          })
        : [],
    [automaticEnvironment, logicalProjectEnvironments, environmentById],
  );
  const autoBalanceUpdateBanner = useAutoBalanceUpdateBanner(autoUpdateEnvironments);
  const versionMismatch = resolveServerConfigVersionMismatch(serverConfig);
  const versionMismatchDismissKey =
    versionMismatch && activeThread
      ? buildVersionMismatchDismissalKey(activeThread.environmentId, versionMismatch)
      : null;
  const [dismissedVersionMismatchKey, setDismissedVersionMismatchKey] = useState<string | null>(
    null,
  );
  const versionMismatchDismissed =
    versionMismatchDismissKey === dismissedVersionMismatchKey ||
    isVersionMismatchDismissed(versionMismatchDismissKey);
  const showVersionMismatchBanner =
    versionMismatch !== null && versionMismatchDismissKey !== null && !versionMismatchDismissed;
  const hasMultipleRegisteredEnvironments = environments.length > 1;
  const versionMismatchServerLabel =
    hasMultipleRegisteredEnvironments && activeThread
      ? `${environmentById.get(activeThread.environmentId)?.label ?? serverConfig?.environment.label ?? activeThread.environmentId} server`
      : "server";
  const serverUpdateEnvironmentId = activeThread?.environmentId ?? null;
  const versionMismatchSelfUpdate = resolveServerSelfUpdateCapability(serverConfig);
  const versionMismatchInstallation = serverConfig?.environment.capabilities.serverInstallation;
  const versionMismatchDesktopAppUpdate = supportsDesktopAppUpdate(serverConfig);
  const serverUpdateState = useAtomValue(
    serverEnvironment.updateStateAtom(serverUpdateEnvironmentId),
  );
  const [dismissedServerUpdateState, setDismissedServerUpdateState] = useState<
    typeof serverUpdateState | null
  >(null);
  const serverUpdateFailureDismissed =
    serverUpdateState === dismissedServerUpdateState ||
    isServerUpdateFailureDismissed(serverUpdateState);
  const systemComposerBannerItems = useMemo<ComposerBannerStackItem[]>(() => {
    const items: ComposerBannerStackItem[] = [];
    const updateRunning = serverUpdateState.status === "running";
    const unavailableConnection = activeEnvironmentUnavailableState?.connection ?? null;
    const disconnectAction =
      canDisconnectActiveEnvironment && activeEnvironmentUnavailableState ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={disconnectingEnvironment}
          title="Hide this server's threads. Switch it on again in Connections."
          onClick={() =>
            void handleDisconnectActiveEnvironmentStable(
              activeEnvironmentUnavailableState.environmentId,
            )
          }
        >
          Disconnect server
        </Button>
      ) : undefined;
    const environmentReconnecting =
      unavailableConnection !== null &&
      (unavailableConnection.phase === "connecting" ||
        unavailableConnection.phase === "reconnecting");
    const suppressUnavailableBanner =
      environmentReconnecting && (updateRunning || !reconnectWarningGraceElapsed);
    if (activeEnvironmentUnavailableState && unavailableConnection && !suppressUnavailableBanner) {
      items.push({
        id: `environment-unavailable:${activeEnvironmentUnavailableState.environmentId}`,
        variant: unavailableConnection.phase === "error" ? "error" : "warning",
        icon: <WifiOffIcon />,
        title: `${activeEnvironmentUnavailableState.label} is ${environmentReconnecting ? "reconnecting" : "offline"}`,
        actions: (
          <>
            {!environmentReconnecting ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void handleReconnectActiveEnvironmentStable(
                    activeEnvironmentUnavailableState.environmentId,
                  )
                }
              >
                Reconnect
              </Button>
            ) : null}
            {disconnectAction}
          </>
        ),
      });
    }
    if (
      !automaticEnvironment &&
      serverUpdateEnvironmentId &&
      (serverUpdateState.status === "idle"
        ? showVersionMismatchBanner
        : !serverUpdateFailureDismissed)
    ) {
      const updateInProgress = serverUpdateState.status === "running";
      const updateFailed = serverUpdateState.status === "failed";
      items.push({
        id: `server-version:${serverUpdateEnvironmentId}`,
        variant: updateFailed ? "error" : "default",
        priority: updateInProgress ? "urgent" : "notice",
        icon: <ComposerServerUpdateIcon status={serverUpdateState.status} />,
        title:
          updateInProgress || updateFailed ? (
            <ComposerServerUpdateStatus
              state={serverUpdateState}
              serverLabel={versionMismatchServerLabel}
            />
          ) : versionMismatch ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="block max-w-full cursor-help truncate rounded-sm text-left"
                  >
                    Server update available
                  </button>
                }
              />
              <TooltipPopup side="top">
                {versionMismatchServerLabel} {versionMismatch.serverVersion}{" "}
                <span aria-hidden="true">→</span> {versionMismatch.clientVersion}
              </TooltipPopup>
            </Tooltip>
          ) : (
            "Server update available"
          ),
        description:
          !updateInProgress &&
          !updateFailed &&
          versionMismatchSelfUpdate !== null &&
          (versionMismatchSelfUpdate !== "desktop-managed" || !versionMismatchDesktopAppUpdate)
            ? serverUpdateGuidance(versionMismatchSelfUpdate)
            : undefined,
        actions: updateInProgress ? (
          disconnectAction
        ) : !versionMismatch ||
          (versionMismatchSelfUpdate === "desktop-managed" &&
            !versionMismatchDesktopAppUpdate) ? undefined : (
          <ServerUpdateAction
            environmentId={serverUpdateEnvironmentId}
            serverLabel={versionMismatchServerLabel}
            selfUpdate={versionMismatchSelfUpdate}
            installation={versionMismatchInstallation}
            desktopAppUpdate={versionMismatchDesktopAppUpdate}
            targetVersion={versionMismatch.clientVersion}
            label={updateFailed ? "Retry" : "Update"}
            variant="ghost"
          />
        ),
        ...(updateInProgress || (!updateFailed && !versionMismatchDismissKey)
          ? {}
          : {
              dismissLabel: "Dismiss update notice",
              onDismiss: () => {
                if (updateFailed) {
                  dismissServerUpdateFailure(serverUpdateState);
                  setDismissedServerUpdateState(serverUpdateState);
                }
                dismissVersionMismatch(versionMismatchDismissKey);
                setDismissedVersionMismatchKey(versionMismatchDismissKey);
              },
            }),
      });
    }
    if (autoBalanceUpdateBanner) items.push(autoBalanceUpdateBanner);
    return items;
  }, [
    automaticEnvironment,
    autoBalanceUpdateBanner,
    activeEnvironmentUnavailableState,
    handleReconnectActiveEnvironmentStable,
    canDisconnectActiveEnvironment,
    disconnectingEnvironment,
    handleDisconnectActiveEnvironmentStable,
    setDismissedVersionMismatchKey,
    showVersionMismatchBanner,
    reconnectWarningGraceElapsed,
    serverUpdateFailureDismissed,
    serverUpdateState,
    versionMismatch,
    versionMismatchDismissKey,
    serverUpdateEnvironmentId,
    versionMismatchSelfUpdate,
    versionMismatchInstallation,
    versionMismatchDesktopAppUpdate,
    versionMismatchServerLabel,
  ]);
  const providerInstanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(
          deriveProviderInstanceEntries(providerStatuses),
          settings,
          activeProject?.id ?? null,
        ),
      ),
    [providerStatuses, settings, activeProject?.id],
  );
  useEffect(() => {
    if (!isLocalDraftThread) return;
    const disabled = new Set(
      providerInstanceEntries.filter((entry) => !entry.enabled).map((entry) => entry.instanceId),
    );
    appAtomRegistry.update(fanoutStateAtom, (current) => {
      if (current.selections === null) return current;
      const next = current.selections.filter((selection) => !disabled.has(selection.instanceId));
      return next.length === current.selections.length ? current : { ...current, selections: next };
    });
  }, [fanoutStateAtom, isLocalDraftThread, providerInstanceEntries]);
  const { selectedProviderEntry, requestedDriverKind } = useMemo(
    () =>
      resolveComposerProviderSelection({
        entries: providerInstanceEntries,
        candidateInstanceIds: [
          selectedProviderByThreadId,
          activeRuntime?.providerInstanceId,
          activeThread?.modelSelection.instanceId,
          activeProjectDefaultModelSelection?.instanceId,
        ],
        lockedProvider,
        lockedInstanceId:
          activeRuntime?.providerInstanceId ?? activeThread?.modelSelection.instanceId,
      }),
    [
      activeProjectDefaultModelSelection?.instanceId,
      activeThread?.modelSelection,
      activeRuntime?.providerInstanceId,
      lockedProvider,
      providerInstanceEntries,
      selectedProviderByThreadId,
    ],
  );
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
  const setThreadError = useMemo(
    () =>
      makeThreadErrorSetter({
        routeThreadRef,
        routeThreadKey,
        draftId,
        serverThreadRef:
          serverThreadId && serverThreadEnvironmentId
            ? { threadId: serverThreadId, environmentId: serverThreadEnvironmentId }
            : null,
        setLocalServerErrorsByThreadKey,
        setLocalDraftErrorsByDraftId,
      }),
    [draftId, routeThreadKey, routeThreadRef, serverThreadId, serverThreadEnvironmentId],
  );
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
  } = usePendingThreadRequests({
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
  const [usageLimitsPanel, setUsageLimitsPanel] = useState<{
    readonly key: string;
    readonly threadKey: string;
    readonly now: number;
  } | null>(null);
  const usageLimitsKey =
    activeProviderInstanceId === null || (isServerThread && activeThread === undefined)
      ? null
      : [
          routeThreadKey,
          activeProviderInstanceId,
          activeThread?.latestRun?.runId ?? "",
          activePendingApproval?.requestId ?? activePendingUserInput?.requestId ?? "",
        ].join(":");
  if (
    usageLimitsPanel !== null &&
    usageLimitsKey !== null &&
    usageLimitsPanel.key !== usageLimitsKey
  ) {
    setUsageLimitsPanel(null);
  }
  const usageLimitSources = serverConfig?.usageLimitSources ?? EMPTY_USAGE_LIMIT_SOURCES;
  const usageLimitsReport = useMemo(
    () =>
      usageLimitsPanel !== null &&
      usageLimitsKey !== null &&
      usageLimitsPanel.key === usageLimitsKey &&
      activeProviderInstanceId !== null
        ? collectProviderUsageLimits(
            activeProviderInstanceId,
            providerStatuses,
            usageLimitSources,
            usageLimitsPanel.now,
          )
        : null,
    [
      activeProviderInstanceId,
      providerStatuses,
      usageLimitSources,
      usageLimitsKey,
      usageLimitsPanel,
    ],
  );
  const usageLimitsBanner = useMemo(
    () =>
      usageLimitsReport !== null && usageLimitsPanel !== null
        ? // A fresh id per opening: a reopen must not collide with the previous notice while it exits.
          usageLimitsBannerItem(
            `usage-limits:${usageLimitsPanel.key}:${usageLimitsPanel.now}`,
            usageLimitsReport,
            environmentId,
            () => setUsageLimitsPanel(null),
          )
        : null,
    [environmentId, usageLimitsPanel, usageLimitsReport],
  );
  // Supaterm owns /usage-limits only where Limits has data for the selected provider;
  // elsewhere the name stays the provider's own and is sent through untouched.
  const usageLimitsOffered =
    activeProviderStatus !== null &&
    hasProviderUsageLimits(activeProviderStatus.driver, providerStatuses, usageLimitSources);
  const openUsageLimits = () => {
    const now = Date.now();
    const report =
      activeProviderInstanceId !== null && usageLimitsKey !== null
        ? collectProviderUsageLimits(
            activeProviderInstanceId,
            providerStatuses,
            usageLimitSources,
            now,
          )
        : null;
    if (report && usageLimitsKey !== null) {
      setUsageLimitsPanel({ key: usageLimitsKey, threadKey: routeThreadKey, now });
      return true;
    }
    setUsageLimitsPanel(null);
    toastManager.add({ type: "info", title: "Usage limits are unavailable for this provider" });
    return false;
  };
  const openUsageLimitsStable = useStableCallback(openUsageLimits);
  // Responses can resolve after navigating away; only the originating thread's panel clears.
  const clearUsageLimitsFor = (threadKey: string) =>
    setUsageLimitsPanel((current) =>
      current !== null && current.threadKey === threadKey ? null : current,
    );
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
      item.status === "completed",
  );
  const isCompacting =
    (isSendBusy || phase === "connecting" || phase === "running") &&
    compactRequestIsActive &&
    !compactionSettled;
  const isWorking =
    phase === "running" ||
    isSendBusy ||
    isConnecting ||
    isCompacting ||
    runlessWorkStartedAt !== null;
  const activeContextWindow = useMemo(
    () =>
      deriveLatestContextWindowSnapshot(
        serverVisibleTurnItems ?? [],
        activeThreadLiveTokenUsage,
        serverProjection?.providerThreads.find(
          (thread) => thread.id === serverProjection.thread.activeProviderThreadId,
        ),
      ),
    [activeThreadLiveTokenUsage, serverVisibleTurnItems, serverProjection],
  );
  const pendingBackgroundTasks = useMemo(() => {
    if (serverProjection === null || serverProjection === undefined) {
      return [];
    }
    const sessionError =
      serverProjection.providerSessions.findLast(
        (session) => session.providerInstanceId === serverProjection.thread.providerInstanceId,
      )?.lastError ?? null;
    const latestRun =
      usageLimitRunPresentedAsLatest(
        serverProjection.runs,
        serverProjection.turnItems,
        sessionError,
      ) ?? latestUnheldRun(serverProjection.runs);
    return [
      ...derivePendingBackgroundWork({
        latestRun,
        providerThreads: serverProjection.providerThreads,
        turnItems: serverProjection.turnItems,
        activeProviderThreadId: serverProjection.thread.activeProviderThreadId,
        runs: serverProjection.runs,
        pullRequests: serverProjection.thread.pullRequests,
        workflowRunWatches: serverProjection.thread.workflowRunWatches,
      }),
    ];
  }, [serverProjection]);
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
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoff = (
    messageId: MessageId,
    previewUrls?: ReadonlyArray<string>,
  ) => {
    delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
    const currentPreviewUrls =
      previewUrls ?? attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    setAttachmentPreviewHandoffByMessageId((existing) => {
      if (!(messageId in existing)) {
        return existing;
      }
      const next = { ...existing };
      delete next[messageId];
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
    for (const previewUrl of currentPreviewUrls) {
      revokeBlobPreviewUrl(previewUrl);
    }
  };
  const clearAttachmentPreviewHandoffStable = useStableCallback(clearAttachmentPreviewHandoff);
  const clearAttachmentPreviewHandoffs = () => {
    attachmentPreviewPromotionInFlightByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  };
  const clearAttachmentPreviewHandoffsStable = useStableCallback(clearAttachmentPreviewHandoffs);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffsStable();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffsStable]);
  const handoffAttachmentPreviews = (messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    const nextPreviewUrlSet = new Set(previewUrls);
    for (const previewUrl of previousPreviewUrls) {
      if (!nextPreviewUrlSet.has(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
  };
  const handoffAttachmentPreviewsStable = useStableCallback(handoffAttachmentPreviews);
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
  const serverAttachmentResources = useMemo(
    () =>
      selectHandoffImageResources(
        Object.keys(attachmentPreviewHandoffByMessageId).length === 0
          ? undefined
          : serverVisibleTurnItems.flatMap(({ item }) =>
              item.type === "user_message"
                ? [{ id: item.messageId, role: "user" as const, attachments: item.attachments }]
                : [],
            ),
        attachmentPreviewHandoffByMessageId,
      ),
    [serverVisibleTurnItems, attachmentPreviewHandoffByMessageId],
  );
  const serverAttachmentUrls = useAssetUrls(environmentId, serverAttachmentResources);
  const serverAttachmentUrlById = useMemo(
    () =>
      new Map(
        serverAttachmentResources.flatMap((resource, index) => {
          const url = serverAttachmentUrls[index];
          return url ? [[resource.attachmentId, url] as const] : [];
        }),
      ),
    [serverAttachmentResources, serverAttachmentUrls],
  );
  useEffect(() => {
    if (typeof Image === "undefined" || serverVisibleTurnItems.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];
    const userMessagesById = new Map(
      serverVisibleTurnItems.flatMap((row) =>
        row.item.type === "user_message" ? [[String(row.item.messageId), row.item] as const] : [],
      ),
    );

    for (const [messageId, handoffPreviewUrls] of Object.entries(
      attachmentPreviewHandoffByMessageId,
    )) {
      if (attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId]) {
        continue;
      }

      const serverMessage = userMessagesById.get(messageId);
      if (serverMessage === undefined || serverMessage.attachments.length === 0) {
        continue;
      }

      const serverPreviewUrls = serverMessage.attachments.flatMap((attachment) =>
        attachment.type === "image"
          ? [serverAttachmentUrlById.get(attachment.id)].filter(
              (previewUrl): previewUrl is string => previewUrl !== undefined,
            )
          : [],
      );
      if (
        serverPreviewUrls.length === 0 ||
        serverPreviewUrls.length !== handoffPreviewUrls.length ||
        serverPreviewUrls.some((previewUrl) => previewUrl.startsWith("blob:"))
      ) {
        continue;
      }

      attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId] = true;

      let cancelled = false;
      const imageInstances: HTMLImageElement[] = [];

      const preloadServerPreviews = Promise.all(
        serverPreviewUrls.map(
          (previewUrl) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              imageInstances.push(image);
              const handleLoad = () => resolve();
              const handleError = () =>
                reject(new Error(`Failed to load server preview for ${messageId}.`));
              image.addEventListener("load", handleLoad, { once: true });
              image.addEventListener("error", handleError, { once: true });
              image.src = previewUrl;
            }),
        ),
      );

      void preloadServerPreviews
        .then(() => {
          if (cancelled) {
            return;
          }
          clearAttachmentPreviewHandoffStable(messageId as MessageId, handoffPreviewUrls);
        })
        .catch(() => {
          if (!cancelled) {
            delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
          }
        });

      cleanups.push(() => {
        cancelled = true;
        delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
        for (const image of imageInstances) {
          image.src = "";
        }
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [
    attachmentPreviewHandoffByMessageId,
    clearAttachmentPreviewHandoffStable,
    serverAttachmentUrlById,
    serverVisibleTurnItems,
  ]);
  const timelineAttachmentUrlById = useMemo(() => {
    const urls = new Map(serverAttachmentUrlById);
    for (const row of serverVisibleTurnItems) {
      if (row.item.type !== "user_message") continue;
      const handoffUrls = attachmentPreviewHandoffByMessageId[row.item.messageId];
      if (handoffUrls === undefined) continue;
      let imageIndex = 0;
      for (const attachment of row.item.attachments) {
        if (attachment.type !== "image") continue;
        const handoffUrl = handoffUrls[imageIndex];
        imageIndex += 1;
        if (handoffUrl !== undefined) urls.set(attachment.id, handoffUrl);
      }
    }
    return urls;
  }, [attachmentPreviewHandoffByMessageId, serverAttachmentUrlById, serverVisibleTurnItems]);
  const anchoredTimelineMessages = useMemo(
    () =>
      feedbackSubmissions.flatMap((submission) =>
        submission.status === "interrupted"
          ? []
          : [
              { ...codexFeedbackMessage(submission), runId: null },
              { ...codexFeedbackMessage(submission, "assistant"), runId: null },
            ],
      ),
    [feedbackSubmissions],
  );
  const [projectTimelineEntries] = useState(createTimelineEntriesProjector);
  const serverTimelineEntries = useMemo(
    () =>
      projectTimelineEntries(
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
      ),
    [
      activeThreadKey,
      anchoredTimelineMessages,
      pendingCreationMessages,
      optimisticUserMessages,
      projectTimelineEntries,
      serverVisibleTurnItems,
      serverProjection,
      timelineAttachmentUrlById,
    ],
  );
  const draftTimelineEntries = useMemo(
    () =>
      [...pendingCreationMessages, ...optimisticUserMessages].map(
        (message) =>
          ({
            id: message.id,
            kind: "message",
            createdAt: message.createdAt,
            message,
          }) as const,
      ),
    [pendingCreationMessages, optimisticUserMessages],
  );
  const timelineEntries = isServerThread ? serverTimelineEntries : draftTimelineEntries;
  const timelineMessages = useMemo(
    () => timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
    [timelineEntries],
  );
  const displayedTimeline = resolveThreadSwitchTimeline({
    loading: timelineEntries.length === 0 && threadSyncPhase !== null,
    activeThreadKey,
    nextEntries: timelineEntries,
    rememberedForActive: peekRememberedThreadTimeline<typeof timelineEntries>(activeThreadKey),
  });
  const displayedTimelineKey = displayedTimeline.displayThreadKey ?? routeThreadKey;
  const paintOnlyDisplayedTimeline = isPaintOnlyThreadTimeline(
    displayedTimeline.displayThreadKey,
    activeThreadKey,
  );
  const displayedThreadRef = parseScopedThreadKey(displayedTimelineKey);
  const worktreeSetupOwnerKey = draftId ?? routeThreadKey;
  const worktreeSetupActive =
    worktreeSetupRef !== null && worktreeSetupRef.ownerKey === worktreeSetupOwnerKey;
  const setupTarget = worktreeSetupActive ? worktreeSetupRef : routeThreadRef;
  const worktreeSetupQuery = useEnvironmentQuery(
    worktreeSetupActive ||
      (activeThread?.id === routeThreadRef.threadId &&
        (isLocallyPreparingWorktree || activeRunPreparing || activeThread.worktreePath !== null))
      ? vcsEnvironment.worktreeSetup({
          environmentId: setupTarget.environmentId,
          input: { threadId: setupTarget.threadId },
        })
      : null,
  );
  const latestWorktreeSetup = worktreeSetupQuery.data;
  const [heldWorktreeSetupSource, setHeldWorktreeSetupSource] = useState({
    latest: latestWorktreeSetup,
    routeThreadKey,
  });
  if (heldWorktreeSetupSource.routeThreadKey !== routeThreadKey) {
    setHeldWorktreeSetupSource({ latest: latestWorktreeSetup, routeThreadKey });
    setHeldWorktreeSetup(null);
  } else if (heldWorktreeSetupSource.latest !== latestWorktreeSetup) {
    setHeldWorktreeSetupSource({ latest: latestWorktreeSetup, routeThreadKey });
    if (latestWorktreeSetup) {
      setHeldWorktreeSetup((current) =>
        current?.threadId === latestWorktreeSetup.threadId &&
        current.sequence > latestWorktreeSetup.sequence
          ? current
          : latestWorktreeSetup,
      );
    }
  }
  const { snapshot: liveWorktreeSetup, isPreparingWorktree } = useMemo(
    () =>
      resolveWorktreeSetupProgress({
        threadId: setupTarget.threadId,
        localPreparing: isLocallyPreparingWorktree,
        runStatus: activeActivityRun?.status,
        latest: latestWorktreeSetup,
        held: heldWorktreeSetup,
      }),
    [
      activeActivityRun?.status,
      heldWorktreeSetup,
      isLocallyPreparingWorktree,
      latestWorktreeSetup,
      setupTarget.threadId,
    ],
  );
  const worktreeSetup = resolveVisibleWorktreeSetup({
    live: liveWorktreeSetup,
    recorded: null,
    turnStarted: activeActivityRun?.startedAt != null,
    followUpSent: timelineMessages.filter((message) => message.role === "user").length > 1,
  });
  // Sends wait for the agent handoff, not for the setup script: an async
  // script keeps the snapshot running while the agent already works, and a
  // follow-up must not be held behind a slow install. Before the first
  // snapshot arrives the starting session stands in for it. A send that
  // queues behind the setup run or the pending task is never held here.
  const worktreeSetupBlocksSend =
    !sendQueuesBehindSetup &&
    (worktreeSetup !== null
      ? worktreeSetup.phase === "running" && !worktreeSetupAgentStarted(worktreeSetup)
      : isPreparingWorktree);
  const cancelWorktreeSetup = useAtomCommand(vcsEnvironment.cancelWorktreeSetup, {
    reportFailure: false,
  });
  const retryWorkspacePreparation = useAtomCommand(threadEnvironment.retryWorkspacePreparation);
  const retryableRunIdsKey = useMemo(
    () =>
      [
        ...workspacePreparationRetryRunIds(
          serverProjection?.runs ?? [],
          serverProjection?.turnItems ?? [],
        ),
      ].join("\n"),
    [serverProjection?.runs, serverProjection?.turnItems],
  );
  const retryableWorkspacePreparationRunIds = useMemo(
    () => new Set(retryableRunIdsKey === "" ? [] : (retryableRunIdsKey.split("\n") as RunId[])),
    [retryableRunIdsKey],
  );
  const onRetryWorkspacePreparation = (runId: RunId) => {
    if (!activeThreadRef || retryingWorkspacePreparationRunIds.has(runId)) return;
    retryingWorkspacePreparationRunIds.add(runId);
    void retryWorkspacePreparation({
      environmentId: activeThreadRef.environmentId,
      input: { threadId: activeThreadRef.threadId, runId },
    }).finally(() => retryingWorkspacePreparationRunIds.delete(runId));
  };
  const onRetryWorkspacePreparationStable = useStableCallback(onRetryWorkspacePreparation);
  const onCancelWorktreeSetup = () => {
    if (!worktreeSetup || worktreeSetup.phase !== "running") return;
    void cancelWorktreeSetup({
      environmentId: setupTarget.environmentId,
      input: { threadId: worktreeSetup.threadId },
    });
  };
  const onCancelWorktreeSetupStable = useStableCallback(onCancelWorktreeSetup);
  const onOpenWorktreeSetupTerminal = useMemo(() => {
    if (!worktreeSetup || !activeThreadRef || worktreeSetup.threadId !== activeThreadRef.threadId) {
      return null;
    }
    const setupThreadRef = activeThreadRef;
    return (terminalId: string) => {
      storeEnsureTerminal(setupThreadRef, terminalId, { open: true, active: true });
    };
  }, [activeThreadRef, storeEnsureTerminal, worktreeSetup]);
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
  const { turnDiffSummaries } = useTurnDiffSummaries(serverProjection);

  /**
   * File tools are explicit; completed commands are included because a shell
   * command can mutate the workspace without reporting the paths it touched.
   */
  const workspaceMutationId = useMemo(() => {
    let itemId: string | null = null;
    for (let index = serverVisibleTurnItems.length - 1; index >= 0; index -= 1) {
      const item = serverVisibleTurnItems[index]?.item;
      if (!item) continue;
      if (item.type !== "command_execution" && item.type !== "file_change") continue;
      if (item.status === "pending" || item.status === "running" || item.status === "waiting") {
        continue;
      }
      itemId = item.id;
      break;
    }
    const latestCheckpointCompletedAt = turnDiffSummaries.at(-1)?.completedAt ?? null;
    return itemId === null && latestCheckpointCompletedAt === null
      ? null
      : JSON.stringify([itemId, latestCheckpointCompletedAt]);
  }, [serverVisibleTurnItems, turnDiffSummaries]);

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
  const manualCompactionProviderAvailable = useMemo(
    () =>
      hasAvailableCompactionProvider({
        providers: providerInstanceEntries,
        driverKind: selectedProvider,
        instanceId: activeProviderInstanceId,
        lockedInstanceId: lockedProvider
          ? (activeRuntime?.providerInstanceId ?? activeThread?.modelSelection.instanceId ?? null)
          : null,
      }),
    [
      activeProviderInstanceId,
      activeThread?.modelSelection.instanceId,
      activeRuntime?.providerInstanceId,
      lockedProvider,
      providerInstanceEntries,
      selectedProvider,
    ],
  );
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
    rememberReadyThreadTimeline({
      threadKey: activeThreadKey,
      entries: timelineEntries,
      markdownCwd: gitCwd,
      workspaceRoot: activeWorkspaceRoot ?? null,
    });
  }, [activeThreadKey, activeWorkspaceRoot, gitCwd, threadDetailLoading, timelineEntries]);
  const heldPaintContext = paintOnlyDisplayedTimeline
    ? peekHeldThreadTimeline<typeof timelineEntries>()
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
  const composerUsageWindows = useMemo(
    () => headlineUsageWindows(activeProviderStatus),
    [activeProviderStatus],
  );
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
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: Boolean(terminalUiState.terminalOpen),
      },
    }),
    [terminalUiState.terminalOpen],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const splitTerminalVerticalShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "terminal.splitVertical", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const onToggleDiff = () => {
    if (!isServerThread) {
      return;
    }
    if (!diffOpen) {
      onDiffPanelOpen?.();
    }
    if (activeThreadRef) {
      useRightPanelStore.getState().toggle(activeThreadRef, "diff");
    }
  };
  const onToggleDiffStable = useStableCallback(onToggleDiff);

  const needsLoadBalancing = automaticEnvironment && !draftThread?.loadBalancedEnvironmentId;
  const loadBalancingCandidates = useMemo(
    () =>
      needsLoadBalancing
        ? logicalProjectEnvironments
            .filter((candidate) => {
              const environment = environmentById.get(candidate.environmentId);
              return (
                environment?.connection.phase === "connected" &&
                (loadBalancingSettings.loadBalancingWeights[candidate.environmentId] ?? 50) > 0 &&
                environment.serverConfig?.providers.some(
                  (provider) =>
                    (activeProviderInstanceId === null ||
                      provider.instanceId === activeProviderInstanceId) &&
                    provider.driver === selectedProvider &&
                    (environment.serverConfig?.settings
                      ? resolveProjectProviderInstanceEnabled(
                          environment.serverConfig.settings,
                          candidate.projectId,
                          provider.instanceId,
                        )
                      : provider.enabled) &&
                    provider.installed &&
                    provider.status !== "error" &&
                    provider.auth.status !== "unauthenticated" &&
                    provider.availability !== "unavailable",
                )
              );
            })
            .map((candidate) => candidate.environmentId)
        : [],
    [
      needsLoadBalancing,
      logicalProjectEnvironments,
      environmentById,
      loadBalancingSettings.loadBalancingWeights,
      activeProviderInstanceId,
      selectedProvider,
    ],
  );
  const loadBalancing = useLoadBalancedEnvironment(
    loadBalancingCandidates,
    loadBalancingSettings.loadBalancingWeights,
  );
  const refreshLoadBalancing = loadBalancing.refresh;
  useEffect(() => {
    if (!needsLoadBalancing || loadBalancing.pending || !draftId || isSendInFlight()) return;
    if (!draftThread || draftThread.promotedTo || getDraftSession(draftId) !== draftThread) return;
    const target = logicalProjectEnvironments.find(
      (environment) => environment.environmentId === loadBalancing.environmentId,
    );
    if (!target?.projectId) return;
    setDraftThreadContext(draftId, {
      projectRef: scopeProjectRef(target.environmentId, target.projectId),
      environmentSelection: "auto",
      loadBalancedEnvironmentId: target.environmentId,
    });
  }, [
    needsLoadBalancing,
    loadBalancing.pending,
    loadBalancing.environmentId,
    draftId,
    draftThread,
    getDraftSession,
    logicalProjectEnvironments,
    setDraftThreadContext,
  ]);
  const onAutoEnvironment = () => {
    if (envLocked || !draftId) return;
    if (composerHasAttachments) {
      toastManager.add({
        type: "warning",
        id: "load-balancing-attachments",
        title: "Keep attachments on this machine",
        description:
          "Remove attachments before choosing automatic routing, then attach them on the selected machine.",
      });
      return;
    }
    refreshLoadBalancing(
      logicalProjectEnvironments.map((environment) => environment.environmentId),
    );
    setDraftThreadContext(draftId, {
      environmentSelection: "auto",
      loadBalancedEnvironmentId: null,
      branch: null,
      worktreePath: null,
    });
  };
  const onAutoEnvironmentStable = useStableCallback(onAutoEnvironment);
  const autoEnvironmentLabel = automaticEnvironment
    ? draftThread?.loadBalancedEnvironmentId
      ? "Auto balance"
      : loadBalancing.pending
        ? "Checking machines…"
        : loadBalancing.failed
          ? "Auto balance unavailable"
          : "Auto balance"
    : undefined;

  const environmentChangeRef = useRef<{
    readonly environmentId: EnvironmentId;
    readonly draftId: string;
    readonly projectKey: string | null;
  } | null>(null);
  const [isEnvironmentChanging, setIsEnvironmentChanging] = useState(false);
  useLayoutEffect(() => {
    return () => {
      const request = environmentChangeRef.current;
      if (request?.draftId === draftId && request.projectKey === activeProjectKey) {
        environmentChangeRef.current = null;
        setIsEnvironmentChanging(false);
      }
    };
  }, [draftId, activeProjectKey]);

  const onEnvironmentChange = (nextEnvironmentId: EnvironmentId) => {
    if (envLocked || !draftId || sendInFlightRef.current) return;
    const originalDraft = getDraftSession(draftId);
    if (!originalDraft || originalDraft.promotedTo) return;
    const target = logicalProjectEnvironments.find(
      (env) => env.environmentId === nextEnvironmentId,
    );
    if (!target) return;
    const request = {
      environmentId: target.environmentId,
      draftId,
      projectKey: activeProjectKey,
    };
    environmentChangeRef.current = request;
    setIsEnvironmentChanging(false);
    const retarget = (project: (typeof allProjects)[number]) => {
      const currentDraft = getDraftSession(draftId);
      if (
        environmentChangeRef.current !== request ||
        sendInFlightRef.current ||
        !currentDraft ||
        currentDraft.promotedTo ||
        currentDraft.environmentId !== originalDraft.environmentId ||
        currentDraft.projectId !== originalDraft.projectId
      )
        return;
      const projectRef = scopeProjectRef(target.environmentId, project.id);
      if (activeProjectIsScratch) {
        setLogicalProjectDraftThreadId(
          deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings),
          projectRef,
          draftId,
          { environmentSelection: "manual", loadBalancedEnvironmentId: null },
        );
      } else {
        setDraftThreadContext(draftId, {
          projectRef,
          environmentSelection: "manual",
          loadBalancedEnvironmentId: null,
        });
      }
    };
    const finish = () => {
      if (environmentChangeRef.current === request) {
        environmentChangeRef.current = null;
        setIsEnvironmentChanging(false);
      }
    };
    if (target.projectId !== null) {
      const project = allProjects.find(
        (project) =>
          project.environmentId === target.environmentId && project.id === target.projectId,
      );
      if (project) retarget(project);
      finish();
      return;
    }
    setIsEnvironmentChanging(true);
    void openScratchProject(target.environmentId, "Could not switch machine")
      .then((project) => {
        if (project) retarget(project);
      })
      .finally(finish);
  };
  const onEnvironmentChangeStable = useStableCallback(onEnvironmentChange);

  const activeTerminalGroup =
    terminalUiState.terminalGroups.find(
      (group) => group.id === terminalUiState.activeTerminalGroupId,
    ) ??
    terminalUiState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalUiState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;

  const focusComposer = () => {
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
      focusComposer();
    });
  };
  const scheduleComposerFocusStable = useStableCallback(scheduleComposerFocus);
  const useArtifactTemplate = (template: CodexArtifactTemplate) => {
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
  const useArtifactTemplateStable = useStableCallback(useArtifactTemplate);

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
  const editQueuedRunCommand = useAtomCommand(threadEnvironment.editQueuedRun, {
    reportFailure: false,
  });
  const queuedRunsControlRef = useRef<QueuedRunsControlHandle>(null);
  const queuedEditSaveInFlightRef = useRef(false);
  const [isSavingQueuedEdit, setIsSavingQueuedEdit] = useState(false);
  const queuedEditImageResources = useMemo(
    () =>
      (editingQueuedRun?.existingAttachments ?? [])
        .filter((attachment) => attachment.type === "image")
        .map((attachment) => ({ _tag: "attachment" as const, attachmentId: attachment.id })),
    [editingQueuedRun],
  );
  const queuedEditImageUrls = useAssetUrls(environmentId, queuedEditImageResources);
  const composerEditingQueuedAttachments = useMemo(() => {
    if (editingQueuedRun === null) return null;
    const urlByAttachmentId = new Map(
      queuedEditImageResources.map((resource, index) => [
        resource.attachmentId,
        queuedEditImageUrls[index] ?? null,
      ]),
    );
    return editingQueuedRun.existingAttachments.map((attachment) => ({
      attachment,
      url: urlByAttachmentId.get(attachment.id) ?? null,
    }));
  }, [editingQueuedRun, queuedEditImageResources, queuedEditImageUrls]);
  const beginEditingQueuedRun = (request: EditQueuedRunRequest) => {
    if (!activeThread) return;
    outboxEditor.editor.cancel();
    if (editingQueuedRun !== null && editingQueuedRun.runId !== request.runId) {
      clearComposerDraftContent(queuedEditDraftTargetFor(editingQueuedRun.runId));
    }
    const target = queuedEditDraftTargetFor(request.runId);
    clearComposerDraftContent(target);
    setComposerDraftPrompt(target, request.text);
    setEditingQueuedRun({
      threadId: activeThread.id,
      runId: request.runId,
      messageId: request.messageId,
      originalText: request.text,
      existingAttachments: request.attachments,
      context: serverProjection?.messages.find((message) => message.id === request.messageId)
        ?.context,
    });
    scheduleComposerFocus();
  };
  const beginEditingQueuedRunStable = useStableCallback(beginEditingQueuedRun);
  const cancelEditingQueuedRun = () => {
    if (editingQueuedRun === null) return;
    clearComposerDraftContent(queuedEditDraftTargetFor(editingQueuedRun.runId));
    setEditingQueuedRun(null);
    scheduleComposerFocus();
  };
  const cancelEditingQueuedRunStable = useStableCallback(cancelEditingQueuedRun);
  const beginEditingOutboxMessage = async (entry: PendingThreadTurn) => {
    await outboxEditor.editor.begin(entry);
    cancelEditingQueuedRun();
    scheduleComposerFocus();
  };
  const beginEditingOutboxMessageStable = useStableCallback(beginEditingOutboxMessage);
  const cancelEditingOutboxMessage = () => {
    outboxEditor.editor.cancel();
    scheduleComposerFocus();
  };
  const cancelEditingOutboxMessageStable = useStableCallback(cancelEditingOutboxMessage);
  const removeEditingQueuedAttachment = (attachmentId: string) => {
    setEditingQueuedRun((current) =>
      current === null
        ? current
        : {
            ...current,
            existingAttachments: current.existingAttachments.filter(
              (attachment) => attachment.id !== attachmentId,
            ),
          },
    );
  };
  const removeEditingQueuedAttachmentStable = useStableCallback(removeEditingQueuedAttachment);
  useEffect(() => {
    if (editingQueuedRun === null) return;
    if (activeThread?.id !== editingQueuedRun.threadId) {
      // oxlint-disable-next-line react/set-state-in-effect -- drops a queued-message edit once its thread is no longer active
      setEditingQueuedRun(null);
      return;
    }
    if (serverProjection === null) return;
    const run = serverProjection.runs.find((candidate) => candidate.id === editingQueuedRun.runId);
    if (run !== undefined && run.status === "queued") return;
    const recovery = recoverQueuedMessageEdit({
      editTarget: queuedEditDraftTargetFor(editingQueuedRun.runId),
      threadTarget: baseComposerDraftTarget,
      originalText: editingQueuedRun.originalText,
    });
    if (recovery === "kept") {
      toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Queued message is no longer queued",
          description: "Your unsaved edit was kept in the composer.",
        }),
      );
    } else if (recovery === "discarded") {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Queued message is no longer queued",
          description: "Your unsaved edit was discarded.",
        }),
      );
    }
    setEditingQueuedRun(null);
  }, [
    activeThread?.id,
    baseComposerDraftTarget,
    editingQueuedRun,
    queuedEditDraftTargetFor,
    serverProjection,
  ]);
  const addTerminalContextToDraft = (selection: TerminalContextSelection) => {
    composerRef.current?.addTerminalContext(selection);
  };
  const addTerminalContextToDraftStable = useStableCallback(addTerminalContextToDraft);
  const setTerminalOpen = (open: boolean) => {
    if (!activeThreadRef) return;
    storeSetTerminalOpen(activeThreadRef, open);
  };
  const setTerminalOpenStable = useStableCallback(setTerminalOpen);
  const toggleTerminalVisibility = () => {
    if (!activeThreadRef) return;
    const nextOpen = !terminalUiState.terminalOpen;
    if (
      nextOpen &&
      !readEnvironmentScope(environmentId, AuthTerminalReadScope) &&
      !hasTerminalWriteAccess()
    )
      return;
    if (nextOpen && hasTerminalWriteAccess() && terminalUiState.terminalIds.length === 0) {
      // Server-created setup terminals exist before this client's drawer mounts.
      // Reuse them before allocating a shell from the still-empty UI state.
      const existingTerminalId =
        runningTerminalIds.find((id) => !panelTerminalIds.has(id)) ??
        activeServerOrderedTerminalIds.find((id) => !panelTerminalIds.has(id));
      if (existingTerminalId !== undefined) {
        storeEnsureTerminal(activeThreadRef, existingTerminalId, { open: true, active: true });
        return;
      }
      void terminalActions.launchTerminal({
        place: (terminalId) => storeEnsureTerminal(activeThreadRef, terminalId, { open: true }),
      })?.result;
      return;
    }
    setTerminalOpen(nextOpen);
  };
  const toggleTerminalVisibilityStable = useStableCallback(toggleTerminalVisibility);
  const splitTerminal = (direction: "horizontal" | "vertical" = "horizontal") => {
    if (!activeThreadRef || hasReachedSplitLimit) return;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        direction === "vertical"
          ? storeSplitTerminalVertical(activeThreadRef, terminalId)
          : storeSplitTerminal(activeThreadRef, terminalId),
    });
    if (!launched) return;
    setTerminalFocusRequestId((value) => value + 1);
    void launched.result;
  };
  const splitTerminalStable = useStableCallback(splitTerminal);
  const createNewTerminal = () => {
    if (!activeThreadRef) return;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) => storeNewTerminal(activeThreadRef, terminalId),
    });
    if (!launched) return;
    setTerminalFocusRequestId((value) => value + 1);
    void launched.result;
  };
  const createNewTerminalStable = useStableCallback(createNewTerminal);
  const closeTerminal = (terminalId: string) => {
    if (!hasTerminalWriteAccess() || !activeThreadRef) return;
    terminalActions.closeTerminalSession(terminalId);
    storeCloseTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  };
  const runProjectScript = async (
    script: ProjectScript,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      worktreePath?: string | null;
      preferNewTerminal?: boolean;
      rememberAsLastInvoked?: boolean;
    },
  ) => {
    if (!hasTerminalWriteAccess() || !activeThreadId || !activeProject || !activeThread) return;
    if (options?.rememberAsLastInvoked !== false) {
      setLastInvokedScriptByProjectId((current) => {
        if (current[activeProject.id] === script.id) return current;
        return { ...current, [activeProject.id]: script.id };
      });
    }
    const targetCwd = options?.cwd ?? gitCwd ?? activeProject.workspaceRoot;
    const baseTerminalId =
      terminalUiState.activeTerminalId || activeKnownTerminalIds[0] || DEFAULT_THREAD_TERMINAL_ID;
    const isBaseTerminalBusy = runningTerminalIds.includes(baseTerminalId);
    const wantsNewTerminal = Boolean(options?.preferNewTerminal) || isBaseTerminalBusy;
    const shouldCreateNewTerminal =
      wantsNewTerminal ||
      !canReuseTerminal ||
      !readEnvironmentScope(environmentId, AuthTerminalReadScope);
    const targetWorktreePath = options?.worktreePath ?? activeThread.worktreePath ?? null;

    setTerminalUiLaunchContext({
      threadId: activeThreadId,
      cwd: targetCwd,
      worktreePath: targetWorktreePath,
    });
    setTerminalOpen(true);
    if (!activeThreadRef) {
      return;
    }
    setTerminalFocusRequestId((value) => value + 1);

    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        shouldCreateNewTerminal
          ? storeNewTerminal(activeThreadRef, terminalId)
          : storeSetActiveTerminal(activeThreadRef, terminalId),
      ...(shouldCreateNewTerminal
        ? { size: { cols: SCRIPT_TERMINAL_COLS, rows: SCRIPT_TERMINAL_ROWS } }
        : { terminalId: baseTerminalId }),
      location: { cwd: targetCwd, worktreePath: targetWorktreePath },
      ...(options?.env ? { extraEnv: options.env } : {}),
    });
    if (!launched) return;
    const targetTerminalId = launched.terminalId;
    const openResult = await launched.result;
    if (openResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(openResult)) {
        const error = squashAtomCommandFailure(openResult);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
      return;
    }

    const writeResult = await terminalActions.writeToTerminal(
      targetTerminalId,
      `${script.command}\r`,
    );
    if (!writeResult) return;
    if (writeResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(writeResult)) {
        const error = squashAtomCommandFailure(writeResult);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
      return;
    }
    if (script.autoOpenPreview && script.previewUrl && isPreviewSupportedInRuntime()) {
      let previewUrl: string;
      try {
        previewUrl = resolveDiscoveredServerUrl(activeThreadRef.environmentId, script.previewUrl, {
          requireReachable: true,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not open preview",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
        return;
      }
      const previewResult = await openUrlInPreview({
        threadRef: activeThreadRef,
        url: previewUrl,
        openPreview,
      });
      if (previewResult._tag === "Failure" && !isAtomCommandInterrupted(previewResult)) {
        const error = squashAtomCommandFailure(previewResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not open preview",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      }
    }
  };
  const runProjectScriptStable = useStableCallback(runProjectScript);

  const runProjectScriptRef = useRef(runProjectScriptStable);
  useLayoutEffect(() => {
    runProjectScriptRef.current = runProjectScriptStable;
  }, [runProjectScriptStable]);
  const runShellCommand = (command: string) => {
    void runProjectScriptRef.current(
      {
        id: "chat-code-block",
        name: "Chat code block",
        command,
        icon: "play",
        runOnWorktreeCreate: false,
      },
      { rememberAsLastInvoked: false },
    );
  };
  const runShellCommandStable = useStableCallback(runShellCommand);

  const persistProjectScripts = async (input: {
    projectId: ProjectId;
    projectCwd: string;
    previousScripts: ReadonlyArray<ProjectScript>;
    nextScripts: ReadonlyArray<ProjectScript>;
    keybinding: NewProjectScriptInput["keybinding"];
    keybindingCommand: KeybindingCommand | null;
  }): Promise<AtomCommandResult<void, unknown>> => {
    const previousKeybinding = keybindingValueForCommand(
      appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.keybindings ?? [],
      input.keybindingCommand,
    );
    const isDeletingScript = !input.nextScripts.some(
      (script) => commandForProjectScript(script.id) === input.keybindingCommand,
    );
    const changesKeybinding =
      input.keybinding !== undefined &&
      (input.keybinding?.trim() || null) !== previousKeybinding &&
      (!isDeletingScript || readEnvironmentScope(environmentId, AuthSettingsWriteScope));
    if (changesKeybinding && !readEnvironmentScope(environmentId, AuthSettingsWriteScope)) {
      return AsyncResult.failure(
        Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: AuthSettingsWriteScope,
            message: "This connection cannot change keyboard shortcuts.",
          }),
        ),
      );
    }
    const keybindingRule = changesKeybinding
      ? decodeProjectScriptKeybindingRule({
          keybinding: input.keybinding,
          command: input.keybindingCommand,
        })
      : null;
    const updateResult = mapAtomCommandResult(
      await updateProjectScriptSettings({
        environmentId,
        input: {
          patch: {
            projectSettingsOverrides: {
              [input.projectId]: {
                ...projectSettingsOverridesForWrite(settings, input.projectId),
                defaultProjectScripts: input.nextScripts,
              },
            },
          },
        },
      }),
      () => undefined,
    );
    if (updateResult._tag === "Failure") {
      return updateResult;
    }

    if (!changesKeybinding) return updateResult;
    if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) {
      return AsyncResult.failure(
        Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: AuthSettingsWriteScope,
            message: isDeletingScript
              ? "The script was deleted, but its keyboard shortcut could not be removed because permission changed."
              : "The script was saved, but this connection can no longer change keyboard shortcuts.",
          }),
        ),
      );
    }

    const scriptId = input.keybindingCommand
      ? projectScriptIdFromCommand(input.keybindingCommand)
      : null;
    if (!keybindingRule && !input.previousScripts.some((script) => script.id === scriptId)) {
      return updateResult;
    }
    const retainedElsewhere =
      !input.nextScripts.some((script) => script.id === scriptId) &&
      (settings.defaultProjectScripts.some((script) => script.id === scriptId) ||
        Object.entries(settings.projectSettingsOverrides).some(
          ([projectId, entry]) =>
            projectId !== input.projectId &&
            entry.defaultProjectScripts?.some((script) => script.id === scriptId),
        ) ||
        allProjects.some(
          (other) =>
            other.environmentId === environmentId &&
            other.id !== input.projectId &&
            resolveProjectScripts(settings, other).some((script) => script.id === scriptId),
        ));
    if (!keybindingRule && retainedElsewhere) return updateResult;

    const previousRules = (
      environmentById.get(environmentId)?.serverConfig?.keybindings ?? []
    ).flatMap((binding) => {
      if (binding.command !== input.keybindingCommand || binding.whenAst) return [];
      const previous = decodeProjectScriptKeybindingRule({
        keybinding: keybindingValueForCommand([binding], input.keybindingCommand),
        command: input.keybindingCommand,
      });
      return previous ? [previous] : [];
    });
    const previous = previousRules.at(-1);
    for (const rule of keybindingRule ? previousRules.slice(0, -1) : previousRules) {
      const result = await removeKeybinding({ environmentId, input: rule });
      if (result._tag === "Failure") return mapAtomCommandResult(result, () => undefined);
    }
    return keybindingRule
      ? mapAtomCommandResult(
          await upsertKeybinding({
            environmentId,
            input:
              previous && previous.key !== keybindingRule.key
                ? { ...keybindingRule, replace: previous }
                : keybindingRule,
          }),
          () => undefined,
        )
      : updateResult;
  };
  const saveProjectScript = async (
    input: NewProjectScriptInput,
  ): Promise<AtomCommandResult<void, unknown>> => {
    if (!activeProject) {
      return AsyncResult.success(undefined);
    }
    const nextId = nextProjectScriptId(
      input.name,
      activeProjectScripts.map((script) => script.id),
    );
    const nextScript = buildProjectScript(nextId, input);
    const nextScripts = [
      ...activeProjectScripts.map((script) => releaseClaimedRoles(script, input)),
      nextScript,
    ];

    return persistProjectScripts({
      projectId: activeProject.id,
      projectCwd: activeProject.workspaceRoot,
      previousScripts: activeProjectScripts,
      nextScripts,
      keybinding: input.keybinding,
      keybindingCommand: commandForProjectScript(nextId),
    });
  };
  const saveProjectScriptStable = useStableCallback(saveProjectScript);
  const updateProjectScript = async (
    scriptId: string,
    input: NewProjectScriptInput,
  ): Promise<AtomCommandResult<void, unknown>> => {
    if (!activeProject) {
      return AsyncResult.success(undefined);
    }
    const existingScript = activeProjectScripts.find((script) => script.id === scriptId);
    if (!existingScript) {
      return AsyncResult.failure(Cause.fail(new Error("Script not found.")));
    }

    const updatedScript = buildProjectScript(existingScript.id, input);
    const nextScripts = activeProjectScripts.map((script) =>
      script.id === scriptId ? updatedScript : releaseClaimedRoles(script, input),
    );

    return persistProjectScripts({
      projectId: activeProject.id,
      projectCwd: activeProject.workspaceRoot,
      previousScripts: activeProjectScripts,
      nextScripts,
      keybinding: input.keybinding,
      keybindingCommand: commandForProjectScript(scriptId),
    });
  };
  const updateProjectScriptStable = useStableCallback(updateProjectScript);
  const deleteProjectScript = async (
    scriptId: string,
  ): Promise<AtomCommandResult<void, unknown>> => {
    if (!activeProject) {
      return AsyncResult.success(undefined);
    }
    const nextScripts = activeProjectScripts.filter((script) => script.id !== scriptId);

    const deletedName = activeProjectScripts.find((s) => s.id === scriptId)?.name;

    const result = await persistProjectScripts({
      projectId: activeProject.id,
      projectCwd: activeProject.workspaceRoot,
      previousScripts: activeProjectScripts,
      nextScripts,
      keybinding: null,
      keybindingCommand: commandForProjectScript(scriptId),
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: `Deleted action "${deletedName ?? "Unknown"}"`,
      });
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not delete action",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    }
    return result;
  };
  const deleteProjectScriptStable = useStableCallback(deleteProjectScript);

  const handleRuntimeModeChange = (mode: RuntimeMode) => {
    if (mode === runtimeMode) return;
    setComposerDraftRuntimeMode(composerDraftTarget, mode);
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, { runtimeMode: mode });
    }
    scheduleComposerFocus();
  };
  const handleRuntimeModeChangeStable = useStableCallback(handleRuntimeModeChange);

  const openProviderSetup = (instanceId: ProviderInstanceId) => {
    void navigate({
      to: "/settings/providers",
      search: { environmentId, instanceId },
    });
  };
  const openProviderSetupStable = useStableCallback(openProviderSetup);
  const canOperatePreview = useEnvironmentScope(
    activeThreadRef?.environmentId ?? null,
    AuthPreviewOperateScope,
  );
  const createBrowserSurface = (profileId?: string) => {
    if (!activeThreadRef || !canOperatePreview) return;
    void addBrowserSurface({
      threadRef: activeThreadRef,
      openPreview,
      ...(profileId === undefined ? {} : { profileId }),
    }).then((result) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      if (error instanceof BrowserSettingsReadError) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open browser",
            description: error.message,
          }),
        );
      }
    });
  };
  const createBrowserSurfaceStable = useStableCallback(createBrowserSurface);
  const addDiffSurface = () => {
    if (!activeThreadRef || !isServerThread || !isGitRepo) return;
    useDiffPanelStore.getState().selectGitScope(activeThreadRef, "branch");
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    onDiffPanelOpen?.();
  };
  const addDiffSurfaceStable = useStableCallback(addDiffSurface);
  const openChangesFromThreadPanel = () => {
    addDiffSurface();
  };
  const openChangesFromThreadPanelStable = useStableCallback(openChangesFromThreadPanel);
  const addFilesSurface = () => {
    if (!activeThreadRef || !activeProject) return;
    useRightPanelStore.getState().open(activeThreadRef, "files");
  };
  const addFilesSurfaceStable = useStableCallback(addFilesSurface);
  const visiblePullRequests = visibleThreadPullRequests(
    (activeThreadShell ?? activeThread)?.pullRequests ?? [],
  );
  const visiblePullRequestCount = visiblePullRequests.length;
  const pullRequestsSurfaceAvailable = isServerThread && visiblePullRequestCount > 0;
  const addPullRequestsSurface = () => {
    if (!activeThreadRef || !pullRequestsSurfaceAvailable) return;
    useRightPanelStore.getState().open(activeThreadRef, "pull-requests");
  };
  const addPullRequestsSurfaceStable = useStableCallback(addPullRequestsSurface);
  const { state: deviceState, loaded: deviceStateLoaded } = useDeviceState(
    activeThreadRef?.environmentId ?? null,
  );
  const [deviceSetupThread, setDeviceSetupThread] = useState<ScopedThreadRef | null>(null);
  const addDeviceSurface = () => {
    if (!activeThreadRef) return;
    if (!deviceState.onboardingCompleted || deviceState.hostStatus === "disabled") {
      setDeviceSetupThread(activeThreadRef);
      return;
    }
    useRightPanelStore.getState().open(activeThreadRef, "device");
  };
  const addDeviceSurfaceStable = useStableCallback(addDeviceSurface);
  const autoShowFloatingPreview = useClientSettings(selectAutoShowFloatingPreview);
  const previousDeviceSessions = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    if (!activeThreadRef || !deviceStateLoaded) return;
    const threadKey = `${activeThreadRef.environmentId}:${activeThreadRef.threadId}`;
    const sessions = deviceState.sessions.filter(
      (session) => session.threadId === activeThreadRef.threadId,
    );
    const key = (session: (typeof sessions)[number]) => `${session.hostId}:${session.deviceId}`;
    const deviceFor = (session: (typeof sessions)[number]) =>
      deviceState.devices.find(
        (entry) => entry.hostId === session.hostId && entry.id === session.deviceId,
      );
    const previous = previousDeviceSessions.current.get(threadKey);
    previousDeviceSessions.current.set(
      threadKey,
      new Set(sessions.filter((session) => deviceFor(session) !== undefined).map(key)),
    );
    if (!previous || shouldUsePlanSidebarSheet) return;
    for (const session of sessions) {
      if (previous.has(key(session))) continue;
      const device = deviceFor(session);
      if (!device) continue;
      const target = {
        hostId: session.hostId,
        deviceId: session.deviceId,
        platform: device.platform,
        name: device.name,
      };
      if (autoShowFloatingPreview) {
        usePreviewMiniPlayerStore.getState().open(activeThreadRef, { kind: "device", ...target });
        continue;
      }
      const existing = useRightPanelStore
        .getState()
        .byThreadKey[scopedThreadKey(activeThreadRef)]?.surfaces.some(
          (surface) =>
            surface.kind === "device" &&
            surface.target?.hostId === session.hostId &&
            surface.target.deviceId === session.deviceId,
        );
      if (existing) continue;
      useRightPanelStore.getState().openDevice(activeThreadRef, target, true);
    }
  }, [
    activeThreadRef,
    autoShowFloatingPreview,
    deviceStateLoaded,
    shouldUsePlanSidebarSheet,
    deviceState.sessions,
    deviceState.devices,
  ]);
  const previousServerPreviewTabs = useRef(new Map<string, Map<string, string | undefined>>());
  useEffect(() => {
    if (!activeThreadRef || !activeEnvironmentServerBrowser || !activePreviewState.listLoaded)
      return;
    const threadKey = scopedThreadKey(activeThreadRef);
    const serverSessions = Object.values(activePreviewState.sessions).filter(
      (session) => session.runtime === "server",
    );
    const previous = previousServerPreviewTabs.current.get(threadKey);
    previousServerPreviewTabs.current.set(
      threadKey,
      new Map(serverSessions.map((session) => [session.tabId, session.revealRequest?.id])),
    );
    if (!previous) return;
    for (const session of serverSessions) {
      const requested = session.revealRequest;
      const fresh = requested
        ? previous.get(session.tabId) !== requested.id
        : !previous.has(session.tabId);
      if (!fresh || session.reveal !== true) continue;
      if (!autoShowFloatingPreview && requested?.force !== true) continue;
      const surface = rightPanelState.surfaces.find(
        (surface) => surface.kind === "preview" && surface.resourceId === session.tabId,
      );
      if (surface && requested?.force === true) {
        useRightPanelStore.getState().activateSurface(activeThreadRef, surface.id);
      } else if (!surface) {
        usePreviewMiniPlayerStore
          .getState()
          .open(activeThreadRef, browserMiniPlayerSource(session.tabId));
      }
    }
  }, [
    activeEnvironmentServerBrowser,
    activePreviewState.listLoaded,
    activePreviewState.sessions,
    activeThreadRef,
    autoShowFloatingPreview,
    rightPanelState.surfaces,
  ]);
  useEffect(() => {
    if (!activeThreadRef || !deviceStateLoaded) return;
    const source = activePreviewMiniPlayer?.source;
    if (source?.kind !== "device") return;
    const sessionStillExists = deviceState.sessions.some(
      (session) =>
        session.threadId === activeThreadRef.threadId &&
        session.hostId === source.hostId &&
        session.deviceId === source.deviceId,
    );
    if (!sessionStillExists) usePreviewMiniPlayerStore.getState().close(activeThreadRef);
  }, [activePreviewMiniPlayer, activeThreadRef, deviceState.sessions, deviceStateLoaded]);
  const openFileSurface = (relativePath: string) => {
    if (!activeThreadRef || !activeProject) return;
    useRightPanelStore.getState().openFile(activeThreadRef, relativePath);
  };
  const openFileSurfaceStable = useStableCallback(openFileSurface);
  const persistedLinkedThreadPullRequest = isServerThread
    ? (activeThreadShell?.linkedPullRequest ?? activeThread?.linkedPullRequest ?? null)
    : (activeThread?.linkedPullRequest ?? null);
  const activeProjectRepository = sourceControlRepositorySelector(
    activeProject?.repositoryIdentity,
  );
  const persistedLinkedThreadPullRequestStatus = useLinkedThreadPullRequest(
    activeThreadRef?.environmentId ?? null,
    activeThreadShell?.pullRequests,
    activeThreadShell?.branchPullRequest,
  );
  const replacementLinkedThreadPullRequest = useMemo(() => {
    const detected = gitStatusQuery.data?.pr;
    const threadBranch = activeThread?.branch;
    const projectId = activeProject?.id;
    if (
      persistedLinkedThreadPullRequest === null ||
      (persistedLinkedThreadPullRequestStatus?.pr.state !== "merged" &&
        persistedLinkedThreadPullRequestStatus?.pr.state !== "closed") ||
      gitStatusQuery.data?.refName !== threadBranch ||
      detected?.state !== "open" ||
      detected.headRef !== threadBranch ||
      projectId === undefined ||
      activeProjectRepository === null ||
      (persistedLinkedThreadPullRequest.projectId === projectId &&
        persistedLinkedThreadPullRequest.repository.toLowerCase() ===
          activeProjectRepository.toLowerCase() &&
        persistedLinkedThreadPullRequest.number === detected.number)
    ) {
      return null;
    }
    return {
      projectId,
      repository: activeProjectRepository,
      number: detected.number,
      url: detected.url,
    };
  }, [
    activeProject?.id,
    activeProjectRepository,
    activeThread?.branch,
    gitStatusQuery.data,
    persistedLinkedThreadPullRequest,
    persistedLinkedThreadPullRequestStatus?.pr.state,
  ]);
  const linkedThreadPullRequest =
    replacementLinkedThreadPullRequest ?? persistedLinkedThreadPullRequest;
  const linkedThreadPullRequestKey = linkedThreadPullRequest
    ? JSON.stringify([
        linkedThreadPullRequest.projectId,
        linkedThreadPullRequest.repository,
        linkedThreadPullRequest.number,
      ])
    : null;
  const threadPrRelinkKeysRef = useRef(new Map<string, string>());
  const threadPrRelinkWriteRef = useRef(Promise.resolve());
  useEffect(() => {
    if (!isServerThread || activeThreadKey === null || activeThreadRef === null) {
      return;
    }
    if (replacementLinkedThreadPullRequest === null) {
      threadPrRelinkKeysRef.current.delete(activeThreadKey);
      return;
    }
    const relinkKey = `${replacementLinkedThreadPullRequest.projectId}:${replacementLinkedThreadPullRequest.repository}#${replacementLinkedThreadPullRequest.number}`;
    if (threadPrRelinkKeysRef.current.get(activeThreadKey) === relinkKey) return;
    threadPrRelinkKeysRef.current.set(activeThreadKey, relinkKey);
    const openSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      activeThreadRef,
    );
    if (
      openSurface?.kind === "pull-request" &&
      persistedLinkedThreadPullRequest !== null &&
      openSurface.projectId === persistedLinkedThreadPullRequest.projectId &&
      openSurface.repository.toLowerCase() ===
        persistedLinkedThreadPullRequest.repository.toLowerCase() &&
      openSurface.number === persistedLinkedThreadPullRequest.number
    ) {
      useRightPanelStore
        .getState()
        .openPullRequest(activeThreadRef, replacementLinkedThreadPullRequest);
    }

    threadPrRelinkWriteRef.current = threadPrRelinkWriteRef.current.then(async () => {
      if (threadPrRelinkKeysRef.current.get(activeThreadKey) !== relinkKey) return;
      const result = await updateThreadMetadata({
        environmentId: activeThreadRef.environmentId,
        input: {
          threadId: activeThreadRef.threadId,
          linkedPullRequest: replacementLinkedThreadPullRequest,
        },
      });
      if (threadPrRelinkKeysRef.current.get(activeThreadKey) !== relinkKey) return;
      if (result._tag !== "Failure") return;
      threadPrRelinkKeysRef.current.delete(activeThreadKey);
      if (isAtomCommandInterrupted(result)) return;
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to update the thread pull request",
          description: chatActionErrorMessage(squashAtomCommandFailure(result)),
        }),
      );
    });
  }, [
    activeThreadKey,
    activeThreadRef,
    isServerThread,
    persistedLinkedThreadPullRequest,
    replacementLinkedThreadPullRequest,
    updateThreadMetadata,
  ]);
  const hasLinkedPullRequestDetail = persistedLinkedThreadPullRequest !== null;
  const proactivePullRequestsKey = pullRequestsSurfaceAvailable
    ? JSON.stringify(
        visiblePullRequests.map((link) => [link.host, link.repository, link.number]).sort(),
      )
    : linkedThreadPullRequestKey;
  const activeRunningTurnId = activeRuntime?.activeRunId ?? null;
  const proactivePanelObservationRef = useRef<ReturnType<
    typeof observeProactivePanelUserChoice
  > | null>(null);
  const observedThreadPullRequestRef = useRef<{
    readonly threadKey: string;
    readonly reference: ThreadLinkedPullRequest | null;
  } | null>(null);

  useEffect(() => {
    if (!isServerThread || activeThreadKey === null || activeThreadRef === null) {
      proactivePanelObservationRef.current = null;
      observedThreadPullRequestRef.current = null;
      return;
    }
    const panels = useRightPanelStore.getState();
    const observation = observeProactivePanelUserChoice(proactivePanelObservationRef.current, {
      threadKey: activeThreadKey,
      runningTurnId: activeRunningTurnId,
      userActionRevision: panels.getUserActionRevision(activeThreadRef),
    });
    proactivePanelObservationRef.current = observation;
    const {
      runningTurnId: previousRunningTurnId,
      targetKey: previousTargetKey,
      userActionRevision,
    } = observation;
    const openSurface = selectActiveRightPanelSurface(panels.byThreadKey, activeThreadRef);
    const previousPullRequest = observedThreadPullRequestRef.current;
    observedThreadPullRequestRef.current = {
      threadKey: activeThreadKey,
      reference: linkedThreadPullRequest,
    };
    const followSelectedPullRequest =
      previousPullRequest?.threadKey === activeThreadKey &&
      shouldRetargetThreadPullRequestPanel(
        previousPullRequest.reference,
        linkedThreadPullRequest,
        openSurface,
      );
    if (followSelectedPullRequest && linkedThreadPullRequest !== null) {
      panels.openProactive(
        activeThreadRef,
        pullRequestSurface(linkedThreadPullRequest),
        userActionRevision,
      );
    }
    if (!clientSettingsHydrated) return;

    const proactivePanelsEnabled = settings.proactivePanelsEnabled && !shouldUsePlanSidebarSheet;
    const eligibleLink =
      proactivePanelsEnabled &&
      shouldOpenProactivePullRequest(previousTargetKey, proactivePullRequestsKey);
    const shouldDeferLink = eligibleLink && !pullRequestsCapabilityKnown;
    proactivePanelObservationRef.current = {
      ...observation,
      targetKey: shouldDeferLink ? (previousTargetKey ?? null) : proactivePullRequestsKey,
    };
    if (eligibleLink && pullRequestsCapabilityKnown) {
      if (
        pullRequestsSurfaceAvailable &&
        (visiblePullRequestCount > 1 || !hasLinkedPullRequestDetail || !supportsPullRequests)
      ) {
        panels.openProactive(
          activeThreadRef,
          { id: "pull-requests", kind: "pull-requests" },
          userActionRevision,
        );
      } else if (
        !followSelectedPullRequest &&
        supportsPullRequests &&
        linkedThreadPullRequest !== null
      ) {
        panels.openProactive(
          activeThreadRef,
          pullRequestSurface(linkedThreadPullRequest),
          userActionRevision,
        );
      }
    }
    if (threadDetailLoading) return;

    const settledTurnId = latestRunSettled ? (activeLatestRun?.runId ?? null) : null;
    const newlyCompletedTurnId = shouldOpenProactiveTurnDiff({
      previousRunningTurnId,
      runningTurnId: activeRunningTurnId,
      settledTurnId,
      turnCompleted: activeLatestRun?.status === "completed",
    })
      ? settledTurnId
      : null;
    const eligibleCompletion =
      proactivePanelsEnabled &&
      newlyCompletedTurnId !== null &&
      !(
        proactivePullRequestsKey !== null &&
        (!pullRequestsCapabilityKnown || supportsPullRequests || pullRequestsSurfaceAvailable)
      );
    const completedCheckpoint = eligibleCompletion
      ? turnDiffSummaries.find((checkpoint) => checkpoint.runId === newlyCompletedTurnId)
      : undefined;
    const diffAction = eligibleCompletion
      ? resolveProactiveTurnDiffAction({
          checkpoint: completedCheckpoint,
          isGitRepo: gitStatusQuery.data?.isRepo,
          activeSurfaceKind: openSurface?.kind ?? null,
        })
      : "ignore";
    proactivePanelObservationRef.current = {
      ...proactivePanelObservationRef.current,
      runningTurnId:
        diffAction === "defer" || shouldDeferLink ? previousRunningTurnId : activeRunningTurnId,
    };
    if (diffAction !== "open" || newlyCompletedTurnId === null) return;
    if (!panels.openProactive(activeThreadRef, { id: "diff", kind: "diff" }, userActionRevision)) {
      return;
    }
    useDiffPanelStore.getState().selectGitScope(activeThreadRef, "branch");
    onDiffPanelOpen?.();
  }, [
    turnDiffSummaries,
    activeLatestRun?.runId,
    activeLatestRun?.status,
    activeRunningTurnId,
    activeThreadKey,
    activeThreadRef,
    clientSettingsHydrated,
    gitStatusQuery.data?.isRepo,
    isServerThread,
    latestRunSettled,
    linkedThreadPullRequest,
    proactivePullRequestsKey,
    hasLinkedPullRequestDetail,
    onDiffPanelOpen,
    pullRequestsCapabilityKnown,
    pullRequestsSurfaceAvailable,
    visiblePullRequestCount,

    settings.proactivePanelsEnabled,
    shouldUsePlanSidebarSheet,
    supportsPullRequests,
    threadDetailLoading,
    proactivePanelObservationRef,
    observedThreadPullRequestRef,
  ]);
  const closePreviewPanel = () => {
    if (activeThreadRef) {
      if (activeRightPanelSurface?.kind === "preview" && activeRightPanelSurface.resourceId) {
        usePreviewMiniPlayerStore
          .getState()
          .open(activeThreadRef, browserMiniPlayerSource(activeRightPanelSurface.resourceId));
      } else if (activeRightPanelSurface?.kind === "device" && activeRightPanelSurface.target) {
        usePreviewMiniPlayerStore
          .getState()
          .open(activeThreadRef, { kind: "device", ...activeRightPanelSurface.target });
      }
      useRightPanelStore.getState().setMaximized(activeThreadRef, false);
      useRightPanelStore.getState().close(activeThreadRef);
    }
  };
  const closePreviewPanelStable = useStableCallback(closePreviewPanel);
  const togglePreviewPanel = () => {
    if (!activeThreadRef || !browserAvailable) return;
    if (previewPanelOpen) {
      closePreviewPanel();
      return;
    }
    if (!canOperatePreview) return;
    const activeTabId = activePreviewState.activeTabId;
    if (activeTabId) {
      useRightPanelStore.getState().openBrowser(activeThreadRef, activeTabId);
    } else {
      createBrowserSurface();
    }
  };
  const togglePreviewPanelStable = useStableCallback(togglePreviewPanel);
  const addTerminalSurface = () => {
    if (!activeThreadRef) return;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        useRightPanelStore.getState().openTerminal(activeThreadRef, terminalId),
    });
    if (!launched) return;
    setTerminalFocusRequestId((value) => value + 1);
    void launched.result;
  };
  const addTerminalSurfaceStable = useStableCallback(addTerminalSurface);
  const splitPanelTerminal = (direction: "horizontal" | "vertical" = "horizontal") => {
    if (
      !activeThreadRef ||
      activeRightPanelSurface?.kind !== "terminal" ||
      activeRightPanelSurface.terminalIds.length >= MAX_TERMINALS_PER_GROUP
    ) {
      return;
    }
    const surfaceId = activeRightPanelSurface.id;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        useRightPanelStore
          .getState()
          .splitTerminal(activeThreadRef, surfaceId, terminalId, direction),
    });
    if (!launched) return;
    setTerminalFocusRequestId((value) => value + 1);
    void launched.result;
  };
  const splitPanelTerminalStable = useStableCallback(splitPanelTerminal);
  const splitPanelTerminalVertical = () => {
    splitPanelTerminal("vertical");
  };
  const splitPanelTerminalVerticalStable = useStableCallback(splitPanelTerminalVertical);
  const activatePanelTerminal = (terminalId: string) => {
    if (!activeThreadRef || activeRightPanelSurface?.kind !== "terminal") return;
    useRightPanelStore
      .getState()
      .activateTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  };
  const activatePanelTerminalStable = useStableCallback(activatePanelTerminal);
  const closePanelTerminal = (terminalId: string) => {
    if (
      !hasTerminalWriteAccess() ||
      !activeThreadRef ||
      activeRightPanelSurface?.kind !== "terminal"
    )
      return;
    terminalActions.closeTerminalSession(terminalId);
    storeCloseTerminal(activeThreadRef, terminalId);
    useRightPanelStore
      .getState()
      .closeTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
  };
  const closePanelTerminalStable = useStableCallback(closePanelTerminal);
  const terminalCloseTarget = (terminalId: string) => ({
    label: activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId),
    hasRunningSubprocess: activeTerminalHasRunningSubprocessById.get(terminalId) ?? false,
  });
  const requestCloseTerminal = (terminalId: string) => {
    if (!hasTerminalWriteAccess()) return;
    void confirmTerminalClose([terminalCloseTarget(terminalId)]).then((confirmed) => {
      if (confirmed && readEnvironmentScope(environmentId, AuthTerminalOperateScope))
        closeTerminal(terminalId);
    });
  };
  const requestCloseTerminalStable = useStableCallback(requestCloseTerminal);
  const requestClosePanelTerminal = (terminalId: string) => {
    if (!hasTerminalWriteAccess()) return;
    void confirmTerminalClose([terminalCloseTarget(terminalId)]).then((confirmed) => {
      if (confirmed && readEnvironmentScope(environmentId, AuthTerminalOperateScope))
        closePanelTerminal(terminalId);
    });
  };
  const requestClosePanelTerminalStable = useStableCallback(requestClosePanelTerminal);
  const activateRightPanelSurface = (surface: RightPanelSurface) => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().activateSurface(activeThreadRef, surface.id);
    if (surface.kind === "preview" && surface.resourceId) {
      setActivePreviewTab(activeThreadRef, surface.resourceId);
    }
    if (surface.kind === "terminal") {
      setTerminalFocusRequestId((value) => value + 1);
    }
    if (surface.kind === "diff" && !diffOpen) {
      onDiffPanelOpen?.();
    }
  };
  const activateRightPanelSurfaceStable = useStableCallback(activateRightPanelSurface);
  const toggleRightPanel = () => {
    if (!activeThreadRef) return;
    if (rightPanelOpen) {
      closePreviewPanel();
      return;
    }
    useRightPanelStore.getState().toggleVisibility(activeThreadRef);
  };
  const toggleRightPanelStable = useStableCallback(toggleRightPanel);
  const toggleThreadPanel = () => {
    if (!activeThreadRef || routeKind === "draft") return;
    useRightPanelStore.getState().toggleThreadPanel(activeThreadRef, threadPanelPresentation);
  };
  const toggleThreadPanelStable = useStableCallback(toggleThreadPanel);
  useEffect(() => {
    if (!canMaximizeRightPanel || !activeThreadRef) return;
    if (useRightPanelStore.getState().consumeMaximizeRequest(activeThreadRef))
      useRightPanelStore.getState().setMaximized(activeThreadRef, true);
  }, [canMaximizeRightPanel, activeThreadRef]);
  const toggleRightPanelMaximized = () => {
    if (!canMaximizeRightPanel || !activeThreadRef) return;
    useRightPanelStore.getState().setMaximized(activeThreadRef, !rightPanelMaximized);
  };
  const toggleRightPanelMaximizedStable = useStableCallback(toggleRightPanelMaximized);
  const cleanupRightPanelSurfaces = (surfaces: readonly RightPanelSurface[]) => {
    if (!activeThreadRef) return;
    for (const surface of surfaces) {
      if (canOperatePreview && surface.kind === "preview" && surface.resourceId) {
        void closePreviewSession({
          closePreview,
          snapshot: activePreviewState.sessions[surface.resourceId] ?? null,
          tabId: surface.resourceId,
          threadRef: activeThreadRef,
        });
      }
      if (
        surface.kind === "terminal" &&
        readEnvironmentScope(activeThreadRef.environmentId, AuthTerminalOperateScope)
      ) {
        for (const terminalId of surface.terminalIds) {
          storeCloseTerminal(activeThreadRef, terminalId);
          terminalActions.closeTerminalSession(terminalId);
        }
      }
    }
  };
  const syncActivePreviewSurface = () => {
    if (!activeThreadRef) return;
    const nextActiveSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      activeThreadRef,
    );
    if (nextActiveSurface?.kind === "preview" && nextActiveSurface.resourceId) {
      setActivePreviewTab(activeThreadRef, nextActiveSurface.resourceId);
    }
  };
  const finishRightPanelSurfaceClose = (surfaces: readonly RightPanelSurface[]) => {
    if (!activeThreadRef) return;
    const store = useRightPanelStore.getState();
    const activeId = selectThreadRightPanelState(
      store.byThreadKey,
      activeThreadRef,
    ).activeSurfaceId;
    const ordered = surfaces.toSorted(
      (left, right) => Number(left.id === activeId) - Number(right.id === activeId),
    );
    for (const surface of ordered) {
      cleanupRightPanelSurfaces([surface]);
      store.closeSurface(activeThreadRef, surface.id);
    }
    syncActivePreviewSurface();
  };
  const closeRightPanelSurfaces = (surfaces: readonly RightPanelSurface[]) => {
    if (!activeThreadRef) return;
    void confirmRightPanelSurfacesClose(
      surfaces.filter(
        (surface) =>
          surface.kind !== "terminal" ||
          readEnvironmentScope(activeThreadRef.environmentId, AuthTerminalOperateScope),
      ),
      {
        desktopByTabId: activePreviewState.desktopByTabId,
        terminalCloseTarget,
      },
    ).then((confirmed) => {
      if (confirmed) finishRightPanelSurfaceClose(surfaces);
    });
  };
  const closeRightPanelSurface = (surface: RightPanelSurface) => closeRightPanelSurfaces([surface]);
  const closeRightPanelSurfaceStable = useStableCallback(closeRightPanelSurface);
  const closeOtherRightPanelSurfaces = (surface: RightPanelSurface) => {
    closeRightPanelSurfaces(rightPanelState.surfaces.filter((entry) => entry.id !== surface.id));
  };
  const closeOtherRightPanelSurfacesStable = useStableCallback(closeOtherRightPanelSurfaces);
  const closeRightPanelSurfacesToRight = (surface: RightPanelSurface) => {
    const surfaceIndex = rightPanelState.surfaces.findIndex((entry) => entry.id === surface.id);
    if (surfaceIndex < 0) return;
    closeRightPanelSurfaces(rightPanelState.surfaces.slice(surfaceIndex + 1));
  };
  const closeRightPanelSurfacesToRightStable = useStableCallback(closeRightPanelSurfacesToRight);
  const closeAllRightPanelSurfaces = () => {
    closeRightPanelSurfaces(rightPanelState.surfaces);
  };
  const closeAllRightPanelSurfacesStable = useStableCallback(closeAllRightPanelSurfaces);
  const moveRightPanelSurface = (surfaceId: string, toIndex: number) => {
    if (activeThreadRef)
      useRightPanelStore.getState().moveSurface(activeThreadRef, surfaceId, toIndex);
  };
  const moveRightPanelSurfaceStable = useStableCallback(moveRightPanelSurface);
  const copyRightPanelFilePath = (relativePath: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: "Clipboard API unavailable.",
        }),
      );
      return;
    }

    void navigator.clipboard.writeText(relativePath).then(
      () => {
        toastManager.add({
          type: "success",
          title: "Path copied",
          description: relativePath,
        });
      },
      (error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to copy path",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  };
  const copyRightPanelFilePathStable = useStableCallback(copyRightPanelFilePath);
  useEffect(
    () =>
      subscribePreviewAction((action) => {
        if (action === "toggle-panel") togglePreviewPanelStable();
      }),
    [togglePreviewPanelStable],
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

  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // thread switches. LegendList fires scroll events with isAtEnd=false while
  // initialScrollAtEnd is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const timelineScrollIntentRef = useRef<"toward-end" | "away-from-end" | null>(null);
  const timelineScrollModeRef = useRef<TimelineScrollMode>("following-end");
  // State mirror of the follow mode refs. LegendList's maintainScrollAtEnd
  // re-pins on its own (independent of the refs), so the timeline needs a
  // render-visible flag to switch it off once the user scrolls away.
  const [timelineLiveFollowEnabled, setTimelineLiveFollowEnabled] = useState(
    () => readTimelinePosition(routeThreadKey)?.atEnd !== false,
  );
  const pendingTimelineAnchorRef = useRef<MessageId | null>(null);
  const positionedTimelineAnchorRef = useRef<MessageId | null>(null);
  const settledTimelineAnchorRef = useRef<MessageId | null>(null);
  const activeTimelineAnchorIndexRef = useRef<number | null>(null);
  const observedTimelineActivityRef = useRef<TimelineRunObservation | null>(null);
  const anchorUserScrollGenerationRef = useRef(0);
  const cancelPositionRestoreRef = useRef<(() => void) | null>(null);
  const liveFollowUserScrollGenerationRef = useRef<number | null>(0);
  const pendingAnchorScrollRestoreRef = useRef<{
    readonly messageId: MessageId;
    readonly offset: number;
    readonly userScrollGeneration: number;
  } | null>(null);
  const anchorScrollRestoreFrameRef = useRef<number | null>(null);
  const cancelTimelineLiveFollowForUserNavigation = () => {
    cancelPositionRestoreRef.current?.();
    anchorUserScrollGenerationRef.current += 1;
    const wasProgrammaticScrollMode = timelineScrollModeRef.current !== "free-scrolling";
    timelineScrollModeRef.current = "free-scrolling";
    liveFollowUserScrollGenerationRef.current = null;
    setTimelineLiveFollowEnabled(false);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    pendingAnchorScrollRestoreRef.current = null;
    if (anchorScrollRestoreFrameRef.current !== null) {
      cancelAnimationFrame(anchorScrollRestoreFrameRef.current);
      anchorScrollRestoreFrameRef.current = null;
    }
    if (wasProgrammaticScrollMode) {
      // While following or anchoring, our scrollToEnd/scrollToOffset calls can
      // sit in LegendList's pending-imperative-scroll queue (it defers them
      // while layout settles) and fire seconds later with stale targets,
      // yanking the view away after the user scrolled. Starting a new
      // imperative scroll cancels everything queued; targeting an item that
      // is not in the data makes the new request itself resolve without ever
      // scrolling, so this is a pure cancel.
      void legendListRef.current?.scrollToItem({
        item: TIMELINE_SCROLL_CANCEL_SENTINEL,
        animated: false,
      });
      // An already-started animated scroll (behavior: smooth) keeps running in
      // the browser regardless of the queue; a same-position instant write is
      // the only way to halt it where it is.
      const scrollNode = legendListRef.current?.getScrollableNode() as
        | { scrollTop?: number }
        | null
        | undefined;
      const currentScrollTop = scrollNode?.scrollTop;
      if (scrollNode && typeof currentScrollTop === "number") {
        scrollNode.scrollTop = currentScrollTop;
      }
    }
  };
  const cancelTimelineLiveFollowForUserNavigationStable = useStableCallback(
    cancelTimelineLiveFollowForUserNavigation,
  );
  const cancelTimelineLiveFollowForUserNavigationRef = useRef(
    cancelTimelineLiveFollowForUserNavigationStable,
  );
  useEffect(() => {
    cancelTimelineLiveFollowForUserNavigationRef.current =
      cancelTimelineLiveFollowForUserNavigationStable;
  }, [cancelTimelineLiveFollowForUserNavigationStable]);
  useEffect(() => {
    const previous = observedTimelineActivityRef.current;
    const dispatchedUserItem =
      previous?.hydrated &&
      previous.threadKey === activeThreadKey &&
      activeActivityRun !== null &&
      previous.runId !== activeActivityRun.runId
        ? serverProjection?.visibleTurnItems.find(
            (row) => row.item.type === "user_message" && row.item.runId === activeActivityRun.runId,
          )
        : undefined;
    const { observation, anchorMessageId: messageId } = observeTimelineRun(previous, {
      threadKey: activeThreadKey,
      hydrated: !isServerThread || (serverProjection !== null && threadStatus === "live"),
      runId: activeActivityRun?.runId ?? null,
      queued: activeActivityRun?.status === "queued",
      messageId:
        dispatchedUserItem?.item.type === "user_message" ? dispatchedUserItem.item.messageId : null,
    });
    observedTimelineActivityRef.current = observation;
    if (messageId === null) return;
    if (
      pendingTimelineAnchorRef.current !== null ||
      timelineScrollModeRef.current === "free-scrolling"
    ) {
      return;
    }

    isAtEndRef.current = true;
    timelineScrollModeRef.current = "anchoring-new-turn";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    pendingTimelineAnchorRef.current = messageId;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor({ threadKey: activeThreadKey, messageId });
  }, [activeActivityRun, activeThreadKey, isServerThread, serverProjection, threadStatus]);
  const timelineRealContentOverflowsViewport = (list?: LegendListRef | null) =>
    timelineContentOverflowsViewport((list ?? legendListRef.current)?.getState(), {
      composerInset: composerTimelineInset,
      anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
    });
  const timelineRealContentOverflowsViewportStable = useStableCallback(
    timelineRealContentOverflowsViewport,
  );
  const pageScrollControllerRef = useRef<ReturnType<typeof createPageScrollController> | null>(
    null,
  );
  const handlePageScrollStart = useEffectEvent((key: PageScrollKey) => {
    timelineScrollIntentRef.current = key === "PageUp" ? "away-from-end" : "toward-end";
    composerRef.current?.collapseForTimelineScrollKey(key);
    if (
      (key === "PageUp" && timelineRealContentOverflowsViewportStable()) ||
      !isTimelineAtLogicalEndStable()
    ) {
      cancelTimelineLiveFollowForUserNavigationStable();
    }
  });
  useEffect(() => {
    const controller = createPageScrollController({
      getContainer: () => legendListRef.current?.getScrollableNode() ?? null,
      getScrollPaddingBottomPx: () => composerOverlayElement?.getBoundingClientRect().height ?? 0,
      onScrollStart: handlePageScrollStart,
    });
    pageScrollControllerRef.current = controller;

    return () => {
      controller.dispose();
      if (pageScrollControllerRef.current === controller) {
        pageScrollControllerRef.current = null;
      }
    };
  }, [composerOverlayElement]);
  const onComposerPageScrollKeyDown = (key: PageScrollKey) => {
    pageScrollControllerRef.current?.handleKeyDown(key);
  };
  const onComposerPageScrollKeyDownStable = useStableCallback(onComposerPageScrollKeyDown);
  const onComposerPageScrollKeyUp = (key: string) => {
    pageScrollControllerRef.current?.handleKeyUp(key);
  };
  const onComposerPageScrollKeyUpStable = useStableCallback(onComposerPageScrollKeyUp);
  const onComposerPageScrollRelease = () => {
    pageScrollControllerRef.current?.releaseActiveKey();
  };
  const onComposerPageScrollReleaseStable = useStableCallback(onComposerPageScrollRelease);
  const scrollToEnd = (animated: boolean = false) => {
    cancelPositionRestoreRef.current?.();
    isAtEndRef.current = true;
    timelineScrollModeRef.current = "following-end";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    pendingTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor(releaseChatTimelineAnchor);
    // The anchored end space must be gone before the scroll measures, or the
    // list lands short of the real end (#6519).
    requestAnimationFrame(() => {
      void legendListRef.current?.scrollToEnd?.({ animated: animated && !prefersReducedMotion() });
    });
  };
  const scrollToEndStable = useStableCallback(scrollToEnd);
  useEffect(() => {
    if (!activeThread?.id) return;
    let removeListeners: (() => void) | null = null;
    let frame: number | null = null;
    const attach = (remainingAttempts: number) => {
      frame = requestAnimationFrame(() => {
        frame = null;
        const scrollNode = legendListRef.current?.getScrollableNode();
        if (!scrollNode) {
          // The list may not have mounted on the first frame after a thread
          // switch — without a retry the opt-out listeners never attach and
          // live-follow becomes impossible to escape for the whole thread.
          if (remainingAttempts > 0) {
            attach(remainingAttempts - 1);
          }
          return;
        }
        const handleManualNavigation = () => {
          cancelTimelineLiveFollowForUserNavigationRef.current();
        };
        // The gestures below must only break follow when they can actually
        // move the viewport away from the live edge (#5566): a spurious break
        // while pinned at the end produces no scroll event, never re-arms,
        // and streaming silently stops following. Underflowing content can't
        // scroll at all, so nothing there should break follow.
        const contentScrollsUp = () => timelineRealContentOverflowsViewportStable();
        // The follow re-arm band, not the strict flag: streaming growth makes
        // isAtEnd flicker false for a frame before the follow scroll catches
        // up, and a gesture landing in that window while still pinned would
        // otherwise break follow with no scroll event left to re-arm it.
        const viewportIsAwayFromEnd = () =>
          resolveTimelineIsAtEnd(legendListRef.current?.getState()) === false;
        const handleWheel = (event: WheelEvent) => {
          if (event.ctrlKey || !isTimelineScrollTarget(event.target, scrollNode, event.deltaY))
            return;
          if (event.deltaY > 0) {
            timelineScrollIntentRef.current = "toward-end";
            if (isAtEndRef.current) {
              composerRef.current?.restoreAfterTimelineReachedEnd();
            }
          } else if (event.deltaY < 0) {
            timelineScrollIntentRef.current = "away-from-end";
          }
          if (event.deltaY < 0 && contentScrollsUp()) {
            handleManualNavigation();
          }
        };
        // Touch direction isn't observable here (touchmove fires on any
        // finger motion, scrolling or not), so break only once the drag has
        // actually carried the viewport out of the end band — an upward flick
        // gets there within its first few events and later touchmoves break.
        const handleTouchMove = () => {
          if (viewportIsAwayFromEnd()) {
            handleManualNavigation();
          }
        };
        // Scrollbar drags produce no wheel/touch events; they are the only
        // pointerdowns whose target is the scroll node itself rather than a
        // message row.
        const handlePointerDown = (event: PointerEvent) => {
          if (event.target === scrollNode) {
            if (contentScrollsUp()) {
              handleManualNavigation();
            }
            return;
          }
          if (viewportIsAwayFromEnd()) {
            handleManualNavigation();
          }
        };
        // Keyboard scrolling (PageUp/Home/ArrowUp) bypasses wheel and
        // pointer events entirely; without this the timeline yanks back to
        // the end on the next stream chunk. Clicking message text can leave
        // DOM focus on body, so these keys must also be heard at document.
        const handleKeyDown = (event: KeyboardEvent) => {
          if (
            !(event.target instanceof Node) ||
            (!scrollNode.contains(event.target) &&
              event.target !== document.body &&
              event.target !== document.documentElement) ||
            event.defaultPrevented ||
            event.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            eventPathContainsSelector(event, TYPE_TO_FOCUS_EDITABLE_SELECTOR) ||
            document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR)
          ) {
            return;
          }
          if (!["PageUp", "Home", "ArrowUp", "PageDown", "End", "ArrowDown"].includes(event.key))
            return;
          const scrollDirection = ["PageUp", "Home", "ArrowUp"].includes(event.key) ? -1 : 1;
          if (
            scrollNode.contains(event.target) &&
            !isTimelineScrollTarget(event.target, scrollNode, scrollDirection)
          )
            return;
          switch (event.key) {
            case "PageUp":
            case "Home":
            case "ArrowUp":
              timelineScrollIntentRef.current = "away-from-end";
              if (contentScrollsUp()) {
                handleManualNavigation();
                composerRef.current?.collapseForTimelineScrollKey(event.key);
              }
              break;
            case "PageDown":
            case "End":
            case "ArrowDown":
              timelineScrollIntentRef.current = "toward-end";
              if (viewportIsAwayFromEnd()) {
                handleManualNavigation();
              }
              composerRef.current?.collapseForTimelineScrollKey(event.key);
              if (isTimelineAtLogicalEndStable()) {
                composerRef.current?.restoreAfterTimelineReachedEnd();
              }
              break;
            default:
              break;
          }
        };
        scrollNode.addEventListener("wheel", handleWheel, {
          passive: true,
        });
        scrollNode.addEventListener("touchmove", handleTouchMove, {
          passive: true,
        });
        scrollNode.addEventListener("pointerdown", handlePointerDown, {
          passive: true,
        });
        document.addEventListener("keydown", handleKeyDown);
        removeListeners = () => {
          scrollNode.removeEventListener("wheel", handleWheel);
          scrollNode.removeEventListener("touchmove", handleTouchMove);
          scrollNode.removeEventListener("pointerdown", handlePointerDown);
          document.removeEventListener("keydown", handleKeyDown);
        };
      });
    };
    attach(12);

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      removeListeners?.();
    };
  }, [
    activeThread?.id,
    composerRef,
    isTimelineAtLogicalEndStable,
    timelineRealContentOverflowsViewportStable,
  ]);

  const onTimelineAnchorReady = (messageId: MessageId, anchorIndex: number) => {
    if (pendingTimelineAnchorRef.current === messageId) {
      pendingTimelineAnchorRef.current = null;
    }
    activeTimelineAnchorIndexRef.current = anchorIndex;
    if (positionedTimelineAnchorRef.current === messageId) {
      return;
    }
    positionedTimelineAnchorRef.current = messageId;
    settledTimelineAnchorRef.current = null;
    const positionAnchor = (remainingAttempts: number) => {
      requestAnimationFrame(() => {
        if (positionedTimelineAnchorRef.current !== messageId) {
          return;
        }
        const list = legendListRef.current;
        if (!list) {
          if (remainingAttempts > 0) {
            positionAnchor(remainingAttempts - 1);
          }
          return;
        }
        const scrollNode = list.getScrollableNode();
        let finished = false;
        const finishAnimatedPositioning = () => {
          if (finished) {
            return;
          }
          finished = true;
          window.clearTimeout(fallbackTimer);
          scrollNode.removeEventListener("scrollend", finishAnimatedPositioning);
          if (positionedTimelineAnchorRef.current !== messageId) {
            return;
          }
          const scrollOffset = list.getState().scroll;
          void list.scrollToOffset({ offset: scrollOffset, animated: false });
          settledTimelineAnchorRef.current = messageId;
        };
        const fallbackTimer = window.setTimeout(finishAnimatedPositioning, 750);
        scrollNode.addEventListener("scrollend", finishAnimatedPositioning, { once: true });
        void list.scrollToIndex({
          index: anchorIndex,
          animated: !prefersReducedMotion(),
          viewPosition: 0,
          viewOffset: CHAT_LIST_ANCHOR_OFFSET,
        });
      });
    };
    requestAnimationFrame(() => positionAnchor(12));
  };
  const onTimelineAnchorReadyStable = useStableCallback(onTimelineAnchorReady);
  const onTimelineAnchorSizeChanged = (messageId: MessageId) => {
    if (settledTimelineAnchorRef.current !== messageId) {
      return;
    }
    if (liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current) {
      return;
    }
    const scrollOffset = legendListRef.current?.getState().scroll;
    if (scrollOffset === undefined) {
      return;
    }
    if (pendingAnchorScrollRestoreRef.current === null) {
      pendingAnchorScrollRestoreRef.current = {
        messageId,
        offset: scrollOffset,
        userScrollGeneration: anchorUserScrollGenerationRef.current,
      };
    }
    if (anchorScrollRestoreFrameRef.current !== null) {
      return;
    }
    anchorScrollRestoreFrameRef.current = requestAnimationFrame(() => {
      anchorScrollRestoreFrameRef.current = null;
      const pending = pendingAnchorScrollRestoreRef.current;
      pendingAnchorScrollRestoreRef.current = null;
      if (
        pending &&
        settledTimelineAnchorRef.current === pending.messageId &&
        pending.userScrollGeneration === anchorUserScrollGenerationRef.current
      ) {
        const list = legendListRef.current;
        const currentScrollOffset = list?.getState().scroll;
        if (
          typeof currentScrollOffset === "number" &&
          Math.abs(currentScrollOffset - pending.offset) <= 2
        ) {
          void list?.scrollToOffset({ offset: pending.offset, animated: false });
        }
      }
    });
  };
  const onTimelineAnchorSizeChangedStable = useStableCallback(onTimelineAnchorSizeChanged);

  const onToolOutputCollapsedAtEnd = () => {
    composerRef.current?.restoreAfterTimelineReachedEnd();
  };
  const onToolOutputCollapsedAtEndStable = useStableCallback(onToolOutputCollapsedAtEnd);

  const onIsAtEndChange = (isAtEnd: boolean) => {
    if (
      !isAtEnd &&
      liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current
    ) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      return;
    }
    if (isAtEndRef.current === isAtEnd) return;
    isAtEndRef.current = isAtEnd;
    if (isAtEnd) {
      if (timelineScrollIntentRef.current === "toward-end") {
        composerRef.current?.restoreAfterTimelineReachedEnd();
      }
      timelineScrollModeRef.current = "following-end";
      liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
      setTimelineLiveFollowEnabled(true);
      setTimelineAnchor(releaseChatTimelineAnchor);
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    } else {
      timelineScrollModeRef.current = "free-scrolling";
      liveFollowUserScrollGenerationRef.current = null;
      showScrollDebouncer.current.maybeExecute();
    }
  };
  const onIsAtEndChangeStable = useStableCallback(onIsAtEndChange);

  useLayoutEffect(() => {
    if (timelineScrollModeRef.current !== "anchoring-new-turn") return;
    if (
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId: timelineAnchorMessageId,
        liveFollowEnabled: timelineLiveFollowEnabled,
        runningTurnId: activeRunningTurnId,
        timelineEntries,
      })
    ) {
      scrollToEndStable();
    }
  }, [
    activeRunningTurnId,
    scrollToEndStable,
    timelineAnchorMessageId,
    timelineEntries,
    timelineLiveFollowEnabled,
  ]);

  const [timelineScrollSession, setTimelineScrollSession] = useState(() => ({
    threadKey: activeThreadKey,
    followEnd: readTimelinePosition(routeThreadKey)?.atEnd !== false,
  }));
  if (timelineScrollSession.threadKey !== activeThreadKey) {
    const followEnd = readTimelinePosition(routeThreadKey)?.atEnd !== false;
    setTimelineScrollSession({ threadKey: activeThreadKey, followEnd });
    setPullRequestDialogState(null);
    setTimelineLiveFollowEnabled(followEnd);
    setShowScrollToBottom(!followEnd);
  }
  useEffect(() => {
    const { followEnd } = timelineScrollSession;
    isAtEndRef.current = followEnd;
    timelineScrollIntentRef.current = null;
    timelineScrollModeRef.current = followEnd ? "following-end" : "free-scrolling";
    liveFollowUserScrollGenerationRef.current = followEnd
      ? anchorUserScrollGenerationRef.current
      : null;
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
  }, [timelineScrollSession]);

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
          if (shouldRefocusComposerOnWindowFocus(document.activeElement)) focusComposerStable();
        });
      });
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposerStable, isMobileViewport, terminalUiState.terminalOpen]);

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
    setExpandedImage(null);
  }

  const closeExpandedImage = () => {
    setExpandedImage(null);
  };
  const closeExpandedImageStable = useStableCallback(closeExpandedImage);

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
  const localCheckoutBranchMismatch = useMemo(
    () =>
      isServerThread
        ? resolveLocalCheckoutBranchMismatch({
            effectiveEnvMode: envMode,
            activeWorktreePath,
            activeThreadBranch,
            currentGitBranch: gitStatusQuery.data?.refName ?? null,
          })
        : null,
    [activeThreadBranch, activeWorktreePath, envMode, gitStatusQuery.data?.refName, isServerThread],
  );
  const publishComposerOverlayHeight = (height: number) => {
    const nextHeight = Math.ceil(height);
    if (nextHeight <= 0) return;
    const isResting = overlayComposerIsResting({
      composerMounted: composerMountedRef.current,
      composerReportedResting: composerRestingRef.current,
    });
    const nextInset = resolveComposerTimelineInset({
      currentInset: composerTimelineInsetRef.current,
      overlayHeight: nextHeight,
      isResting,
    });
    if (composerTimelineInsetRef.current !== nextInset) {
      composerTimelineInsetRef.current = nextInset;
      setComposerTimelineInset(nextInset);
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
    const stopObserving = observeResize(composerOverlayElement, updateHeight);
    return () => {
      disposed = true;
      stopObserving();
    };
  }, [composerOverlayElement, publishComposerOverlayHeightStable]);
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
    publishComposerOverlayHeightStable(composerOverlayElement.getBoundingClientRect().height);
  }, [composerMounted, composerOverlayElement, publishComposerOverlayHeightStable]);
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(activeThreadRef);
  const activeThreadReferenceCopyTarget = useMemo(
    () =>
      activeThreadId === null || !isServerThread
        ? null
        : resolveThreadReferenceCopyTarget({
            threadId: activeThreadId,
            openPanelPullRequestUrl,
            pullRequests: activeThread?.pullRequests,
            linkedPullRequestUrl: linkedThreadPullRequest?.url ?? null,
          }),
    [
      activeThreadId,
      isServerThread,
      activeThread?.pullRequests,
      linkedThreadPullRequest?.url,
      openPanelPullRequestUrl,
    ],
  );
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
  const addPullRequestSurface = () => {
    if (!supportsPullRequests || activeThreadRef === null || pullRequestPanelTarget === null)
      return;
    useRightPanelStore.getState().openPullRequest(activeThreadRef, pullRequestPanelTarget);
  };
  const addPullRequestSurfaceStable = useStableCallback(addPullRequestSurface);
  const pullRequestSurfaceAvailable = supportsPullRequests && pullRequestPanelTarget !== null;
  const supportsMarkDone = serverConfig != null;
  const supportsSnooze = serverConfig != null;
  const supportsPinning = serverConfig != null;
  const activeThreadPinned = supportsPinning && activeThreadShell?.pinnedAt != null;
  const activeThreadSnoozed =
    activeThreadShell !== null &&
    supportsSnooze &&
    effectiveSnoozed(activeThreadShell, { now: new Date().toISOString() });
  const [, bumpSnoozeWakeTick] = useState(0);
  useEffect(() => {
    if (!activeThreadSnoozed) return;
    const wakeAtMs = Date.parse(activeThreadShell?.snoozedUntil ?? "");
    if (!Number.isFinite(wakeAtMs)) return;
    let id = 0;
    const scheduleWake = () => {
      id = window.setTimeout(
        () => {
          if (Date.now() < wakeAtMs) {
            scheduleWake();
            return;
          }
          bumpSnoozeWakeTick((tick) => tick + 1);
        },
        Math.min(Math.max(0, wakeAtMs - Date.now()) + 50, 2_147_483_647),
      );
    };
    scheduleWake();
    return () => window.clearTimeout(id);
  }, [activeThreadShell?.snoozedUntil, activeThreadSnoozed]);
  const activeThreadWokeAt =
    activeThreadShell !== null && supportsSnooze
      ? threadWokeAt(activeThreadShell, { now: new Date().toISOString() })
      : null;
  const acknowledgeThreadWoke = useAcknowledgeThreadWoke();
  const acknowledgeActiveThreadWoke = () => {
    if (activeThreadRef === null || activeThreadWokeAt === null) return;
    acknowledgeThreadWoke(activeThreadRef, activeThreadWokeAt);
  };
  const acknowledgeActiveThreadWokeStable = useStableCallback(acknowledgeActiveThreadWoke);
  const activeThreadLastVisitedAt = activeThreadShell?.lastVisitedAt;
  const activeThreadWokeVisible = isThreadWokeUnseen({
    wokeAt: activeThreadWokeAt,
    done: activeThreadShell?.doneOverride === "done",
    lastVisitedAt: activeThreadLastVisitedAt,
    latestRunCompletedAt: activeLatestRun?.completedAt ?? null,
  });
  const activeThreadDone =
    supportsMarkDone && !activeThreadSnoozed && activeThreadShell?.doneOverride === "done";
  const reopenThreadMutation = useOrchestrationCommand(threadEnvironment.reopen, {
    reportFailure: false,
  });
  const [reopeningThreadKey, setReopeningThreadKey] = useState<string | null>(null);
  const isReopening = reopeningThreadKey !== null && reopeningThreadKey === activeThreadKey;
  const handleReopenActiveThread = async () => {
    if (
      !activeThreadRef ||
      !readEnvironmentScope(activeThreadRef.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const threadKey = scopedThreadKey(activeThreadRef);
    setReopeningThreadKey(threadKey);
    const reopenRequest = reopenThreadMutation({
      environmentId: activeThreadRef.environmentId,
      input: { threadId: activeThreadRef.threadId, reason: "user" },
    });
    try {
      const result = await reopenRequest;
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to reopen thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    } finally {
      setReopeningThreadKey((current) => (current === threadKey ? null : current));
    }
  };
  const handleReopenActiveThreadStable = useStableCallback(handleReopenActiveThread);
  const unsnoozeThreadMutation = useOrchestrationCommand(threadEnvironment.unsnooze, {
    reportFailure: false,
  });
  const [unsnoozingThreadKey, setUnsnoozingThreadKey] = useState<string | null>(null);
  const isUnsnoozing = unsnoozingThreadKey !== null && unsnoozingThreadKey === activeThreadKey;
  const handleUnsnoozeActiveThread = async () => {
    if (
      !activeThreadRef ||
      !readEnvironmentScope(activeThreadRef.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const threadKey = scopedThreadKey(activeThreadRef);
    setUnsnoozingThreadKey(threadKey);
    const recovery = activeThreadShell?.limitRecovery;
    const recoveryOwnsSnooze =
      recovery?.snooze === true &&
      recovery.runId === activeThreadShell?.latestRun?.runId &&
      activeThreadShell?.snoozedUntil != null &&
      Date.parse(activeThreadShell.snoozedUntil) === Date.parse(recovery.resetAt);
    const unsnoozeRequest = recoveryOwnsSnooze
      ? updateThreadMetadata({
          environmentId: activeThreadRef.environmentId,
          input: {
            threadId: activeThreadRef.threadId,
            limitRecovery: { runId: recovery.runId, resetAt: recovery.resetAt, snooze: false },
          },
        })
      : unsnoozeThreadMutation({
          environmentId: activeThreadRef.environmentId,
          input: { threadId: activeThreadRef.threadId, reason: "user" },
        });
    try {
      const result = await unsnoozeRequest;
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to wake thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    } finally {
      setUnsnoozingThreadKey((current) => (current === threadKey ? null : current));
    }
  };
  const handleUnsnoozeActiveThreadStable = useStableCallback(handleUnsnoozeActiveThread);
  const [isRestoringThreadBranch, setIsRestoringThreadBranch] = useState(false);
  const [revealedBranchMismatchKey, setRevealedBranchMismatchKey] = useState<string | null>(null);
  const [, setBranchMismatchDismissTick] = useState(0);
  const composerHasDraftContent = useComposerDraftStore((store) =>
    composerDraftHasUserContent(store.getComposerDraft(composerDraftTarget)),
  );
  const nowMinute = useNowMinute();
  const activeBranchMismatchKey = branchMismatchKey(
    activeThread?.id ?? null,
    localCheckoutBranchMismatch,
  );
  const showBranchMismatchBanner = shouldShowBranchMismatchBanner({
    hasMismatch: localCheckoutBranchMismatch !== null,
    isDismissed: isBranchMismatchDismissedForSession(activeBranchMismatchKey),
    composerHasContent: composerHasDraftContent,
    wasShownForCurrentMismatch:
      revealedBranchMismatchKey !== null && revealedBranchMismatchKey === activeBranchMismatchKey,
  });
  const nextRevealedBranchMismatchKey = showBranchMismatchBanner
    ? activeBranchMismatchKey
    : revealedBranchMismatchKey !== null && revealedBranchMismatchKey !== activeBranchMismatchKey
      ? null
      : revealedBranchMismatchKey;
  if (nextRevealedBranchMismatchKey !== revealedBranchMismatchKey) {
    setRevealedBranchMismatchKey(nextRevealedBranchMismatchKey);
  }
  const handleSwitchCheckoutToThread = async () => {
    if (!canWriteSourceControl) return;
    if (
      !activeProjectCwd ||
      !activeThread ||
      !localCheckoutBranchMismatch ||
      isRestoringThreadBranch
    ) {
      return;
    }
    setIsRestoringThreadBranch(true);
    const checkoutResult = await switchGitRef({
      environmentId,
      input: {
        cwd: activeProjectCwd,
        refName: localCheckoutBranchMismatch.threadBranch,
      },
    });
    if (checkoutResult._tag === "Failure") {
      setIsRestoringThreadBranch(false);
      if (!isAtomCommandInterrupted(checkoutResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to switch checkout",
            description: chatActionErrorMessage(squashAtomCommandFailure(checkoutResult)),
          }),
        );
      }
      return;
    }

    if (!readEnvironmentScope(environmentId, AuthSourceControlWriteScope)) {
      setIsRestoringThreadBranch(false);
      return;
    }
    const nextBranch = checkoutResult.value.refName ?? localCheckoutBranchMismatch.threadBranch;
    if (nextBranch !== activeThread.branch) {
      const updateResult = await updateThreadMetadata({
        environmentId,
        input: { threadId: activeThread.id, branch: nextBranch, worktreePath: null },
      });
      if (updateResult._tag === "Failure") {
        setIsRestoringThreadBranch(false);
        if (!isAtomCommandInterrupted(updateResult)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Checkout switched, but the thread could not be updated",
              description: chatActionErrorMessage(squashAtomCommandFailure(updateResult)),
            }),
          );
        }
        gitStatusQuery.refresh();
        return;
      }
    }
    gitStatusQuery.refresh();
    setIsRestoringThreadBranch(false);
    scheduleComposerFocus();
  };
  const handleSwitchCheckoutToThreadStable = useStableCallback(handleSwitchCheckoutToThread);
  // The stack renders items[0] front-most and tucks the rest behind hover, so
  // ordering is priority: system banners, then the branch-mismatch notice,
  // and the informational parked-thread banner last — it must never cover another.
  // Background work (subagent fleets, workflow runs, watch loops, dev servers) can outlive
  // the turn; once it settles, the composer stop button is gone, so this
  // banner is the only visible stop affordance. The interrupt path also
  // accepts a completed run while its provider still has background work.
  const activeBackgroundTasks = !isWorking && activeThread ? pendingBackgroundTasks : [];
  const [stoppingBackgroundWorkKey, setStoppingBackgroundWorkKey] = useState<string | null>(null);
  const isStoppingBackgroundWork =
    stoppingBackgroundWorkKey === `${environmentId}:${activeThreadId}`;
  const handleStopBackgroundWork = async () => {
    if (!activeThread || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope))
      return;
    const requestKey = `${environmentId}:${activeThread.id}`;
    setStoppingBackgroundWorkKey(requestKey);
    const result = await interruptThreadTurn({
      environmentId,
      input: { threadId: activeThread.id },
    });
    // Acceptance does not confirm termination. Allow retry while the provider
    // finishes stopping the tasks or reports a failure.
    setStoppingBackgroundWorkKey((current) => (current === requestKey ? null : current));
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to stop background work.",
        );
      }
    }
  };
  const handleStopBackgroundWorkStable = useStableCallback(handleStopBackgroundWork);
  const onOpenRelatedThread = (threadId: ThreadId) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };
  const onOpenRelatedThreadStable = useStableCallback(onOpenRelatedThread);
  const childThreadInputs = useChildThreadInputs(activeThreadRef);
  const childInputBannerItem = useMemo<ComposerBannerStackItem | null>(() => {
    const first = childThreadInputs[0];
    const parentAwaitingUser =
      activePendingApproval || activePendingUserInput || activeThreadShell?.hasPendingUserInput;
    if (!first || parentAwaitingUser) return null;
    return {
      id: `child-input:${first.id}`,
      variant: "info",
      priority: "activity",
      icon: first.hasPendingApprovals ? <ShieldQuestionIcon /> : <MessageCircleIcon />,
      title: childThreadInputsTitle(childThreadInputs),
      description: childThreadInputs.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 ? " " : null}
          <span className="whitespace-nowrap">
            <InlineButton tone="muted" onClick={() => onOpenRelatedThreadStable(child.id)}>
              {child.title}
            </InlineButton>
            {index < childThreadInputs.length - 1 ? "," : null}
          </span>
        </Fragment>
      )),
      actions: (
        <Button size="xs" variant="ghost" onClick={() => onOpenRelatedThreadStable(first.id)}>
          {first.hasPendingApprovals ? "Open approval" : "Open question"}
        </Button>
      ),
    };
  }, [
    childThreadInputs,
    activePendingApproval,
    activePendingUserInput,
    activeThreadShell?.hasPendingUserInput,
    onOpenRelatedThreadStable,
  ]);

  const sendStandaloneCommand = async (text: string, failureMessage: string) => {
    if (!activeThread || !clientSettingsHydrated || sendInFlightRef.current) return;
    const context = composerRef.current?.getSendContext();
    if (!context?.providerAvailable) return;

    const threadId = activeThread.id;
    const createdAt = new Date().toISOString();
    sendInFlightRef.current = true;
    setThreadError(threadId, null);
    try {
      await enqueueThreadOutboxTurns([
        {
          environmentId,
          input: {
            threadId,
            message: { messageId: newMessageId(), role: "user", text, attachments: [] },
            modelSelection: context.selectedModelSelection,
            runtimeMode,
            interactionMode: context.interactionMode,
            createdAt,
          },
          ...(localCheckoutBranchMismatch
            ? { branch: localCheckoutBranchMismatch.currentBranch }
            : {}),
        },
      ]);
      scrollToEnd();
      clearUsageLimitsFor(routeThreadKey);
    } catch (error) {
      setThreadError(threadId, error instanceof Error ? error.message : failureMessage);
    } finally {
      sendInFlightRef.current = false;
    }
  };
  const sendStandaloneCommandStable = useStableCallback(sendStandaloneCommand);
  const activeGoal = activeThreadShell?.goal ?? null;
  const goalBannerItem = useMemo<ComposerBannerStackItem | null>(() => {
    if (!activeThread || activeGoal === null) return null;
    const presentation = presentProviderGoal(activeGoal, isWorking);
    return {
      id: `goal:${activeThread.id}`,
      variant: "default",
      priority: "activity",
      icon: <TargetIcon />,
      title:
        presentation.usage === null
          ? presentation.title
          : `${presentation.title} · ${presentation.usage}`,
      description: presentation.objective,
      actions: isWorking ? undefined : (
        <>
          {presentation.canResume ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void sendStandaloneCommandStable("/goal resume", "Failed to resume goal.")
              }
            >
              Resume
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void sendStandaloneCommandStable("/goal clear", "Failed to clear goal.")}
          >
            Clear
          </Button>
        </>
      ),
    };
  }, [activeGoal, activeThread, isWorking, sendStandaloneCommandStable]);

  const backgroundWorkBannerItem = useMemo<ComposerBannerStackItem | null>(() => {
    const presentation = presentPendingBackgroundWork(activeBackgroundTasks);
    if (presentation === null || !activeThread) {
      return null;
    }
    // One watched run colors the dot; with more, no one run speaks for the banner.
    const watches = serverProjection?.thread.workflowRunWatches ?? [];
    const watchedRun = {
      run: watches.length === 1 ? watches[0]! : null,
      environmentId: activeThread.environmentId,
      projectId: activeThread.projectId,
      handle: backgroundWorkChecksHandle,
    };
    return {
      id: `background-work:${activeThread.id}`,
      variant: "default",
      priority: "activity",
      icon: (
        <BackgroundWorkIcon
          {...watchedRun}
          waiting={presentation.waiting}
          threadRef={activeThreadRef}
        />
      ),
      iconInteractive: watchedRun.run !== null,
      title: <BackgroundWorkTitle {...watchedRun} title={presentation.title} />,
      description:
        presentation.items.length === 1 && presentation.items[0]?.childThreadId === undefined
          ? undefined
          : presentation.items.map((item, index) => {
              const childThreadId = item.childThreadId;
              const separator = index < presentation.items.length - 1 ? "," : null;
              return (
                <Fragment key={item.taskId}>
                  {index > 0 ? " " : null}
                  {childThreadId === undefined ? (
                    <>
                      {item.label}
                      {separator}
                    </>
                  ) : (
                    <span className="whitespace-nowrap">
                      <InlineButton
                        tone="muted"
                        aria-label={`Open subagent ${item.label}`}
                        onClick={() => onOpenRelatedThreadStable(childThreadId)}
                      >
                        {item.label}
                      </InlineButton>
                      {separator}
                    </span>
                  )}
                </Fragment>
              );
            }),
      actions: (
        <Button
          size="xs"
          variant="ghost"
          disabled={!canOperateThread || isStoppingBackgroundWork}
          onClick={() => void handleStopBackgroundWorkStable()}
        >
          {isStoppingBackgroundWork ? "Stopping..." : "Stop"}
        </Button>
      ),
    };
  }, [
    activeBackgroundTasks,
    activeThread,
    activeThreadRef,
    backgroundWorkChecksHandle,
    canOperateThread,
    handleStopBackgroundWorkStable,
    isStoppingBackgroundWork,
    onOpenRelatedThreadStable,
    serverProjection?.thread.workflowRunWatches,
  ]);
  // Done, snoozed, and woke are thread state, not composer actions: each
  // gets one quiet line after the last message instead of a banner. A woken
  // thread announces itself here, not just in the sidebar pill. Dismissing
  // marks the wake as seen (same acknowledgment as the pill); sending a
  // message clears it as a side effect of the send path.
  // Memoized: it is the timeline's list footer, and a new element re-renders that footer.
  // nowMinute keeps the relative time fresh.
  const activeDoneAt = activeThreadShell?.doneAt;
  const activeSnoozedUntil = activeThreadShell?.snoozedUntil;
  const threadStatusLine = useMemo(() => {
    const nowMs = Date.parse(`${nowMinute}:00.000Z`);
    return activeThreadSnoozed ? (
      <ThreadStatusLine
        icon={<AlarmClockIcon />}
        label={
          activeSnoozedUntil
            ? `Snoozed, ${formatRelativeTimeUntilLabel(activeSnoozedUntil, nowMs)}`
            : "Snoozed"
        }
        actionLabel={isUnsnoozing ? "Waking..." : "Wake now"}
        actionDisabled={!canOperateThread || isUnsnoozing}
        onAction={() => void handleUnsnoozeActiveThreadStable()}
      />
    ) : activeThreadDone ? (
      <ThreadStatusLine
        icon={<CheckCircle2Icon />}
        label={activeDoneAt ? `Done ${formatRelativeTimeLabel(activeDoneAt, nowMs)}` : "Done"}
        actionLabel={isReopening ? "Reopening..." : "Reopen"}
        actionDisabled={!canOperateThread || isReopening}
        onAction={() => void handleReopenActiveThreadStable()}
      />
    ) : activeThreadWokeVisible ? (
      <ThreadStatusLine
        icon={<AlarmClockIcon />}
        label="Woke from snooze"
        actionLabel="Dismiss"
        onAction={acknowledgeActiveThreadWokeStable}
      />
    ) : null;
  }, [
    acknowledgeActiveThreadWokeStable,
    activeThreadDone,
    activeDoneAt,
    activeSnoozedUntil,
    activeThreadSnoozed,
    activeThreadWokeVisible,
    canOperateThread,
    handleReopenActiveThreadStable,
    handleUnsnoozeActiveThreadStable,
    isReopening,
    isUnsnoozing,
    nowMinute,
  ]);
  const activeThreadHasCompactableConversation = serverVisibleTurnItems.some(
    ({ item }) =>
      item.type === "user_message" &&
      (item.text.trim().toLowerCase() !== "/compact" || item.attachments.length > 0),
  );
  const pendingHandoff = useMemo(
    () =>
      resolvePendingHandoff(
        serverProjection,
        composerSelectedModelSelection ?? activeThread?.modelSelection,
        providerStatuses,
      ),
    [
      serverProjection,
      composerSelectedModelSelection,
      activeThread?.modelSelection,
      providerStatuses,
    ],
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
  const feedbackBannerItems = useMemo(
    () =>
      feedbackSubmissions.flatMap((submission) => {
        const item = feedbackBannerItem(submission, () => {
          setFeedbackSubmissionsByThreadKey((current) => ({
            ...current,
            [routeThreadKey]: (current[routeThreadKey] ?? []).filter(
              (entry) => entry.id !== submission.id,
            ),
          }));
        });
        return item ? [item] : [];
      }),
    [feedbackSubmissions, routeThreadKey],
  );
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
  const composerBannerItems = useMemo<ComposerBannerStackItem[]>(() => {
    const limitRecoveryItems = limitRecoveryBanner === null ? [] : [limitRecoveryBanner];
    const backgroundWorkItems = [
      childInputBannerItem,
      goalBannerItem,
      backgroundWorkBannerItem,
    ].filter((item) => item !== null);
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
      {
        id: `branch-mismatch:${activeBranchMismatchKey}`,
        variant: "info",
        icon: <GitBranchIcon />,
        title: (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-normal text-muted-foreground">Branch changed — was</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <code className="min-w-0 truncate font-medium text-foreground">
                    {localCheckoutBranchMismatch.threadBranch}
                  </code>
                }
              />
              <TooltipPopup side="top">
                This thread last ran on {localCheckoutBranchMismatch.threadBranch}. Sending will
                continue on {localCheckoutBranchMismatch.currentBranch}.
              </TooltipPopup>
            </Tooltip>
          </span>
        ),
        actions: (
          <InlineConfirmButton
            size="xs"
            variant="ghost"
            disabled={!canWriteSourceControl || isRestoringThreadBranch}
            required={gitStatusQuery.data?.hasWorkingTreeChanges === true}
            label={isRestoringThreadBranch ? "Restoring..." : "Restore branch"}
            confirmLabel="Confirm restore"
            tooltip={
              gitStatusQuery.data?.hasWorkingTreeChanges
                ? `Switch back to ${localCheckoutBranchMismatch.threadBranch}. You have uncommitted changes.`
                : `Switch back to ${localCheckoutBranchMismatch.threadBranch}`
            }
            confirmTooltip={`Click again to switch to ${localCheckoutBranchMismatch.threadBranch}. Your uncommitted changes will carry over, or block the switch if they conflict.`}
            onConfirm={() => void handleSwitchCheckoutToThreadStable()}
          />
        ),
        dismissLabel: "Dismiss branch change notice",
        onDismiss: () => {
          dismissBranchMismatchForSession(activeBranchMismatchKey);
          setBranchMismatchDismissTick((tick) => tick + 1);
        },
      },
    ];
  }, [
    activeBranchMismatchKey,
    canWriteSourceControl,
    feedbackBannerItems,
    gitStatusQuery.data?.hasWorkingTreeChanges,
    limitRecoveryBanner,
    handleSwitchCheckoutToThreadStable,
    isRestoringThreadBranch,
    backgroundWorkBannerItem,
    childInputBannerItem,
    goalBannerItem,
    localCheckoutBranchMismatch,
    projectCloneBannerItem,
    showBranchMismatchBanner,
    systemComposerBannerItems,
    usageLimitsBanner,
  ]);

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

  const { onForkFromRun: forkFromRun, disabled: forkDisabled } = useForkThread(
    isServerThread ? activeThread : null,
    isRevertingCheckpoint || threadDetailLoading || activeEnvironmentUnavailable,
  );
  const forkSource = useMemo(
    () => (serverProjection === null ? null : resolveThreadForkSource(serverProjection)),
    [serverProjection],
  );
  const onForkFromRun = async (source: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => {
    try {
      await forkFromRun(source);
    } catch (error) {
      if (!activeThread) return;
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : "Failed to fork this response.",
      );
    }
  };
  const onForkFromRunStable = useStableCallback(onForkFromRun);

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

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (preventRepeatedTerminalCloseShortcut(event, keybindings)) {
        event.stopPropagation();
        return;
      }

      if (isThreadFindActive && event.key === "Escape") return;
      if (isTerminalCloseConfirmPending() && preventTerminalCloseShortcut(event, keybindings)) {
        event.stopPropagation();
        return;
      }
      if (!activeThreadId || isCommandPaletteOpen()) {
        return;
      }
      const terminalFocusOwner = getTerminalFocusOwner();
      if (event.defaultPrevented && terminalFocusOwner === null) {
        return;
      }
      const shortcutContext = getShortcutContextStable(event.target);

      if (
        !shortcutContext.terminalFocus &&
        !shortcutContext.modelPickerOpen &&
        shouldTypeToFocusComposer(event)
      ) {
        if (composerRef.current?.insertTextAtEnd(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      const command = resolveChatShortcutCommand(event, keybindings, scriptKeybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "thread.copyReference") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) copyActiveThreadReferenceStable();
        return;
      }

      if (command === "thread.fork") {
        if (!forkSource || forkDisabled) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) void onForkFromRunStable(forkSource);
        return;
      }

      if (command === "thread.mark-done") {
        if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!isServerThread || !activeThreadRef || !supportsMarkDone) return;
        if (activeThreadDone) {
          void handleReopenActiveThreadStable();
          return;
        }
        if (markDoneAndAdvance(activeThreadRef)) return;

        void markThreadDone(activeThreadRef).then((result) => {
          if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to mark thread as Done",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        });
        return;
      }

      if (command === "thread.pin") {
        if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!isServerThread || !activeThreadRef || !supportsPinning) return;
        const pinned = activeThreadPinned;
        void (pinned ? confirmAndUnpinThread(activeThreadRef) : pinThread(activeThreadRef)).then(
          (result) => {
            if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: pinned ? "Failed to unpin thread" : "Failed to pin thread",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          },
        );
        return;
      }

      if (command === "terminal.toggle") {
        if (!terminalUiState.terminalOpen && !canReadTerminal && !canOperateTerminal) return;
        event.preventDefault();
        event.stopPropagation();
        toggleTerminalVisibilityStable();
        return;
      }

      if (command === "chat.find" && isServerThread && serverConfig?.threadFind === true) {
        event.preventDefault();
        event.stopPropagation();
        openThreadFindStable();
        return;
      }

      if (command === "rightPanel.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleRightPanelStable();
        return;
      }

      if (command === "rightPanel.toggleMaximized") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) toggleRightPanelMaximizedStable();
        return;
      }

      if (command === "threadPanel.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleThreadPanelStable();
        return;
      }

      if (command === "rightPanel.close") {
        if (!activeRightPanelSurface) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) closeRightPanelSurfaceStable(activeRightPanelSurface);
        return;
      }

      if (command === "terminal.split") {
        if (!canOperateTerminal) return;
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel") {
          splitPanelTerminalStable();
          return;
        }
        if (!terminalUiState.terminalOpen) {
          setTerminalOpenStable(true);
        }
        splitTerminalStable();
        return;
      }

      if (command === "terminal.splitVertical") {
        if (!canOperateTerminal) return;
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel") {
          splitPanelTerminalStable("vertical");
          return;
        }
        if (!terminalUiState.terminalOpen) {
          setTerminalOpenStable(true);
        }
        splitTerminalStable("vertical");
        return;
      }

      if (command === "terminal.close") {
        if (!canOperateTerminal) return;
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel" && activeRightPanelSurface?.kind === "terminal") {
          requestClosePanelTerminalStable(activeRightPanelSurface.activeTerminalId);
          return;
        }
        if (!terminalUiState.terminalOpen) return;
        requestCloseTerminalStable(terminalUiState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        if (!canOperateTerminal) return;
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel") {
          addTerminalSurfaceStable();
          return;
        }
        if (!terminalUiState.terminalOpen) {
          setTerminalOpenStable(true);
        }
        createNewTerminalStable();
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onToggleDiffStable();
        return;
      }

      if (command === "modelPicker.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) composerRef.current?.toggleModelPicker();
        return;
      }

      if (
        command === "composer.host" ||
        command === "composer.effort" ||
        command === "composer.mode" ||
        command === "composer.workspace"
      ) {
        if (
          (command === "composer.host" || command === "composer.workspace") &&
          !showDraftProjectPicker
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) composerRef.current?.openControl(command);
        return;
      }

      if (command === "composer.cycleHost") {
        if (envLocked || !draftId || !hasMultipleEnvironments) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        const currentId = environmentChangeRef.current?.environmentId ?? environmentId;
        const index = logicalProjectEnvironments.findIndex(
          (env) => env.environmentId === currentId,
        );
        const next = logicalProjectEnvironments[(index + 1) % logicalProjectEnvironments.length];
        if (next) onEnvironmentChangeStable(next.environmentId);
        return;
      }

      if (command === "composer.branch") {
        if (!isGitRepo || !showDraftProjectPicker) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) branchToolbarRef.current?.openBranchPicker();
        return;
      }

      if (command === "composer.previousWorktree") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) branchToolbarRef.current?.usePreviousWorktree();
        return;
      }

      if (command === "thread.steerQueuedMessage") {
        if (routeKind === "draft") return;
        if (!queuedRunsControlRef.current?.steerNext(event.repeat)) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (command === "thread.editQueuedMessage") {
        if (routeKind === "draft") return;
        if (!composerRef.current?.isCaretAtStart()) return;
        if (!queuedRunsControlRef.current?.editLatest(event.repeat)) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (command === "thread.stop") {
        if (!canInterruptRunningThread) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        void onInterruptStable();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject || !canOperateTerminal) return;
      const script = activeProjectScripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScriptStable(script);
    };
    const dismissFind = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !isThreadFindActive ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        isCommandPaletteOpen()
      )
        return;
      const context = getShortcutContextStable(event.target);
      if (context.terminalFocus || context.previewFocus || context.modelPickerOpen) return;
      event.preventDefault();
      closeThreadFindStable();
      focusComposerStable();
    };
    window.addEventListener("keydown", handler, true);
    window.addEventListener("keydown", dismissFind);
    return () => {
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener("keydown", dismissFind);
    };
  }, [
    activeProject,
    activeRightPanelSurface,
    activeProjectScripts,
    canReadTerminal,
    canOperateTerminal,
    addTerminalSurfaceStable,
    activeThreadRef,
    activeThreadPinned,
    activeThreadDone,
    canInterruptRunningThread,
    terminalUiState.terminalOpen,
    terminalUiState.activeTerminalId,
    activeThreadId,
    closeRightPanelSurfaceStable,
    requestCloseTerminalStable,
    requestClosePanelTerminalStable,
    createNewTerminalStable,
    setTerminalOpenStable,
    runProjectScriptStable,
    splitTerminalStable,
    splitPanelTerminalStable,
    keybindings,
    scriptKeybindings,
    handleReopenActiveThreadStable,
    isServerThread,
    serverConfig?.threadFind,
    onInterruptStable,
    onToggleDiffStable,
    pinThread,
    markThreadDone,
    supportsPinning,
    supportsMarkDone,
    confirmAndUnpinThread,
    copyActiveThreadReferenceStable,
    forkDisabled,
    forkSource,
    onForkFromRunStable,
    getShortcutContextStable,
    openThreadFindStable,
    closeThreadFindStable,
    focusComposerStable,
    isThreadFindActive,
    toggleRightPanelStable,
    toggleRightPanelMaximizedStable,
    toggleThreadPanelStable,
    toggleTerminalVisibilityStable,
    composerRef,
    routeKind,
    draftId,
    environmentId,
    envLocked,
    hasMultipleEnvironments,
    logicalProjectEnvironments,
    onEnvironmentChangeStable,
    isGitRepo,
    showDraftProjectPicker,
  ]);

  useEffect(() => {
    return window.desktopBridge?.onMenuAction((action) => {
      if (action === "rightPanel.toggle") toggleRightPanelStable();
      else if (action === "rightPanel.toggleMaximized") toggleRightPanelMaximizedStable();
    });
  }, [toggleRightPanelStable, toggleRightPanelMaximizedStable]);

  // Paste-to-focus: the resting composer blurs on a click into the timeline,
  // so a paste that follows has no editable target and would be dropped.
  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if (
        shouldRedirectInputToComposer(event) &&
        isPasteAsTextShortcut(event, isMacPlatform(navigator.platform))
      ) {
        pasteAsTextShortcutUntilRef.current = Date.now() + 1_000;
      }
    };
    const handler = (event: ClipboardEvent) => {
      if (!activeThreadId || isCommandPaletteOpen()) return;
      if (getTerminalFocusOwner() !== null) return;
      if (composerRef.current?.isModelPickerOpen()) return;
      const text = pasteTextToFocusComposer(event);
      const clipboardData = event.clipboardData;
      if (text === null || clipboardData === null) return;
      const bypassAutoAttachment = Date.now() <= pasteAsTextShortcutUntilRef.current;
      pasteAsTextShortcutUntilRef.current = 0;
      if (
        ((readPastedComposerContext(clipboardData)?.records.length ?? 0) === 0 &&
          composerRef.current?.pasteTextAtEnd(text, { bypassAutoAttachment })) ||
        composerRef.current?.insertTextAtEnd(text, { clipboardData })
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", keyHandler, true);
    window.addEventListener("paste", handler, true);
    return () => {
      window.removeEventListener("keydown", keyHandler, true);
      window.removeEventListener("paste", handler, true);
    };
  }, [activeThreadId, composerRef]);

  const [pendingRevert, setPendingRevert] = useState<{
    turnCount: number;
    messageId: MessageId;
    routeThreadKey: string;
  } | null>(null);

  if (pendingRevert && pendingRevert.routeThreadKey !== routeThreadKey) {
    setPendingRevert(null);
  }

  const onRevertToTurnCount = async (
    turnCount: number,
    messageId: MessageId,
    restoreFiles?: boolean,
  ) => {
    const localApi = readLocalApi();
    if (
      !localApi ||
      !activeThread ||
      isRevertingCheckpoint ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const sourceMessage = serverProjection?.messages.find((message) => message.id === messageId);
    const message = sourceMessage
      ? {
          id: sourceMessage.id,
          role: sourceMessage.role,
          text: sourceMessage.text,
          attachments: sourceMessage.attachments,
          context: sourceMessage.context,
          runId: sourceMessage.runId,
          streaming: false,
          createdAt: DateTime.formatIso(sourceMessage.createdAt),
          updatedAt: DateTime.formatIso(sourceMessage.updatedAt),
        }
      : undefined;
    if (!message || message.role !== "user") return;

    if (!supportsConversationRollback) {
      setThreadError(
        activeThread.id,
        "This provider does not support reverting conversation history. Start a new thread instead.",
      );
      return;
    }
    if (activeEnvironmentUnavailable && activeEnvironmentUnavailableLabel) {
      setThreadError(
        activeThread.id,
        `Reconnect ${activeEnvironmentUnavailableLabel} before reverting checkpoints.`,
      );
      return;
    }
    if (phase === "running" || isSendBusy || isConnecting) {
      setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
      return;
    }
    if (restoreFiles === undefined) {
      setPendingRevert({ turnCount, messageId, routeThreadKey });
      return;
    }

    useComposerDraftStore.setState((store) => ({
      rewindingThreadKeys: new Set(store.rewindingThreadKeys).add(routeThreadKey),
    }));
    setThreadError(activeThread.id, null);
    try {
      if (composerRef.current?.hasPendingAttachments()) {
        throw new Error("Wait for attachments to finish preparing before rewinding.");
      }
      const connection = readPreparedConnection(environmentId);
      if (!connection) throw new Error("The environment is not connected.");
      const files = await prepareRevertedMessageAttachments({
        message,
        environmentId,
        httpBaseUrl: connection.httpBaseUrl,
        createAssetUrl: createAttachmentAssetUrl,
      });
      const store = useComposerDraftStore.getState();
      const draft = store.getComposerDraft(composerDraftTarget);
      if (
        (draft?.images.length ?? 0) + (draft?.files.length ?? 0) + files.length >
        PROVIDER_SEND_TURN_MAX_ATTACHMENTS
      ) {
        throw new Error(
          "Make room for this message's attachments in the composer before rewinding.",
        );
      }
      const commandId = CommandId.make(randomUUID());
      await waitForRevertedMessage(routeThreadRef, messageId, turnCount, commandId, async () => {
        const result = await revertThreadCheckpoint({
          environmentId,
          input: { commandId, threadId: activeThread.id, turnCount, restoreFiles },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      });
      const currentPrompt = store.getComposerDraft(composerDraftTarget)?.prompt ?? "";
      const restoredPrompt = recallableComposerPrompt(message.text);
      const nextPrompt =
        restoredPrompt.length === 0
          ? currentPrompt
          : currentPrompt.length > 0
            ? `${currentPrompt}\n\n${restoredPrompt}`
            : restoredPrompt;
      store.setPrompt(composerDraftTarget, nextPrompt);
      const images: ComposerImageAttachment[] = [];
      const restoredFiles: ComposerFileAttachment[] = [];
      files.forEach((file, index) => {
        const attachment = {
          id: randomUUID(),
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          file,
        };
        if (message.attachments?.[index]?.type === "image") {
          images.push({ ...attachment, type: "image", previewUrl: URL.createObjectURL(file) });
        } else {
          restoredFiles.push({ ...attachment, type: "file" });
        }
      });
      store.addImages(composerDraftTarget, images, { allowDuplicates: true });
      store.addFiles(composerDraftTarget, restoredFiles, { allowDuplicates: true });
      if (currentRouteThreadKeyRef.current === routeThreadKey) {
        promptRef.current = nextPrompt;
        composerRef.current?.resetCursorState({ prompt: nextPrompt, cursor: nextPrompt.length });
        requestAnimationFrame(() => {
          if (currentRouteThreadKeyRef.current === routeThreadKey)
            composerRef.current?.focusAtEnd();
        });
      }
    } catch (error) {
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : "Failed to revert thread state.",
      );
    } finally {
      useComposerDraftStore.setState((store) => {
        const remaining = new Set(store.rewindingThreadKeys);
        remaining.delete(routeThreadKey);
        return { rewindingThreadKeys: remaining };
      });
    }
  };
  const onRevertToTurnCountStable = useStableCallback(onRevertToTurnCount);

  const onCompactContext = () => {
    if (compactDisabled) return;
    void sendStandaloneCommand("/compact", "Failed to compact context.");
  };

  const onResume = async () => {
    if (
      !activeThread ||
      (resumableRunId === null && !hasHeldQueuedRuns) ||
      isSendBusy ||
      isResuming ||
      isConnecting ||
      isRevertingCheckpoint ||
      threadDetailLoading ||
      activeEnvironmentUnavailable ||
      sendInFlightRef.current
    ) {
      return;
    }
    const threadId = activeThread.id;
    sendInFlightRef.current = true;
    setResumingThreadKeys((current) => new Set(current).add(routeThreadKey));
    setThreadError(threadId, null);
    try {
      const resume = async () => {
        if (resumableRunId === null) {
          return resumeThreadQueue({ environmentId, input: { threadId } });
        }
        const createdAt = new Date().toISOString();
        const settingsResult = await persistThreadSettingsForNextTurn({
          threadId,
          createdAt,
          ...(localCheckoutBranchMismatch
            ? { branch: localCheckoutBranchMismatch.currentBranch }
            : {}),
          runtimeMode,
          interactionMode,
        });
        if (settingsResult._tag === "Failure") return settingsResult;
        const modelSelection = composerRef.current?.getSendContext().selectedModelSelection;
        const turnResult = await startThreadTurn({
          environmentId,
          input: {
            threadId,
            manualContinuationOfRunId: resumableRunId,
            ...(modelSelection ? { modelSelection } : {}),
            message: {
              messageId: newMessageId(),
              role: "user",
              text: "Continue where you left off.",
              attachments: [],
            },
            runtimeMode,
            interactionMode,
            dispatchMode: "start",
          },
        });
        if (turnResult._tag === "Failure" || !hasHeldQueuedRuns) return turnResult;
        clearUsageLimitsFor(routeThreadKey);
        return resumeThreadQueue({ environmentId, input: { threadId } });
      };
      const result = await resume();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setThreadError(
            threadId,
            error instanceof Error ? error.message : "Could not resume thread.",
          );
        }
      } else {
        clearUsageLimitsFor(routeThreadKey);
        if (currentRouteThreadKeyRef.current === routeThreadKey) scrollToEnd();
      }
    } finally {
      sendInFlightRef.current = false;
      setResumingThreadKeys((current) => {
        const next = new Set(current);
        next.delete(routeThreadKey);
        return next;
      });
    }
  };

  function captureOutboxAttachments(
    attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>,
  ) {
    return attachments.map((attachment) => {
      const uploaded =
        attachment.file === null
          ? getUploadedAttachments({ environmentId, images: [attachment] })?.[0]
          : undefined;
      if (attachment.file === null && uploaded === undefined)
        throw new Error(`Attach '${attachment.name}' again before sending.`);
      return {
        id: attachment.id,
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        bytes: attachment.file,
        ...(attachment.source ? { source: attachment.source } : {}),
        ...(uploaded ? { uploaded } : {}),
      };
    });
  }

  const onSend = async (
    e?: { preventDefault: () => void },
    dispatchMode: ComposerDispatchMode = "auto",
    submissionIntent: ComposerSubmissionIntent = "foreground",
    directAnnotation?: {
      annotation: PreviewAnnotationPayload;
      image: ComposerImageAttachment | null;
    },
  ) => {
    e?.preventDefault();
    if (outboxEditor.editing) {
      if (directAnnotation || sendInFlightRef.current || isSavingQueuedEdit) return;
      const sendContext = composerRef.current?.getSendContext();
      if (!sendContext) return;
      const { entry, keptAttachmentIds } = outboxEditor.editing;
      sendInFlightRef.current = true;
      setIsSavingQueuedEdit(true);
      try {
        const addedAttachments = [...sendContext.images, ...sendContext.files];
        const payload = buildEditedThreadOutboxTurn({
          entry,
          text: promptRef.current,
          keptAttachmentIds,
          addedAttachments: captureOutboxAttachments(addedAttachments),
          context: buildMessageContext({
            terminalContexts: sendContext.terminalContexts,
            reviewComments: sendContext.reviewComments,
            previewAnnotations: sendContext.previewAnnotations,
            threadContexts: sendContext.threadContexts,
            attachments: addedAttachments.map((attachment) => ({
              attachment,
              attachmentId: attachment.id,
            })),
          }),
        });
        const nextThreadRef = await outboxEditor.editor.save({
          ...payload,
          input: {
            ...payload.input,
            modelSelection: sendContext.selectedModelSelection,
            runtimeMode,
            interactionMode: sendContext.interactionMode,
          },
        });
        setThreadError(threadId, null);
        composerRef.current?.resetCursorState();
        if (nextThreadRef)
          void navigate({ to: "/$environmentId/$threadId", params: nextThreadRef, replace: true });
        scheduleComposerFocus();
      } catch (error) {
        setThreadError(
          threadId,
          error instanceof Error ? error.message : "Could not save the pending message.",
        );
      } finally {
        sendInFlightRef.current = false;
        setIsSavingQueuedEdit(false);
      }
      return;
    }

    if (
      usageLimitsOffered &&
      usageLimitsKey !== null &&
      !directAnnotation &&
      !composerHasNonPromptContent &&
      isUsageLimitsCommand(promptRef.current)
    ) {
      if (openUsageLimits()) {
        promptRef.current = "";
        setComposerDraftPrompt(composerDraftTarget, "");
        composerRef.current?.resetCursorState();
      }
      return;
    }

    const notifyDirectAnnotationAttached = () => {
      if (!directAnnotation) return;
      toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Annotation attached to draft",
          description: "Sending is unavailable right now. Finish the current action, then send.",
        }),
      );
    };
    if (
      !readCanQueueComposerMessage(environmentId) ||
      !activeThread ||
      isSendBusy ||
      isConnecting ||
      isRevertingCheckpoint ||
      !clientSettingsHydrated ||
      (threadDetailLoading && !activeEnvironmentUnavailable) ||
      environmentChangeRef.current !== null ||
      sendInFlightRef.current ||
      feedbackUploadsInFlightRef.current.has(routeThreadKey)
    ) {
      notifyDirectAnnotationAttached();
      return;
    }
    if (needsLoadBalancing) {
      toastManager.add({
        type: "warning",
        title: loadBalancing.pending
          ? "Checking machine resources"
          : "Choose a machine to continue",
        description: loadBalancing.pending
          ? "Resource checks are still running. You can choose a machine in the composer."
          : "No eligible machine has available resources. Choose a machine in the composer to override.",
      });
      return;
    }
    const sendCtx = composerRef.current?.getSendContext();
    if (activePendingProgress && sendCtx?.answeringPendingUserInput !== false) {
      if (directAnnotation || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
        notifyDirectAnnotationAttached();
        return;
      }
      onAdvanceActivePendingUserInput();
      return;
    }
    if (!sendCtx?.providerAvailable) {
      notifyDirectAnnotationAttached();
      return;
    }
    const multipleModelSelections = sendCtx.multipleModelSelections;
    if (multipleModelSelections !== null && serverConfig == null) {
      setThreadError(
        activeThread.id,
        "Connect to this environment before starting multiple models.",
      );
      return;
    }
    if (
      multipleModelSelections !== null &&
      (!isLocalDraftThread ||
        !isGitRepo ||
        shouldRequireWorktreeBaseBranch({
          shouldCreateWorktree: true,
          activeThreadBranch,
          refsSettled: worktreeBaseRefsSettled,
          environmentUnavailable: activeEnvironmentUnavailable,
        }) ||
        multipleModelSelections.length === 0)
    ) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Choose models and a base branch",
          description:
            "Multiple models need a new thread in a Git project. Each gets its own worktree.",
        }),
      );
      return;
    }
    const {
      images: sendContextImages,
      files: composerFiles,
      terminalContexts: composerTerminalContexts,
      previewAnnotations: sendContextPreviewAnnotations,
      reviewComments: composerReviewComments,
      threadContexts: composerThreadContexts,
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
      interactionMode: sendInteractionMode,
    } = sendCtx;
    const annotationImageAlreadyAttached =
      directAnnotation?.image !== undefined &&
      sendContextImages.some((image) => image.id === directAnnotation.image?.id);
    // A full composer (e.g. 8 files) cannot take the annotation screenshot;
    // over the cap the server rejects the whole turn.
    const annotationImageAppended =
      directAnnotation?.image !== undefined &&
      !annotationImageAlreadyAttached &&
      sendContextImages.length + composerFiles.length < PROVIDER_SEND_TURN_MAX_ATTACHMENTS;
    const composerImages =
      directAnnotation?.image && annotationImageAppended
        ? [...sendContextImages, directAnnotation.image]
        : sendContextImages;
    const composerPreviewAnnotations =
      directAnnotation &&
      !sendContextPreviewAnnotations.some(
        (annotation) => annotation.id === directAnnotation.annotation.id,
      )
        ? [
            ...sendContextPreviewAnnotations,
            {
              ...directAnnotation.annotation,
              screenshot:
                directAnnotation.annotation.screenshot &&
                (annotationImageAppended || annotationImageAlreadyAttached)
                  ? { ...directAnnotation.annotation.screenshot, dataUrl: "" }
                  : null,
            },
          ]
        : sendContextPreviewAnnotations;
    // A direct "send annotation" writes the draft and sends in the same tick; the reference
    // must be in the text now, not after the next render.
    const promptForSend = directAnnotation
      ? ensureInlineContextReferences(promptRef.current, [
          previewAnnotationContextReference(directAnnotation.annotation),
        ])
      : promptRef.current;
    if (editingQueuedRun !== null) {
      if (queuedEditSaveInFlightRef.current) return;
      const editText = promptForSend.trim();
      const newEditImages = [...composerImages];
      const newEditFiles = [...composerFiles];
      const newEditAttachments = [...newEditImages, ...newEditFiles];
      if (
        editingQueuedRun.existingAttachments.length + newEditAttachments.length >
        PROVIDER_SEND_TURN_MAX_ATTACHMENTS
      ) {
        setThreadError(
          editingQueuedRun.threadId,
          `A message can have at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments.`,
        );
        return;
      }
      if (
        editText.length === 0 &&
        editingQueuedRun.existingAttachments.length === 0 &&
        newEditImages.length === 0 &&
        newEditFiles.length === 0
      ) {
        return;
      }
      queuedEditSaveInFlightRef.current = true;
      setIsSavingQueuedEdit(true);
      try {
        const uploads = await prepareQueuedEditAttachments({
          existingAttachments: editingQueuedRun.existingAttachments,
          images: newEditImages,
          files: newEditFiles,
          readImage: readFileAsDataUrl,
          uploadFiles: async (files) => {
            const validateFiles = () => {
              const config =
                appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null;
              const reason = fileAttachmentCapabilityBlockReason({
                files,
                attachmentUploadsCapabilityKnown: config !== null,
                supportsAttachmentUploads: config != null,
                maxFileAttachmentBytes:
                  config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
              });
              if (reason !== null) throw new Error(reason);
            };
            validateFiles();
            for (const file of files)
              startAttachmentUpload({
                environmentId,
                image: file,
                draftTarget: composerDraftTarget,
              });
            await awaitAttachmentUploads(files.map((file) => file.id));
            validateFiles();
            const uploaded = getUploadedAttachments({ environmentId, images: files });
            if (uploaded === null) throw new Error("Retry or remove failed uploads before saving.");
            return uploaded;
          },
        });
        const result = await editQueuedRunCommand({
          environmentId: activeThread.environmentId,
          input: {
            threadId: editingQueuedRun.threadId,
            runId: editingQueuedRun.runId,
            text: editText.length === 0 ? ATTACHMENT_ONLY_BOOTSTRAP_PROMPT : editText,
            edit: {
              messageId: editingQueuedRun.messageId,
              attachments: uploads,
              context: {
                version: 1,
                records: [
                  ...new Map(
                    [
                      ...(editingQueuedRun.context?.records ?? []).filter(
                        (record) =>
                          !("attachmentId" in record) ||
                          editingQueuedRun.existingAttachments.some(
                            (attachment) => attachment.id === record.attachmentId,
                          ),
                      ),
                      ...(buildMessageContext({
                        terminalContexts: composerTerminalContexts.filter(
                          (context) => context.text.trim().length > 0,
                        ),
                        reviewComments: composerReviewComments,
                        previewAnnotations: composerPreviewAnnotations,
                        threadContexts: composerThreadContexts,
                        attachments: newEditAttachments.map((attachment, index) => ({
                          attachment,
                          attachmentId:
                            uploads[editingQueuedRun.existingAttachments.length + index]?.id ??
                            attachment.id,
                        })),
                      })?.records ?? []),
                    ].map((record) => [record.contextId, record] as const),
                  ).values(),
                ],
              },
            },
          },
        });
        if (result._tag === "Failure") {
          setThreadError(editingQueuedRun.threadId, "Could not save the edited queued message.");
          return;
        }
        setThreadError(editingQueuedRun.threadId, null);
        releaseDraftAttachments(newEditAttachments);
        promptRef.current = "";
        clearComposerDraftContent(queuedEditDraftTargetFor(editingQueuedRun.runId));
        composerRef.current?.resetCursorState();
        setEditingQueuedRun(null);
        scheduleComposerFocus();
      } catch (error) {
        setThreadError(
          editingQueuedRun.threadId,
          error instanceof Error ? error.message : "Could not save the edited queued message.",
        );
      } finally {
        queuedEditSaveInFlightRef.current = false;
        setIsSavingQueuedEdit(false);
      }
      return;
    }
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length + composerFiles.length,
      terminalContexts: composerTerminalContexts,
      elementContextCount:
        composerPreviewAnnotations.length +
        composerReviewComments.length +
        composerThreadContexts.length,
    });
    const feedbackCommand =
      ctxSelectedProvider === "codex" &&
      composerImages.length === 0 &&
      composerFiles.length === 0 &&
      sendableComposerTerminalContexts.length === 0 &&
      composerPreviewAnnotations.length === 0 &&
      composerReviewComments.length === 0 &&
      composerThreadContexts.length === 0
        ? parseCodexFeedbackCommand(trimmed)
        : null;
    if (feedbackCommand && multipleModelSelections === null) {
      if (!isServerThread || activeThread.activeProviderThreadId === null) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Start a Codex thread first",
            description: "Send a message before you submit feedback.",
          }),
        );
        return;
      }
      feedbackUploadsInFlightRef.current.add(routeThreadKey);
      await submitCodexFeedback({
        submission: {
          id: newMessageId(),
          command: trimmed,
          createdAt: new Date().toISOString(),
        },
        clearDraft: () => {
          promptRef.current = "";
          clearComposerDraftContent(composerDraftTarget);
          composerRef.current?.resetCursorState();
        },
        onUpdate: (submission) => {
          setFeedbackSubmissionsByThreadKey((current) => {
            const existing = current[routeThreadKey] ?? [];
            const found = existing.some((entry) => entry.id === submission.id);
            return {
              ...current,
              [routeThreadKey]: found
                ? existing.map((entry) => (entry.id === submission.id ? submission : entry))
                : [...existing, submission],
            };
          });
        },
        upload: () =>
          uploadThreadFeedback({
            environmentId: activeThread.environmentId,
            input: { threadId: activeThread.id, ...feedbackCommand },
          }),
      }).finally(() => {
        feedbackUploadsInFlightRef.current.delete(routeThreadKey);
      });

      return;
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          }),
        );
      }
      return;
    }
    if (!activeProject) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Choose a project first",
          description: "This draft no longer points to an available project.",
        }),
      );
      return;
    }
    const threadIdForSend = activeThread.id;
    const shouldCreateWorktree =
      isLocalDraftThread && sendEnvMode === "worktree" && !activeThread.worktreePath;
    const baseBranchForWorktree = shouldCreateWorktree ? activeThreadBranch : null;
    if (
      shouldRequireWorktreeBaseBranch({
        shouldCreateWorktree,
        activeThreadBranch,
        refsSettled: worktreeBaseRefsSettled,
        environmentUnavailable: activeEnvironmentUnavailable,
      })
    ) {
      setThreadError(threadIdForSend, "Select a base branch before sending in New worktree mode.");
      return;
    }

    const composerImagesSnapshot = [...composerImages];
    const composerFilesSnapshot = [...composerFiles];
    const composerAttachmentsSnapshot = [...composerImagesSnapshot, ...composerFilesSnapshot];
    const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
    const composerPreviewAnnotationsSnapshot = [...composerPreviewAnnotations];
    const composerReviewCommentsSnapshot: ReviewCommentContext[] = [...composerReviewComments];
    const composerThreadContextsSnapshot = [...composerThreadContexts];
    const messageTextForSend = composerTerminalContexts
      .filter((context) => !composerTerminalContextsSnapshot.includes(context))
      .reduce(
        (text, context) =>
          removeInlineContextReference(text, terminalContextReference(context).contextId).prompt,
        promptForSend,
      )
      .trim();
    // Records bind attachments by the id each side knows: the local id for the optimistic
    // row, the upload id (or local id on the data-URL path) on the wire; the server
    // rebinds them to the persisted id.
    const buildOutgoingMessageContext = (attachmentIds: ReadonlyArray<string>) =>
      buildMessageContext({
        terminalContexts: composerTerminalContextsSnapshot,
        reviewComments: composerReviewCommentsSnapshot,
        previewAnnotations: composerPreviewAnnotationsSnapshot,
        threadContexts: composerThreadContextsSnapshot,
        attachments: composerAttachmentsSnapshot.map((attachment, index) => ({
          attachment,
          attachmentId: attachmentIds[index] ?? attachment.id,
        })),
      });
    const outgoingMessageContext = buildOutgoingMessageContext(
      composerAttachmentsSnapshot.map((attachment) => attachment.id),
    );
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
    const turnDispatchMode = sendQueuesBehindSetup ? "queue" : dispatchMode;
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: messageTextForSend || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
    });
    if (composerRef.current?.validateProviderInput(outgoingMessageText) === false) {
      return;
    }

    const multipleTargets = [];
    for (const selection of multipleModelSelections ?? []) {
      const provider = providerInstanceEntries.find(
        (entry) => entry.instanceId === selection.instanceId,
      );
      if (!provider?.enabled || !provider.isAvailable || provider.status !== "ready") {
        setThreadError(threadIdForSend, `Provider for ${selection.model} is unavailable.`);
        return;
      }
      const providerBlockReason = getAntigravitySendBlockReason(provider.snapshot, selection.model);
      if (providerBlockReason) {
        setThreadError(threadIdForSend, providerBlockReason);
        return;
      }
      const providerState = getComposerProviderState({
        provider: provider.driverKind,
        model: selection.model,
        models: provider.models,
        modelOptions: selection.options,
        promptInjectionState: getComposerPromptInjectionState(messageTextForSend),
      });
      const text = formatOutgoingPrompt({
        provider: provider.driverKind,
        model: selection.model,
        models: provider.models,
        effort: providerState.promptEffort,
        text: messageTextForSend || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
      });
      if (composerRef.current?.validateProviderInput(text) === false) return;
      multipleTargets.push({
        selection: createModelSelection(
          selection.instanceId,
          selection.model,
          providerState.modelOptionsForDispatch,
        ),
        text,
        interactionMode: sendInteractionMode,
      });
    }

    sendInFlightRef.current = true;
    const savedDraft = useComposerDraftStore.getState().getComposerDraft(composerDraftTarget);
    try {
      const titleSeed =
        assistantCitationsToPlainText(stripInlineContextReferences(trimmed)).trim() ||
        composerAttachmentsSnapshot[0]?.name ||
        (composerTerminalContextsSnapshot[0]
          ? formatTerminalContextLabel(composerTerminalContextsSnapshot[0])
          : "New thread");
      const title = truncate(titleSeed);
      const localAttachments = captureOutboxAttachments(composerAttachmentsSnapshot);
      const targets =
        multipleModelSelections === null
          ? [
              {
                threadId: threadIdForSend,
                messageId: messageIdForSend,
                selection: ctxSelectedModelSelection,
                text: outgoingMessageText,
                interactionMode: sendInteractionMode,
              },
            ]
          : multipleTargets.map((target) => ({
              ...target,
              threadId: newThreadId(),
              messageId: newMessageId(),
            }));
      await enqueueThreadOutboxTurns(
        targets.map((target) => {
          const prepareWorktree = multipleModelSelections !== null || shouldCreateWorktree;
          const worktree = prepareWorktree
            ? {
                projectCwd: activeProject.workspaceRoot,
                ...(multipleModelSelections !== null ? { requireWorktree: true } : {}),
                ...(startFromOrigin ? { startFromOrigin: true } : {}),
              }
            : undefined;
          const pendingWorktree = worktree && !activeThreadBranch ? worktree : undefined;
          const bootstrap = isLocalDraftThread
            ? {
                createThread: {
                  projectId: activeProject.id,
                  title,
                  modelSelection: target.selection,
                  runtimeMode,
                  interactionMode: target.interactionMode,
                  branch: activeThreadBranch,
                  worktreePath: multipleModelSelections === null ? activeThread.worktreePath : null,
                  createdAt: activeThread.createdAt,
                },
                ...(worktree && activeThreadBranch
                  ? {
                      prepareWorktree: {
                        ...worktree,
                        baseBranch: activeThreadBranch,
                      },
                      runSetupScript: true,
                    }
                  : {}),
              }
            : undefined;
          return {
            environmentId,
            input: {
              threadId: target.threadId,
              message: {
                messageId: target.messageId,
                role: "user" as const,
                text: target.text,
                attachments: [],
                ...(outgoingMessageContext ? { context: outgoingMessageContext } : {}),
              },
              modelSelection: target.selection,
              titleSeed: title,
              runtimeMode,
              interactionMode: target.interactionMode,
              // Like mobile, a delayed steer follows current server state at delivery.
              dispatchMode: turnDispatchMode === "steer" ? ("auto" as const) : turnDispatchMode,
              ...(bootstrap ? { bootstrap } : {}),
              createdAt: messageCreatedAt,
            },
            localAttachments,
            ...(pendingWorktree ? { pendingWorktree } : {}),
            ...(localCheckoutBranchMismatch
              ? { branch: localCheckoutBranchMismatch.currentBranch }
              : {}),
            ...(draftId && multipleModelSelections === null ? { draftId } : {}),
            background: submissionIntent === "background",
          };
        }),
      );
      if (
        multipleModelSelections === null &&
        !sendQueuesBehindSetup &&
        !(phase === "running" && dispatchMode === "queue")
      ) {
        // Anchor the sent turn when its acknowledged row arrives in the transcript.
        isAtEndRef.current = true;
        timelineScrollModeRef.current = "anchoring-new-turn";
        liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
        setTimelineLiveFollowEnabled(true);
        pendingTimelineAnchorRef.current = messageIdForSend;
        activeTimelineAnchorIndexRef.current = null;
        showScrollDebouncer.current.cancel();
        setShowScrollToBottom(false);
        setTimelineAnchor({
          threadKey: scopedThreadKey(scopeThreadRef(environmentId, threadIdForSend)),
          messageId: messageIdForSend,
        });
      }
      if (
        multipleModelSelections === null &&
        shouldDockDraftHeroForSubmission({ isDraftHeroState, activeThreadKey, submissionIntent }) &&
        activeThreadKey
      ) {
        await runMobileComposerTransition(
          () => {
            captureDraftHeroLayout();
            setDockedDraftHeroThreadKey(activeThreadKey);
          },
          { active: panelAnimationsActive, durationMs: panelAnimationDurationMs },
        );
      }
      if (!sendQueuesBehindSetup) {
        setWorktreeSetupRef(
          multipleModelSelections === null && baseBranchForWorktree
            ? {
                environmentId,
                threadId: threadIdForSend,
                ownerKey: worktreeSetupOwnerKey,
              }
            : null,
        );
      }
      if (useComposerDraftStore.getState().getComposerDraft(composerDraftTarget) === savedDraft) {
        promptRef.current = "";
        clearComposerDraftContent(composerDraftTarget);
        composerRef.current?.resetCursorState();
      }
      // The outbox owns its own bytes. References recovered without bytes stay owned until delivery.
      releaseDraftAttachments(
        composerAttachmentsSnapshot.filter((attachment) => attachment.file !== null),
      );
      setThreadError(threadIdForSend, null);
      if (isLocalDraftThread && multipleModelSelections === null)
        markPromotedDraftThreadByRef(scopeThreadRef(environmentId, threadIdForSend));
      clearUsageLimitsFor(routeThreadKey);
      if (submissionIntent === "background") handleNewThreadInActiveProject();
      else if (isLocalDraftThread && targets[0]) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: targets[0].threadId },
          replace: true,
        });
      }
    } catch (error) {
      setThreadError(
        threadIdForSend,
        error instanceof Error ? error.message : "Could not save the pending message.",
      );
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const getModelDisabledReason = useMemo(
    () =>
      makeModelDisabledReason(
        activeThread
          ? {
              providers: providerStatuses,
              hasStartedSession: activeRuntime !== null,
              supportsProviderSwitchingViaHandoff,
              currentModelSelection: activeThread.modelSelection,
              currentProviderInstanceId: activeRuntime?.providerInstanceId ?? null,
            }
          : null,
      ),
    [activeRuntime, activeThread, providerStatuses, supportsProviderSwitchingViaHandoff],
  );

  const onProviderModelSelect = (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean },
  ) => {
    if (!activeThread) return;
    const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
    const resolvedDriverKind = entry?.driver ?? null;
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      resolvedDriverKind !== null &&
      resolvedDriverKind !== lockedProvider
    ) {
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      activeRuntime?.providerInstanceId
    ) {
      const currentEntry = providerStatuses.find(
        (snapshot) => snapshot.instanceId === activeRuntime.providerInstanceId,
      );
      if (
        currentEntry?.continuation?.groupKey &&
        entry?.continuation?.groupKey &&
        currentEntry.continuation.groupKey !== entry.continuation.groupKey
      ) {
        if (options?.focusComposer !== false) scheduleComposerFocus();
        return;
      }
    }
    const resolvedModel = resolveAppModelSelectionForInstance(
      instanceId,
      settings,
      providerStatuses,
      model,
    );
    if (!resolvedModel) {
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    const rememberedOptions =
      useComposerDraftStore.getState().stickyOptionsByModelByProvider[instanceId]?.[resolvedModel];
    const nextModelSelection: ModelSelection =
      rememberedOptions !== undefined && rememberedOptions.length > 0
        ? { instanceId, model: resolvedModel, options: [...rememberedOptions] }
        : { instanceId, model: resolvedModel };
    const modelChangeBlockReason = getStartedThreadModelChangeBlockReason({
      providers: providerStatuses,
      hasStartedSession: activeRuntime !== null,
      supportsProviderSwitchingViaHandoff,
      currentModelSelection: activeThread.modelSelection,
      currentProviderInstanceId: activeRuntime?.providerInstanceId ?? null,
      nextModelSelection,
    });
    if (modelChangeBlockReason) {
      toastManager.add({
        type: "warning",
        title: modelChangeBlockReason.title,
        description: modelChangeBlockReason.description,
      });
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    setComposerDraftModelSelection(
      scopeThreadRef(activeThread.environmentId, activeThread.id),
      nextModelSelection,
      { explicit: true, replaceOptions: true },
    );
    setStickyComposerModelSelection(nextModelSelection);
    if (options?.focusComposer !== false) scheduleComposerFocus();
  };
  const onProviderModelSelectStable = useStableCallback(onProviderModelSelect);
  const onEnvModeChange = (mode: DraftThreadEnvMode) => {
    if (multipleModelSelections !== null) return;
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        envMode: mode,
        startFromOrigin: resolveNewDraftStartFromOrigin({
          envMode: mode,
          newWorktreesStartFromOrigin: activeProjectSettings.settings.newWorktreesStartFromOrigin,
        }),
        ...(mode === "worktree" && draftThread?.worktreePath ? { worktreePath: null } : {}),
      });
    }
    scheduleComposerFocus();
  };
  const onEnvModeChangeStable = useStableCallback(onEnvModeChange);

  const onWorktreeSetupWorkLocally = () => {
    if (!worktreeSetup || worktreeSetup.phase !== "running" || !draftId) {
      return;
    }
    const target = {
      environmentId: setupTarget.environmentId,
      input: { threadId: worktreeSetup.threadId },
    };
    void (async () => {
      const result = await cancelWorktreeSetup(target);
      if (result._tag !== "Success" || !result.value.cancelled) return;
      setWorkLocallyResendDraftId(draftId);
    })();
  };
  const onWorktreeSetupWorkLocallyStable = useStableCallback(onWorktreeSetupWorkLocally);
  const onSendRef = useRef(onSend);
  const onResumeRef = useRef(onResume);
  const onCompactContextRef = useRef(onCompactContext);
  useLayoutEffect(() => {
    onSendRef.current = onSend;
    onResumeRef.current = onResume;
    onCompactContextRef.current = onCompactContext;
  });
  const onComposerSend = (...args: Parameters<typeof onSend>) => onSendRef.current(...args);
  const onComposerSendStable = useStableCallback(onComposerSend);
  const onComposerResume = () => onResumeRef.current();
  const onComposerResumeStable = useStableCallback(onComposerResume);
  const onComposerCompactContext = () => onCompactContextRef.current();
  const onComposerCompactContextStable = useStableCallback(onComposerCompactContext);
  const queuedRunsControl = useMemo(
    () => (
      <>
        <ThreadOutboxControl
          environmentId={environmentId}
          threadId={threadId}
          editingMessageId={outboxEditor.editing?.entry.id ?? null}
          onEditMessage={beginEditingOutboxMessageStable}
          onCancelEdit={cancelEditingOutboxMessageStable}
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
            editingRunId={editingQueuedRun?.runId ?? null}
            onEditQueuedRun={beginEditingQueuedRunStable}
            onCancelEdit={cancelEditingQueuedRunStable}
          />
        ) : null}
      </>
    ),
    [
      environmentId,
      threadId,
      outboxEditor.editing?.entry.id,
      beginEditingOutboxMessageStable,
      cancelEditingOutboxMessageStable,
      activeThread,
      beginEditingQueuedRunStable,
      cancelEditingQueuedRunStable,
      editingQueuedRun?.runId,
      isServerThread,
      keybindings,
      optimisticUserMessages,
    ],
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
    void onSendRef.current();
  }, [
    composerDraftTarget,
    routeThreadKey,
    sendEnvMode,
    setDraftThreadContext,
    workLocallyResendReady,
  ]);

  const onStartFromOriginChange = (nextStartFromOrigin: boolean) => {
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        startFromOrigin: nextStartFromOrigin,
      });
    }
  };

  const onExpandTimelineImage = (preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  };
  const onExpandTimelineImageStable = useStableCallback(onExpandTimelineImage);
  const onOpenTurnDiff = (runId: RunId, filePath?: string) => {
    if (!isServerThread || !activeThreadRef) return;
    const diffOpen =
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, activeThreadRef) === "diff";
    explicitDiffOpenRef.current = diffOpen ? null : activeThreadRef;
    useDiffPanelStore.getState().selectTurn(activeThreadRef, runId, filePath);
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    onDiffPanelOpen?.();
  };
  const onOpenTurnDiffStable = useStableCallback(onOpenTurnDiff);
  // The revert handler is read from a ref at call-time so the callback
  // reference is fully stable and never busts TimelineRowCtx identity.
  const onRevertToTurnCountRef = useRef(onRevertToTurnCountStable);
  useLayoutEffect(() => {
    onRevertToTurnCountRef.current = onRevertToTurnCountStable;
  });
  const onRevertTimelineTurn = (targetTurnCount: number, messageId: MessageId) => {
    void onRevertToTurnCountRef.current(targetTurnCount, messageId);
  };
  const onRevertTimelineTurnStable = useStableCallback(onRevertTimelineTurn);

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
    renderedRightPanelSurface?.kind === "preview" ? (
      <Suspense fallback={null}>
        <PreviewPanel
          mode="embedded"
          threadRef={activeThreadRef}
          tabId={renderedRightPanelSurface.resourceId}
          configuredUrls={configuredPreviewUrls}
          visible={rightPanelOpen}
          onSendAnnotation={(annotation, image) => {
            void onSend(undefined, "auto", "foreground", { annotation, image });
          }}
        />
      </Suspense>
    ) : renderedRightPanelSurface?.kind === "terminal" ? (
      <PersistentThreadTerminalPanel
        visible={rightPanelOpen}
        threadRef={activeThreadRef}
        surface={renderedRightPanelSurface}
        launchContext={activeTerminalLaunchContext ?? null}
        focusRequestId={terminalFocusRequestId}
        keybindings={keybindings}
        onAddTerminalContext={addTerminalContextToDraftStable}
        onSplitTerminal={splitPanelTerminalStable}
        onSplitTerminalVertical={splitPanelTerminalVerticalStable}
        onNewTerminal={addTerminalSurfaceStable}
        onActiveTerminalChange={activatePanelTerminalStable}
        onCloseTerminal={closePanelTerminalStable}
        splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
        splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
        newShortcutLabel={newTerminalShortcutLabel ?? undefined}
        closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
      />
    ) : renderedRightPanelSurface?.kind === "diff" ? (
      <Suspense fallback={null}>
        <DiffPanel
          key={activeThreadKey}
          mode="embedded"
          composerDraftTarget={composerDraftTarget}
          workspaceMutationId={workspaceMutationId}
        />
      </Suspense>
    ) : renderedRightPanelSurface?.kind === "pull-request" && !pullRequestsCapabilityKnown ? (
      <PullRequestDetailGhost />
    ) : renderedRightPanelSurface?.kind === "pull-request" && !supportsPullRequests ? (
      <PullRequestsUnavailableState
        title="Pull requests unavailable"
        error="Update this environment's Supaterm server to browse pull requests."
      />
    ) : renderedRightPanelSurface?.kind === "pull-request" ? (
      <PullRequestDetailPanel
        getShortcutContext={getShortcutContextStable}
        shortcutsEnabled={
          rightPanelOpen && activeRightPanelSurface?.id === renderedRightPanelSurface.id
        }
        key={`${renderedRightPanelSurface.host ?? ""}:${renderedRightPanelSurface.repository}#${renderedRightPanelSurface.number}`}
        environmentId={activeThread.environmentId}
        onSelectPullRequest={(reference) => {
          if (activeThreadRef)
            useRightPanelStore.getState().openPullRequest(activeThreadRef, {
              projectId: reference.projectId,
              repository: reference.repository,
              number: reference.number,
              ...(reference.host ? { host: reference.host } : {}),
            });
        }}
        threadRef={activeThreadRef}
        reference={{
          projectId: renderedRightPanelSurface.projectId as ProjectId,
          ...(renderedRightPanelSurface.host ? { host: renderedRightPanelSurface.host } : {}),
          repository: renderedRightPanelSurface.repository,
          number: renderedRightPanelSurface.number,
        }}
        context={pullRequestPanelContext(
          {
            projectId: activeThread.projectId,
            pullRequests: visiblePullRequests,
            linkedPullRequest: linkedThreadPullRequest,
            branchPullRequest:
              activeThreadShell?.branchPullRequest ?? activeThread.branchPullRequest,
          },
          renderedRightPanelSurface,
        )}
        composerDraftTarget={composerDraftTarget}
        onBack={
          activeThreadRef !== null && pullRequestsSurfaceAvailable && visiblePullRequestCount > 1
            ? addPullRequestsSurfaceStable
            : undefined
        }
      />
    ) : renderedRightPanelSurface?.kind === "pull-requests" && activeThreadRef ? (
      <ThreadPullRequestsPanel threadRef={activeThreadRef} />
    ) : renderedRightPanelSurface?.kind === "device" ? (
      <Suspense fallback={null}>
        <DevicePanel
          mode="embedded"
          threadRef={activeThreadRef}
          key={renderedRightPanelSurface.id}
          surface={renderedRightPanelSurface}
          visible={rightPanelOpen}
          onDismissSetup={() => {
            finishRightPanelSurfaceClose([renderedRightPanelSurface]);
            useRightPanelStore.getState().show(activeThreadRef);
          }}
        />
      </Suspense>
    ) : (renderedRightPanelSurface?.kind === "files" ||
        renderedRightPanelSurface?.kind === "file") &&
      ((activeProject && activeWorkspaceRoot) ||
        (renderedRightPanelSurface.kind === "file" && renderedRightPanelSurface.attachment)) ? (
      <Suspense fallback={null}>
        <FilePreviewPanel
          key={`${activeThread.environmentId}:${
            renderedRightPanelSurface.kind === "file" && renderedRightPanelSurface.attachment
              ? `attachment:${renderedRightPanelSurface.attachment.id}`
              : activeWorkspaceRoot
          }`}
          environmentId={activeThread.environmentId}
          cwd={activeWorkspaceRoot ?? ""}
          projectName={activeProject?.title ?? ""}
          threadRef={activeThreadRef}
          composerDraftTarget={composerDraftTarget}
          keybindings={keybindings}
          availableEditors={availableEditors}
          relativePath={
            renderedRightPanelSurface.kind === "file"
              ? renderedRightPanelSurface.relativePath
              : null
          }
          {...(renderedRightPanelSurface.kind === "file" && renderedRightPanelSurface.attachment
            ? { attachment: renderedRightPanelSurface.attachment }
            : {})}
          revealLine={
            renderedRightPanelSurface.kind === "file"
              ? (renderedRightPanelSurface.revealLine ?? null)
              : null
          }
          revealRequestId={
            renderedRightPanelSurface.kind === "file"
              ? renderedRightPanelSurface.revealRequestId
              : 0
          }
          onOpenFile={openFileSurfaceStable}
          onNavigateFolder={(relativePath, folderTrail, keepSource) =>
            useRightPanelStore
              .getState()
              .navigateFolder(
                activeThreadRef,
                renderedRightPanelSurface.id,
                relativePath,
                folderTrail,
                keepSource,
              )
          }
          folderTrail={renderedRightPanelSurface.folderTrail}
          onPendingChange={handleFilePendingChangeStable}
          selectedFilePending={
            renderedRightPanelSurface.kind === "file" &&
            pendingFileSurfaceIds.has(renderedRightPanelSurface.id)
          }
          workspaceMutationId={workspaceMutationId}
        />
      </Suspense>
    ) : null
  ) : null;
  const threadDetailsPanelProps: ThreadDetailsPanelProps = {
    anchor: threadPanelPopoverAnchorRef,
    handle: threadPanelPopoverHandle,
    onPresentationChange: setThreadPanelPresentation,
    forceNewWorktree: multipleModelSelections !== null,
    environmentId: activeThread.environmentId,
    threadId: activeThread.id,
    ...(draftId ? { draftId } : {}),
    activeProjectName: activeProject?.title,
    activeProjectScripts: activeProject ? activeProjectScripts : undefined,
    preferredScriptId: activeProject
      ? (lastInvokedScriptByProjectId[activeProject.id] ?? null)
      : null,
    keybindings,
    availableEditors,
    showOpenInPicker,
    gitCwd,
    isGitRepo,
    envLocked,
    availableEnvironments: logicalProjectEnvironments,
    autoEnvironmentLabel,
    onAutoEnvironment:
      draftId &&
      !envLocked &&
      canAutoBalanceEnvironments &&
      loadBalancingSettings.loadBalancingEnabled
        ? onAutoEnvironmentStable
        : undefined,
    onEnvironmentChange: onEnvironmentChangeStable,
    onEnvModeChange: onEnvModeChangeStable,
    envMode,
    activeThreadBranchOverride: activeThreadBranch,
    startFromOrigin,
    onStartFromOriginChange,
    ...(canCheckoutPullRequestIntoThread
      ? { onCheckoutPullRequestRequest: openPullRequestDialogStable }
      : {}),
    onComposerFocusRequest: scheduleComposerFocusStable,
    ...(isServerThread && isGitRepo ? { onOpenChanges: openChangesFromThreadPanelStable } : {}),
    onRunProjectScript: runProjectScriptStable,
    onAddProjectScript: saveProjectScriptStable,
    onUpdateProjectScript: updateProjectScriptStable,
    onDeleteProjectScript: deleteProjectScriptStable,
    contextWindow: activeContextWindow
      ? {
          usage: activeContextWindow,
          modelDisplayName: providerSubagentModelLabel,
          ...(manualCompactionProviderAvailable ? { onCompact: onCompactContext } : {}),
          compactDisabled: compactDisabled || isSendBusy || isConnecting,
          compactDisabledReason,
        }
      : null,
    forkSource,
    forkDisabled,
    onForkFromRun: onForkFromRunStable,
  };
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
  const threadPanelHeaderControl = (
    <div
      className="absolute top-[var(--workspace-controls-top)] right-[calc(env(safe-area-inset-right)+0.75rem)] z-50 flex h-[var(--workspace-topbar-height)] items-center [-webkit-app-region:no-drag]"
      data-workspace-titlebar-controls
    >
      <PanelLayoutControls
        {...panelToggleControlProps}
        showTerminalControl={false}
        showRightPanelControl={false}
      />
    </div>
  );
  const panelLayoutControls = (
    <div
      className={cn(
        "pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]",
      )}
      data-workspace-titlebar-controls
    >
      <TooltipProvider>
        {!shouldUsePlanSidebarSheet ? (
          <span
            aria-hidden={!rightPanelOpen}
            className={cn(
              "flex shrink-0",
              panelAnimationsActive &&
                "motion-safe:transition-opacity motion-safe:duration-(--panel-animation-duration) motion-safe:ease-drawer",
              rightPanelOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none absolute right-full mr-1 opacity-0",
            )}
            inert={!rightPanelOpen}
          >
            <RightPanelMaximizeControl
              maximized={rightPanelMaximized}
              onToggle={toggleRightPanelMaximizedStable}
            />
          </span>
        ) : null}
        <div className="pointer-events-auto flex h-full items-center">{panelToggleControls}</div>
      </TooltipProvider>
    </div>
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
          />
        ) : null
      }
    />
  ) : null;

  const content = (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      <Dialog
        open={
          deviceSetupThread !== null &&
          deviceSetupThread.environmentId === activeThreadRef?.environmentId &&
          deviceSetupThread.threadId === activeThreadRef?.threadId
        }
        onOpenChange={(open) => {
          if (!open) setDeviceSetupThread(null);
        }}
      >
        <WizardPopup>
          {activeThreadRef ? (
            <DeviceSetup
              environmentId={activeThreadRef.environmentId}
              state={deviceState}
              onComplete={() => {
                useRightPanelStore.getState().open(activeThreadRef, "device");
                setDeviceSetupThread(null);
              }}
            />
          ) : null}
        </WizardPopup>
      </Dialog>
      {rightPanelControlsAtRoot ? panelLayoutControls : null}
      <PreviewPanelGroup className="min-h-0 min-w-0 flex-1" maximized={rightPanelMaximized}>
        <PreviewPanelSibling>
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-background">
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
                <div className="chat-banner-lane pointer-events-none absolute top-0 z-20 flex flex-col">
                  <ProviderStatusBanner
                    key={`provider:${routeThreadKey}`}
                    status={visibleProviderStatus}
                    onDismiss={() => setDismissedProviderStatusBannerKey(providerStatusBannerKey)}
                    onOpenProviderSetup={openProviderSetupStable}
                  />
                  <ThreadErrorBanner
                    key={`error:${routeThreadKey}`}
                    error={timelineThreadError}
                    errorClass={
                      localServerError === null && visibleThreadError === serverRuntime?.lastError
                        ? (serverRuntime?.lastErrorClass ?? null)
                        : null
                    }
                    onDismiss={() => {
                      setThreadError(activeThread.id, null);
                      dismissThreadErrorBannerForSession(threadErrorBannerKey);
                      setThreadErrorBannerDismissTick((tick) => tick + 1);
                    }}
                  />
                </div>
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
                    providerStatuses={
                      environmentById.get(
                        displayedThreadRef?.environmentId ?? activeThread.environmentId,
                      )?.serverConfig?.providers ?? EMPTY_PROVIDERS
                    }
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
                    onForkFromRun={
                      paintOnlyDisplayedTimeline ? async () => {} : onForkFromRunStable
                    }
                    supportsConversationRollback={
                      !paintOnlyDisplayedTimeline && supportsConversationRollback
                    }
                    onRevertToTurnCount={
                      paintOnlyDisplayedTimeline ? noopHeldRevert : onRevertTimelineTurnStable
                    }
                    {...(!paintOnlyDisplayedTimeline
                      ? {
                          onUseArtifactTemplate: useArtifactTemplateStable,
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
                            inert={isSavingQueuedEdit}
                            aria-busy={isSavingQueuedEdit}
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
                                    outboxEditor.editing ? null : multipleModelSelections
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
                                  isSendBusy={isSendBusy || isSavingQueuedEdit || isResuming}
                                  canResume={resumableRunId !== null || hasHeldQueuedRuns}
                                  isRevertingCheckpoint={isRevertingCheckpoint}
                                  sendDisabledReason={
                                    !canQueueMessage
                                      ? "This connection cannot change threads."
                                      : outboxEditor.editing
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
                                      ? openUsageLimitsStable
                                      : undefined
                                  }
                                  environmentUnavailable={activeEnvironmentUnavailableState}
                                  activePendingApproval={
                                    outboxEditor.editing ? null : activePendingApproval
                                  }
                                  pendingApprovals={outboxEditor.editing ? [] : pendingApprovals}
                                  pendingUserInputs={outboxEditor.editing ? [] : pendingUserInputs}
                                  supportsQuestionAutoDismiss={supportsQuestionAutoDismiss}
                                  activePendingProgress={
                                    outboxEditor.editing ? null : activePendingProgress
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
                                  editingQueuedAttachments={
                                    outboxEditor.attachments ?? composerEditingQueuedAttachments
                                  }
                                  onRemoveEditingQueuedAttachment={
                                    outboxEditor.editing
                                      ? outboxEditor.editor.removeAttachment
                                      : removeEditingQueuedAttachmentStable
                                  }
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
                  <ThreadDetailsPanel {...threadDetailsPanelProps} />
                ) : null}

                {pullRequestDialogState ? (
                  <PullRequestThreadDialog
                    key={pullRequestDialogState.key}
                    open
                    environmentId={activeThread.environmentId}
                    threadId={activeThread.id}
                    cwd={activeProject?.workspaceRoot ?? null}
                    initialReference={pullRequestDialogState.initialReference}
                    onOpenChange={(open) => {
                      if (!open) {
                        closePullRequestDialog();
                      }
                    }}
                    onPrepared={handlePreparedPullRequestThreadStable}
                  />
                ) : null}
              </ThreadFindCanvas>
            </div>

            {mountedTerminalThreadRefs.map(
              ({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
                <PersistentThreadTerminalDrawer
                  key={mountedThreadKey}
                  threadRef={mountedThreadRef}
                  threadId={mountedThreadRef.threadId}
                  active={mountedThreadKey === activeThreadKey}
                  launchContext={
                    mountedThreadKey === activeThreadKey
                      ? (activeTerminalLaunchContext ?? null)
                      : null
                  }
                  focusRequestId={mountedThreadKey === activeThreadKey ? terminalFocusRequestId : 0}
                  splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
                  splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
                  newShortcutLabel={newTerminalShortcutLabel ?? undefined}
                  closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
                  keybindings={keybindings}
                  onAddTerminalContext={addTerminalContextToDraftStable}
                />
              ),
            )}
          </div>
        </PreviewPanelSibling>

        {rightPanelPresent && !shouldUsePlanSidebarSheet && activeThreadRef ? (
          <PreviewPanelInline
            open={rightPanelOpen}
            widthStorageKey={`supaterm:preview-panel-width:${activeThreadKey}`}
            onCollapse={closePreviewPanelStable}
          >
            <RightPanelTabs
              mode="inline"
              open={rightPanelOpen}
              keybindings={keybindings}
              getShortcutContext={getShortcutContextStable}
              maximized={rightPanelMaximized}
              surfaces={renderedRightPanelSurfaces}
              environmentId={activeThreadRef.environmentId}
              activeSurfaceId={renderedRightPanelSurface?.id ?? null}
              pendingSurfaceIds={pendingFileSurfaceIds}
              previewSessions={activePreviewState.sessions}
              desktopByTabId={activePreviewState.desktopByTabId}
              previewRuntimeTabId={resolvePreviewRuntimeTabId}
              terminalLabelsById={activeTerminalLabelsById}
              onActivate={activateRightPanelSurfaceStable}
              onCloseSurface={closeRightPanelSurfaceStable}
              onRenameDevice={(surfaceId, title) => {
                if (activeThreadRef)
                  useRightPanelStore.getState().renameDevice(activeThreadRef, surfaceId, title);
              }}
              onCloseOtherSurfaces={closeOtherRightPanelSurfacesStable}
              onCloseSurfacesToRight={closeRightPanelSurfacesToRightStable}
              onCloseAllSurfaces={closeAllRightPanelSurfacesStable}
              onMoveSurface={moveRightPanelSurfaceStable}
              onCopyFilePath={copyRightPanelFilePathStable}
              onAddBrowser={() => createBrowserSurface()}
              onAddBrowserInProfile={createBrowserSurfaceStable}
              onAddTerminal={addTerminalSurfaceStable}
              onAddDiff={addDiffSurfaceStable}
              onAddFiles={addFilesSurfaceStable}
              onAddPullRequest={addPullRequestSurfaceStable}
              onAddPullRequests={addPullRequestsSurfaceStable}
              onAddDevice={addDeviceSurfaceStable}
              browserAvailable={canOperatePreview && browserAvailable}
              terminalAvailable={activeProject !== null && canOperateTerminal}
              diffAvailable={isServerThread && isGitRepo}
              filesAvailable={activeProject !== null}
              pullRequestAvailable={pullRequestSurfaceAvailable}
              pullRequestsAvailable={pullRequestsSurfaceAvailable}
              deviceAvailable={activeThreadRef !== null}
            >
              {rightPanelContent}
            </RightPanelTabs>
          </PreviewPanelInline>
        ) : null}
      </PreviewPanelGroup>
      {rightPanelPresent && shouldUsePlanSidebarSheet && activeThreadRef ? (
        <RightPanelSheet
          animationDurationMs={panelAnimationsActive ? panelAnimationDurationMs : 0}
          open={rightPanelOpen}
          onClose={closePreviewPanelStable}
        >
          <RightPanelTabs
            mode="sheet"
            open={rightPanelOpen}
            keybindings={keybindings}
            getShortcutContext={getShortcutContextStable}
            layoutControls={
              rightPanelOpen ? (
                <TooltipProvider>
                  <div className="mr-px flex items-center">{panelToggleControls}</div>
                </TooltipProvider>
              ) : null
            }
            surfaces={renderedRightPanelSurfaces}
            environmentId={activeThreadRef.environmentId}
            activeSurfaceId={renderedRightPanelSurface?.id ?? null}
            pendingSurfaceIds={pendingFileSurfaceIds}
            previewSessions={activePreviewState.sessions}
            desktopByTabId={activePreviewState.desktopByTabId}
            previewRuntimeTabId={resolvePreviewRuntimeTabId}
            terminalLabelsById={activeTerminalLabelsById}
            onActivate={activateRightPanelSurfaceStable}
            onCloseSurface={closeRightPanelSurfaceStable}
            onRenameDevice={(surfaceId, title) => {
              if (activeThreadRef)
                useRightPanelStore.getState().renameDevice(activeThreadRef, surfaceId, title);
            }}
            onCloseOtherSurfaces={closeOtherRightPanelSurfacesStable}
            onCloseSurfacesToRight={closeRightPanelSurfacesToRightStable}
            onCloseAllSurfaces={closeAllRightPanelSurfacesStable}
            onMoveSurface={moveRightPanelSurfaceStable}
            onCopyFilePath={copyRightPanelFilePathStable}
            onAddBrowser={() => createBrowserSurface()}
            onAddBrowserInProfile={createBrowserSurfaceStable}
            onAddTerminal={addTerminalSurfaceStable}
            onAddDiff={addDiffSurfaceStable}
            onAddFiles={addFilesSurfaceStable}
            onAddPullRequest={addPullRequestSurfaceStable}
            onAddPullRequests={addPullRequestsSurfaceStable}
            onAddDevice={addDeviceSurfaceStable}
            browserAvailable={canOperatePreview && browserAvailable}
            terminalAvailable={activeProject !== null && canOperateTerminal}
            diffAvailable={isServerThread && isGitRepo}
            filesAvailable={activeProject !== null}
            pullRequestAvailable={pullRequestSurfaceAvailable}
            pullRequestsAvailable={pullRequestsSurfaceAvailable}
            deviceAvailable={activeThreadRef !== null}
          >
            {rightPanelContent}
          </RightPanelTabs>
        </RightPanelSheet>
      ) : null}

      <AlertDialog
        open={pendingRevert !== null && pendingRevert.routeThreadKey === routeThreadKey}
        onOpenChange={(open) => {
          if (!open) setPendingRevert(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit from here?</AlertDialogTitle>
            <AlertDialogDescription>
              Rewind chat to before this message. Your prompt and attachments return to the
              composer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (!pendingRevert || pendingRevert.routeThreadKey !== routeThreadKey) return;
                setPendingRevert(null);
                void onRevertToTurnCount(pendingRevert.turnCount, pendingRevert.messageId, true);
              }}
            >
              Revert files too
            </Button>
            <Button
              onClick={() => {
                if (!pendingRevert || pendingRevert.routeThreadKey !== routeThreadKey) return;
                setPendingRevert(null);
                void onRevertToTurnCount(pendingRevert.turnCount, pendingRevert.messageId, false);
              }}
            >
              Revert and keep changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      <LinkPullRequestDialogHost />
      {expandedImage && (
        <ExpandedImageDialog
          key={expandedImageKey(expandedImage)}
          preview={expandedImage}
          onClose={closeExpandedImageStable}
        />
      )}
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
