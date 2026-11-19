import { ChildThreadApprovals } from "./ChildThreadApprovals";
import { useOpenThreadInspector } from "./thread-inspector-navigation";
import { useSidebarWorkspaceTabs } from "../layout/workspace/useSystemWorkspaceTabBar";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Dialog from "../../components/ui/Dialog";
import { pendingThreadCreationLabel } from "@supaterm/client-runtime/pending-thread-creation";
import { useSelectedThreadComposerMetadata } from "../../state/use-thread-detail";
import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { parseThreadKey, threadKey } from "@supaterm/client-runtime/state/entities";
import { createThreadVisitTracker } from "@supaterm/client-runtime/state/thread-visits";
import { useChildThreadInputs } from "../../state/entities";
import { UsageLimitRecoveryCard } from "./UsageLimitRecoveryCard";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import {
  effectiveSnoozed,
  isThreadWokeUnseen,
  snoozeWakeLabel,
  threadWokeAt,
} from "@supaterm/client-runtime/state/thread-snooze";
import type { WorktreeSetupCardProps } from "./worktree-setup-card";
import type { ComposerTextPaste } from "../../native/SupatermComposerEditor.types";
import { type EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import type { HandoffEndpoints } from "@supaterm/client-runtime/handoff";
import { queuedRunEditBlockedReason } from "@supaterm/client-runtime/queued-run-edit";
import type { VoiceRecordingHandOff } from "@supaterm/client-runtime/voice-input";
import {
  childThreadInputsTitle,
  type CodexFeedbackSubmission,
  type EnvironmentThreadStatus,
} from "@supaterm/client-runtime/state/threads";
import { useKeyboardScrollToEnd } from "@legendapp/list/keyboard";
import { resolveProviderSkillsForCwd } from "@supaterm/client-runtime/providerSkills";
import type { LegendListRef } from "@legendapp/list/react-native";
import { NativeLayoutObserver } from "../../native/NativeLayoutObserver";
import {
  deriveBottomControlInsets,
  deriveContentSideInsets,
  type NativeLayoutMetrics,
} from "../../lib/reserved-regions";
import type {
  EnvironmentId,
  MessageId,
  ModelSelection,
  RepositoryIdentity,
  RuntimeRequestId,
  ScopedThreadRef,
  ServerConfig as SupatermServerConfig,
  UsageLimitsReport,
  RunId,
} from "@supaterm/contracts";
import {
  appendCodexArtifactTemplateUsePrompt,
  type CodexArtifactTemplate,
} from "@supaterm/shared/codexArtifactTemplates";
import {
  declinePendingApprovals,
  sendApprovalFeedback,
  type ApprovalResponder,
  type ThreadUserInputQuestion,
} from "@supaterm/client-runtime/state/thread-requests";
import { useDeadlinePassed } from "../../lib/clock";
import {
  BACKGROUND_WORK_STOP_RETRY_AFTER_MS,
  type BackgroundWorkStopRequest,
  isBackgroundWorkStopPending,
  limitRecoveryOwnsSnooze,
  presentPendingBackgroundWork,
  presentProviderGoal,
} from "@supaterm/client-runtime/state/thread-execution";
import { resolveSubagentPillSegment } from "@supaterm/client-runtime/state/thread-subagents";
import {
  formatModelSelectionEffort,
  type ProviderSubagentStatus,
} from "@supaterm/client-runtime/state/thread-execution";
import { formatModelSlugName, resolveSelectableModel } from "@supaterm/shared/model";
import { isProviderNativeSubagentThread } from "@supaterm/contracts";
import type { QueuedRunEdit } from "../../state/queued-run-edit";
import type { FollowUpBehavior } from "../../lib/followUpBehavior";
import type { ActiveTurnComposerAction } from "@supaterm/client-runtime/state/composer-dispatch";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Keyboard,
  Platform,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import {
  KeyboardController,
  KeyboardStickyView,
  useKeyboardState,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, {
  Easing,
  FadeInDown,
  FadeOut,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBarOverlap } from "../../components/ui/useBarInset";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import {
  useWorkspaceContentWidth,
  WorkspaceSettledContentWidthContext,
  useWorkspaceSettledContentWidth,
} from "../layout/workspace-content-width";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import {
  useDeviceType,
  useDuoBottomBarInset,
  useNativeColumnLayoutMetrics,
  useNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { collectProviderUsageLimits } from "@supaterm/shared/usageLimits";
import type { ComposerEditorHandle } from "../../components/ComposerEditor";
import type { StatusTone } from "../../components/StatusPill";
import { getComposerDraftSnapshot, setFreshSessionPending } from "../../state/use-composer-drafts";
import type { MarkdownTextSelection } from "../../native/SelectableMarkdownText";
import { annotateAssistantText } from "./annotateAssistantText";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import {
  ANDROID_READING_MAX_WIDTH,
  CHAT_CONTENT_MAX_WIDTH,
  type LayoutVariant,
} from "../../lib/layout";
import { editPendingThreadMessage } from "../../state/edit-pending-thread-message";
import { environmentCatalog } from "../../connection/catalog";
import { deviceEnvironment } from "../../state/device";
import { useEnvironmentQuery } from "../../state/query";
import { threadDevicePreviews } from "../devices/threadDevicePreviews";
import { ThreadBrowserFloat } from "../browser/ThreadBrowserFloat";
import { useThreadServerBrowserTabs } from "../../state/preview";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";
import { scopedThreadKey } from "../../lib/scopedEntities";
import {
  clearThreadComposerError,
  threadComposerErrorsAtom,
} from "../../state/thread-composer-error";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/threads";
import { appAtomRegistry } from "../../state/atom-registry";
import { threadStreamHaptics } from "./threadStreamHaptics";
import { useAtomCommand } from "../../state/use-atom-command";
import { orchestrationEnvironment } from "../../state/orchestration";
import type { RunStopPresentation } from "@supaterm/client-runtime/state/thread-execution";
import type { PendingUserInputDraftAnswer } from "@supaterm/client-runtime/state/pending-user-input";
import {
  threadFeedRunIsInProgress,
  type PendingApproval,
  type PendingUserInput,
  type ThreadFeedEntry,
  type ThreadFeedLatestRun,
} from "../../lib/threadActivity";
import { PendingApprovalCard } from "./PendingApprovalCard";
import { ComposerErrorNotice } from "./ComposerErrorNotice";
import { FreshSessionNotice } from "./FreshSessionNotice";
import { ComposerFeedback } from "./ComposerFeedback";
import { ComposerUsageLimits } from "./ComposerUsageLimits";
import { PendingUserInputCard } from "./PendingUserInputCard";
import { ProviderSubagentBar } from "./ProviderSubagentBar";
import { ThreadCreationFailedCard } from "./ThreadCreationFailedCard";
import {
  FLOATING_WORKING_CONTROL_COVERAGE,
  FloatingWorkingControl,
} from "./floating-working-control";
import { connectionFloatingStatus, type FloatingWorkingStatus } from "./floating-working-status";
import type { ThreadStatusLineModel } from "./thread-context-divider";
import { useConnectionStatusVisibility } from "../../connection/useConnectionStatusVisibility";
import {
  derivePendingUserInputMaxHeight,
  ESTIMATED_KEYBOARD_HEIGHT,
  USER_INPUT_TOGGLE_DURATION_MS,
} from "./pendingUserInputLayout";
import {
  COMPOSER_LAYOUT_TRANSITION,
  COMPOSER_TRANSITION_DURATION_MS,
} from "../../components/composerLayoutTransition";
import {
  COMPOSER_COLLAPSED_CHROME,
  COMPOSER_EXPANDED_CHROME,
  THREAD_COMPOSER_BOTTOM_GUTTER,
  ThreadComposer,
} from "./ThreadComposer";
import { ComposerPopoverHost } from "./ComposerPopoverHost";
import { useNextPromptSuggestion } from "./useNextPromptSuggestion";
import { ThreadFeed, type ThreadFeedHistoryControls, type ThreadFeedPins } from "./ThreadFeed";
import type { MessageJump, MessageJumpHandlers } from "@supaterm/client-runtime/message-jump";
import { WorkspaceMutationIdProvider } from "./WorkspaceMutationIdProvider";
import { ComposerQueuedEditBanner } from "./ComposerQueuedEdit";
import { SideChatActionsRow } from "./SideChatActionsRow";
import { ThreadSideChatsRow } from "./ThreadSideChatsRow";
import type { ThreadContentPresentation } from "./threadContentPresentation";
import { resolveThreadFeedSubmissionAnchor } from "./thread-feed-scroll-position";
import { useOpenLinkedThread } from "./useOpenLinkedThread";
import { useGlobalVoiceInput } from "../voice-input/VoiceInputProvider";
import type { OrchestrationV2ProviderSession } from "@supaterm/contracts";

export interface ThreadDetailScreenProps {
  readonly header?: React.ReactNode;
  readonly draftMode?: {
    /** viewportHeight excludes the composer so draft chrome can resize it without feedback. */
    readonly content: (
      headerInset: number,
      bottomInset: number,
      viewportHeight: number,
    ) => React.ReactNode;
    readonly controls: (viewportHeight: number) => React.ReactNode;
    readonly editorRef: React.RefObject<ComposerEditorHandle | null>;
    readonly sendBlockedReason: string | null;
    readonly interactionLocked: boolean;
  };
  readonly worktreeSetup?: WorktreeSetupCardProps | null;
  readonly canOperateThread: boolean;
  readonly selectedThread: EnvironmentThreadShell;
  readonly contentPresentation: ThreadContentPresentation;
  readonly screenTone: StatusTone;
  readonly connectionError: string | null;
  readonly environmentLabel: string | null;
  readonly feedbackSubmissions: ReadonlyArray<CodexFeedbackSubmission>;
  readonly onDismissFeedback: (id: MessageId) => void;
  readonly selectedThreadFeed: ReadonlyArray<ThreadFeedEntry>;
  readonly pendingHandoff?: HandoffEndpoints | null;
  readonly activityRun: ThreadFeedLatestRun | null;
  readonly activeWorkStartedAt: string | null;
  readonly runlessWorkActive?: boolean;
  readonly providerSubagentStatus?: ProviderSubagentStatus | null;
  readonly extensionStatuses?: NonNullable<OrchestrationV2ProviderSession["extensionStatuses"]>;
  readonly isCompacting: boolean;
  readonly creationState:
    | {
        readonly kind: "preparing";
        readonly preparingWorktree: boolean;
        readonly serverOwned: boolean;
      }
    | { readonly kind: "failed"; readonly reason: string; readonly onEditTask: () => void }
    | null;
  readonly activePendingApproval: PendingApproval | null;
  readonly activePendingApprovals: ReadonlyArray<PendingApproval>;
  readonly respondingApprovalId: RuntimeRequestId | null;
  readonly activePendingUserInput: PendingUserInput | null;
  readonly activePendingUserInputDrafts: Record<string, PendingUserInputDraftAnswer>;
  readonly activePendingUserInputAnswers: Record<string, string | ReadonlyArray<string>> | null;
  readonly respondingUserInputId: RuntimeRequestId | null;
  readonly connectionStateLabel: EnvironmentConnectionPhase;
  readonly threadSyncStatus?: EnvironmentThreadStatus;
  readonly historyControls?: ThreadFeedHistoryControls;
  readonly pins?: ThreadFeedPins;
  readonly messageJump?: MessageJump | null;
  readonly onMessageJumpFailed?: MessageJumpHandlers["fail"];
  readonly activeThreadBusy: boolean;
  readonly canStopThread: boolean;
  readonly queuedRunEdit: QueuedRunEdit | null;
  readonly composerDraftKey: string | null;
  readonly followUpBehavior: FollowUpBehavior;
  readonly canSteerActiveTurn: boolean;
  readonly isSavingQueuedEdit: boolean;
  readonly onCancelQueuedRunEdit: () => void;
  readonly onRemoveQueuedEditAttachment: (attachmentId: string) => void;
  readonly environmentId: EnvironmentId;
  readonly projectWorkspaceRoot: string | null;
  readonly threadCwd: string | null;
  readonly repositoryIdentity?: RepositoryIdentity | null;
  readonly selectedThreadQueueCount: number;
  readonly queuedMessages: ReadonlyArray<QueuedThreadMessage>;
  readonly dispatchingMessageId: MessageId | null;
  readonly serverConfig: SupatermServerConfig | null;
  readonly layoutVariant?: LayoutVariant;
  readonly usesAutomaticContentInsets?: boolean;
  readonly onHeaderMaterialVisibilityChange?: (visible: boolean) => void;
  readonly onOpenConnectionEditor: () => void;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly onPickDraftMedia: () => Promise<void>;
  readonly onPickDraftFiles: () => Promise<void>;
  readonly onNativePasteImages: (uris: ReadonlyArray<string>) => Promise<void>;
  readonly onNativePasteText: (paste: ComposerTextPaste) => Promise<void>;
  readonly onRemoveDraftImage: (imageId: string) => void;
  readonly onStopThread: () => void;
  readonly onResumeQueue: (() => Promise<void>) | null;
  readonly onSendMessage: (
    followUp?: ActiveTurnComposerAction,
    beforeDispatch?: (
      text: string,
      hasAttachmentsOrContext: boolean,
    ) => Promise<boolean | "responded">,
    onWillEnqueue?: () => void,
  ) => Promise<MessageId | null>;
  readonly onSendVoiceMessage?: (
    recordingUri: string,
    language: string,
    handOff: VoiceRecordingHandOff | undefined,
  ) => Promise<MessageId | null>;
  readonly onReconnectEnvironment: () => void;
  readonly canSwitchThreadProvider: boolean;
  readonly onUpdateThreadModelSelection: (modelSelection: ModelSelection) => void;
  readonly onRespondToApproval: ApprovalResponder;
  readonly onSelectUserInputOption: (
    requestId: RuntimeRequestId,
    question: ThreadUserInputQuestion,
    value: string,
  ) => void;
  readonly onChangeUserInputCustomAnswer: (
    requestId: RuntimeRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  readonly onSubmitUserInput: () => Promise<unknown>;
  readonly onDismissUserInput: () => Promise<unknown>;
  readonly showContent?: boolean;
}

function useThreadOutcomeHaptics(state: {
  readonly threadKey: string;
  readonly live: boolean;
  readonly run: ThreadFeedLatestRun | null;
  readonly pendingRequestId: string | null;
  readonly composerError: string | null;
}) {
  const { threadKey, live, run, pendingRequestId, composerError } = state;
  const previousRef = useRef({ threadKey, hydrated: live, run, pendingRequestId, composerError });

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- plays haptics for send failures, input requests and turn outcomes that change while the thread is live
  useEffect(() => {
    const previous = previousRef.current;
    const sameThread = previous.threadKey === threadKey;
    const hydrated = live || (sameThread && previous.hydrated);
    previousRef.current = { threadKey, hydrated, run, pendingRequestId, composerError };
    if (!sameThread || !previous.hydrated) return;

    if (previous.composerError === null && composerError !== null) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (previous.pendingRequestId === null && pendingRequestId !== null) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    if (
      run === null ||
      run.completedAt === null ||
      previous.run?.runId !== run.runId ||
      !threadFeedRunIsInProgress(previous.run)
    ) {
      return;
    }
    if (run.status === "completed") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (run.status === "failed") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [threadKey, live, run, pendingRequestId, composerError]);
}

const ComposerPanels = Platform.OS === "android" ? Animated.ScrollView : Animated.View;

function ColumnWidth(props: { readonly width: number | null; readonly children: React.ReactNode }) {
  const inherited = useWorkspaceSettledContentWidth();
  return (
    <WorkspaceSettledContentWidthContext value={props.width ?? inherited}>
      {props.children}
    </WorkspaceSettledContentWidthContext>
  );
}
const USAGE_LIMITS_PANEL_GAP = 12;
const FEED_END_GAP = 12;
const USAGE_LIMITS_PANEL_MIN_HEIGHT = 44;

const USER_INPUT_TOGGLE_TIMING = {
  duration: USER_INPUT_TOGGLE_DURATION_MS,
  easing: Easing.out(Easing.cubic),
};

const wakeAwareVisitShell = Atom.family((key: string) => {
  const ref = parseThreadKey(key);
  return Atom.make((get) => {
    const shell = get(environmentThreadShells.threadShellAtom(ref));
    if (shell === null) return null;
    const nowMs = Date.now();
    const wokeAt = threadWokeAt(shell, { now: new Date(nowMs).toISOString() });
    const wakeAtMs = shell.snoozedUntil == null ? NaN : Date.parse(shell.snoozedUntil);
    if (wokeAt === null && wakeAtMs > nowMs) {
      const timer = setTimeout(
        () => get.refreshSelf(),
        Math.min(wakeAtMs - nowMs + 50, 2_147_483_647),
      );
      get.addFinalizer(() => clearTimeout(timer));
    }
    return { ...shell, wokeAt };
  }).pipe(Atom.withLabel(`mobile-thread-visit-shell:${key}`));
});

const threadVisitTracker = createThreadVisitTracker({
  threadShellAtom: (ref) => wakeAwareVisitShell(threadKey(ref)),
  sessionGenerationAtom: environmentCatalog.sessionGenerationAtom,
  visit: threadEnvironment.visit,
});

const NO_RUN_STOP_ATOM = Atom.make<RunStopPresentation | null>(null).pipe(
  Atom.withLabel("mobile-thread-run-stop:empty"),
);

const COMPOSER_HEIGHT_SETTLE_MS = COMPOSER_TRANSITION_DURATION_MS + 40;

export function ThreadDetailScreen(props: ThreadDetailScreenProps) {
  const [statusRequests, setStatusRequests] = useState<
    Record<string, BackgroundWorkStopRequest | undefined>
  >({});
  return (
    <ThreadDetailBody
      key={scopedThreadKey(props.environmentId, props.selectedThread.id)}
      {...props}
      statusRequests={statusRequests}
      setStatusRequests={setStatusRequests}
    />
  );
}

function ThreadDetailBody(
  props: ThreadDetailScreenProps & {
    statusRequests: Record<string, BackgroundWorkStopRequest | undefined>;
    setStatusRequests: React.Dispatch<
      React.SetStateAction<Record<string, BackgroundWorkStopRequest | undefined>>
    >;
  },
) {
  const selectedThreadDetailRef: ScopedThreadRef | null = props.draftMode
    ? null
    : { environmentId: props.environmentId, threadId: props.selectedThread.id };
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const deviceType = useDeviceType();
  const workspace = useWorkspaceTabs();
  const sidebarSearchActive =
    deviceType === "duo-unfolded" &&
    workspace?.state.tabs[workspace.state.selectedTab].searchMode === "active";
  const [composerOwnsKeyboard, setComposerOwnsKeyboard] = useState(false);
  if (sidebarSearchActive && composerOwnsKeyboard) setComposerOwnsKeyboard(false);
  const navigation = useNavigation();
  const { layout } = useAdaptiveWorkspaceLayout();
  const selectDetail = useSelectWorkspaceDetail();
  const openLinkedThread = useOpenLinkedThread();
  const openInspector = useOpenThreadInspector();
  const { session: voiceInputSession } = useGlobalVoiceInput();
  const { reportedModelSelection, queuedCount, turnSubagents } =
    useSelectedThreadComposerMetadata();
  const deviceState = useEnvironmentQuery(
    deviceEnvironment.state({ environmentId: props.environmentId, input: {} }),
  );
  const devicePreviews = threadDevicePreviews(deviceState.data, props.selectedThread.id);
  const openDevicePreview = () => {
    Keyboard.dismiss();
    if (
      openInspector(
        { environmentId: props.environmentId, threadId: props.selectedThread.id },
        { type: "device", environmentId: props.environmentId, threadId: props.selectedThread.id },
      )
    )
      return;
    navigation.navigate("ThreadDevicePreview", {
      environmentId: props.environmentId,
      threadId: props.selectedThread.id,
    });
  };
  const browserTabs = useThreadServerBrowserTabs({
    environmentId: props.environmentId,
    threadId: props.selectedThread.id,
    enabled: !props.draftMode && props.serverConfig != null,
  });
  const openBrowserPreview = (tabId?: string) => {
    Keyboard.dismiss();
    navigation.navigate("ThreadBrowserPreview", {
      environmentId: props.environmentId,
      threadId: props.selectedThread.id,
      ...(tabId === undefined ? {} : { tabId }),
    });
  };
  const insets = useSafeAreaInsets();
  const isKeyboardVisible = useKeyboardState((state) => state.isVisible);
  const liveKeyboardHeight = useKeyboardState((state) => state.height);
  const [keyboardStateSuspect, setKeyboardStateSuspect] = useState(false);
  const ownedInputFocusedRef = useRef(false);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to AppState on Android to mark keyboard state suspect when the app resumes
  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setKeyboardStateSuspect(!ownedInputFocusedRef.current);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);
  const [observedKeyboardState, setObservedKeyboardState] = useState({
    isKeyboardVisible,
    liveKeyboardHeight,
  });
  if (
    observedKeyboardState.isKeyboardVisible !== isKeyboardVisible ||
    observedKeyboardState.liveKeyboardHeight !== liveKeyboardHeight
  ) {
    setObservedKeyboardState({
      isKeyboardVisible,
      liveKeyboardHeight,
    });
    setKeyboardStateSuspect(false);
  }
  const handleOwnedInputFocusChange = (focused: boolean) => {
    ownedInputFocusedRef.current = focused;
    if (focused) {
      if (deviceType === "duo-folded" || deviceType === "duo-unfolded")
        setComposerOwnsKeyboard(true);
      setKeyboardStateSuspect(false);
    }
  };
  const windowHeight = useWindowDimensions().height;
  const navigationHeaderHeight = useBarOverlap();
  const [screenMetrics, setScreenMetrics] = useState<NativeLayoutMetrics | null>(null);
  const columnMetrics = useNativeColumnLayoutMetrics();
  const windowMetrics = useNativeLayoutMetrics();
  const nativeMetrics = usesNativeWorkspaceColumns ? columnMetrics : screenMetrics;
  const controlInsets = deriveBottomControlInsets(nativeMetrics);
  const selectedThreadKey = scopedThreadKey(props.environmentId, props.selectedThread.id);
  const childThreadInputs = useChildThreadInputs({
    environmentId: props.environmentId,
    threadId: props.selectedThread.id,
  });
  const composerError = useAtomValue(threadComposerErrorsAtom)[selectedThreadKey]?.message ?? null;
  const agentsSegment = resolveSubagentPillSegment(turnSubagents);
  const defaultComposerEditorRef = useRef<ComposerEditorHandle>(null);
  const composerEditorRef = props.draftMode?.editorRef ?? defaultComposerEditorRef;
  const isProviderSubagent = isProviderNativeSubagentThread(props.selectedThread.source);
  const suggestedPrompt = useNextPromptSuggestion({
    environmentId: props.environmentId,
    threadId: props.draftMode ? null : props.selectedThread.id,
    connected: props.connectionStateLabel === "connected",
    enabled: props.serverConfig?.settings.nextPromptSuggestionsEnabled === true,
    latestRun: props.selectedThread.latestRun,
  });
  const editingRunId = props.queuedRunEdit?.runId ?? null;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- focuses the composer editor on the next animation frame when a queued run edit starts
  useEffect(() => {
    if (editingRunId === null) return;
    const frame = requestAnimationFrame(() => composerEditorRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [composerEditorRef, editingRunId]);
  const listRef = useRef<LegendListRef>(null);
  const feedTouchStartRef = useRef<{ pageX: number; pageY: number } | null>(null);
  const threadScope = useRef(new AbortController());
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [anchorMessageId, setAnchorMessageId] = useState<MessageId | null>(null);
  const [sendingWithKeyboard, setSendingWithKeyboard] = useState(false);
  if (sendingWithKeyboard && !isKeyboardVisible) setSendingWithKeyboard(false);
  const [isAtEnd, setIsAtEnd] = useState(true);
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const composerHeightSettle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleComposerHeightChange = (height: number) => {
    setComposerHeight((current) => current ?? height);
    if (composerHeightSettle.current !== null) clearTimeout(composerHeightSettle.current);
    composerHeightSettle.current = setTimeout(() => {
      composerHeightSettle.current = null;
      setComposerHeight(height);
    }, COMPOSER_HEIGHT_SETTLE_MS);
  };
  const bottomBarInset = useDuoBottomBarInset();
  const hasSidebarTabBar = useSidebarWorkspaceTabs() === "picker";
  const bottomSafeArea =
    Platform.OS === "ios" ? (windowMetrics?.safeArea.bottom ?? insets.bottom) : insets.bottom;
  const alignedBottomInset =
    bottomBarInset ??
    (Platform.OS === "ios" && Platform.isPad
      ? Math.max(bottomSafeArea, 12) - (layout.usesSplitView ? 5 : 0)
      : undefined);
  const composerBottomInset = Math.max(
    0,
    (alignedBottomInset !== undefined
      ? alignedBottomInset - THREAD_COMPOSER_BOTTOM_GUTTER
      : Math.max(bottomSafeArea, 12)) - (hasSidebarTabBar ? 3 : 0),
  );
  const composerKeyboardOffset = composerBottomInset;
  const contentPresentationKind = props.contentPresentation.kind;
  const clientCreation =
    props.creationState?.kind === "preparing" && !props.creationState.serverOwned
      ? props.creationState
      : null;
  const preparingWorktreeInFeed =
    props.creationState?.kind === "preparing" &&
    props.creationState.preparingWorktree &&
    !props.worktreeSetup &&
    props.connectionStateLabel === "connected";
  const interruptThreadTurn = useAtomCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const unsnoozeThread = useAtomCommand(threadEnvironment.unsnooze, { reportFailure: false });
  const reopenThread = useAtomCommand(threadEnvironment.reopen, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const anyRunStop = useAtomValue(
    selectedThreadDetailRef === null
      ? NO_RUN_STOP_ATOM
      : environmentThreadDetails.runStopAtom(selectedThreadDetailRef),
  );
  const runStop =
    anyRunStop?.background && props.selectedThread.pendingBackgroundTasks.length === 0
      ? null
      : anyRunStop;
  const forceStopThread = useAtomCommand(orchestrationEnvironment.forceStopThread, {
    reportFailure: false,
  });
  const canForceStop =
    useAtomValue(orchestrationEnvironment.forceStopThread.permissionAtom(props.environmentId)) &&
    props.serverConfig?.environment.capabilities.threadForceStop === true;
  const [forceStoppingKey, setForceStoppingKey] = useState<string | null>(null);
  const forceStop = async (runId: RunId | undefined) => {
    const threadKey = selectedThreadKey;
    setForceStoppingKey(threadKey);
    const result = await forceStopThread({
      environmentId: props.environmentId,
      input:
        runId === undefined
          ? { threadId: props.selectedThread.id }
          : { threadId: props.selectedThread.id, runId },
    });
    setForceStoppingKey((current) => (current === threadKey ? null : current));
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) Dialog.alert("Could not force stop the agent");
      return;
    }
    const others = result.value.sharedWithThreadIds.length;
    if (result.value.outcome === "releasing") {
      Dialog.alert("Turn stopped; the agent is still shutting down");
    }
    if (result.value.outcome === "shared") {
      Dialog.alert(
        "Turn stopped; the agent process kept running",
        `It is shared with ${others === 0 ? "other" : others} working ${others === 1 ? "thread" : "threads"}. Stop those to free it.`,
      );
    }
  };
  const statusRequest = props.statusRequests[selectedThreadKey] ?? null;
  const statusPending = isBackgroundWorkStopPending(
    statusRequest,
    selectedThreadKey,
    props.selectedThread.pendingBackgroundTasks,
    useDeadlinePassed(statusRequest?.retryAt ?? null),
  );
  const [lifecycleNow, setLifecycleNow] = useState(() => new Date().toISOString());
  useFocusEffect(
    useCallback(() => {
      setLifecycleNow(new Date().toISOString());
      const timer = setInterval(() => setLifecycleNow(new Date().toISOString()), 60_000);
      return () => clearInterval(timer);
    }, []),
  );
  const snoozed = effectiveSnoozed(props.selectedThread, { now: lifecycleNow });
  const snoozedUntil = props.selectedThread.snoozedUntil ?? null;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- arms a timer that refreshes the lifecycle clock when the thread's snooze expires
  useEffect(() => {
    if (!snoozed || snoozedUntil === null) return;
    const timer = setTimeout(
      () => setLifecycleNow(new Date().toISOString()),
      Math.min(Math.max(0, Date.parse(snoozedUntil) - Date.now()) + 50, 2_147_483_647),
    );
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Re-arm if timer clamping fires before the wake time.
  }, [snoozed, snoozedUntil, lifecycleNow]);
  const lifecycleSnoozed =
    snoozed &&
    !limitRecoveryOwnsSnooze({
      runId:
        props.selectedThread.runtime?.status === "failed" &&
        props.selectedThread.runtime.lastErrorClass === "usage_limit"
          ? props.selectedThread.latestRun?.runId
          : null,
      resetAt: props.selectedThread.runtime?.usageLimitResetAt,
      recovery: props.selectedThread.limitRecovery,
      snoozedUntil,
    });
  const done = props.selectedThread.doneOverride === "done";
  const wokeAt = threadWokeAt(props.selectedThread, { now: lifecycleNow });
  const woke = isThreadWokeUnseen({
    wokeAt,
    done,
    lastVisitedAt: props.selectedThread.lastVisitedAt,
    latestRunCompletedAt: props.selectedThread.latestRun?.completedAt ?? null,
  });
  const runStatusAction = async (action: "stop" | "wake" | "reopen" | "dismiss") => {
    if (statusPending || !props.canOperateThread) return;
    const request: BackgroundWorkStopRequest = {
      threadKey: selectedThreadKey,
      taskIds:
        action === "stop"
          ? props.selectedThread.pendingBackgroundTasks.map((task) => task.taskId)
          : [],
      retryAt: null,
    };
    props.setStatusRequests((current) => ({ ...current, [request.threadKey]: request }));
    const target = {
      environmentId: props.environmentId,
      input: { threadId: props.selectedThread.id },
    };
    const recovery = props.selectedThread.limitRecovery;
    const recoveryOwnsSnooze =
      recovery?.snooze === true &&
      recovery.runId === props.selectedThread.latestRun?.runId &&
      snoozedUntil !== null &&
      Date.parse(snoozedUntil) === Date.parse(recovery.resetAt);
    const result =
      action === "stop"
        ? await interruptThreadTurn(target)
        : action === "wake"
          ? recoveryOwnsSnooze
            ? await updateMetadata({
                ...target,
                input: {
                  ...target.input,
                  limitRecovery: {
                    runId: recovery.runId,
                    resetAt: recovery.resetAt,
                    snooze: false,
                  },
                },
              })
            : await unsnoozeThread({ ...target, input: { ...target.input, reason: "user" } })
          : action === "reopen"
            ? await reopenThread({ ...target, input: { ...target.input, reason: "user" } })
            : await visitThread({
                ...target,
                input: { ...target.input, visitedAt: wokeAt ?? lifecycleNow },
              });
    props.setStatusRequests((current) =>
      current[request.threadKey] !== request
        ? current
        : {
            ...current,
            [request.threadKey]:
              action === "stop" && result._tag !== "Failure"
                ? { ...request, retryAt: Date.now() + BACKGROUND_WORK_STOP_RETRY_AFTER_MS }
                : undefined,
          },
    );
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        "Could not update thread",
        error instanceof Error ? error.message : "Try again.",
      );
    }
  };
  const showConnectionStatus = useConnectionStatusVisibility(
    selectedThreadKey,
    props.connectionStateLabel !== "connected",
    props.connectionStateLabel === "error" ||
      props.connectionStateLabel === "unsupported" ||
      props.connectionStateLabel === "available",
  );
  const pendingBackgroundWork = presentPendingBackgroundWork(
    props.selectedThread.pendingBackgroundTasks,
  );
  const extensionStatus = props.extensionStatuses?.length
    ? {
        label: `Pi · ${props.extensionStatuses.map((status) => status.text).join(" · ")}`,
        onPress: () =>
          Dialog.alert("Pi", props.extensionStatuses?.map((status) => status.text).join("\n\n")),
      }
    : null;
  const backgroundLine = (() => {
    if (pendingBackgroundWork === null || contentPresentationKind !== "ready")
      return null satisfies ThreadStatusLineModel | null as ThreadStatusLineModel | null;
    return {
      key: "background",
      icon: pendingBackgroundWork.waiting ? "person.2" : "terminal",
      label: pendingBackgroundWork.title,
      accessibilityLabel: `${pendingBackgroundWork.title}: ${pendingBackgroundWork.items
        .map((item) => item.label)
        .join(", ")}`,
      onOpen: () => {
        Keyboard.dismiss();
        navigation.navigate("ThreadBackgroundWork", {
          environmentId: props.environmentId,
          threadId: props.selectedThread.id,
        });
      },
      action: {
        label: statusPending ? "Stopping..." : "Stop",
        accessibilityLabel: "Stop background work",
        disabled: !props.canOperateThread || statusPending,
        onPress: () => void runStatusAction("stop"),
      },
    } satisfies ThreadStatusLineModel | null as ThreadStatusLineModel | null;
  })();
  const lifecycleLine = (() => {
    if (contentPresentationKind !== "ready" || !(lifecycleSnoozed || done || woke))
      return null satisfies ThreadStatusLineModel | null;
    const actionLabel = lifecycleSnoozed ? "Wake now" : done ? "Reopen" : "Dismiss";
    const wake =
      lifecycleSnoozed && snoozedUntil !== null
        ? snoozeWakeLabel(snoozedUntil, { now: lifecycleNow })
        : "now";
    return {
      key: "lifecycle",
      icon: done && !lifecycleSnoozed ? "checkmark.circle" : "alarm",
      label: lifecycleSnoozed
        ? wake === "now"
          ? "Snoozed"
          : `Snoozed, ${wake} left`
        : done
          ? "Done"
          : "Woke from snooze",
      action: {
        label: statusPending
          ? lifecycleSnoozed
            ? "Waking..."
            : done
              ? "Reopening..."
              : "Dismissing..."
          : actionLabel,
        accessibilityLabel: actionLabel,
        disabled: !props.canOperateThread || statusPending,
        onPress: () =>
          void runStatusAction(lifecycleSnoozed ? "wake" : done ? "reopen" : "dismiss"),
      },
    } satisfies ThreadStatusLineModel | null;
  })();
  const statusLines = [backgroundLine, lifecycleLine].filter((line) => line !== null);
  const deriveFloatingStatus = (ready: boolean) => {
    const connectionStatus = connectionFloatingStatus({
      connectionError: props.connectionError,
      connectionState: props.connectionStateLabel,
      environmentLabel: props.environmentLabel,
      onReconnect: props.onReconnectEnvironment,
    });
    if (connectionStatus !== null && showConnectionStatus && !props.draftMode) {
      return connectionStatus satisfies FloatingWorkingStatus | null;
    }
    if (runStop !== null && ready) {
      const unresponsive = runStop.state === "unresponsive";
      return {
        kind: "stop",
        unresponsive,
        label: unresponsive ? "Not responding to Stop" : "Stopping…",
        action:
          unresponsive && canForceStop
            ? {
                label: forceStoppingKey === selectedThreadKey ? "Force stopping..." : "Force stop",
                accessibilityLabel: "Force stop the agent",
                disabled: forceStoppingKey === selectedThreadKey,
                onPress: () =>
                  Dialog.confirm({
                    title: "Force stop the agent?",
                    message:
                      "It has not answered Stop. Force stop ends the turn and kills the agent's processes, unless other working threads share them.",
                    confirmText: "Force stop",
                    destructive: true,
                    onConfirm: () => void forceStop(runStop.runId),
                  }),
              }
            : null,
      } satisfies FloatingWorkingStatus | null;
    }
    if (props.activePendingApproval !== null || props.activePendingUserInput !== null) {
      return null satisfies FloatingWorkingStatus | null;
    }
    if (props.creationState?.kind === "preparing") {
      if (props.worktreeSetup || preparingWorktreeInFeed)
        return null satisfies FloatingWorkingStatus | null;
      return {
        kind: "preparing",
        label: pendingThreadCreationLabel({
          connected: props.connectionStateLabel === "connected",
          preparingWorktree: props.creationState.preparingWorktree,
        }),
      } satisfies FloatingWorkingStatus | null;
    }
    if (props.creationState?.kind === "failed") {
      return null satisfies FloatingWorkingStatus | null;
    }
    if (!ready) return null satisfies FloatingWorkingStatus | null;
    const childInput = childThreadInputs[0];
    if (childInput) {
      return {
        kind: "child-input",
        label: childThreadInputsTitle(childThreadInputs),
        accessibilityLabel: `Open ${childInput.hasPendingApprovals ? "approval" : "question"} from ${childInput.title}`,
        onPress: () => {
          Keyboard.dismiss();
          openLinkedThread({ environmentId: props.environmentId, threadId: childInput.id });
        },
      } satisfies FloatingWorkingStatus | null;
    }
    if (props.selectedThread.goal !== null) {
      const goal = presentProviderGoal(props.selectedThread.goal, false);
      return {
        kind: "goal",
        label: goal.title,
        accessibilityLabel: `${goal.title}: ${goal.objective}`,
      } satisfies FloatingWorkingStatus | null;
    }
    if (extensionStatus !== null) {
      return { kind: "extension", ...extensionStatus } satisfies FloatingWorkingStatus | null;
    }
    return null satisfies FloatingWorkingStatus | null;
  };
  const floatingStatus = deriveFloatingStatus(contentPresentationKind === "ready");
  const showWorkingControl = floatingStatus !== null;
  const reservesStatusRoom =
    contentPresentationKind === "loading" &&
    !props.selectedThread.hasPendingApprovals &&
    !props.selectedThread.hasPendingUserInput &&
    deriveFloatingStatus(true) !== null;
  const showFloatingStatus =
    showWorkingControl ||
    reservesStatusRoom ||
    queuedCount > 0 ||
    agentsSegment !== null ||
    devicePreviews.length > 0 ||
    browserTabs.tabs.length > 0;
  const selectedThreadFeed = props.selectedThreadFeed;
  const freshSessionAvailable =
    !props.draftMode &&
    props.canOperateThread &&
    props.queuedRunEdit === null &&
    props.activePendingApproval === null &&
    props.activePendingUserInput === null &&
    props.selectedThread.latestRun != null &&
    props.serverConfig?.environment.capabilities.freshContext === true;
  const hasCompactableConversation =
    selectedThreadFeed.some(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "user" &&
        ((entry.message.attachments?.length ?? 0) > 0 ||
          entry.message.text.trim().toLowerCase() !== "/compact"),
    ) ||
    (props.historyControls?.hasMoreHistory === true &&
      props.selectedThread.latestUserMessageAt !== null);
  const composerChrome = composerExpanded
    ? COMPOSER_EXPANDED_CHROME
    : COMPOSER_COLLAPSED_CHROME +
      (!isProviderSubagent && ((Platform.OS === "ios" && Platform.isPad) || hasSidebarTabBar)
        ? 14
        : 0);
  const composerOverlapHeight = composerHeight ?? composerChrome + composerBottomInset;
  const [userInputToggle, setUserInputToggle] = useState<{
    readonly requestId: RuntimeRequestId;
    readonly collapsed: boolean;
  } | null>(null);
  const activeUserInputRequestId = props.activePendingUserInput?.requestId ?? null;
  const questionInFlow = Platform.OS === "android" && activeUserInputRequestId !== null;
  const composerSlotHidden =
    activeUserInputRequestId !== null || props.creationState?.kind === "failed";
  const pendingMessageEditBlocked =
    queuedRunEditBlockedReason({ openQuestionCount: activeUserInputRequestId === null ? 0 : 1 }) !==
    null;
  const [usageLimitsPanel, setUsageLimitsPanel] = useState<{
    readonly key: string;
    readonly threadKey: string;
    readonly now: number;
  } | null>(null);
  const usageLimitsKey = [
    selectedThreadKey,
    props.selectedThread.modelSelection.instanceId,
    props.selectedThread.latestRun?.runId ?? "",
    props.activePendingApproval?.requestId ?? props.activePendingUserInput?.requestId ?? "",
  ].join(":");
  if (usageLimitsPanel !== null && usageLimitsPanel.key !== usageLimitsKey) {
    setUsageLimitsPanel(null);
  }
  const usageLimitsReport =
    usageLimitsPanel !== null && usageLimitsPanel.key === usageLimitsKey
      ? collectProviderUsageLimits(
          props.selectedThread.modelSelection.instanceId,
          props.serverConfig?.providers ?? [],
          usageLimitsPanel.now,
        )
      : null;
  const showUsageLimits = (report: UsageLimitsReport | null) =>
    setUsageLimitsPanel(
      report === null
        ? null
        : {
            key: usageLimitsKey,
            threadKey: selectedThreadKey,
            now: Date.parse(report.createdAt),
          },
    );
  const dismissUsageLimits = () => setUsageLimitsPanel(null);
  const clearUsageLimitsFor = (threadKey: string) =>
    setUsageLimitsPanel((current) =>
      current !== null && current.threadKey === threadKey ? null : current,
    );
  const userInputToggled =
    userInputToggle !== null && userInputToggle.requestId === activeUserInputRequestId;
  const userInputCollapsed = userInputToggled && userInputToggle.collapsed;
  const [lastKnownKeyboardHeight, setLastKnownKeyboardHeight] = useState(0);
  if (liveKeyboardHeight > 0 && liveKeyboardHeight !== lastKnownKeyboardHeight) {
    setLastKnownKeyboardHeight(liveKeyboardHeight);
  }
  const reservedKeyboardHeight =
    lastKnownKeyboardHeight > 0 ? lastKnownKeyboardHeight : ESTIMATED_KEYBOARD_HEIGHT;
  const keyboardStickyEnabled =
    Platform.OS === "ios"
      ? deviceType !== "duo-unfolded" || (composerOwnsKeyboard && !sidebarSearchActive)
      : !keyboardStateSuspect;
  const estimatedOverlayHeight = composerOverlapHeight;
  const contentInsetEndAdjustment = useSharedValue(estimatedOverlayHeight);
  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      contentInsetEndAdjustment.set(event.nativeEvent.layout.height);
    },
    [contentInsetEndAdjustment],
  );
  const [screenHeight, setScreenHeight] = useState<number | null>(null);
  const [screenWidth, setScreenWidth] = useState<number | null>(null);
  const handleScreenLayout = (event: LayoutChangeEvent) => {
    setScreenHeight(event.nativeEvent.layout.height);
    const width = Math.round(event.nativeEvent.layout.width);
    setScreenWidth((current) =>
      current !== null && Math.abs(current - width) <= 1 ? current : width,
    );
  };
  const screenAreaHeight = screenHeight ?? windowHeight;
  const draftViewportHeight = screenAreaHeight - navigationHeaderHeight - liveKeyboardHeight;
  const { height: keyboardTranslation } = useReanimatedKeyboardAnimation();
  const pendingUserInputMaxHeight = useDerivedValue(() =>
    derivePendingUserInputMaxHeight({
      windowHeight: screenAreaHeight,
      keyboardHeight: keyboardStickyEnabled ? -keyboardTranslation.value : 0,
      navigationHeaderHeight,
      composerOverlapHeight:
        composerBottomInset +
        (questionInFlow && showFloatingStatus ? FLOATING_WORKING_CONTROL_COVERAGE : 0),
    }),
  );
  const questionBottomInset = activeUserInputRequestId !== null ? composerBottomInset : 0;
  const composerPanelsHeightStyle = useAnimatedStyle(() => ({
    maxHeight: pendingUserInputMaxHeight.value + questionBottomInset,
    flexGrow: 0,
  }));
  const approvalHeightStyle = useAnimatedStyle(() => ({
    maxHeight: derivePendingUserInputMaxHeight({
      windowHeight: screenAreaHeight,
      keyboardHeight: keyboardStickyEnabled ? -keyboardTranslation.value : 0,
      navigationHeaderHeight,
      composerOverlapHeight,
    }),
    flexGrow: 0,
  }));
  const usageLimitsOpen = usageLimitsReport !== null && activeUserInputRequestId === null;
  const [usageLimitsLayout, setUsageLimitsLayout] = useState({ overlay: 0, panel: 0 });
  const handleComposerOverlayLayout = (event: LayoutChangeEvent) => {
    if (!questionInFlow) onComposerLayout(event);
    if (!usageLimitsOpen) return;
    const overlay = event.nativeEvent.layout.height;
    setUsageLimitsLayout((current) =>
      current.overlay === overlay ? current : { ...current, overlay },
    );
  };
  const handleUsageLimitsLayout = (event: LayoutChangeEvent) => {
    const panel = event.nativeEvent.layout.height;
    setUsageLimitsLayout((current) => (current.panel === panel ? current : { ...current, panel }));
  };
  const overlayBesideUsageLimits =
    usageLimitsLayout.overlay > 0
      ? usageLimitsLayout.overlay - usageLimitsLayout.panel
      : composerOverlapHeight;
  const usageLimitsMaxHeight = Math.max(
    USAGE_LIMITS_PANEL_MIN_HEIGHT,
    Math.min(
      Math.round(screenAreaHeight * 0.4),
      screenAreaHeight -
        navigationHeaderHeight -
        reservedKeyboardHeight -
        overlayBesideUsageLimits -
        USAGE_LIMITS_PANEL_GAP * 2,
    ),
  );
  const userInputMotion = !userInputToggled
    ? "fresh"
    : userInputCollapsed
      ? "collapsed"
      : "expanded";
  const userInputCardProgress = useDerivedValue<number>(
    () =>
      userInputMotion === "fresh"
        ? 1
        : withTiming(userInputMotion === "collapsed" ? 0 : 1, USER_INPUT_TOGGLE_TIMING),
    [userInputMotion],
  );
  const userInputInsetProgress = useDerivedValue<number>(() => {
    if (userInputMotion === "collapsed") return 0;
    return userInputMotion === "fresh" ? 1 : withTiming(1, USER_INPUT_TOGGLE_TIMING);
  }, [userInputMotion]);
  const userInputCardCoverage = useSharedValue(0);
  const composerPopoverHeight = useSharedValue(0);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const reduceMotion = useReducedMotion();
  const floatingCoverageTarget = showFloatingStatus ? FLOATING_WORKING_CONTROL_COVERAGE : 0;
  const floatingControlCoverage = useSharedValue(floatingCoverageTarget);
  useAnimatedReaction(
    () => floatingCoverageTarget,
    (target, previous) => {
      if (previous === null) {
        floatingControlCoverage.set(target);
        return;
      }
      floatingControlCoverage.set(
        withTiming(target, { duration: 180, reduceMotion: ReduceMotion.System }),
      );
    },
    [floatingCoverageTarget],
  );
  const userInputCoverageApplies = Platform.OS === "ios" && activeUserInputRequestId !== null;
  const questionStatusSpace = useAnimatedStyle(() => ({ height: floatingControlCoverage.value }));
  const combinedContentInsetEndAdjustment = useSharedValue(estimatedOverlayHeight);
  useAnimatedReaction(
    () =>
      questionInFlow
        ? 0
        : contentInsetEndAdjustment.value +
          Math.max(FEED_END_GAP, floatingControlCoverage.value) +
          (userInputCoverageApplies
            ? userInputInsetProgress.value * userInputCardCoverage.value
            : 0),
    (value) => {
      combinedContentInsetEndAdjustment.set(value);
    },
    [questionInFlow, userInputCoverageApplies],
  );
  const composerPopoverLift = useDerivedValue(() =>
    withTiming(
      !composerSlotHidden && composerPopoverHeight.value > 0 ? composerPopoverHeight.value + 8 : 0,
      { duration: 180, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System },
    ),
  );
  const floatingControlLift = useDerivedValue(
    () =>
      Math.max(
        userInputCoverageApplies ? userInputCardProgress.value * userInputCardCoverage.value : 0,
        composerPopoverLift.value,
      ),
    [userInputCoverageApplies],
  );
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- arms a fresh thread scope when shown, then aborts it and clears its timers when the screen hides or unmounts
  useEffect(() => {
    if (threadScope.current.signal.aborted) threadScope.current = new AbortController();
    const scope = threadScope.current;
    return () => {
      scope.abort();
      if (composerHeightSettle.current !== null) clearTimeout(composerHeightSettle.current);
    };
  }, []);
  const handleToggleUserInputCollapsed = () => {
    if (activeUserInputRequestId === null) {
      return;
    }
    if (userInputCollapsed) {
      setUserInputToggle({ requestId: activeUserInputRequestId, collapsed: false });
    } else {
      Keyboard.dismiss();
      setUserInputToggle({ requestId: activeUserInputRequestId, collapsed: true });
    }
  };
  const showContent = props.showContent ?? true;
  useAtomMount(
    threadVisitTracker(
      showContent && !props.draftMode
        ? { environmentId: props.environmentId, threadId: props.selectedThread.id }
        : null,
    ),
  );
  const layoutVariant = props.layoutVariant ?? "compact";
  const isSplitLayout = layoutVariant !== "compact";
  const contentMaxWidth =
    Platform.OS === "android"
      ? ANDROID_READING_MAX_WIDTH
      : isSplitLayout
        ? CHAT_CONTENT_MAX_WIDTH
        : undefined;
  const providerSubagentProvider = props.serverConfig?.providers.find(
    (provider) => provider.instanceId === props.selectedThread.modelSelection.instanceId,
  );
  const providerSubagentModelSlug = providerSubagentProvider
    ? resolveSelectableModel(
        providerSubagentProvider.driver,
        props.selectedThread.modelSelection.model,
        providerSubagentProvider.models,
      )
    : null;
  const providerSubagentCatalogModel = providerSubagentProvider?.models.find(
    (model) => model.slug === providerSubagentModelSlug,
  );
  const workspaceContentWidth = useWorkspaceContentWidth();
  const composerWidthStyle = useAnimatedStyle(() =>
    isSplitLayout && workspaceContentWidth !== null
      ? {
          width: Math.max(
            0,
            workspaceContentWidth.value - controlInsets.left - controlInsets.right,
          ),
          right: undefined,
        }
      : { width: "auto", right: controlInsets.right },
  );
  const columnWidth = usesNativeWorkspaceColumns && isSplitLayout ? screenWidth : null;
  const columnComposerWidthStyle =
    columnWidth === null
      ? null
      : { width: Math.max(0, columnWidth - controlInsets.left - controlInsets.right) };
  const selectedInstanceId = props.selectedThread.modelSelection.instanceId;
  useAtomMount(threadStreamHaptics(selectedThreadDetailRef));
  useThreadOutcomeHaptics({
    threadKey: selectedThreadKey,
    live: props.threadSyncStatus === "live",
    run: props.activityRun,
    pendingRequestId:
      props.activePendingApproval?.requestId ?? props.activePendingUserInput?.requestId ?? null,
    composerError,
  });
  const selectedProviderSkills = (() => {
    const provider = props.serverConfig?.providers.find(
      (candidate) => candidate.instanceId === selectedInstanceId,
    );
    return provider
      ? resolveProviderSkillsForCwd(provider, props.threadCwd ?? props.projectWorkspaceRoot)
      : [];
  })();

  const currentPendingApprovals = () =>
    selectedThreadDetailRef === null
      ? []
      : (appAtomRegistry.get(environmentThreadDetails.pendingRequestsAtom(selectedThreadDetailRef))
          ?.approvals ?? []);
  const { onSendMessage } = props;
  const handleSendMessage = async (
    followUp?: ActiveTurnComposerAction,
    stillSendable?: () => boolean,
  ) => {
    const scope = threadScope.current.signal;
    const targetThreadKey = selectedThreadKey;
    const hasUserMessage = selectedThreadFeed.some(
      (entry) => entry.type === "message" && entry.message.role === "user",
    );
    const approvalsToDecline = props.activePendingApprovals;
    const declineBeforeDispatch =
      approvalsToDecline.length > 0 && props.activePendingUserInput === null
        ? async (text: string, hasAttachmentsOrContext: boolean) => {
            if (scope.aborted || stillSendable?.() === false || props.respondingApprovalId !== null)
              return false;
            const feedbackTarget = approvalsToDecline[0];
            if (feedbackTarget?.supportsFeedback) {
              if (hasAttachmentsOrContext) {
                Dialog.alert(
                  "Approval feedback",
                  "Send approval feedback without attachments or added context.",
                );
                return false;
              }
              return (await sendApprovalFeedback(feedbackTarget, text, props.onRespondToApproval))
                ? ("responded" as const)
                : false;
            }
            return (
              props.respondingApprovalId === null &&
              (await declinePendingApprovals(approvalsToDecline, props.onRespondToApproval)) &&
              !scope.aborted &&
              stillSendable?.() !== false &&
              !currentPendingApprovals().some(
                (approval) =>
                  !approvalsToDecline.some((declined) => declined.requestId === approval.requestId),
              )
            );
          }
        : undefined;
    let dismissingKeyboard = false;
    const messageId = await onSendMessage(followUp, declineBeforeDispatch, () => {
      if (
        scope.aborted ||
        Platform.OS !== "ios" ||
        !hasUserMessage ||
        !KeyboardController.isVisible()
      )
        return;
      setSendingWithKeyboard(true);
      dismissingKeyboard = true;
    });
    if (messageId === null || scope.aborted) {
      return messageId;
    }
    revealSubmittedMessage(scope, targetThreadKey, messageId, hasUserMessage, dismissingKeyboard);
    return messageId;
  };
  const revealSubmittedMessage = (
    scope: AbortSignal,
    targetThreadKey: string,
    messageId: MessageId,
    hasUserMessage: boolean,
    dismissingKeyboard = false,
  ) => {
    clearUsageLimitsFor(targetThreadKey);

    const nextAnchorMessageId = resolveThreadFeedSubmissionAnchor({
      currentAnchorMessageId: anchorMessageId,
      submittedMessageId: messageId,
      hasStartedTurn: props.selectedThread.latestRun !== null,
      hasUserMessage,
      queuedMessageCount: props.selectedThreadQueueCount,
      deliveryDeferred: props.connectionStateLabel !== "connected",
    });
    setAnchorMessageId(nextAnchorMessageId);
    if (!dismissingKeyboard) composerEditorRef.current?.blur();
    const followSubmission =
      contentPresentationKind === "ready" &&
      (dismissingKeyboard || nextAnchorMessageId === messageId);
    if (dismissingKeyboard || followSubmission) {
      requestAnimationFrame(() => {
        if (scope.aborted) return;
        void KeyboardController.dismiss()
          .then(() => {
            if (!followSubmission || scope.aborted) return;
            return scrollMessageToEnd({ animated: !reduceMotion, closeKeyboard: false });
          })
          .catch(() => {
            if (!scope.aborted) freeze.set(false);
          });
      });
    }
  };
  const { onSendVoiceMessage } = props;
  const handleSendVoiceMessage =
    onSendVoiceMessage && clientCreation === null && props.activePendingApprovals.length === 0
      ? async (
          recordingUri: string,
          language: string,
          handOff: VoiceRecordingHandOff | undefined,
        ) => {
          const scope = threadScope.current.signal;
          const targetThreadKey = selectedThreadKey;
          const hasUserMessage = selectedThreadFeed.some(
            (entry) => entry.type === "message" && entry.message.role === "user",
          );
          const messageId = await onSendVoiceMessage(recordingUri, language, handOff);
          if (messageId !== null && !scope.aborted) {
            revealSubmittedMessage(scope, targetThreadKey, messageId, hasUserMessage);
          }
        }
      : undefined;

  const handleEditPendingMessage = async (message: QueuedThreadMessage) => {
    if (pendingMessageEditBlocked) return;
    const scope = threadScope.current.signal;
    if (message.creation) {
      selectDetail({
        name: "Thread",
        params: {
          draft: {
            environmentId: String(message.environmentId),
            projectId: String(message.creation.projectId),
            pendingTaskId: String(message.messageId),
          },
        },
      });
      return;
    }
    const edited = await settlePromise(() => editPendingThreadMessage(message));
    if (AsyncResult.isFailure(edited)) {
      const error = squashAtomCommandFailure(edited);
      Dialog.alert(
        "Could not edit message",
        error instanceof Error ? error.message : "Please try again.",
      );
      return;
    }
    if (
      edited.value &&
      !scope.aborted &&
      selectedThreadKey === scopedThreadKey(message.environmentId, message.threadId)
    ) {
      composerEditorRef.current?.focus();
    }
  };

  const collapseComposer = () => {
    composerEditorRef.current?.blur();
  };

  const handleUseArtifactTemplate = (template: CodexArtifactTemplate) => {
    const draftMessage =
      props.composerDraftKey === null ? "" : getComposerDraftSnapshot(props.composerDraftKey).text;
    const nextDraft = appendCodexArtifactTemplateUsePrompt(draftMessage, template);
    if (nextDraft !== draftMessage) props.onChangeDraftMessage(nextDraft);
    requestAnimationFrame(() => {
      composerEditorRef.current?.focus();
      composerEditorRef.current?.setSelection({ start: nextDraft.length, end: nextDraft.length });
    });
  };

  const annotationDraftKey =
    isProviderSubagent || props.draftMode || props.isSavingQueuedEdit
      ? null
      : props.composerDraftKey;
  const handleAnnotateAssistantText = (messageId: MessageId, selection: MarkdownTextSelection) => {
    if (annotationDraftKey === null) return;
    annotateAssistantText({
      source: { environmentId: props.environmentId, threadId: props.selectedThread.id, messageId },
      draftKey: annotationDraftKey,
      selection,
    });
  };

  const handleScrollToEnd = () => {
    void Haptics.selectionAsync();
    void scrollMessageToEnd({ animated: !reduceMotion, closeKeyboard: false }).catch(() => {
      freeze.set(false);
    });
  };

  const showScrollToEndButton = !props.draftMode && contentPresentationKind === "ready" && !isAtEnd;
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";

  const handleFeedTouchStart = (event: GestureResponderEvent) => {
    feedTouchStartRef.current = {
      pageX: event.nativeEvent.pageX,
      pageY: event.nativeEvent.pageY,
    };
  };

  const handleFeedTouchMove = (event: GestureResponderEvent) => {
    const start = feedTouchStartRef.current;
    if (!start) {
      return;
    }
    const deltaX = event.nativeEvent.pageX - start.pageX;
    const deltaY = event.nativeEvent.pageY - start.pageY;
    if (Math.hypot(deltaX, deltaY) > 8) {
      feedTouchStartRef.current = null;
    }
  };

  const handleFeedTouchEnd = () => {
    if (feedTouchStartRef.current) {
      collapseComposer();
    }
    feedTouchStartRef.current = null;
  };

  const handleFeedTouchCancel = () => {
    feedTouchStartRef.current = null;
  };

  return (
    <View className="flex-1" onLayout={handleScreenLayout}>
      {!usesNativeWorkspaceColumns ? <NativeLayoutObserver onChange={setScreenMetrics} /> : null}
      {props.draftMode ? (
        props.draftMode.content(
          navigationHeaderHeight,
          liveKeyboardHeight + estimatedOverlayHeight + 24,
          draftViewportHeight,
        )
      ) : showContent ? (
        <View
          style={{ flex: 1 }}
          onTouchStart={handleFeedTouchStart}
          onTouchMove={handleFeedTouchMove}
          onTouchEnd={handleFeedTouchEnd}
          onTouchCancel={handleFeedTouchCancel}
        >
          <View
            pointerEvents="none"
            className={
              Platform.OS === "android"
                ? "absolute inset-0 bg-thread-canvas"
                : "absolute inset-0 bg-screen"
            }
          />
          <RenderErrorBoundary
            key={selectedThreadKey}
            resetKeys={[props.threadCwd]}
            renderFallback={(fallback) => (
              <RenderFailureView
                {...fallback}
                title="The conversation couldn't be displayed"
                bottomInset={estimatedOverlayHeight}
              />
            )}
          >
            <WorkspaceMutationIdProvider threadRef={selectedThreadDetailRef}>
              <ColumnWidth width={columnWidth}>
                <ThreadFeed
                  environmentId={props.environmentId}
                  threadId={props.selectedThread.id}
                  workspaceRoot={props.threadCwd}
                  repositoryIdentity={props.repositoryIdentity}
                  feed={props.selectedThreadFeed}
                  pendingHandoff={props.pendingHandoff}
                  statusLines={statusLines}
                  worktreeSetup={props.worktreeSetup}
                  preparingWorktree={preparingWorktreeInFeed}
                  queuedMessages={props.queuedMessages}
                  creatingThread={clientCreation !== null}
                  dispatchingMessageId={props.dispatchingMessageId}
                  onEditPendingMessage={
                    isProviderSubagent || pendingMessageEditBlocked
                      ? null
                      : handleEditPendingMessage
                  }
                  contentPresentation={props.contentPresentation}
                  threadTitle={props.selectedThread.title}
                  latestRun={props.activityRun}
                  activeWorkStartedAt={props.activeWorkStartedAt}
                  runlessWorkActive={props.runlessWorkActive ?? false}
                  listRef={listRef}
                  freeze={freeze}
                  anchorMessageId={anchorMessageId}
                  contentInsetEndAdjustment={combinedContentInsetEndAdjustment}
                  keyboardOffset={composerKeyboardOffset}
                  sendingWithKeyboard={sendingWithKeyboard}
                  fitShortFeedToViewport={questionInFlow && !isKeyboardVisible}
                  contentBottomInset={
                    questionInFlow
                      ? 0
                      : estimatedOverlayHeight +
                        (showFloatingStatus ? FLOATING_WORKING_CONTROL_COVERAGE : FEED_END_GAP)
                  }
                  contentMaxWidth={contentMaxWidth}
                  historyControls={props.historyControls}
                  {...(props.pins ? { pins: props.pins } : {})}
                  messageJump={props.messageJump ?? null}
                  {...(props.onMessageJumpFailed
                    ? { onMessageJumpFailed: props.onMessageJumpFailed }
                    : {})}
                  contentSideInsets={deriveContentSideInsets(nativeMetrics)}
                  layoutVariant={layoutVariant}
                  usesAutomaticContentInsets={props.usesAutomaticContentInsets}
                  onHeaderMaterialVisibilityChange={props.onHeaderMaterialVisibilityChange}
                  onIsAtEndChange={setIsAtEnd}
                  skills={selectedProviderSkills}
                  onUseArtifactTemplate={handleUseArtifactTemplate}
                  onAnnotateAssistantText={
                    annotationDraftKey === null ? undefined : handleAnnotateAssistantText
                  }
                  annotationDraftKey={annotationDraftKey ?? undefined}
                />
              </ColumnWidth>
            </WorkspaceMutationIdProvider>
          </RenderErrorBoundary>
        </View>
      ) : (
        <View className="flex-1" />
      )}

      {showContent ? (
        <ThreadBrowserFloat
          key={selectedThreadKey}
          environmentId={props.environmentId}
          threadId={props.selectedThread.id}
          tabs={browserTabs.tabs}
          loaded={browserTabs.loaded}
          top={navigationHeaderHeight + 8}
          onOpen={openBrowserPreview}
        />
      ) : null}

      {showContent ? (
        <KeyboardStickyView
          enabled={keyboardStickyEnabled}
          pointerEvents="box-none"
          style={
            questionInFlow
              ? {
                  marginLeft: controlInsets.left,
                  marginRight: controlInsets.right,
                  marginBottom: controlInsets.bottom,
                }
              : { position: "absolute", bottom: 0, left: 0, right: 0, top: 0 }
          }
          offset={{ closed: 0, opened: composerKeyboardOffset }}
        >
          {questionInFlow ? (
            <Animated.View pointerEvents="none" style={questionStatusSpace} />
          ) : null}
          <ComposerPopoverHost
            hidden={composerSlotHidden}
            popoverHeight={composerPopoverHeight}
            inFlow={questionInFlow}
          >
            <Animated.View
              layout={COMPOSER_LAYOUT_TRANSITION}
              pointerEvents="box-none"
              style={
                questionInFlow
                  ? (columnComposerWidthStyle ?? (isSplitLayout ? composerWidthStyle : undefined))
                  : columnComposerWidthStyle
                    ? [
                        {
                          position: "absolute",
                          bottom: controlInsets.bottom,
                          left: controlInsets.left,
                        },
                        columnComposerWidthStyle,
                      ]
                    : [
                        {
                          position: "absolute",
                          bottom: controlInsets.bottom,
                          left: controlInsets.left,
                          right: controlInsets.right,
                        },
                        composerWidthStyle,
                      ]
              }
            >
              <View onLayout={handleComposerOverlayLayout} className="w-full">
                <View className="w-full self-center" style={{ maxWidth: contentMaxWidth }}>
                  <FloatingWorkingControl
                    colorScheme={isDarkMode ? "dark" : "light"}
                    status={floatingStatus}
                    extensionStatus={
                      floatingStatus !== null && floatingStatus.kind === "goal"
                        ? extensionStatus
                        : null
                    }
                    lift={floatingControlLift}
                    hidden={composerMenuOpen}
                    devicePreview={
                      devicePreviews.length > 0
                        ? { count: devicePreviews.length, onPress: openDevicePreview }
                        : null
                    }
                    browserPreview={
                      browserTabs.tabs.length > 0
                        ? { count: browserTabs.tabs.length, onPress: () => openBrowserPreview() }
                        : null
                    }
                    showScrollToEnd={showScrollToEndButton}
                    onScrollToEnd={handleScrollToEnd}
                    agents={agentsSegment}
                    onOpenAgents={() => {
                      Keyboard.dismiss();
                      navigation.navigate("ThreadAgents", {
                        environmentId: props.environmentId,
                        threadId: props.selectedThread.id,
                      });
                    }}
                    queuedCount={queuedCount}
                    onOpenQueue={() => {
                      Keyboard.dismiss();
                      navigation.navigate("ThreadQueue", {
                        environmentId: props.environmentId,
                        threadId: props.selectedThread.id,
                      });
                    }}
                  />
                  <ComposerPanels
                    className="w-full"
                    style={Platform.OS === "android" ? composerPanelsHeightStyle : undefined}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                  >
                    {props.queuedRunEdit !== null ? (
                      <Animated.View
                        className="shrink-0"
                        entering={FadeInDown.duration(180)}
                        exiting={FadeOut.duration(120)}
                      >
                        <ComposerQueuedEditBanner
                          saving={props.isSavingQueuedEdit}
                          onCancel={() => {
                            voiceInputSession.cancel(props.composerDraftKey);
                            props.onCancelQueuedRunEdit();
                          }}
                        />
                      </Animated.View>
                    ) : null}
                    <UsageLimitRecoveryCard
                      key={props.selectedThread.latestRun?.runId}
                      thread={props.selectedThread}
                      environmentId={props.environmentId}
                    />
                    <ChildThreadApprovals
                      threadRef={selectedThreadDetailRef}
                      maxHeight={pendingUserInputMaxHeight}
                    />
                    {props.draftMode ? null : props.selectedThread.lineage.sideChat === true &&
                      props.selectedThread.lineage.parentThreadId !== null ? (
                      <SideChatActionsRow
                        thread={props.selectedThread}
                        parentThreadId={props.selectedThread.lineage.parentThreadId}
                      />
                    ) : (
                      <ThreadSideChatsRow
                        environmentId={props.environmentId}
                        threadId={props.selectedThread.id}
                      />
                    )}
                    {props.feedbackSubmissions.map((submission) => (
                      <ComposerFeedback
                        key={submission.id}
                        submission={submission}
                        onDismiss={() => props.onDismissFeedback(submission.id)}
                      />
                    ))}
                    {freshSessionAvailable ? (
                      <FreshSessionNotice threadKey={selectedThreadKey} />
                    ) : null}
                    {composerError !== null ? (
                      <ComposerErrorNotice
                        message={composerError}
                        onDismiss={() => clearThreadComposerError(selectedThreadKey)}
                      />
                    ) : null}
                    {usageLimitsReport && activeUserInputRequestId === null ? (
                      <Animated.View
                        className="shrink-0 px-4"
                        style={{ paddingBottom: USAGE_LIMITS_PANEL_GAP }}
                        onLayout={handleUsageLimitsLayout}
                        entering={FadeInDown.duration(220)}
                        exiting={FadeOut.duration(140)}
                      >
                        <ComposerUsageLimits
                          report={usageLimitsReport}
                          environmentId={props.environmentId}
                          maxHeight={usageLimitsMaxHeight}
                          onClose={dismissUsageLimits}
                        />
                      </Animated.View>
                    ) : null}
                    {props.creationState?.kind === "failed" ? (
                      <Animated.View
                        className="shrink-0 px-4"
                        style={{ paddingBottom: composerBottomInset }}
                        entering={FadeInDown.duration(220)}
                        exiting={FadeOut.duration(140)}
                      >
                        <ThreadCreationFailedCard
                          reason={props.creationState.reason}
                          onEditTask={props.creationState.onEditTask}
                        />
                      </Animated.View>
                    ) : null}
                    {props.activePendingApproval || props.activePendingUserInput ? (
                      <Animated.View
                        className="shrink-0 gap-3 px-4 pb-3"
                        style={
                          activeUserInputRequestId !== null
                            ? { paddingBottom: composerBottomInset }
                            : undefined
                        }
                        entering={FadeInDown.duration(220)}
                        exiting={FadeOut.duration(140)}
                      >
                        {props.activePendingApproval ? (
                          <Animated.ScrollView
                            key={props.activePendingApproval.requestId}
                            style={approvalHeightStyle}
                            keyboardShouldPersistTaps="handled"
                            nestedScrollEnabled
                          >
                            <PendingApprovalCard
                              canOperateThread={props.canOperateThread}
                              approval={props.activePendingApproval}
                              respondingApprovalId={props.respondingApprovalId}
                              onRespond={props.onRespondToApproval}
                            />
                          </Animated.ScrollView>
                        ) : null}
                        {props.activePendingUserInput ? (
                          <PendingUserInputCard
                            environmentId={props.environmentId}
                            threadId={props.selectedThread.id}
                            workspaceRoot={props.threadCwd}
                            canOperateThread={props.canOperateThread}
                            pendingUserInput={props.activePendingUserInput}
                            maxHeight={pendingUserInputMaxHeight}
                            collapsed={userInputCollapsed}
                            onToggleCollapsed={handleToggleUserInputCollapsed}
                            onStopThread={props.onStopThread}
                            cardProgress={userInputCardProgress}
                            cardCoverage={userInputCardCoverage}
                            onInputFocusChange={handleOwnedInputFocusChange}
                            drafts={props.activePendingUserInputDrafts}
                            answers={props.activePendingUserInputAnswers}
                            respondingUserInputId={props.respondingUserInputId}
                            onSelectOption={props.onSelectUserInputOption}
                            onChangeCustomAnswer={props.onChangeUserInputCustomAnswer}
                            onSubmit={props.onSubmitUserInput}
                            onDismiss={props.onDismissUserInput}
                            supportsQuestionAutoDismiss={
                              props.serverConfig?.settings.autoDismissQuestions !== false &&
                              props.serverConfig != null
                            }
                          />
                        ) : null}
                      </Animated.View>
                    ) : null}
                  </ComposerPanels>
                </View>

                <View style={composerSlotHidden ? { display: "none" } : undefined}>
                  {isProviderSubagent ? (
                    <View
                      className="self-center px-3 pt-1.5"
                      style={{
                        width: "100%",
                        maxWidth: contentMaxWidth,
                        paddingBottom: composerBottomInset + 6,
                      }}
                    >
                      <ProviderSubagentBar
                        provider={providerSubagentProvider ?? null}
                        modelLabel={
                          providerSubagentCatalogModel?.name ??
                          formatModelSlugName(props.selectedThread.modelSelection.model)
                        }
                        effortLabel={formatModelSelectionEffort(
                          props.selectedThread.modelSelection,
                          providerSubagentProvider?.models,
                          reportedModelSelection,
                        )}
                        status={props.providerSubagentStatus ?? null}
                        inspect={
                          providerSubagentProvider?.driver === "antigravity"
                            ? {
                                environmentId: props.environmentId,
                                threadId: props.selectedThread.id,
                              }
                            : null
                        }
                        onOpenParent={
                          props.selectedThread.lineage.parentThreadId === null
                            ? null
                            : () =>
                                openLinkedThread({
                                  environmentId: String(props.environmentId),
                                  threadId: String(props.selectedThread.lineage.parentThreadId),
                                })
                        }
                      />
                    </View>
                  ) : (
                    <>
                      {props.draftMode?.controls(draftViewportHeight)}
                      <ThreadComposer
                        isDraft={Boolean(props.draftMode)}
                        canOperateThread={props.canOperateThread}
                        reportedModelSelection={reportedModelSelection}
                        editorRef={composerEditorRef}
                        placeholder={
                          props.activePendingApproval
                            ? props.activePendingApproval.supportsFeedback
                              ? "Send feedback to decline this request"
                              : "Send a message to decline and redirect the agent"
                            : (suggestedPrompt ?? "Ask anything")
                        }
                        suggestedPrompt={suggestedPrompt}
                        contentMaxWidth={contentMaxWidth}
                        connectionState={props.connectionStateLabel}
                        environmentLabel={props.environmentLabel}
                        selectedThread={props.selectedThread}
                        hasCompactableConversation={
                          hasCompactableConversation && !props.isCompacting
                        }
                        {...(freshSessionAvailable
                          ? {
                              onFreshSession: () => setFreshSessionPending(selectedThreadKey, true),
                            }
                          : {})}
                        serverConfig={props.serverConfig}
                        queueCount={props.selectedThreadQueueCount}
                        activeThreadBusy={props.activeThreadBusy}
                        canStopThread={props.canStopThread}
                        environmentId={props.environmentId}
                        projectCwd={props.threadCwd ?? props.projectWorkspaceRoot}
                        awaitingCreation={clientCreation !== null}
                        sendBlockedReason={props.draftMode?.sendBlockedReason ?? null}
                        interactionLocked={props.draftMode?.interactionLocked}
                        draftKey={props.composerDraftKey ?? undefined}
                        followUpBehavior={
                          props.activePendingApprovals.length > 0 &&
                          props.activePendingUserInput === null
                            ? "steer"
                            : props.followUpBehavior
                        }
                        canSteerActiveTurn={props.canSteerActiveTurn}
                        hidden={composerSlotHidden}
                        queuedEdit={
                          props.queuedRunEdit === null
                            ? null
                            : {
                                existingAttachments: props.queuedRunEdit.existingAttachments,
                                saving: props.isSavingQueuedEdit,
                                onRemoveExistingAttachment: props.onRemoveQueuedEditAttachment,
                              }
                        }
                        bottomInset={composerBottomInset}
                        onChangeDraftMessage={props.onChangeDraftMessage}
                        onPickDraftMedia={props.onPickDraftMedia}
                        onPickDraftFiles={props.onPickDraftFiles}
                        onNativePasteImages={props.onNativePasteImages}
                        onNativePasteText={props.onNativePasteText}
                        onRemoveDraftImage={props.onRemoveDraftImage}
                        onStopThread={props.onStopThread}
                        onResumeQueue={props.onResumeQueue}
                        onSendMessage={handleSendMessage}
                        onSendVoiceMessage={props.draftMode ? undefined : handleSendVoiceMessage}
                        onShowUsageLimits={showUsageLimits}
                        canSwitchProvider={props.canSwitchThreadProvider}
                        onUpdateModelSelection={props.onUpdateThreadModelSelection}
                        onExpandedChange={setComposerExpanded}
                        onHeightChange={handleComposerHeightChange}
                        onEditorFocusChange={handleOwnedInputFocusChange}
                        onCommandMenuOpenChange={setComposerMenuOpen}
                      />
                    </>
                  )}
                </View>
              </View>
            </Animated.View>
          </ComposerPopoverHost>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
}
