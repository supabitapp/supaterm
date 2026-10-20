import { Toolbar } from "../../components/ui/Toolbar";
import * as Dialog from "../../components/ui/Dialog";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { clampFileAttachmentUploadBytes } from "@supaterm/client-runtime/state/attachments";
import {
  nextPastedTextFileName,
  pastedTextDisposition,
  replaceTextSelection,
} from "@supaterm/client-runtime/text-paste";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { HeaderHeightContext } from "@react-navigation/elements";
import {
  CommonActions,
  StackActions,
  useFocusEffect,
  useNavigation,
  usePreventRemove,
  type NavigationAction,
} from "@react-navigation/native";
import {
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import * as Haptics from "expo-haptics";
import { Platform, Pressable, ScrollView, View } from "react-native";
import {
  KeyboardController,
  KeyboardStickyView,
  useKeyboardState,
} from "react-native-keyboard-controller";
import Animated, { FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { SYSTEM_FONT_FAMILY } from "../../lib/fonts";
import {
  AuthOrchestrationOperateScope,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  resolveEnvironmentMachineKind,
} from "@supaterm/contracts";

import {
  ComposerEditor,
  type ComposerEditorHandle,
  type ComposerTextPaste,
} from "../../components/ComposerEditor";
import { composerContextImportsAtom } from "../../state/use-composer-drafts";
import {
  composerContextSendBlockReason,
  type ComposerDocumentAttachment,
} from "../../lib/composerContext";
import {
  ComposerActionButton,
  ComposerInlineControl,
  ComposerToolbarRow,
} from "../../components/ComposerToolbar";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { ComposerAttachmentButton } from "./ComposerAttachmentButton";
import { ComposerAttachmentStrip } from "../../components/ComposerAttachmentStrip";
import { composerStripAttachments } from "../../lib/composerImages";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import {
  composerAttachmentUploadBlockReason,
  composerAttachmentsStillUploading,
  composerAttachmentUploadsAtom,
} from "../../state/composer-attachment-uploads";
import { FilePreviewModal, type FilePreviewSource } from "../../components/FilePreviewModal";
import { VideoPreviewModal, type VideoPreviewSource } from "../../components/VideoPreviewModal";
import { ComposerSpeedToggle } from "../../components/ComposerSpeedToggle";
import { ComposerModelControl } from "./ComposerModelControl";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { hasProviderUsageLimits, isUsageLimitsCommand } from "@supaterm/shared/usageLimits";
import { COMPOSER_LAYOUT_TRANSITION } from "../../components/composerLayoutTransition";
import { ComposerSurface } from "./ThreadComposer";
import { ComposerCommandPopover } from "./ComposerCommandPopover";
import { useComposerCommandMenu } from "./use-composer-command-menu";
import {
  ComposerDictationConfirmAction,
  ComposerDictationLeadingAction,
  ComposerDictationStatus,
  ComposerDictationToolbar,
  ComposerDictationTrailingActions,
} from "../voice-input/ComposerDictationControl";
import { useVoiceInputController } from "../voice-input/useVoiceInputController";
import { resolveVoiceComposerPresentation } from "../voice-input/voiceInputPresentation";
import {
  useThreadSettingsSheetPresentation,
  type NavigationWithFinishTransitioning,
} from "./use-thread-settings-sheet-presentation";
import { makeTurnCommandMetadata } from "../../lib/commandMetadata";
import {
  convertPastedImagesToAttachments,
  createPastedTextComposerAttachment,
  pickComposerFiles,
  pickComposerMedia,
  removePersistedComposerAttachmentFile,
  type DraftComposerFileAttachment,
} from "../../lib/composerImages";
import { useScaledTextRole } from "../settings/appearance/useScaledTextRole";
import {
  clearComposerDraftContent,
  captureComposerDraftInsertion,
  countComposerDraftAttachmentsAfterSelection,
  getComposerDraftSnapshot,
  composerDraftsAtom,
  mergeComposerDraftContent,
  restoreComposerDraftSnapshot,
  setStickyNewTaskProject,
  updateComposerDraftSettings,
  scheduleUnusedComposerAttachmentCleanup,
  type ComposerDraft,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { useEnvironmentServerConfig, useProjects, useThreadShells } from "../../state/entities";
import { useProjectClone } from "../../state/projectClones";
import { projectEnvironment } from "../../state/projects";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectCloneBanner } from "./ProjectCloneBanner";
import {
  describeUnavailableModelSelection,
  isModelSelectionUnavailable,
  resolveSelectableModelSelection,
} from "../../lib/modelOptions";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { useNewTaskFlow } from "./new-task-flow-provider";
import {
  nextEnvironmentId,
  useHardwareKeyboardCommand,
} from "../keyboard/hardwareKeyboardCommands";
import { resolveProjectThreadCreationBranch } from "./projectThreadCreationValidation";
import { resolveDraftProjectSelection } from "./new-task-project-selection";
import {
  resolveNewTaskBranchLabel,
  resolveNewTaskWorkspaceLabel,
} from "./new-task-context-presentation";
import { useIncomingShare } from "../sharing/IncomingShareProvider";
import { selectIncomingShareAttachmentsForServer } from "../sharing/incoming-share-model";
import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { fileRoutePathSegments } from "../files/filePath";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { IOS_NAV_BAR_HEIGHT } from "../../lib/layoutMetrics";

function NewTaskWorkspaceIcon(props: {
  readonly workspaceMode: "local" | "worktree";
  readonly worktreePath: string | null;
  readonly size: number;
}) {
  if (props.workspaceMode === "local" && props.worktreePath === null) {
    return (
      <SymbolView
        name="folder"
        size={props.size}
        tintColorClassName="accent-icon-muted"
        type="monochrome"
      />
    );
  }

  const boxSize = (14 * props.size) / 16;
  return (
    <View
      className="size-4"
      style={Platform.OS === "android" ? { width: boxSize, height: boxSize } : undefined}
    >
      <SymbolView
        name="folder"
        size={props.size}
        tintColorClassName="accent-icon-muted"
        type="monochrome"
      />
      <View
        className="absolute -right-1 -bottom-1"
        style={
          Platform.OS === "android" ? { right: -boxSize / 4, bottom: -boxSize / 4 } : undefined
        }
      >
        <SymbolView
          name="arrow.triangle.branch"
          size={Math.round((9 * props.size) / 16)}
          tintColorClassName="accent-icon-muted"
          type="monochrome"
        />
      </View>
    </View>
  );
}

export function NewTaskDraftScreen(props: {
  readonly initialProjectRef?: {
    readonly environmentId?: string;
    readonly projectId?: string;
    readonly branch?: string | null;
    readonly worktreePath?: string | null;
    readonly cloning?: boolean;
  };
  readonly pendingTaskId?: string;
  readonly draftId?: string;
  readonly incomingShareId?: string;
}) {
  const projects = useProjects();
  const flow = useNewTaskFlow();
  const navigation = useNavigation();
  const {
    consumeShare,
    getShare,
    isLoading: isIncomingShareInboxLoading,
    releaseShareReservation,
    reserveShare,
  } = useIncomingShare();
  const insets = useSafeAreaInsets();
  const isKeyboardVisible = useKeyboardState((state) => state.isVisible);
  const keyboardHeight = useKeyboardState((state) => state.height);
  const headerHeight = useContext(HeaderHeightContext) ?? insets.top + IOS_NAV_BAR_HEIGHT;
  const [viewportHeight, setViewportHeight] = useState(0);
  const controlsBottomPadding = Math.max(insets.bottom, 10);
  const keyboardOpenedOffset = Math.max(0, controlsBottomPadding - 8);
  const headerOverlap = Platform.OS === "ios" && NATIVE_LIQUID_GLASS_SUPPORTED ? headerHeight : 0;
  const availableDockHeight =
    viewportHeight > 0
      ? Math.max(
          0,
          viewportHeight -
            keyboardHeight -
            headerOverlap +
            (isKeyboardVisible ? keyboardOpenedOffset : 0),
        )
      : undefined;
  const { projectScopes, selectedProject, selectedProjectKey, setProject } = flow;
  const selectedProjectLabel = (() => {
    if (!selectedProject) return null;
    const scope = projectScopes.find((candidate) =>
      candidate.projectRefs.some(
        (ref) =>
          ref.environmentId === selectedProject.environmentId &&
          ref.projectId === selectedProject.id,
      ),
    );
    return scope?.title ?? selectedProject.title;
  })();
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const selectedEnvironmentServerConfig = useEnvironmentServerConfig(
    selectedProject?.environmentId ?? null,
  );
  const environmentConnected =
    selectedProject !== null &&
    connectedEnvironments.find(
      (environment) => environment.environmentId === selectedProject.environmentId,
    )?.connectionState === "connected";
  const canOperate = useEnvironmentScope(
    selectedProject?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const taskPermissionReason =
    environmentConnected && !canOperate ? "This connection cannot start tasks." : null;
  const modelUnavailable = environmentConnected && flow.selectedModelOption?.isUnavailable === true;
  const projectCloneState = useProjectClone(
    selectedProject
      ? { environmentId: selectedProject.environmentId, projectId: selectedProject.id }
      : null,
  );
  const projectClone = projectCloneState === "pending" ? null : projectCloneState;
  const awaitingKnownClone =
    projectCloneState === "pending" &&
    props.initialProjectRef?.cloning === true &&
    selectedProject !== null &&
    selectedProject.id === props.initialProjectRef.projectId &&
    selectedProject.environmentId === props.initialProjectRef.environmentId;
  const cloneBlocksStart =
    awaitingKnownClone || (projectClone !== null && projectClone.phase !== "done");
  const cancelProjectClone = useAtomCommand(sourceControlEnvironment.cancelProjectClone, {
    reportFailure: false,
  });
  const retryProjectClone = useAtomCommand(sourceControlEnvironment.retryProjectClone, {
    reportFailure: false,
  });
  const runCloneAction = async (
    title: string,
    action: () => Promise<AsyncResult.AsyncResult<unknown, unknown>>,
  ) => {
    const result = await action();
    if (AsyncResult.isFailure(result)) {
      const error = Cause.squash(result.cause);
      Dialog.alert(title, error instanceof Error ? error.message : "An error occurred.");
    }
  };
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const selectedProjectRef = useRef(selectedProject);
  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);
  const removeClonedProject = async () => {
    if (!selectedProject) return;
    const removed = selectedProject;
    const result = await deleteProject({
      environmentId: removed.environmentId,
      input: { projectId: removed.id },
    });
    if (AsyncResult.isFailure(result)) {
      const error = Cause.squash(result.cause);
      Dialog.alert(
        "Failed to remove project",
        error instanceof Error ? error.message : "An error occurred.",
      );
      return;
    }
    const current = selectedProjectRef.current;
    if (current?.id === removed.id && current.environmentId === removed.environmentId) {
      navigation.dispatch(StackActions.replace("Home"));
    }
  };
  const uploadStates = useAtomValue(composerAttachmentUploadsAtom);
  const attachmentBlockReason = selectedProject
    ? composerAttachmentUploadBlockReason({
        environmentId: selectedProject.environmentId,
        attachments: flow.attachments,
        connected: environmentConnected,
        serverConfig: selectedEnvironmentServerConfig,
        states: uploadStates,
      })
    : null;
  const attachmentsUploading =
    environmentConnected &&
    selectedProject !== null &&
    composerAttachmentsStillUploading({
      environmentId: selectedProject.environmentId,
      attachments: flow.attachments,
      serverConfig: selectedEnvironmentServerConfig,
      states: uploadStates,
    });
  const queuesInsteadOfStarting = !environmentConnected || attachmentsUploading;
  const promptInputRef = useRef<ComposerEditorHandle>(null);
  const composerDockRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const loadedBranchesProjectKeyRef = useRef<string | null>(null);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const keepFocusedComposerVisible = () => {
    if (isComposerFocused) {
      composerDockRef.current?.scrollToEnd({ animated: false });
    }
  };
  useEffect(keepFocusedComposerVisible, [keepFocusedComposerVisible]);
  const [previewVideo, setPreviewVideo] = useState<VideoPreviewSource | null>(null);
  const [previewFile, setPreviewFile] = useState<FilePreviewSource | null>(null);
  const wasFocusedBeforePreviewRef = useRef(false);
  const openVideoPreview = (attachment: DraftComposerFileAttachment, sourceIdentifier: string) => {
    wasFocusedBeforePreviewRef.current = isComposerFocused;
    setPreviewFile(null);
    setPreviewVideo((current) => current ?? { type: "local", attachment, sourceIdentifier });
  };
  const openFilePreview = (source: FilePreviewSource) => {
    wasFocusedBeforePreviewRef.current = isComposerFocused;
    setPreviewVideo(null);
    setPreviewFile((current) => current ?? source);
  };
  const closeMediaPreview = () => {
    setPreviewVideo(null);
    setPreviewFile(null);
    if (wasFocusedBeforePreviewRef.current) {
      setTimeout(() => {
        if (navigation.isFocused()) promptInputRef.current?.focus();
      }, 100);
    }
  };
  const settingsSheetPresentation = useThreadSettingsSheetPresentation({
    editorRef: promptInputRef,
    isEditorFocused: isComposerFocused,
  });
  useEffect(() => {
    if (Platform.OS !== "ios") {
      return;
    }

    navigation.getParent()?.setOptions({ gestureEnabled: !isKeyboardVisible });
  }, [isKeyboardVisible, navigation]);
  useEffect(() => {
    return () => {
      if (Platform.OS === "ios") {
        navigation.getParent()?.setOptions({ gestureEnabled: true });
      }
    };
  }, [navigation]);
  const settingsRoutePresentedRef = useRef(false);
  const { onDismissed: onSettingsSheetDismissed } = settingsSheetPresentation;
  useEffect(() => {
    if (!settingsSheetPresentation.isVisible || settingsRoutePresentedRef.current) {
      return;
    }

    settingsRoutePresentedRef.current = true;
    navigation.dispatch(StackActions.push("ThreadSettings"));
  }, [navigation, settingsSheetPresentation.isVisible]);
  useFocusEffect(() => {
    if (!settingsRoutePresentedRef.current) {
      return;
    }

    settingsRoutePresentedRef.current = false;
    onSettingsSheetDismissed();
  });
  useEffect(
    () =>
      // UIKit's completion callback for the sheet dismissal, surfaced by the
      // native-stack patch. This is when the queued keyboard restore runs.
      (navigation as unknown as NavigationWithFinishTransitioning).addListener(
        "finishTransitioning",
        settingsSheetPresentation.onStackTransitionsFinished,
      ),
    [navigation, settingsSheetPresentation.onStackTransitionsFinished],
  );
  const [importingShareKey, setImportingShareKey] = useState<string | null>(null);
  const [isCancellingShareImport, setIsCancellingShareImport] = useState(false);
  const [cancelledIncomingShareId, setCancelledIncomingShareId] = useState<string | null>(null);
  const [isReturningToProjectPicker, setIsReturningToProjectPicker] = useState(false);
  const [submitNavigationAction, setSubmitNavigationAction] = useState<NavigationAction | null>(
    null,
  );
  const [shareImportAttempt, setShareImportAttempt] = useState(0);
  const startedShareImportKeyRef = useRef<string | null>(null);
  const cancellingShareImportKeyRef = useRef<string | null>(null);
  const shareImportDraftBackupRef = useRef(new Map<string, ComposerDraft>());
  const activeShareImportTokenRef = useRef<symbol | null>(null);
  const shareImportMountedRef = useRef(true);
  const pendingPastedTextAttachmentCountRef = useRef(0);
  const [pendingPastedTextAttachmentCount, setPendingPastedTextAttachmentCount] = useState(0);
  const pastedTextFileNamesRef = useRef<{ draftKey: string | null; names: Set<string> }>({
    draftKey: null,
    names: new Set(),
  });

  const isCurrentShareImport = useEffectEvent(
    (draftKey: string, shareId: string) =>
      flow.draftKey === draftKey && props.incomingShareId === shareId,
  );
  const latestDraftKeyRef = useRef(flow.draftKey);
  const latestIncomingShareIdRef = useRef(props.incomingShareId);
  useLayoutEffect(() => {
    latestDraftKeyRef.current = flow.draftKey;
    latestIncomingShareIdRef.current = props.incomingShareId;
  });
  const isImportingShare = importingShareKey !== null;
  const alertedUnavailableIncomingShareIdRef = useRef<string | null>(null);
  // The share this screen already moved into its draft. Sending clears the
  // draft (and its importedShareIds receipt) a frame before the screen leaves,
  // and the inbox entry is long gone by then; without this the re-render in
  // between reads as "shared content vanished" and alerts on every send.
  const [consumedIncomingShareId, setConsumedIncomingShareId] = useState<string | null>(null);
  const incomingShare = props.incomingShareId ? getShare(props.incomingShareId) : null;
  const requestedInitialProjectAvailable = Boolean(
    props.initialProjectRef?.environmentId &&
    props.initialProjectRef.projectId &&
    projects.some(
      (project) =>
        project.environmentId === props.initialProjectRef?.environmentId &&
        project.id === props.initialProjectRef?.projectId,
    ),
  );
  const shouldReturnToProjectPicker = Boolean(
    !props.pendingTaskId &&
    !props.draftId &&
    props.initialProjectRef?.environmentId &&
    props.initialProjectRef.projectId &&
    !requestedInitialProjectAvailable &&
    projects.length > 0,
  );
  if (shouldReturnToProjectPicker && !isReturningToProjectPicker) {
    setIsReturningToProjectPicker(true);
  } else if (isReturningToProjectPicker && requestedInitialProjectAvailable) {
    setIsReturningToProjectPicker(false);
  }
  const isProjectPickerReturnActive =
    isReturningToProjectPicker && !requestedInitialProjectAvailable;
  const isIncomingShareAwaitingServerConfig = Boolean(
    incomingShare?.attachments.some((attachment) => attachment.type === "file") &&
    selectedEnvironmentServerConfig === null,
  );
  const isIncomingShareTransferPending = Boolean(
    incomingShare &&
    cancelledIncomingShareId !== props.incomingShareId &&
    !isIncomingShareAwaitingServerConfig,
  );
  const contextImports = useAtomValue(composerContextImportsAtom);
  const isImportingContext = flow.draftKey ? contextImports[flow.draftKey] === true : false;
  const isComposerBusy = isIncomingShareTransferPending || flow.submitting || isImportingContext;
  const isComposerInteractionLocked = isComposerBusy || flow.switchingToEnvironmentId !== null;
  const providerOptionDescriptors = resolveProviderOptionDescriptors({
    capabilities: flow.selectedModelOption?.capabilities,
    selections: flow.selectedModel?.options,
  });
  const { environments, selectedEnvironmentId, switchEnvironment, switchingToEnvironmentId } = flow;
  const cycleEnvironment = () => {
    if (isComposerBusy) return true;
    const next = nextEnvironmentId(environments, switchingToEnvironmentId ?? selectedEnvironmentId);
    if (next !== null) void switchEnvironment(next);
    return true;
  };
  const cycleEnvironmentCommands = environments.length > 1 ? (["cycleHost"] as const) : [];
  useHardwareKeyboardCommand(cycleEnvironmentCommands, cycleEnvironment);
  const offersUsageLimits =
    flow.selectedProviderStatus !== null &&
    hasProviderUsageLimits(
      flow.selectedProviderStatus.driver,
      selectedEnvironmentServerConfig?.providers ?? [],
    );
  const composerWorkspaceCwd =
    (flow.workspaceMode === "worktree"
      ? selectedProject?.workspaceRoot
      : (flow.selectedWorktreePath ?? selectedProject?.workspaceRoot)) || null;
  const stripAttachments = composerStripAttachments(flow.attachments);
  const composerMenu = useComposerCommandMenu({
    draftMessage: flow.prompt,
    ownerKey: flow.draftKey,
    environmentId: selectedProject?.environmentId ?? null,
    threadShells: useThreadShells(),
    pullRequestProjectId:
      selectedEnvironmentServerConfig != null ? (selectedProject?.id ?? null) : null,
    pullRequestRepository: selectedProject?.repositoryIdentity?.displayName ?? null,
    projectCwd: composerWorkspaceCwd,
    selectedProviderStatus: flow.selectedProviderStatus,
    hasThread: false,
    hasCompactableConversation: false,
    offersUsageLimits: offersUsageLimits,
    enabled: isComposerFocused && !isComposerInteractionLocked,
    onChangeDraftMessage: flow.setPrompt,
  });
  const dictationDisabled = isIncomingShareTransferPending || isImportingShare || flow.submitting;
  const voiceInput = useVoiceInputController({
    ownerKey: flow.draftKey,
    label: selectedProjectLabel ? `New task in ${selectedProjectLabel}` : "New task",
    readDraftMessage: () => (flow.draftKey ? getComposerDraftSnapshot(flow.draftKey).text : null),
    subscribeToDraftChanges: (onChange) => appAtomRegistry.subscribe(composerDraftsAtom, onChange),
    selection: composerMenu.selection,
    disabled: dictationDisabled,
    onChangeDraftMessage: flow.setPrompt,
    onChangeSelection: composerMenu.onSelectionChange,
    onSubmit: () => {
      if (canStart) void handleStart();
    },
  });
  const voicePresentation = resolveVoiceComposerPresentation(
    voiceInput.state,
    voiceInput.elapsedSeconds,
  );
  const isVoiceInputPresented = voicePresentation.statusLabel !== null;
  const startDictation = () => {
    promptInputRef.current?.blur();
    voiceInput.start();
  };
  const preventRemove =
    (isIncomingShareTransferPending && !isProjectPickerReturnActive) ||
    isCancellingShareImport ||
    flow.submitting;
  usePreventRemove(preventRemove, () => undefined);
  useEffect(() => {
    if (preventRemove || submitNavigationAction === null) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      setSubmitNavigationAction(null);
      (navigation.getParent() ?? navigation).dispatch(submitNavigationAction);
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, preventRemove, submitNavigationAction]);
  const hasImportedIncomingShare = Boolean(
    props.incomingShareId &&
    (consumedIncomingShareId === props.incomingShareId ||
      (flow.draftKey &&
        getComposerDraftSnapshot(flow.draftKey).importedShareIds?.includes(props.incomingShareId))),
  );
  const isIncomingShareUnavailable = Boolean(
    props.incomingShareId &&
    !isIncomingShareInboxLoading &&
    !incomingShare &&
    !hasImportedIncomingShare,
  );
  const isIncomingShareReady =
    !props.incomingShareId ||
    (hasImportedIncomingShare && !incomingShare) ||
    isIncomingShareUnavailable;
  const hasContent = flow.prompt.trim().length > 0 || flow.attachments.length > 0;
  const canSubmitDraft =
    !isComposerInteractionLocked &&
    !cloneBlocksStart &&
    taskPermissionReason === null &&
    attachmentBlockReason === null &&
    !modelUnavailable &&
    Boolean(flow.selectedProject) &&
    Boolean(flow.selectedModel) &&
    isIncomingShareReady &&
    !isImportingShare &&
    pendingPastedTextAttachmentCount === 0;
  const canStart = canSubmitDraft && hasContent && !voiceInput.blocksSubmission;
  const startTaskLabel =
    taskPermissionReason ??
    attachmentBlockReason ??
    (cloneBlocksStart
      ? projectClone === null || projectClone.phase === "running"
        ? "Cloning repository"
        : "Repository not cloned"
      : pendingPastedTextAttachmentCount > 0
        ? "Attaching pasted text"
        : flow.submitting
          ? "Starting task"
          : attachmentsUploading
            ? "Queue task, sends when uploads finish"
            : environmentConnected
              ? "Start task"
              : "Queue task");
  const appliedInitialProjectKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (cancelledIncomingShareId === props.incomingShareId) {
      navigation.goBack();
    }
  }, [cancelledIncomingShareId, navigation, props.incomingShareId]);
  useEffect(() => {
    if (!isProjectPickerReturnActive) {
      return;
    }
    // Let usePreventRemove commit its disabled state before replacing this
    // route, otherwise the transfer guard can swallow the fallback action.
    const frame = requestAnimationFrame(() => {
      navigation.dispatch(
        StackActions.replace("NewTask", { incomingShareId: props.incomingShareId }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [isProjectPickerReturnActive, navigation, props.incomingShareId]);
  useEffect(() => {
    if (!shareImportMountedRef.current) {
      startedShareImportKeyRef.current = null;
    }
    shareImportMountedRef.current = true;
    return () => {
      appliedInitialProjectKeyRef.current = null;
      shareImportMountedRef.current = false;
      activeShareImportTokenRef.current = null;
      cancellingShareImportKeyRef.current = null;
    };
  }, []);

  const { beginEditingPendingTask, cancelEditingPendingTask, editingPendingTask, openDraft } = flow;
  // Drafts hydrate from disk and projects arrive with the shell snapshot, so on
  // a cold launch the draft or its project can be missing for a moment; wait
  // for hydration and retry while projects load.
  const attemptedDraftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!props.draftId || props.pendingTaskId) {
      return;
    }
    const draftId = props.draftId;
    if (attemptedDraftIdRef.current === draftId) {
      return;
    }
    let cancelled = false;
    void waitForComposerDraftsLoaded().then(() => {
      if (cancelled || attemptedDraftIdRef.current === draftId) {
        return;
      }
      if (openDraft(draftId)) {
        attemptedDraftIdRef.current = draftId;
        return;
      }
      if (getComposerDraftSnapshot(draftId).project !== undefined && projects.length === 0) {
        return;
      }
      attemptedDraftIdRef.current = draftId;
      navigation.dispatch(StackActions.replace("NewTask"));
    });
    return () => {
      cancelled = true;
    };
  }, [navigation, openDraft, projects, props.draftId, props.pendingTaskId]);

  const attemptedPendingTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!props.pendingTaskId || editingPendingTask?.messageId === props.pendingTaskId) {
      return;
    }
    if (attemptedPendingTaskIdRef.current === props.pendingTaskId) {
      return;
    }
    attemptedPendingTaskIdRef.current = props.pendingTaskId;
    if (!beginEditingPendingTask(props.pendingTaskId)) {
      navigation.dispatch(StackActions.replace("NewTask"));
    }
  }, [beginEditingPendingTask, editingPendingTask?.messageId, navigation, props.pendingTaskId]);

  useEffect(() => {
    if (!props.pendingTaskId) return;
    return () => {
      attemptedPendingTaskIdRef.current = null;
      cancelEditingPendingTask();
    };
  }, [props.pendingTaskId, cancelEditingPendingTask]);

  const theme = useUniwindTheme();
  const foregroundColor = theme["--color-foreground"];
  const bodyText = useScaledTextRole("body");

  const lastInitialProjectRefRef = useRef(props.initialProjectRef);

  useEffect(() => {
    if (props.pendingTaskId || props.draftId) {
      return;
    }
    if (lastInitialProjectRefRef.current !== props.initialProjectRef) {
      lastInitialProjectRefRef.current = props.initialProjectRef;
      appliedInitialProjectKeyRef.current = null;
    }
    const initialEnvironmentId = props.initialProjectRef?.environmentId;
    const initialProjectId = props.initialProjectRef?.projectId;
    if (initialEnvironmentId && initialProjectId) {
      const directProject =
        projects.find(
          (project) =>
            project.environmentId === initialEnvironmentId && project.id === initialProjectId,
        ) ?? null;

      if (directProject) {
        // Apply the route's project once. Re-applying on every change would
        // instantly revert environment/project switches made in the picker.
        const directProjectKey = `${directProject.environmentId}:${directProject.id}`;
        if (appliedInitialProjectKeyRef.current === directProjectKey) {
          return;
        }
        if (props.initialProjectRef?.branch) {
          if (
            selectedProject?.environmentId !== directProject.environmentId ||
            selectedProject.id !== directProject.id
          ) {
            setProject(directProject);
            return;
          }
          if (!flow.draftKey) return;
          // The route completes checkout before mounting this composer. Local
          // mode reuses an existing worktree; worktree mode would create another.
          updateComposerDraftSettings(flow.draftKey, {
            workspaceSelection: {
              mode: "local",
              branch: props.initialProjectRef.branch,
              worktreePath: props.initialProjectRef.worktreePath ?? null,
              startFromOrigin: false,
            },
          });
        }
        appliedInitialProjectKeyRef.current = directProjectKey;
        // Recorded here too: when the route's project is already the
        // provider's fallback selection, setProject below is skipped.
        setStickyNewTaskProject({
          environmentId: directProject.environmentId,
          projectId: directProject.id,
        });
        if (
          selectedProject?.environmentId === directProject.environmentId &&
          selectedProject.id === directProject.id
        ) {
          return;
        }
        setProject(directProject);
        return;
      }
      return;
    }

    const selection = resolveDraftProjectSelection(selectedProjectKey, projects, projectScopes);
    if (selection.kind === "preserve") {
      return;
    }
    if (selection.kind === "select") {
      setProject(selection.project);
      return;
    }

    navigation.dispatch(StackActions.replace("NewTask"));
  }, [
    projectScopes,
    projects,
    flow.draftKey,
    props.initialProjectRef,
    props.pendingTaskId,
    props.draftId,
    navigation,
    selectedProject,
    selectedProjectKey,
    setProject,
  ]);

  const { loadBranches } = flow;
  useEffect(() => {
    if (!selectedProject) {
      loadedBranchesProjectKeyRef.current = null;
      return;
    }
    const projectKey = `${selectedProject.environmentId}:${selectedProject.id}`;
    if (loadedBranchesProjectKeyRef.current === projectKey) {
      return;
    }
    loadedBranchesProjectKeyRef.current = projectKey;
    loadBranches();
  }, [loadBranches, selectedProject]);

  useEffect(() => {
    const shareId = props.incomingShareId;
    const draftKey = flow.draftKey;
    const destinationProject = selectedProject;
    const initialEnvironmentId = props.initialProjectRef?.environmentId;
    const initialProjectId = props.initialProjectRef?.projectId;
    const selectedProjectMatchesRoute =
      !initialEnvironmentId ||
      !initialProjectId ||
      (destinationProject?.environmentId === initialEnvironmentId &&
        destinationProject.id === initialProjectId);
    if (
      !shareId ||
      !draftKey ||
      !destinationProject ||
      !selectedProjectMatchesRoute ||
      cancelledIncomingShareId === shareId
    ) {
      return;
    }
    const importKey = `${shareId}:${draftKey}`;
    if (
      startedShareImportKeyRef.current === importKey ||
      cancellingShareImportKeyRef.current === importKey
    ) {
      return;
    }

    if (!incomingShare) {
      if (
        !isIncomingShareInboxLoading &&
        !hasImportedIncomingShare &&
        alertedUnavailableIncomingShareIdRef.current !== shareId
      ) {
        alertedUnavailableIncomingShareIdRef.current = shareId;
        Dialog.alert(
          "Shared content unavailable",
          "The shared content is no longer in the inbox. You can continue editing this task draft.",
        );
      }
      return;
    }

    if (
      incomingShare.attachments.some((attachment) => attachment.type === "file") &&
      selectedEnvironmentServerConfig === null
    ) {
      return;
    }

    if (alertedUnavailableIncomingShareIdRef.current === shareId) {
      alertedUnavailableIncomingShareIdRef.current = null;
    }
    startedShareImportKeyRef.current = importKey;
    const draftBackup =
      shareImportDraftBackupRef.current.get(importKey) ?? getComposerDraftSnapshot(draftKey);
    shareImportDraftBackupRef.current.set(importKey, draftBackup);
    const importToken = Symbol(`${importKey}#${shareImportAttempt}`);
    let didReserveShare = false;
    let didConsumeShare = false;
    let needsDraftRestore = false;
    activeShareImportTokenRef.current = importToken;
    void (async () => {
      setImportingShareKey(importKey);
      await reserveShare(shareId, {
        environmentId: String(destinationProject.environmentId),
        projectId: String(destinationProject.id),
      });
      didReserveShare = true;
      if (
        !shareImportMountedRef.current ||
        activeShareImportTokenRef.current !== importToken ||
        !isCurrentShareImport(draftKey, shareId)
      ) {
        return;
      }
      const selectedAttachments = selectIncomingShareAttachmentsForServer({
        attachments: incomingShare.attachments,
        serverConfig: appAtomRegistry.get(
          serverEnvironment.configValueAtom(destinationProject.environmentId),
        ),
      });
      if (selectedAttachments.status === "pending") {
        throw new Error("Server attachment support is still loading.");
      }
      needsDraftRestore = true;
      const { skippedAttachmentCount } = await mergeComposerDraftContent(draftKey, {
        text: incomingShare.text,
        attachments: selectedAttachments.attachments,
        sourceShareId: shareId,
      });
      if (
        !shareImportMountedRef.current ||
        activeShareImportTokenRef.current !== importToken ||
        !isCurrentShareImport(draftKey, shareId)
      ) {
        // The durable reservation makes an interrupted transfer resume only
        // in this project instead of copying into a second project draft.
        return;
      }
      await consumeShare(shareId);
      didConsumeShare = true;
      setConsumedIncomingShareId(shareId);
      // The consumed inbox draft was the last owner of files that never made
      // it into the composer draft (unsupported server, oversize, limit
      // skips). Release them before any early return: an unmount or a
      // superseding import must not leak them, and the sweep re-checks
      // ownership so it cannot delete a file another draft picked up.
      const retainedAttachmentIds = new Set(
        getComposerDraftSnapshot(draftKey).attachments.map((attachment) => attachment.id),
      );
      scheduleUnusedComposerAttachmentCleanup(
        incomingShare.attachments.filter((attachment) => !retainedAttachmentIds.has(attachment.id)),
      );
      if (!shareImportMountedRef.current || activeShareImportTokenRef.current !== importToken) {
        return;
      }
      const warnings = [...incomingShare.warnings, ...selectedAttachments.warnings];
      if (skippedAttachmentCount > 0) {
        warnings.push(
          `${skippedAttachmentCount} shared file${skippedAttachmentCount === 1 ? " was" : "s were"} skipped because this draft reached the attachment limit.`,
        );
      }
      if (warnings.length > 0) {
        Dialog.alert("Some shared content was skipped", warnings.join("\n"));
      }
      shareImportDraftBackupRef.current.delete(importKey);
    })()
      .catch((error) => {
        if (!shareImportMountedRef.current || activeShareImportTokenRef.current !== importToken) {
          return;
        }
        Dialog.alert(
          "Could not import shared content",
          error instanceof Error ? error.message : "The shared content could not be saved.",
          [
            {
              text: "Cancel import",
              style: "cancel",
              onPress: () => {
                const cancelImport = async (): Promise<void> => {
                  if (!shareImportMountedRef.current) {
                    return;
                  }
                  // Latch synchronously before restoring the draft. The
                  // restore publishes atom state and can re-run the import
                  // effect before React commits the cancelling state update.
                  cancellingShareImportKeyRef.current = importKey;
                  setIsCancellingShareImport(true);
                  try {
                    if (needsDraftRestore) {
                      // The restore drops the share's merged-in attachments
                      // from the draft. Sweep them only when the inbox entry
                      // was consumed: before that, the inbox still references
                      // these files and must keep them for a later import.
                      const mergedAttachments = getComposerDraftSnapshot(draftKey).attachments;
                      await restoreComposerDraftSnapshot(draftKey, draftBackup);
                      needsDraftRestore = false;
                      if (didConsumeShare) {
                        scheduleUnusedComposerAttachmentCleanup(mergedAttachments);
                      }
                    }
                    if (didReserveShare) {
                      await releaseShareReservation(shareId, {
                        environmentId: String(destinationProject.environmentId),
                        projectId: String(destinationProject.id),
                      });
                    }
                    shareImportDraftBackupRef.current.delete(importKey);
                    if (shareImportMountedRef.current) {
                      setIsCancellingShareImport(false);
                      setCancelledIncomingShareId(shareId);
                    }
                  } catch (cancelError) {
                    if (!shareImportMountedRef.current) {
                      return;
                    }
                    Dialog.alert(
                      "Could not cancel import",
                      cancelError instanceof Error
                        ? cancelError.message
                        : "The shared content could not be restored safely.",
                      [
                        {
                          text: "Retry import",
                          onPress: () => {
                            cancellingShareImportKeyRef.current = null;
                            setIsCancellingShareImport(false);
                            setShareImportAttempt((attempt) => attempt + 1);
                          },
                        },
                        {
                          text: "Retry cancel",
                          onPress: () => void cancelImport(),
                        },
                      ],
                      { cancelable: false },
                    );
                  }
                };
                void cancelImport();
              },
            },
            {
              text: "Retry",
              onPress: () => setShareImportAttempt((attempt) => attempt + 1),
            },
          ],
          { cancelable: false },
        );
      })
      .finally(() => {
        if (startedShareImportKeyRef.current === importKey) {
          startedShareImportKeyRef.current = null;
        }
        if (shareImportMountedRef.current && activeShareImportTokenRef.current === importToken) {
          activeShareImportTokenRef.current = null;
          setImportingShareKey(null);
        }
      });
  }, [
    consumeShare,
    cancelledIncomingShareId,
    flow.draftKey,
    hasImportedIncomingShare,
    incomingShare,
    isIncomingShareInboxLoading,
    props.incomingShareId,
    props.initialProjectRef?.environmentId,
    props.initialProjectRef?.projectId,
    releaseShareReservation,
    reserveShare,
    selectedEnvironmentServerConfig,
    selectedProject,
    shareImportAttempt,
  ]);

  const selectedEnvironmentLabel =
    flow.environments.find(
      (environment) => environment.environmentId === flow.selectedEnvironmentId,
    )?.environmentLabel ?? "Environment";
  const selectedBranchName = resolveProjectThreadCreationBranch({
    workspaceMode: flow.workspaceMode,
    selectedBranch:
      flow.selectedBranchName ??
      (flow.workspaceMode === "worktree" ? flow.defaultBaseBranchName : null),
    currentCheckoutBranch: flow.currentCheckoutBranchName,
  });
  const selectedBranchLabel = resolveNewTaskBranchLabel({
    branchName: selectedBranchName,
    startFromOrigin: flow.startFromOrigin,
    workspaceMode: flow.workspaceMode,
    pullRequestReference: flow.pullRequestReference,
  });
  const workspaceLabel = resolveNewTaskWorkspaceLabel({
    workspaceMode: flow.workspaceMode,
    worktreePath: flow.selectedWorktreePath,
  });
  const showBranchLoading =
    environmentConnected && flow.branchesLoading && flow.availableBranches.length === 0;

  async function handlePickMedia(): Promise<void> {
    if (isComposerInteractionLocked || voiceInput.isBusy) {
      return;
    }
    const capabilities = selectedEnvironmentServerConfig?.environment.capabilities;
    const insertion = flow.draftKey ? captureComposerDraftInsertion(flow.draftKey) : undefined;
    const result = await pickComposerMedia({
      existingCount:
        flow.draftKey && insertion
          ? countComposerDraftAttachmentsAfterSelection(flow.draftKey, insertion)
          : flow.attachments.length,
      maxVideoBytes: capabilities?.fileAttachments?.maxUploadBytes,
    });
    const rejectedCount =
      result.attachments.length > 0 ? flow.appendAttachments(result.attachments, insertion) : 0;
    const problems = [
      ...(result.error ? [result.error] : []),
      ...(rejectedCount > 0
        ? [`You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments per message.`]
        : []),
    ];
    if (problems.length > 0) {
      Dialog.alert("Could not attach photo or video", problems.join("\n\n"));
    }
  }

  async function handlePickFiles(): Promise<void> {
    if (isComposerInteractionLocked || voiceInput.isBusy) {
      return;
    }
    const maxBytes =
      selectedEnvironmentServerConfig?.environment.capabilities.fileAttachments?.maxUploadBytes;
    if (maxBytes === undefined) {
      Dialog.alert("File attachments are not available on this server.");
      return;
    }
    const insertion = flow.draftKey ? captureComposerDraftInsertion(flow.draftKey) : undefined;
    const result = await pickComposerFiles({
      existingCount:
        flow.draftKey && insertion
          ? countComposerDraftAttachmentsAfterSelection(flow.draftKey, insertion)
          : flow.attachments.length,
      maxBytes,
    });
    const rejectedCount =
      result.files.length > 0 ? flow.appendAttachments(result.files, insertion) : 0;
    const problems = [
      ...(result.error ? [result.error] : []),
      ...(rejectedCount > 0
        ? [`You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`]
        : []),
    ];
    if (problems.length > 0) {
      Dialog.alert("Could not attach file", problems.join("\n\n"));
    }
  }

  const handleNativePasteImages = async (uris: ReadonlyArray<string>) => {
    const insertion = flow.draftKey ? captureComposerDraftInsertion(flow.draftKey) : undefined;
    const existingCount =
      flow.draftKey && insertion
        ? countComposerDraftAttachmentsAfterSelection(flow.draftKey, insertion)
        : flow.attachments.length;
    const converted = await settlePromise(() =>
      convertPastedImagesToAttachments({
        uris,
        existingCount,
      }),
    );
    if (AsyncResult.isFailure(converted)) {
      console.error("[native paste] error converting images", squashAtomCommandFailure(converted));
      return;
    }
    if (converted.value.length > 0) flow.appendAttachments(converted.value, insertion);
  };

  const handleNativePasteText = async (paste: ComposerTextPaste) => {
    const draftKey = flow.draftKey;
    if (!draftKey) return;
    const insertion = { text: paste.value, ...paste.selection };
    const insertPaste = () => {
      const insertion = replaceTextSelection({
        value: paste.value,
        selection: paste.selection,
        text: paste.text,
      });
      const selection = { start: insertion.cursor, end: insertion.cursor };
      flow.setPrompt(insertion.value);
      composerMenu.onSelectionChange(selection);
    };
    const capabilities = selectedEnvironmentServerConfig?.environment.capabilities;
    const advertisedMax = capabilities?.fileAttachments?.maxUploadBytes;
    const maxBytes =
      advertisedMax === undefined ? null : clampFileAttachmentUploadBytes(advertisedMax);
    const wouldExceedInputLimit =
      paste.value.length -
        Math.max(0, paste.selection.end - paste.selection.start) +
        paste.text.length >
      PROVIDER_SEND_TURN_MAX_INPUT_CHARS;
    const canAttach =
      maxBytes !== null &&
      countComposerDraftAttachmentsAfterSelection(draftKey, insertion) <
        PROVIDER_SEND_TURN_MAX_ATTACHMENTS &&
      new TextEncoder().encode(paste.text).byteLength <= maxBytes;
    if (
      pastedTextDisposition({
        text: paste.text,
        wouldExceedInputLimit,
        canAttach: true,
      }) === "attachment"
    ) {
      if (canAttach && maxBytes !== null) {
        pendingPastedTextAttachmentCountRef.current += 1;
        setPendingPastedTextAttachmentCount(pendingPastedTextAttachmentCountRef.current);
        const attached = await settlePromise(async () => {
          if (pastedTextFileNamesRef.current.draftKey !== draftKey) {
            pastedTextFileNamesRef.current = { draftKey, names: new Set() };
          }
          const reservedNames = pastedTextFileNamesRef.current.names;
          for (const attachment of flow.attachments) reservedNames.add(attachment.name);
          const name = nextPastedTextFileName([...reservedNames]);
          reservedNames.add(name);
          const attachment = await createPastedTextComposerAttachment({
            text: paste.text,
            name,
            maxBytes,
          });
          if (latestDraftKeyRef.current !== draftKey) {
            await removePersistedComposerAttachmentFile(attachment.fileUri);
            return;
          }
          if (flow.appendAttachments([attachment], insertion) > 0) {
            await removePersistedComposerAttachmentFile(attachment.fileUri);
            Dialog.alert(
              "Could not attach pasted text",
              `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`,
            );
          }
        });
        pendingPastedTextAttachmentCountRef.current = Math.max(
          0,
          pendingPastedTextAttachmentCountRef.current - 1,
        );
        setPendingPastedTextAttachmentCount(pendingPastedTextAttachmentCountRef.current);
        if (AsyncResult.isFailure(attached)) {
          const error = squashAtomCommandFailure(attached);
          Dialog.alert(
            "Could not attach pasted text",
            error instanceof Error ? error.message : "Try again.",
          );
        }
        return;
      } else if (!wouldExceedInputLimit) {
        insertPaste();
      } else {
        Dialog.alert(
          wouldExceedInputLimit
            ? "Pasted text is too large for this message"
            : "Could not attach pasted text",
          wouldExceedInputLimit
            ? "Remove some text or an attachment, then paste again."
            : "Remove an attachment or use a smaller paste, then try again.",
        );
      }
      return;
    }

    insertPaste();
  };

  async function handleStart(): Promise<void> {
    if (
      isComposerInteractionLocked ||
      voiceInput.blocksSubmission ||
      pendingPastedTextAttachmentCountRef.current > 0
    )
      return;
    const selectedProject = flow.selectedProject;
    const draftKey = flow.draftKey;
    if (!selectedProject || !draftKey) {
      return;
    }
    if (
      environmentConnected &&
      !readEnvironmentScope(selectedProject.environmentId, AuthOrchestrationOperateScope)
    ) {
      return;
    }
    const draft = getComposerDraftSnapshot(draftKey);
    if (appAtomRegistry.get(composerContextImportsAtom)[draftKey]) return;
    const modelSelection =
      resolveSelectableModelSelection(
        selectedEnvironmentServerConfig,
        draft.modelSelection ?? null,
        selectedProject.id,
      ) ?? flow.selectedModel;
    const initialMessageText = draft.text.trim();

    if (
      attachmentBlockReason !== null ||
      !modelSelection ||
      (initialMessageText.length === 0 && draft.attachments.length === 0) ||
      flow.submitting
    ) {
      return;
    }
    if (
      environmentConnected &&
      isModelSelectionUnavailable(
        selectedEnvironmentServerConfig,
        modelSelection,
        selectedProject.id,
      )
    ) {
      const { title, detail } = describeUnavailableModelSelection(
        selectedEnvironmentServerConfig,
        modelSelection,
        selectedProject.id,
      );
      Dialog.alert(title, detail);
      return;
    }
    // Supaterm's own limits command is answered by the thread composer; a new task would
    // send it to the agent. A provider's same-named command, or a prompt carrying
    // attachments, goes through as usual.
    if (
      offersUsageLimits &&
      isUsageLimitsCommand(initialMessageText) &&
      draft.attachments.length === 0
    ) {
      Dialog.alert(
        "Usage limits",
        "Send /usage-limits inside a thread, or open Settings → Usage → Limits.",
      );
      return;
    }
    // A failed-send restore can leave the draft over the cap on purpose (it
    // never drops the user's files); starting anyway would upload everything
    // and have the server reject the turn.
    if (draft.attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      Dialog.alert(
        "Too many attachments",
        `Remove attachments until there are at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}.`,
      );
      return;
    }

    const contextBlockReason = composerContextSendBlockReason(draft.context);
    if (contextBlockReason) {
      Dialog.alert("Too much context", contextBlockReason);
      return;
    }

    const editingPendingTask = flow.editingPendingTask;

    // Persist locally, then open the reserved thread on every connection state.
    // The outbox owns uploads and server creation after navigation.
    const metadata = editingPendingTask
      ? {
          threadId: editingPendingTask.threadId,
          commandId: editingPendingTask.commandId,
          messageId: editingPendingTask.messageId,
          createdAt: editingPendingTask.createdAt,
        }
      : makeTurnCommandMetadata();
    const message = flow.buildPendingTaskMessage(metadata, {
      currentCheckoutBranch: queuesInsteadOfStarting ? null : flow.currentCheckoutBranchName,
      useDefaultBranch: true,
    });
    if (!message) {
      return;
    }
    // Persist before clearing the draft or leaving its editor. This only waits
    // for the local outbox write; server and worktree setup run on the thread.
    flow.setSubmitting(true);
    const queued = await settlePromise(() => enqueueThreadOutboxMessage(message));
    flow.setSubmitting(false);
    if (AsyncResult.isFailure(queued)) {
      const error = squashAtomCommandFailure(queued);
      Dialog.alert(
        "Could not queue task",
        error instanceof Error ? error.message : "The task could not be saved to the outbox.",
      );
      return;
    }
    const draftSnapshot = getComposerDraftSnapshot(draftKey);
    if (editingPendingTask) {
      flow.finishEditingPendingTask();
    } else {
      // The queued message owns the attachments now, so the sweep is deferred
      // until the write confirms it.
      clearComposerDraftContent(draftKey, {
        clearModelSelection: true,
        clearWorkspaceSelection: true,
        deferAttachmentCleanup: true,
      });
    }
    const previousRoute = (navigation.getParent() ?? navigation).getState()?.routes.at(-2);
    const returnsToPendingThread =
      editingPendingTask &&
      previousRoute?.name === "Thread" &&
      previousRoute.params &&
      "environmentId" in previousRoute.params &&
      "threadId" in previousRoute.params &&
      previousRoute.params.environmentId === message.environmentId &&
      previousRoute.params.threadId === message.threadId;
    setSubmitNavigationAction(
      returnsToPendingThread
        ? CommonActions.goBack()
        : StackActions.replace("Thread", {
            environmentId: String(message.environmentId),
            threadId: String(message.threadId),
          }),
    );
    scheduleUnusedComposerAttachmentCleanup(draftSnapshot.attachments);
  }

  if (!selectedProject) {
    return (
      <View className="flex-1 bg-sheet" collapsable={false}>
        {Platform.OS === "android" ? (
          <>
            <NativeStackScreenOptions options={{ headerShown: false }} />
            <AndroidScreenHeader
              title="New thread"
              hideBottomBorder
              onBack={() => navigation.goBack()}
            />
          </>
        ) : (
          <NativeStackScreenOptions options={{ title: "Loading task" }} />
        )}
      </View>
    );
  }

  const isAndroid = Platform.OS === "android";
  const openDraftDocument = (attachment: ComposerDocumentAttachment) => {
    // A draft attachment lives only in the draft. Without its key the screen would fall through
    // to a remote lookup for bytes the server has never seen.
    const draftKey = flow.draftKey;
    if (!draftKey) return;
    promptInputRef.current?.blur();
    void KeyboardController.dismiss({ animated: true });
    navigation.dispatch(
      StackActions.push("NewTaskAttachment", {
        environmentId: String(selectedProject.environmentId),
        attachmentId: attachment.attachmentId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: String(attachment.sizeBytes),
        draftKey,
      }),
    );
  };
  const promptEditor = (
    <>
      <ComposerEditor
        draftKey={flow.draftKey}
        environmentId={selectedProject.environmentId}
        onOpenAttachment={openDraftDocument}
        onOpenMention={(path) => {
          if (!composerWorkspaceCwd) return;
          promptInputRef.current?.blur();
          void KeyboardController.dismiss({ animated: true });
          navigation.dispatch(
            StackActions.push("NewTaskFile", {
              environmentId: String(selectedProject.environmentId),
              cwd: composerWorkspaceCwd,
              projectName: selectedProject.title,
              path: fileRoutePathSegments(path),
            }),
          );
        }}
        ref={promptInputRef}
        autoFocus={false}
        editable={!isIncomingShareTransferPending && !flow.submitting}
        readOnly={voiceInput.freezesEditor}
        multiline
        scrollEnabled
        value={flow.prompt}
        skills={composerMenu.skills}
        selection={composerMenu.selection}
        onChangeText={flow.setPrompt}
        onSubmit={() => {
          if (canStart) void handleStart();
        }}
        onSelectionChange={composerMenu.onSelectionChange}
        onFocus={() => setIsComposerFocused(true)}
        onBlur={() => setIsComposerFocused(false)}
        onPasteImages={(uris) => void handleNativePasteImages(uris)}
        onPasteText={(paste) => void handleNativePasteText(paste)}
        placeholder="Ask anything…"
        singleLineCentered={false}
        contentInsetVertical={0}
        style={{
          minHeight: 72,
          maxHeight: 160,
          paddingVertical: 4,
        }}
        textStyle={{ ...bodyText, color: foregroundColor, fontFamily: SYSTEM_FONT_FAMILY }}
      />
    </>
  );

  const closeNewTask = () => {
    void KeyboardController.dismiss({ animated: true });
    const parentNavigation = navigation.getParent();
    if (parentNavigation) {
      parentNavigation.goBack();
      return;
    }
    navigation.goBack();
  };
  const chooseProject = () => {
    if (isComposerInteractionLocked) {
      return;
    }
    promptInputRef.current?.blur();
    void KeyboardController.dismiss({ animated: true });
    navigation.dispatch(StackActions.push("NewTask", { incomingShareId: props.incomingShareId }));
  };
  const openContextPicker = (routeName: "NewTaskBranch" | "NewTaskEnvironment") => {
    if (isComposerInteractionLocked) {
      return;
    }
    promptInputRef.current?.blur();
    void KeyboardController.dismiss({ animated: true });
    navigation.dispatch(StackActions.push(routeName));
  };
  const keyboardDismissArea = (
    <Pressable
      accessible={false}
      className="flex-1"
      onPress={() => {
        promptInputRef.current?.blur();
        void KeyboardController.dismiss({ animated: true });
      }}
    />
  );

  const canPickEnvironment = flow.environments.length > 1 && !flow.environmentPinned;
  const environmentControl = (
    <ComposerInlineControl
      accessibilityLabel={`Environment: ${selectedEnvironmentLabel}`}
      chevronDirection="right"
      disabled={isComposerInteractionLocked || voiceInput.isBusy}
      renderIcon={(size) => (
        <EnvironmentMachineSymbol
          kind={resolveEnvironmentMachineKind(selectedEnvironmentServerConfig)}
          size={size}
          tintColorClassName="accent-icon-muted"
        />
      )}
      label={`on ${selectedEnvironmentLabel}`}
      maxWidth={flow.isScratchDraft ? 170 : 260}
      onPress={canPickEnvironment ? () => openContextPicker("NewTaskEnvironment") : undefined}
      showChevron={canPickEnvironment}
      static={!canPickEnvironment}
    />
  );
  const hero = flow.isScratchDraft ? (
    <View className="items-center gap-2 px-6" testID="new-task-hero">
      <Text className="text-center text-2xl font-supaterm-medium tracking-tight text-foreground">
        What should we work on?
      </Text>
      <View className="flex-row flex-wrap items-center justify-center gap-x-1">
        <ComposerInlineControl
          accessibilityHint="Opens the project picker"
          accessibilityLabel="Choose a project"
          chevronDirection="right"
          disabled={isComposerInteractionLocked}
          icon="folder"
          label="Choose a project"
          onPress={chooseProject}
        />
        {environmentControl}
      </View>
    </View>
  ) : (
    <View className="items-center gap-6 px-6" testID="new-task-hero">
      <View className="w-full items-center gap-1.5">
        <Text className="text-center text-2xl font-supaterm-medium tracking-tight text-foreground">
          What should we build
        </Text>
        <Pressable
          accessibilityHint="Opens the project picker"
          accessibilityLabel={selectedProjectLabel ?? selectedProject.title}
          accessibilityRole="button"
          disabled={isComposerInteractionLocked}
          onPress={chooseProject}
          className="max-w-full active:opacity-65"
        >
          <Text className="text-center text-2xl font-supaterm-medium tracking-tight text-foreground">
            in{" "}
            <Text className="font-supaterm-medium underline">
              {selectedProjectLabel ?? selectedProject.title}
            </Text>
            ?
          </Text>
        </Pressable>
      </View>

      {environmentControl}
    </View>
  );
  const workspaceControls = (
    <View className="flex-row items-center gap-1 px-2">
      <ComposerInlineControl
        accessibilityHint={`Switches to ${flow.workspaceMode === "local" ? "a new worktree" : "the current checkout"}`}
        accessibilityLabel={workspaceLabel}
        disabled={isComposerInteractionLocked || voiceInput.isBusy}
        renderIcon={(size) => (
          <NewTaskWorkspaceIcon
            workspaceMode={flow.workspaceMode}
            worktreePath={flow.selectedWorktreePath}
            size={size}
          />
        )}
        label={workspaceLabel}
        maxWidth={flow.workspaceMode === "local" ? 220 : 148}
        onPress={() => flow.setWorkspaceMode(flow.workspaceMode === "local" ? "worktree" : "local")}
        showChevron={false}
      />

      <ComposerInlineControl
        accessibilityLabel={`${flow.workspaceMode === "worktree" ? "Base branch" : "Branch"}: ${selectedBranchLabel}`}
        chevronDirection="right"
        disabled={isComposerInteractionLocked}
        icon="arrow.triangle.branch"
        label={showBranchLoading ? "Loading branches…" : selectedBranchLabel}
        maxWidth={190}
        onPress={() => openContextPicker("NewTaskBranch")}
      />
    </View>
  );

  const composerDock = (
    <ScrollView
      ref={composerDockRef}
      bounces={false}
      className={Platform.OS === "android" ? "bg-sheet-solid" : "bg-sheet"}
      contentInsetAdjustmentBehavior="never"
      contentContainerClassName="px-[12px] pt-1"
      contentContainerStyle={{ paddingBottom: controlsBottomPadding }}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      onContentSizeChange={keepFocusedComposerVisible}
      onLayout={keepFocusedComposerVisible}
      showsVerticalScrollIndicator={false}
      style={{ flexGrow: 0, maxHeight: availableDockHeight }}
    >
      <View className="pb-3">{hero}</View>
      {!voiceInput.isBusy &&
      composerMenu.trigger &&
      (composerMenu.items.length > 0 || composerMenu.trigger.kind === "pull-request") ? (
        <View className="mb-2">
          <ComposerCommandPopover
            items={composerMenu.items}
            triggerKind={composerMenu.trigger.kind}
            isLoading={composerMenu.isLoading}
            error={composerMenu.error}
            onSelect={composerMenu.onSelect}
          />
        </View>
      ) : null}
      {projectClone && projectClone.phase !== "done" && selectedProject ? (
        <View className="px-1 pb-2">
          <ProjectCloneBanner
            clone={projectClone}
            onCancel={() =>
              void runCloneAction("Failed to cancel clone", () =>
                cancelProjectClone({
                  environmentId: selectedProject.environmentId,
                  input: { projectId: selectedProject.id },
                }),
              )
            }
            onRetry={() =>
              void runCloneAction("Failed to retry clone", () =>
                retryProjectClone({
                  environmentId: selectedProject.environmentId,
                  input: { projectId: selectedProject.id },
                }),
              )
            }
            onRemove={() => void removeClonedProject()}
          />
        </View>
      ) : null}
      {flow.canChooseWorkspace ? <View className="pb-1">{workspaceControls}</View> : null}

      {taskPermissionReason ? (
        <Text className="px-3 py-2 text-xs text-muted-foreground">{taskPermissionReason}</Text>
      ) : null}

      {modelUnavailable ? (
        <Pressable
          accessibilityRole="button"
          className="px-3 py-2"
          disabled={isComposerInteractionLocked}
          onPress={settingsSheetPresentation.open}
        >
          <Text className="text-xs text-foreground">Model unavailable. Open model settings.</Text>
        </Pressable>
      ) : null}

      <ComposerSurface
        transparent={voiceInput.isBusy}
        style={
          voiceInput.isBusy
            ? { borderRadius: 27, paddingVertical: 2 }
            : {
                borderRadius: 26,
                minHeight: 140,
                overflow: "hidden",
                paddingBottom: 6,
                paddingTop: 14,
              }
        }
      >
        <View style={voiceInput.isBusy ? { display: "none" } : undefined}>
          {stripAttachments.length > 0 ? (
            <Animated.View className="px-[14px] pb-2.5" exiting={FadeOut.duration(120)}>
              <ComposerAttachmentStrip
                environmentId={selectedProject.environmentId}
                attachments={stripAttachments}
                imageBorderRadius={16}
                imageSize={72}
                onRemove={
                  isComposerInteractionLocked || voiceInput.isBusy
                    ? () => undefined
                    : flow.removeAttachment
                }
                onPressPreview={
                  isComposerInteractionLocked || voiceInput.isBusy ? undefined : openFilePreview
                }
                onPressVideo={
                  isComposerInteractionLocked || voiceInput.isBusy ? undefined : openVideoPreview
                }
                onPressDocument={
                  isComposerInteractionLocked || voiceInput.isBusy
                    ? undefined
                    : (attachment) =>
                        openDraftDocument({
                          attachmentId: attachment.id,
                          name: attachment.name,
                          mimeType: attachment.mimeType,
                          sizeBytes: attachment.sizeBytes,
                        })
                }
              />
            </Animated.View>
          ) : null}

          <View className="px-[14px]">{promptEditor}</View>
          <View className="h-1" />
        </View>

        <Animated.View layout={COMPOSER_LAYOUT_TRANSITION} collapsable={false}>
          <ComposerDictationToolbar statusKind={voicePresentation.statusKind}>
            <ComposerToolbarRow
              paddingBottom={0}
              paddingHorizontal={0}
              paddingTop={0}
              style={{ gap: voiceInput.isBusy ? 8 : 0, justifyContent: "space-between" }}
            >
              <ComposerDictationLeadingAction
                presentation={voicePresentation}
                onStop={voiceInput.stop}
                onCancel={voiceInput.cancel}
              />
              {isVoiceInputPresented ? (
                <ComposerDictationStatus
                  audioLevels={voiceInput.audioLevels}
                  elapsedSeconds={voiceInput.elapsedSeconds}
                  phase={voiceInput.state.phase}
                  presentation={voicePresentation}
                  onDismissError={voiceInput.cancel}
                />
              ) : (
                <>
                  <ComposerAttachmentButton
                    disabled={isComposerInteractionLocked}
                    supportsFiles={Boolean(
                      selectedEnvironmentServerConfig?.environment.capabilities.fileAttachments,
                    )}
                    onPickMedia={handlePickMedia}
                    onPickFiles={handlePickFiles}
                  />
                  <View className="min-w-0 shrink">
                    <ComposerModelControl
                      descriptors={providerOptionDescriptors}
                      selectedModel={flow.selectedModel}
                      modelOption={flow.selectedModelOption}
                      label={flow.selectedModelOption?.label ?? "Choose model"}
                      disabled={isComposerInteractionLocked}
                      onPress={settingsSheetPresentation.open}
                    />
                  </View>
                  <ComposerSpeedToggle
                    provider={flow.selectedModelOption?.providerDriver}
                    descriptors={providerOptionDescriptors}
                    disabled={isComposerInteractionLocked}
                    onChange={flow.setSelectedModelOptions}
                  />
                </>
              )}
              {voicePresentation.showsSend ? (
                <ComposerDictationTrailingActions
                  state={voiceInput.state}
                  isAvailable={voiceInput.isAvailable}
                  disabled={dictationDisabled}
                  reservesSendWidth
                  onStart={startDictation}
                  onCancel={voiceInput.cancel}
                >
                  {hasContent || !voiceInput.isAvailable ? (
                    <ComposerActionButton
                      accessibilityLabel={startTaskLabel}
                      disabled={!canStart}
                      icon={queuesInsteadOfStarting ? "tray.and.arrow.up" : "arrow.up"}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        void handleStart();
                      }}
                      variant="primary"
                    />
                  ) : null}
                </ComposerDictationTrailingActions>
              ) : (
                <ComposerDictationConfirmAction
                  presentation={voicePresentation}
                  disabled={!canSubmitDraft}
                  onConfirm={voiceInput.stopAndSubmit}
                  submitsMessage
                />
              )}
            </ComposerToolbarRow>
          </ComposerDictationToolbar>
        </Animated.View>
      </ComposerSurface>
      <VideoPreviewModal source={previewVideo} onRequestClose={closeMediaPreview} />
      <FilePreviewModal source={previewFile} onRequestClose={closeMediaPreview} />
    </ScrollView>
  );

  if (isAndroid) {
    return (
      <View className="flex-1 bg-sheet" collapsable={false}>
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <AndroidScreenHeader title="New thread" hideBottomBorder onBack={closeNewTask} />
        <ScreenContent>
          <View
            className="flex-1"
            onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
          >
            {keyboardDismissArea}

            <KeyboardStickyView
              style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
              offset={{ closed: 0, opened: keyboardOpenedOffset }}
            >
              {composerDock}
            </KeyboardStickyView>
          </View>
        </ScreenContent>
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-sheet"
      collapsable={false}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    >
      <NativeStackScreenOptions
        options={{
          headerBackVisible: false,
          headerShadowVisible: false,
          title: "New thread",
        }}
      />
      <Toolbar placement="left">
        <Toolbar.Button accessibilityLabel="Cancel new task" icon="xmark" onPress={closeNewTask} />
      </Toolbar>

      {keyboardDismissArea}
      <KeyboardStickyView
        pointerEvents="box-none"
        style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
        offset={{ closed: 0, opened: keyboardOpenedOffset }}
      >
        <Animated.View
          layout={COMPOSER_LAYOUT_TRANSITION}
          pointerEvents="box-none"
          style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
        >
          {composerDock}
        </Animated.View>
      </KeyboardStickyView>
    </View>
  );
}
