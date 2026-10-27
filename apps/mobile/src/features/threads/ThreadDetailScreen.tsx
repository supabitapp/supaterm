import { useOpenThreadInspector } from "./thread-inspector-navigation";
import { useSidebarWorkspaceTabs } from "../workspace/useSidebarWorkspaceTabs";
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
import { ChatGptUsageLimitNotice } from "./ChatGptUsageLimitNotice";
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
import {
  childThreadInputsTitle,
  type CodexFeedbackSubmission,
  type EnvironmentThreadStatus,
} from "@supaterm/client-runtime/state/threads";
import { useKeyboardChatComposerInset, useKeyboardScrollToEnd } from "@legendapp/list/keyboard";
import { resolveProviderSkillsForCwd } from "@supaterm/client-runtime/providerSkills";
import type { LegendListRef } from "@legendapp/list/react-native";
import { HeaderHeightContext } from "@react-navigation/elements";
import { NativeLayoutObserver } from "../../native/NativeLayoutObserver";
import { deriveBottomControlInsets, type NativeLayoutMetrics } from "../../lib/reserved-regions";
import type {
  EnvironmentId,
  MessageId,
  ModelSelection,
  RuntimeMode,
  RuntimeRequestId,
  ScopedThreadRef,
  ServerConfig as SupatermServerConfig,
  UsageLimitsReport,
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
import {
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
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  AppState,
  Keyboard,
  Platform,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewInstance,
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
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useWorkspaceContentWidth } from "../layout/workspace-content-width";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import {
  useDuoBottomBarInset,
  useNativeColumnLayoutMetrics,
  useNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { collectProviderUsageLimits } from "@supaterm/shared/usageLimits";
import type { ComposerEditorHandle } from "../../components/ComposerEditor";
import type { StatusTone } from "../../components/StatusPill";
import { getComposerDraftSnapshot } from "../../state/use-composer-drafts";
import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import {
  ANDROID_READING_MAX_WIDTH,
  CHAT_CONTENT_MAX_WIDTH,
  type LayoutVariant,
} from "../../lib/layout";
import { editPendingThreadMessage } from "../../state/edit-pending-thread-message";
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
import { useDelayedStatus } from "../../lib/useDelayedStatus";
import {
  threadFeedRunIsUnsettled,
  type PendingApproval,
  type PendingUserInput,
  type PendingUserInputDraftAnswer,
  type ThreadFeedEntry,
  type ThreadFeedLatestRun,
} from "../../lib/threadActivity";
import { PendingApprovalCard } from "./PendingApprovalCard";
import { ComposerErrorNotice } from "./ComposerErrorNotice";
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
import {
  ThreadFeed,
  type ThreadFeedHandle,
  type ThreadFeedHistoryControls,
  type ThreadFeedPins,
} from "./ThreadFeed";
import type { MessageJump, MessageJumpHandlers } from "@supaterm/client-runtime/message-jump";
import { ComposerQueuedEditBanner } from "./ComposerQueuedEdit";
import type { ThreadContentPresentation } from "./threadContentPresentation";
import { resolveThreadFeedSubmissionAnchor } from "./thread-feed-live-follow";
import { useOpenLinkedThread } from "./useOpenLinkedThread";
import { useGlobalVoiceInput } from "../voice-input/VoiceInputProvider";

export interface ThreadDetailScreenProps {
  readonly header?: React.ReactNode;
  readonly draftMode?: {
    readonly content: (
      headerInset: number,
      bottomInset: number,
      availableHeight: number,
    ) => React.ReactNode;
    readonly controls: React.ReactNode;
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
  ) => Promise<MessageId | null>;
  readonly onReconnectEnvironment: () => void;
  readonly canSwitchThreadProvider: boolean;
  readonly onUpdateThreadModelSelection: (modelSelection: ModelSelection) => void;
  readonly onUpdateThreadRuntimeMode: (runtimeMode: RuntimeMode) => void;
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

/** Signals what changes while the thread is on screen: a send failing, the
 * agent asking for input, and the turn finishing or failing. A user stop
 * stays silent, and so does state that only arrives while the thread loads. */
function useThreadOutcomeHaptics(state: {
  readonly threadKey: string;
  readonly live: boolean;
  readonly run: ThreadFeedLatestRun | null;
  readonly pendingRequestId: string | null;
  readonly composerError: string | null;
}) {
  const { threadKey, live, run, pendingRequestId, composerError } = state;
  const previousRef = useRef({ threadKey, hydrated: live, run, pendingRequestId, composerError });

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
      !threadFeedRunIsUnsettled(previous.run)
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

const USAGE_LIMITS_PANEL_GAP = 12;
const USAGE_LIMITS_PANEL_MIN_HEIGHT = 44;

const USER_INPUT_TOGGLE_TIMING = {
  duration: USER_INPUT_TOGGLE_DURATION_MS,
  easing: Easing.out(Easing.cubic),
};

// A scheduled wake can happen without a newer server update, so the tracker
// is told when one takes effect. The shell's updatedAt ticks while a run
// streams; the tracker follows it outside React.
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
  visit: threadEnvironment.visit,
});

// Anchors, follow state and pending scrolls belong to one thread, so the body
// remounts when the thread changes.
export function ThreadDetailScreen(props: ThreadDetailScreenProps) {
  return (
    <ThreadDetailBody
      key={scopedThreadKey(props.environmentId, props.selectedThread.id)}
      {...props}
    />
  );
}

function ThreadDetailBody(props: ThreadDetailScreenProps) {
  const selectedThreadDetailRef: ScopedThreadRef | null = props.draftMode
    ? null
    : { environmentId: props.environmentId, threadId: props.selectedThread.id };
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const navigation = useNavigation();
  const { layout, selectThreadRoute } = useAdaptiveWorkspaceLayout();
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
  // Android can swallow IME hide callbacks when backgrounded mid-hide, freezing the keyboard's
  // height and visibility open. An input that kept focus is exempt, since Android restores its
  // keyboard and no event would lift the quarantine; so Back then Home mid-hide still strands it.
  const [keyboardStateSuspect, setKeyboardStateSuspect] = useState(false);
  const ownedInputFocusedRef = useRef(false);
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
      setKeyboardStateSuspect(false);
    }
  };
  const windowHeight = useWindowDimensions().height;
  const navigationHeaderHeight = useContext(HeaderHeightContext) ?? insets.top + 44;
  const [screenMetrics, setScreenMetrics] = useState<NativeLayoutMetrics | null>(null);
  const columnMetrics = useNativeColumnLayoutMetrics();
  const windowMetrics = useNativeLayoutMetrics();
  const nativeMetrics = usesNativeWorkspaceColumns ? columnMetrics : screenMetrics;
  const controlInsets = deriveBottomControlInsets(nativeMetrics);
  const agentLabel = `${props.selectedThread.modelSelection.instanceId} agent`;
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
  useEffect(() => {
    if (editingRunId === null) return;
    const frame = requestAnimationFrame(() => composerEditorRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [composerEditorRef, editingRunId]);
  const composerOverlayRef = useRef<ViewInstance>(null);
  const listRef = useRef<LegendListRef>(null);
  const feedTouchStartRef = useRef<{ pageX: number; pageY: number } | null>(null);
  // Aborted when the screen hides or unmounts; a hidden Activity pane keeps its state but re-runs
  // effects when shown, so each show arms a fresh scope.
  const threadScope = useRef(new AbortController());
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [anchorMessageId, setAnchorMessageId] = useState<MessageId | null>(null);
  const feedRef = useRef<ThreadFeedHandle>(null);
  const [endFollowEnabled, setEndFollowEnabled] = useState(true);
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  // Keep the bottom padding fixed while the keyboard animates. Changing it at
  // keyboardDidHide makes the composer land low, then jump back above the safe area.
  const bottomBarInset = useDuoBottomBarInset();
  const hasSidebarTabBar = useSidebarWorkspaceTabs() === "picker";
  // A pushed screen temporarily inherits the outgoing tab bar's safe area.
  // Use the window edge so hiding that bar cannot move the composer mid-push.
  const bottomSafeArea =
    Platform.OS === "ios" ? (windowMetrics?.safeArea.bottom ?? insets.bottom) : insets.bottom;
  // The pill already adds its own gutter; iPad and Duo align its edge with the native bar.
  const alignedBottomInset =
    bottomBarInset ??
    (Platform.OS === "ios" && Platform.isPad
      ? Math.max(bottomSafeArea, 12) - (layout.usesSplitView ? 5 : 0)
      : undefined);
  const composerBottomInset =
    alignedBottomInset !== undefined
      ? Math.max(0, alignedBottomInset - THREAD_COMPOSER_BOTTOM_GUTTER)
      : Math.max(bottomSafeArea, 12);
  const composerKeyboardOffset = composerBottomInset;
  const contentPresentationKind = props.contentPresentation.kind;
  const clientCreation =
    props.creationState?.kind === "preparing" && !props.creationState.serverOwned
      ? props.creationState
      : null;
  const realThreadSyncLabel = (() => {
    switch (props.threadSyncStatus) {
      case "empty":
      case "cached":
      case "synchronizing":
        if (contentPresentationKind === "ready") {
          return "Syncing messages...";
        }
        return null;
      default:
        return null;
    }
  })();
  const threadSyncLabel = useDelayedStatus(selectedThreadKey, realThreadSyncLabel);
  const interruptThreadTurn = useAtomCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const unsnoozeThread = useAtomCommand(threadEnvironment.unsnooze, { reportFailure: false });
  const reopenThread = useAtomCommand(threadEnvironment.reopen, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const [statusRequest, setStatusRequest] = useState<{ threadKey: string } | null>(null);
  const statusPending = statusRequest?.threadKey === selectedThreadKey;
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
  useEffect(() => {
    if (!snoozed || snoozedUntil === null) return;
    const timer = setTimeout(
      () => setLifecycleNow(new Date().toISOString()),
      Math.min(Math.max(0, Date.parse(snoozedUntil) - Date.now()) + 50, 2_147_483_647),
    );
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Re-arm if timer clamping fires before the wake time.
  }, [snoozed, snoozedUntil, lifecycleNow]);
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
    const request = { threadKey: selectedThreadKey };
    setStatusRequest(request);
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
    // An accepted interrupt can leave tasks running. Release the action for retry.
    setStatusRequest((current) => (current === request ? null : current));
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
  const floatingStatus = ((): FloatingWorkingStatus | null => {
    const connectionStatus = connectionFloatingStatus({
      connectionError: props.connectionError,
      connectionState: props.connectionStateLabel,
      environmentLabel: props.environmentLabel,
      onReconnect: props.onReconnectEnvironment,
    });
    if (connectionStatus !== null && showConnectionStatus && !props.draftMode) {
      return connectionStatus;
    }
    if (props.activePendingApproval !== null || props.activePendingUserInput !== null) {
      return null;
    }
    if (props.creationState?.kind === "preparing") {
      if (props.worktreeSetup) return null;
      return {
        kind: "preparing",
        label: pendingThreadCreationLabel({
          connected: props.connectionStateLabel === "connected",
          preparingWorktree: props.creationState.preparingWorktree,
        }),
      };
    }
    if (props.creationState?.kind === "failed") {
      return null;
    }
    if (threadSyncLabel !== null) {
      return { kind: "syncing", label: threadSyncLabel };
    }
    const childInput = childThreadInputs[0];
    if (childInput && contentPresentationKind === "ready") {
      return {
        kind: "child-input",
        label: childThreadInputsTitle(childThreadInputs),
        accessibilityLabel: `Open ${childInput.hasPendingApprovals ? "approval" : "question"} from ${childInput.title}`,
        onPress: () => {
          Keyboard.dismiss();
          openLinkedThread({ environmentId: props.environmentId, threadId: childInput.id });
        },
      };
    }
    if (props.isCompacting && contentPresentationKind === "ready") {
      return { kind: "compacting" };
    }
    if (props.activeWorkStartedAt !== null && contentPresentationKind === "ready") {
      return { kind: "working", startedAt: props.activeWorkStartedAt };
    }
    if (pendingBackgroundWork !== null && contentPresentationKind === "ready") {
      return {
        kind: "background",
        label: pendingBackgroundWork.title,
        accessibilityLabel: `${pendingBackgroundWork.title}: ${pendingBackgroundWork.items
          .map((item) => item.label)
          .join(", ")}`,
        waiting: pendingBackgroundWork.waiting,
        onPress: () => {
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
      };
    }
    if (contentPresentationKind === "ready" && (snoozed || done || woke)) {
      const state = snoozed ? "snoozed" : done ? "done" : "woke";
      const label =
        snoozed && snoozedUntil !== null
          ? `Snoozed, wakes in ${snoozeWakeLabel(snoozedUntil, { now: lifecycleNow })}`
          : done
            ? "Done"
            : "Woke from snooze";
      const actionLabel = snoozed ? "Wake now" : done ? "Reopen" : "Dismiss";
      return {
        kind: "lifecycle",
        state,
        label,
        action: {
          label: statusPending
            ? snoozed
              ? "Waking..."
              : done
                ? "Reopening..."
                : "Dismissing..."
            : actionLabel,
          accessibilityLabel: actionLabel,
          disabled: !props.canOperateThread || statusPending,
          onPress: () => void runStatusAction(snoozed ? "wake" : done ? "reopen" : "dismiss"),
        },
      };
    }
    if (props.selectedThread.goal !== null && contentPresentationKind === "ready") {
      const goal = presentProviderGoal(props.selectedThread.goal, false);
      return {
        kind: "goal",
        label: goal.title,
        accessibilityLabel: `${goal.title}: ${goal.objective}`,
      };
    }
    return null;
  })();
  const showWorkingControl = floatingStatus !== null;
  const showFloatingStatus =
    showWorkingControl ||
    queuedCount > 0 ||
    agentsSegment !== null ||
    devicePreviews.length > 0 ||
    browserTabs.tabs.length > 0 ||
    props.queuedMessages.length > 0 ||
    props.selectedThreadFeed.some(
      (entry) => "acknowledged" in entry && entry.acknowledged === true,
    );
  const selectedThreadFeed = props.selectedThreadFeed;
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
  // The last collapse toggle; it only applies to the request it was made on.
  const [userInputToggle, setUserInputToggle] = useState<{
    readonly requestId: RuntimeRequestId;
    readonly collapsed: boolean;
  } | null>(null);
  const activeUserInputRequestId = props.activePendingUserInput?.requestId ?? null;
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
  // A pending approval or question is part of the key: once it is answered,
  // from this client or any other, the agent resumes and spends quota.
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
  // A send may resolve after navigating away, so only the originating
  // thread's panel is cleared; a panel opened elsewhere in the meantime stays.
  const clearUsageLimitsFor = (threadKey: string) =>
    setUsageLimitsPanel((current) =>
      current !== null && current.threadKey === threadKey ? null : current,
    );
  const userInputToggled =
    userInputToggle !== null && userInputToggle.requestId === activeUserInputRequestId;
  const userInputCollapsed = userInputToggled && userInputToggle.collapsed;
  // A height React sets from keyboard state lags the sticky translation by a Yoga pass and
  // flashes over the nav header on the way up, so the usage panel reserves the keyboard instead.
  const [lastKnownKeyboardHeight, setLastKnownKeyboardHeight] = useState(0);
  if (liveKeyboardHeight > 0 && liveKeyboardHeight !== lastKnownKeyboardHeight) {
    setLastKnownKeyboardHeight(liveKeyboardHeight);
  }
  const reservedKeyboardHeight =
    lastKnownKeyboardHeight > 0 ? lastKnownKeyboardHeight : ESTIMATED_KEYBOARD_HEIGHT;
  // Waiting for a visibility render misses the first keyboard frames.
  const keyboardStickyEnabled = Platform.OS === "ios" || !keyboardStateSuspect;
  const estimatedOverlayHeight = composerOverlapHeight;
  // The overlay height already includes the home-indicator inset, and automatic insets make UIKit
  // add the safe-area bottom again. Report it minus the safe area; ThreadFeed hands LegendList the
  // same delta via contentInsetEndStaticAdjustment.
  const nativeInsetOvercount =
    props.usesAutomaticContentInsets === true && Platform.OS === "ios" ? insets.bottom : 0;
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerOverlayRef,
    Math.max(0, estimatedOverlayHeight - nativeInsetOvercount),
    -nativeInsetOvercount,
    Platform.OS === "ios" ? COMPOSER_TRANSITION_DURATION_MS : 0,
  );
  // Android lays the screen out below its opaque header and reports a zero
  // header height, so the window height overstates the room by the header.
  const [screenHeight, setScreenHeight] = useState<number | null>(null);
  const handleScreenLayout = useCallback((event: LayoutChangeEvent) => {
    setScreenHeight(event.nativeEvent.layout.height);
  }, []);
  const screenAreaHeight = screenHeight ?? windowHeight;
  // The question card reads the keyboard frame on the UI thread, in the same frame the sticky
  // view translates, so it gets the full height while the keyboard is closed and never crosses
  // the header while the keyboard moves.
  const { height: keyboardTranslation } = useReanimatedKeyboardAnimation();
  const pendingUserInputMaxHeight = useDerivedValue(() =>
    derivePendingUserInputMaxHeight({
      windowHeight: screenAreaHeight,
      keyboardHeight: keyboardStickyEnabled ? -keyboardTranslation.value : 0,
      navigationHeaderHeight,
      composerOverlapHeight: composerBottomInset,
    }),
  );
  // The usage panel stacks with the composer and any approval card, so it gets
  // whatever room they leave below the header. Measured only while it is open
  // so typing in the composer does not re-render the screen.
  const usageLimitsOpen = usageLimitsReport !== null && activeUserInputRequestId === null;
  const [usageLimitsLayout, setUsageLimitsLayout] = useState({ overlay: 0, panel: 0 });
  const handleComposerOverlayLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onComposerLayout(event);
      if (!usageLimitsOpen) return;
      const overlay = event.nativeEvent.layout.height;
      setUsageLimitsLayout((current) =>
        current.overlay === overlay ? current : { ...current, overlay },
      );
    },
    [onComposerLayout, usageLimitsOpen],
  );
  const handleUsageLimitsLayout = useCallback((event: LayoutChangeEvent) => {
    const panel = event.nativeEvent.layout.height;
    setUsageLimitsLayout((current) => (current.panel === panel ? current : { ...current, panel }));
  }, []);
  const overlayBesideUsageLimits =
    usageLimitsLayout.overlay > 0
      ? usageLimitsLayout.overlay - usageLimitsLayout.panel
      : composerOverlapHeight;
  // The floor keeps the close row on screen when the stack below leaves no room at all.
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
  // A toggle animates the card; a new request starts expanded at once.
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
  // Collapsing the inset is instant: the sinking card still covers the strip
  // being revealed, and animating the inset downward drifted the short-content
  // end anchor.
  const userInputInsetProgress = useDerivedValue<number>(() => {
    if (userInputMotion === "collapsed") return 0;
    return userInputMotion === "fresh" ? 1 : withTiming(1, USER_INPUT_TOGGLE_TIMING);
  }, [userInputMotion]);
  const userInputCardCoverage = useSharedValue(0);
  const composerPopoverHeight = useSharedValue(0);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const reduceMotion = useReducedMotion();
  // Repin timers fire after the render that scheduled them, so they read follow
  // state from the ref the writers below keep in step with it.
  const endFollowEnabledRef = useRef(true);
  const overlayRepinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleOverlayRepin = (delayMs: number) => {
    if (overlayRepinTimerRef.current !== null) {
      clearTimeout(overlayRepinTimerRef.current);
    }
    overlayRepinTimerRef.current = setTimeout(() => {
      overlayRepinTimerRef.current = null;
      if (!endFollowEnabledRef.current) {
        return;
      }
      void scrollMessageToEnd({ animated: false, closeKeyboard: false }).catch(() => {
        freeze.set(false);
      });
    }, delayMs);
  };
  // LegendList does not re-anchor short followed conversations when floating
  // coverage changes after load. Re-pin each time it settles at a new value;
  // the repin checks follow state so a user who scrolled up stays put.
  const settledFloatingCoverageRef = useRef(0);
  const repinAfterCoverageSettles = (coverage: number) => {
    if (coverage === settledFloatingCoverageRef.current) return;
    settledFloatingCoverageRef.current = coverage;
    scheduleOverlayRepin(50);
  };
  const floatingCoverageTarget = showFloatingStatus ? FLOATING_WORKING_CONTROL_COVERAGE : 0;
  const floatingControlCoverage = useDerivedValue(
    () =>
      withTiming(
        floatingCoverageTarget,
        { duration: 180, reduceMotion: ReduceMotion.System },
        (finished) => {
          if (finished) runOnJS(repinAfterCoverageSettles)(floatingCoverageTarget);
        },
      ),
    [floatingCoverageTarget],
  );
  // Android renders the expanded card in-flow (it cannot hit-test the iOS
  // overlay outside the bar's bounds), so its measured overlay height already
  // includes the card — the coverage extra is iOS-only.
  const userInputCoverageApplies = Platform.OS === "ios" && activeUserInputRequestId !== null;
  const combinedContentInsetEndAdjustment = useSharedValue(
    Math.max(0, estimatedOverlayHeight - nativeInsetOvercount),
  );
  useAnimatedReaction(
    () =>
      contentInsetEndAdjustment.value +
      floatingControlCoverage.value +
      (userInputCoverageApplies ? userInputInsetProgress.value * userInputCardCoverage.value : 0),
    (value) => {
      combinedContentInsetEndAdjustment.set(value);
    },
    [userInputCoverageApplies],
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
  const handleEndFollowEnabledChange = (enabled: boolean) => {
    endFollowEnabledRef.current = enabled;
    setEndFollowEnabled(enabled);
  };
  useEffect(() => {
    if (threadScope.current.signal.aborted) threadScope.current = new AbortController();
    const scope = threadScope.current;
    return () => {
      scope.abort();
      if (overlayRepinTimerRef.current !== null) clearTimeout(overlayRepinTimerRef.current);
    };
  }, []);
  const handleToggleUserInputCollapsed = () => {
    if (activeUserInputRequestId === null) {
      return;
    }
    if (userInputCollapsed) {
      setUserInputToggle({ requestId: activeUserInputRequestId, collapsed: false });
      scheduleOverlayRepin(USER_INPUT_TOGGLE_DURATION_MS + 50);
    } else {
      Keyboard.dismiss();
      setUserInputToggle({ requestId: activeUserInputRequestId, collapsed: true });
      scheduleOverlayRepin(60);
    }
  };
  const showContent = props.showContent ?? true;
  // Showing the thread counts as viewing it, before its live shell arrives too.
  useAtomMount(
    threadVisitTracker(
      showContent && !props.draftMode
        ? { environmentId: props.environmentId, threadId: props.selectedThread.id }
        : null,
    ),
  );
  const layoutVariant = props.layoutVariant ?? "compact";
  const isSplitLayout = layoutVariant === "split";
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
  // Clearing animated width can retain the unfolded width after Android resumes folded.
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
    // Runs only once the send path has validated the draft and is about to deliver it, so an
    // empty submit, a queued-message edit, or `/feedback` leaves approvals alone.
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
              // A draft edited or pasted into during the decline isn't what the user sent.
              stillSendable?.() !== false &&
              // An approval that arrived during the decline would block the redirect; the draft
              // stays so the next send declines it too.
              !currentPendingApprovals().some(
                (approval) =>
                  !approvalsToDecline.some((declined) => declined.requestId === approval.requestId),
              )
            );
          }
        : undefined;
    const messageId = await onSendMessage(followUp, declineBeforeDispatch);
    if (messageId === null || scope.aborted) {
      return messageId;
    }

    clearUsageLimitsFor(targetThreadKey);

    const nextAnchorMessageId = resolveThreadFeedSubmissionAnchor({
      currentAnchorMessageId: anchorMessageId,
      submittedMessageId: messageId,
      hasStartedTurn: props.selectedThread.latestRun !== null,
      hasUserMessage,
      queuedMessageCount: props.selectedThreadQueueCount,
      deliveryDeferred: props.connectionStateLabel !== "connected",
    });
    feedRef.current?.resetEndFollow();
    setAnchorMessageId(nextAnchorMessageId);
    composerEditorRef.current?.blur();
    // The send enqueued the message optimistically, so it is in the feed or
    // the queue by the next frame, once the new anchor has rendered.
    if (nextAnchorMessageId === messageId && contentPresentationKind === "ready") {
      requestAnimationFrame(() => {
        if (scope.aborted) return;
        // Wait for the keyboard to finish dismissing: scrollMessageToEnd freezes
        // keyboard-driven inset updates, and a close event swallowed by that
        // freeze leaves a phantom bottom inset.
        void KeyboardController.dismiss()
          .then(() => {
            // A scroll during the dismissal turns end-follow off; leave the reader where they are.
            if (scope.aborted || !endFollowEnabledRef.current) return;
            return scrollMessageToEnd({ animated: !reduceMotion, closeKeyboard: false });
          })
          .catch(() => {
            if (!scope.aborted) freeze.set(false);
          });
      });
    }
    return messageId;
  };

  const handleEditPendingMessage = async (message: QueuedThreadMessage) => {
    if (pendingMessageEditBlocked) return;
    const scope = threadScope.current.signal;
    if (message.creation) {
      selectThreadRoute({
        draft: {
          environmentId: String(message.environmentId),
          projectId: String(message.creation.projectId),
          pendingTaskId: String(message.messageId),
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

  const handleScrollToEnd = () => {
    void Haptics.selectionAsync();
    void scrollMessageToEnd({ animated: !reduceMotion, closeKeyboard: false }).catch(() => {
      freeze.set(false);
    });
  };

  const showScrollToEndButton =
    !props.draftMode && contentPresentationKind === "ready" && !endFollowEnabled;
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
          screenAreaHeight -
            navigationHeaderHeight -
            liveKeyboardHeight -
            estimatedOverlayHeight -
            24,
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
            <ThreadFeed
              environmentId={props.environmentId}
              threadId={props.selectedThread.id}
              workspaceRoot={props.threadCwd}
              feed={props.selectedThreadFeed}
              pendingHandoff={props.pendingHandoff}
              worktreeSetup={props.worktreeSetup}
              queuedMessages={props.queuedMessages}
              creatingThread={clientCreation !== null}
              dispatchingMessageId={props.dispatchingMessageId}
              // A native subagent has no composer to edit a pending message in;
              // Cancel on the edit banner would discard it.
              onEditPendingMessage={
                isProviderSubagent || pendingMessageEditBlocked ? null : handleEditPendingMessage
              }
              contentPresentation={props.contentPresentation}
              agentLabel={agentLabel}
              threadTitle={props.selectedThread.title}
              latestRun={props.activityRun}
              activeWorkStartedAt={props.activeWorkStartedAt}
              runlessWorkActive={props.runlessWorkActive ?? false}
              listRef={listRef}
              freeze={freeze}
              anchorMessageId={anchorMessageId}
              ref={feedRef}
              contentInsetEndAdjustment={combinedContentInsetEndAdjustment}
              keyboardOffset={composerKeyboardOffset}
              contentTopInset={0}
              contentBottomInset={
                estimatedOverlayHeight +
                (showFloatingStatus ? FLOATING_WORKING_CONTROL_COVERAGE : 0)
              }
              contentMaxWidth={contentMaxWidth}
              historyControls={props.historyControls}
              {...(props.pins ? { pins: props.pins } : {})}
              messageJump={props.messageJump ?? null}
              {...(props.onMessageJumpFailed
                ? { onMessageJumpFailed: props.onMessageJumpFailed }
                : {})}
              contentSideInsets={nativeMetrics?.safeArea}
              layoutVariant={layoutVariant}
              usesAutomaticContentInsets={props.usesAutomaticContentInsets}
              onHeaderMaterialVisibilityChange={props.onHeaderMaterialVisibilityChange}
              onEndFollowEnabledChange={handleEndFollowEnabledChange}
              skills={selectedProviderSkills}
              onUseArtifactTemplate={handleUseArtifactTemplate}
            />
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
          style={{ position: "absolute", bottom: 0, left: 0, right: 0, top: 0 }}
          offset={{ closed: 0, opened: composerKeyboardOffset }}
        >
          <ComposerPopoverHost hidden={composerSlotHidden} popoverHeight={composerPopoverHeight}>
            {/* The fixed sticky host gives this bottom-anchored child a stable
              coordinate space. Its top and height can then animate together
              instead of the auto-sized host jumping to Yoga's destination. */}
            <Animated.View
              layout={COMPOSER_LAYOUT_TRANSITION}
              pointerEvents="box-none"
              style={[
                {
                  position: "absolute",
                  bottom: controlInsets.bottom,
                  left: controlInsets.left,
                  right: controlInsets.right,
                },
                composerWidthStyle,
              ]}
            >
              {/* No paddingTop here: the overlay's measured height becomes the
                list's bottom inset, so any padding above the pill/composer
                pushes the resting content floor up by the same amount. */}
              <View
                ref={composerOverlayRef}
                onLayout={handleComposerOverlayLayout}
                className="w-full"
              >
                <View className="w-full self-center" style={{ maxWidth: contentMaxWidth }}>
                  <FloatingWorkingControl
                    colorScheme={isDarkMode ? "dark" : "light"}
                    status={floatingStatus}
                    lift={floatingControlLift}
                    // The command popover opens over the pill's slot.
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
                  <ChatGptUsageLimitNotice
                    key={`chatgpt-limit:${props.selectedThread.latestRun?.runId}`}
                    thread={props.selectedThread}
                  />
                  {props.feedbackSubmissions.map((submission) => (
                    <ComposerFeedback
                      key={submission.id}
                      submission={submission}
                      onDismiss={() => props.onDismissFeedback(submission.id)}
                    />
                  ))}
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
                        <PendingApprovalCard
                          canOperateThread={props.canOperateThread}
                          approval={props.activePendingApproval}
                          respondingApprovalId={props.respondingApprovalId}
                          onRespond={props.onRespondToApproval}
                        />
                      ) : null}
                      {props.activePendingUserInput ? (
                        <PendingUserInputCard
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
                      {props.draftMode?.controls}
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
                        onShowUsageLimits={showUsageLimits}
                        canSwitchProvider={props.canSwitchThreadProvider}
                        onUpdateModelSelection={props.onUpdateThreadModelSelection}
                        onUpdateRuntimeMode={props.onUpdateThreadRuntimeMode}
                        onExpandedChange={setComposerExpanded}
                        onHeightChange={setComposerHeight}
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
