import { useSidebarWorkspaceTabs } from "../workspace/useSidebarWorkspaceTabs";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import type { ComposerTextPaste } from "../../native/SupatermComposerEditor.types";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { useAtomValue } from "@effect/atom-react";
import { clampFileAttachmentUploadBytes } from "@supaterm/client-runtime/state/attachments";
import { pastedTextDisposition, replaceTextSelection } from "@supaterm/client-runtime/text-paste";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ChatAttachment,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type RuntimeMode,
  type ServerConfig as SupatermServerConfig,
  type UsageLimitsReport,
} from "@supaterm/contracts";
import {
  collectProviderUsageLimits,
  hasProviderUsageLimits,
  isUsageLimitsCommand,
} from "@supaterm/shared/usageLimits";
import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import * as Haptics from "expo-haptics";
import { Keyboard, Platform, View, type ViewStyle } from "react-native";
import { composerImageGallery } from "../../lib/composerImageGallery";
import { filePreviewGallery } from "../../lib/filePreviewGallery";
import { FilePreviewModal, type FilePreviewSource } from "../../components/FilePreviewModal";
import {
  composerAttachmentUploadBlockReason,
  composerAttachmentsStillUploading,
  composerAttachmentUploadsAtom,
} from "../../state/composer-attachment-uploads";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  COMPOSER_LAYOUT_TRANSITION,
  COMPOSER_TRANSITION_DURATION_MS,
} from "../../components/composerLayoutTransition";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { themeColorWithAlpha } from "../../lib/mobileTheme";
import { scopedThreadKey } from "../../lib/scopedEntities";
import {
  getComposerDraftSnapshot,
  composerDraftsAtom,
  setComposerDraftText,
  composerContextImportsAtom,
  countComposerDraftAttachmentsAfterSelection,
  useComposerDraft,
} from "../../state/use-composer-drafts";
import { appAtomRegistry } from "../../state/atom-registry";
import type { ComposerDocumentAttachment } from "../../lib/composerContext";
import { useProject, useThreadShells } from "../../state/entities";
import { scopeProjectRef } from "@supaterm/client-runtime/environment";

import { AppText as Text } from "../../components/ui/AppText";
import { ComposerAttachmentButton } from "./ComposerAttachmentButton";
import {
  ComposerAttachmentStrip,
  ComposerAttachmentThumbnail,
} from "../../components/ComposerAttachmentStrip";
import { VideoPreviewModal, type VideoPreviewSource } from "../../components/VideoPreviewModal";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { ComposerEditor, type ComposerEditorHandle } from "../../components/ComposerEditor";
import { fileRoutePathSegments } from "../files/filePath";
import { ComposerActionButton, ComposerToolbarRow } from "../../components/ComposerToolbar";
import {
  composerStripAttachments,
  type DraftComposerFileAttachment,
} from "../../lib/composerImages";
import {
  buildModelOptions,
  groupByProvider,
  isModelSelectionUnavailable,
} from "../../lib/modelOptions";
import { useScaledTextRole, type ScaledTextRole } from "../settings/appearance/useScaledTextRole";
import type { RemoteClientConnectionState } from "../../lib/connection";
import { MOBILE_TYPOGRAPHY } from "../../lib/typography";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { ComposerSpeedToggle } from "../../components/ComposerSpeedToggle";
import { ComposerModelControl } from "./ComposerModelControl";
import { Menu } from "../../components/ui/Menu";
import type { ActiveTurnComposerAction } from "@supaterm/client-runtime/state/composer-dispatch";
import type { FollowUpBehavior } from "../../lib/followUpBehavior";
import {
  resolveComposerSendPresentation,
  type ComposerSendPresentation,
} from "./composerSendPresentation";
import { ComposerCommandPopover } from "./ComposerCommandPopover";
import { ComposerPopoverAnchor } from "./ComposerPopoverAnchor";
import { ComposerQueuedEditAttachments } from "./ComposerQueuedEdit";
import { useComposerCommandMenu } from "./use-composer-command-menu";
import {
  ComposerDictationConfirmAction,
  ComposerDictationLeadingAction,
  ComposerDictationDraftContent,
  ComposerDictationStatus,
  ComposerDictationToolbar,
  ComposerDictationTrailingActions,
  composerDictationToolbarHeight,
} from "../voice-input/ComposerDictationControl";
import { useVoiceInputController } from "../voice-input/useVoiceInputController";
import { resolveVoiceComposerPresentation } from "../voice-input/voiceInputPresentation";
import {
  rememberModelOptions,
  withRememberedModelOptions,
} from "../../state/use-model-option-memory";
import {
  type ExistingThreadSettingsRouteSession,
  useExistingThreadSettingsRoutePresentation,
} from "./ThreadSettingsSheet";
import {
  useThreadSettingsSheetPresentation,
  type NavigationWithFinishTransitioning,
} from "./use-thread-settings-sheet-presentation";

export const COMPOSER_COLLAPSED_CHROME = 60;

const INLINE_EDITOR_HEIGHT = 36;
const COLLAPSED_EDITOR_DEFAULT_INSET = 6;
// iOS puts line-height slack above glyphs. DM Sans's lowercase midline is
// descender (0.31em) + half x-height (0.504em) above the line bottom.
const LOWERCASE_MIDLINE_EM = 0.562;

function lowercaseMidline(text: ScaledTextRole): number {
  return text.lineHeight - LOWERCASE_MIDLINE_EM * text.fontSize;
}

function collapsedEditorInset(text: ScaledTextRole): number {
  const shift = lowercaseMidline(text) - lowercaseMidline(MOBILE_TYPOGRAPHY.body);
  return Math.max(0, Math.round(COLLAPSED_EDITOR_DEFAULT_INSET - shift));
}

export const COMPOSER_EXPANDED_CHROME = 156;

const COMPACT_SURFACE_INSET = 2;

export interface ThreadComposerProps {
  readonly canOperateThread: boolean;
  readonly placeholder: string;
  readonly contentMaxWidth?: number;
  readonly draftControls?: ReactNode;
  readonly bottomInset?: number;
  readonly connectionState: RemoteClientConnectionState;
  readonly environmentLabel: string | null;
  readonly threadSyncPhase?: "loading" | "syncing" | null;
  readonly selectedThread: EnvironmentThreadShell;
  readonly reportedModelSelection?: ModelSelection | null;
  readonly hasCompactableConversation: boolean;
  readonly serverConfig: SupatermServerConfig | null;
  readonly queueCount: number;
  readonly activeThreadBusy: boolean;
  readonly canStopThread: boolean;
  readonly environmentId: EnvironmentId;
  readonly projectCwd: string | null;
  /** The thread is still being created; sends queue behind its creation. */
  readonly awaitingCreation: boolean;
  /** A new thread's draft: it has no server thread yet, so thread-scoped commands are hidden. */
  readonly isDraft?: boolean;
  readonly sendBlockedReason?: string | null;
  readonly interactionLocked?: boolean;
  readonly draftKey?: string;
  readonly queuedEdit?: {
    readonly existingAttachments: ReadonlyArray<ChatAttachment>;
    readonly saving: boolean;
    readonly onRemoveExistingAttachment: (attachmentId: string) => void;
  } | null;
  readonly followUpBehavior: FollowUpBehavior;
  readonly canSteerActiveTurn: boolean;
  readonly hidden: boolean;
  readonly editorRef?: RefObject<ComposerEditorHandle | null>;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly onPickDraftMedia: () => Promise<void>;
  readonly onPickDraftFiles: () => Promise<void>;
  readonly onNativePasteImages: (uris: ReadonlyArray<string>) => Promise<void>;
  readonly onNativePasteText: (paste: ComposerTextPaste) => Promise<void>;
  readonly onRemoveDraftImage: (imageId: string) => void;
  readonly onStopThread: () => void;
  readonly onResumeQueue: (() => Promise<void>) | null;
  /** `stillSendable` reports whether the draft is unchanged after any wait before sending. */
  readonly onSendMessage: (
    followUp?: ActiveTurnComposerAction,
    stillSendable?: () => boolean,
  ) => Promise<MessageId | null>;
  readonly onShowUsageLimits: (report: UsageLimitsReport | null) => void;
  readonly canSwitchProvider: boolean;
  readonly onUpdateModelSelection: (modelSelection: ModelSelection) => void;
  readonly onUpdateRuntimeMode: (runtimeMode: RuntimeMode) => void;
  readonly onExpandedChange?: (expanded: boolean) => void;
  readonly onHeightChange?: (height: number) => void;
  readonly onEditorFocusChange?: (focused: boolean) => void;
  /** Fires when the command popover opens or closes; hosts clear chrome it would overlap. */
  readonly onCommandMenuOpenChange?: (open: boolean) => void;
}

const COMPOSER_ATTACHMENT_ENTERING =
  Platform.OS === "android"
    ? FadeIn.duration(160)
    : FadeIn.delay(COMPOSER_TRANSITION_DURATION_MS).duration(160).reduceMotion(ReduceMotion.System);

const AnimatedGlassSurface = Animated.createAnimatedComponent(GlassSurface);

const FOLLOW_UP_ACTION_LABEL = {
  queue: "Queue",
  steer: "Steer now",
  restart: "Restart turn",
} as const;

const FOLLOW_UP_ACTION_SUBTITLE = {
  queue: "Run after the current turn",
  steer: "Interrupt what the agent is doing",
  restart: "Start the turn over with this message",
} as const;

function SendActionButton(props: {
  readonly size?: "regular" | "large";
  readonly accessibilityLabel: string;
  readonly presentation: ComposerSendPresentation;
  readonly disabled: boolean;
  readonly onSend: (followUp?: ActiveTurnComposerAction) => void;
}) {
  const { presentation } = props;
  const button = (
    <ComposerActionButton
      size={props.size}
      accessibilityLabel={props.accessibilityLabel}
      icon={presentation.icon}
      variant="primary"
      disabled={props.disabled}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        props.onSend();
      }}
    />
  );
  if (!presentation.offersFollowUpChoice || presentation.action === null || props.disabled) {
    return button;
  }
  const actions = [presentation.action, presentation.alternate].filter(
    (action): action is ActiveTurnComposerAction => action !== null,
  );
  return (
    <Menu
      accessibilityLabel="Choose how to send this message"
      shouldOpenOnLongPress
      preservesKeyboard
      onOpenMenu={() => {
        if (Platform.OS === "ios") {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        }
      }}
      actions={actions.map((action) => ({
        id: action,
        title: FOLLOW_UP_ACTION_LABEL[action],
        subtitle: FOLLOW_UP_ACTION_SUBTITLE[action],
        state: action === presentation.action ? ("on" as const) : ("off" as const),
      }))}
      onPressAction={({ nativeEvent }) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        props.onSend(nativeEvent.event as ActiveTurnComposerAction);
      }}
    >
      {button}
    </Menu>
  );
}

/**
 * The pill / card container — renders with Expo's native GlassView on supported
 * iOS 26+ devices, with a frosted blur fallback where supported.
 * Exported so NewTaskDraftScreen can render the same composer chrome.
 */
export function ComposerSurface(props: {
  readonly children: ReactNode;
  readonly style: ViewStyle;
  readonly animateLayout?: boolean;
  readonly transparent?: boolean;
}) {
  const colors = useUniwindTheme();
  const targetBorderRadius =
    typeof props.style.borderRadius === "number" ? props.style.borderRadius : 0;
  const animatedBorderRadius = useSharedValue(targetBorderRadius);
  const shouldAnimate = props.animateLayout !== false && Platform.OS !== "android";
  useLayoutEffect(() => {
    animatedBorderRadius.set(
      shouldAnimate
        ? withTiming(targetBorderRadius, {
            duration: COMPOSER_TRANSITION_DURATION_MS,
            reduceMotion: ReduceMotion.System,
          })
        : targetBorderRadius,
    );
  }, [animatedBorderRadius, shouldAnimate, targetBorderRadius]);
  const animatedShapeStyle = useAnimatedStyle(() => ({
    borderRadius: animatedBorderRadius.value,
  }));
  const layoutTransition = shouldAnimate ? COMPOSER_LAYOUT_TRANSITION : undefined;

  // Each native frame follows the same transition. Animating only the outer
  // clip leaves the glass and content at their final height on the first frame.
  return (
    <Animated.View
      className={
        Platform.OS === "android" || props.transparent
          ? undefined
          : "shadow-[0_6px_28px] shadow-adaptive-black-a15-a35"
      }
      layout={layoutTransition}
      style={[
        animatedShapeStyle,
        {
          overflow: "hidden",
        },
      ]}
    >
      {!props.transparent ? (
        <AnimatedGlassSurface
          chrome="none"
          fallbackColor={colors["--color-composer-surface"]}
          fallbackClassName="border border-composer-border"
          glassEffectStyle="regular"
          pointerEvents="none"
          tintColor="transparent"
          layout={layoutTransition}
          style={[{ position: "absolute", inset: 0 }, animatedShapeStyle]}
        >
          {null}
        </AnimatedGlassSurface>
      ) : null}
      <Animated.View
        collapsable={false}
        layout={layoutTransition}
        style={[props.style, animatedShapeStyle]}
      >
        {props.children}
      </Animated.View>
    </Animated.View>
  );
}

function focusComposerEditor(editorRef: RefObject<ComposerEditorHandle | null>) {
  editorRef.current?.focus();
}

/** Space below the composer pill, inside the bottom inset it is given. */
export const THREAD_COMPOSER_BOTTOM_GUTTER = 6;

export const ThreadComposer = function ThreadComposer(props: ThreadComposerProps) {
  const project = useProject(scopeProjectRef(props.environmentId, props.selectedThread.projectId));
  const { themeVariables: materialTheme } = useAppearancePreferences();
  const composerPanel = materialTheme["--color-composer-panel"];
  const navigation = useNavigation();
  const foregroundColor = useUniwindTheme()["--color-foreground"];
  const bodyText = useScaledTextRole("body");
  const fallbackInputRef = useRef<ComposerEditorHandle>(null);
  const inputRef = props.editorRef ?? fallbackInputRef;
  const [isFocused, setIsFocused] = useState(false);
  const pendingPastedTextAttachmentCountRef = useRef(0);
  const pendingNativeImagePasteCountRef = useRef(0);
  const [pendingPastedTextAttachmentCount, setPendingPastedTextAttachmentCount] = useState(0);
  const settingsSheetPresentation = useThreadSettingsSheetPresentation({
    editorRef: inputRef,
    isEditorFocused: isFocused,
  });
  const settingsRoutePresentation = useExistingThreadSettingsRoutePresentation();
  const settingsRoutePresentedRef = useRef(false);
  const wasExpandedBeforePreviewRef = useRef(false);
  const inFlightThreadIdsRef = useRef(new Set<string>());
  const { onExpandedChange } = props;

  const [previewFile, setPreviewFile] = useState<FilePreviewSource | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoPreviewSource | null>(null);
  const composerOwnerKey = scopedThreadKey(props.environmentId, props.selectedThread.id);
  const composerDraftKey = props.draftKey ?? composerOwnerKey;
  const { text: draftMessage, attachments: draftAttachments } = useComposerDraft(composerDraftKey);
  const queuedEdit = props.queuedEdit ?? null;
  const hasContent =
    draftMessage.trim().length > 0 ||
    draftAttachments.length > 0 ||
    (queuedEdit?.existingAttachments.length ?? 0) > 0;
  const stripAttachments = composerStripAttachments(draftAttachments);
  const showStopAction = !hasContent && props.canStopThread && queuedEdit === null;
  const onResumeQueue = props.onResumeQueue;
  const [resumingQueue, setResumingQueue] = useState(false);
  const showResumeAction =
    !hasContent && !showStopAction && queuedEdit === null && onResumeQueue !== null;
  const handleResumeQueue = async () => {
    if (resumingQueue || onResumeQueue === null) return;
    setResumingQueue(true);
    await onResumeQueue();
    setResumingQueue(false);
  };

  const uploadStates = useAtomValue(composerAttachmentUploadsAtom);
  const attachmentsUploading =
    props.connectionState === "connected" &&
    composerAttachmentsStillUploading({
      environmentId: props.environmentId,
      attachments: draftAttachments,
      serverConfig: props.serverConfig,
      states: uploadStates,
    });
  const sendPresentation = resolveComposerSendPresentation({
    editingQueuedMessage: queuedEdit !== null,
    running: props.activeThreadBusy,
    canSteer: props.canSteerActiveTurn,
    followUpBehavior: props.followUpBehavior,
    deliveryDeferred:
      props.connectionState !== "connected" ||
      props.queueCount > 0 ||
      attachmentsUploading ||
      props.awaitingCreation,
  });
  const sendLabel = sendPresentation.label;
  const currentModelSelection = props.selectedThread.modelSelection;
  const currentRuntimeMode = props.selectedThread.runtimeMode;
  const modelUnavailable =
    props.connectionState === "connected" &&
    isModelSelectionUnavailable(
      props.serverConfig,
      currentModelSelection,
      props.selectedThread.projectId,
    );
  const selectedProviderStatus = (() => {
    if (!props.serverConfig) return null;
    return (
      props.serverConfig.providers.find(
        (p) => p.instanceId === props.selectedThread.modelSelection.instanceId,
      ) ?? null
    );
  })();
  const openDraftDocument = (attachment: ComposerDocumentAttachment) => {
    Keyboard.dismiss();
    navigation.navigate("ThreadAttachment", {
      environmentId: String(props.environmentId),
      threadId: String(props.selectedThread.id),
      attachmentId: attachment.attachmentId,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: String(attachment.sizeBytes),
      draftKey: composerDraftKey,
    });
  };
  const { onSendMessage, onChangeDraftMessage, onShowUsageLimits } = props;
  const usageLimitsOffered =
    selectedProviderStatus !== null &&
    hasProviderUsageLimits(selectedProviderStatus.driver, props.serverConfig?.providers ?? []);
  const openUsageLimits = () => {
    const report = collectProviderUsageLimits(
      currentModelSelection.instanceId,
      props.serverConfig?.providers ?? [],
      Date.now(),
    );
    onShowUsageLimits(report);
    if (!report) {
      Dialog.alert("Usage limits unavailable", "This provider does not currently report limits.");
    }
    return report !== null;
  };

  const composerMenu = useComposerCommandMenu({
    draftMessage: draftMessage,
    ownerKey: composerDraftKey,
    environmentId: props.environmentId,
    threadShells: useThreadShells(),
    currentThreadId: props.selectedThread.id,
    projectCwd: props.projectCwd,
    pullRequestProjectId: props.serverConfig != null ? (project?.id ?? null) : null,
    pullRequestRepository: project?.repositoryIdentity?.displayName ?? null,
    threadPullRequests: props.selectedThread.pullRequests,
    selectedProviderStatus,
    hasThread: !props.isDraft,
    hasCompactableConversation: props.hasCompactableConversation,
    onChangeDraftMessage: props.onChangeDraftMessage,
    offersUsageLimits: usageLimitsOffered,
    onUsageLimits:
      usageLimitsOffered && draftAttachments.length === 0 ? openUsageLimits : undefined,
  });
  const voiceInput = useVoiceInputController({
    ownerKey: composerDraftKey,
    label: props.selectedThread.title || "Untitled thread",
    readDraftMessage: () => getComposerDraftSnapshot(composerDraftKey).text,
    subscribeToDraftChanges: (onChange) => appAtomRegistry.subscribe(composerDraftsAtom, onChange),
    selection: composerMenu.selection,
    onChangeDraftMessage: (text) => setComposerDraftText(composerDraftKey, text),
    onChangeSelection: composerMenu.onSelectionChange,
    onSubmit: () => {
      if (canSend) void handleSend();
    },
  });
  const isSubmissionLocked =
    props.interactionLocked === true || queuedEdit?.saving === true || voiceInput.blocksSubmission;
  const voicePresentation = resolveVoiceComposerPresentation(
    voiceInput.state,
    voiceInput.elapsedSeconds,
  );
  const isVoiceInputPresented = voicePresentation.statusLabel !== null;
  const isExpanded =
    !voiceInput.isBusy && (isFocused || settingsSheetPresentation.keepsComposerExpanded);
  // The iPad sidebar's native tab bar is taller, so the collapsed row's controls grow to match.
  const rowControlSize =
    useSidebarWorkspaceTabs() === "picker" && !isExpanded ? "large" : "regular";
  const { setComposerEditing } = useAdaptiveWorkspaceLayout();
  const showsCompactDictation = isVoiceInputPresented && !isExpanded;
  const isToolbarVisible = isExpanded || isVoiceInputPresented;
  const attachmentBlockReason = composerAttachmentUploadBlockReason({
    environmentId: props.environmentId,
    attachments: draftAttachments,
    connected: props.connectionState === "connected",
    serverConfig: props.serverConfig,
    states: uploadStates,
  });
  const contextImports = useAtomValue(composerContextImportsAtom);
  const sendBlockedReason =
    (queuedEdit?.saving === true ? "Saving…" : null) ??
    props.sendBlockedReason ??
    (pendingPastedTextAttachmentCount > 0 ? "Attaching pasted text" : null) ??
    attachmentBlockReason;
  const canSubmitDraft =
    (props.canOperateThread || props.connectionState !== "connected") &&
    !contextImports[composerDraftKey] &&
    sendBlockedReason === null &&
    !modelUnavailable;
  const canSend = canSubmitDraft && hasContent && !isSubmissionLocked;

  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);
  useEffect(() => () => setComposerEditing(false), [setComposerEditing]);

  const commandMenuTrigger =
    !isSubmissionLocked &&
    composerMenu.trigger &&
    (composerMenu.items.length > 0 || composerMenu.trigger.kind === "pull-request")
      ? composerMenu.trigger
      : null;
  const isCommandMenuOpen = commandMenuTrigger !== null;
  const { onCommandMenuOpenChange } = props;
  // Report closed on unmount too, so the host never keeps its chrome hidden.
  useEffect(() => {
    if (!isCommandMenuOpen) return;
    onCommandMenuOpenChange?.(true);
    return () => onCommandMenuOpenChange?.(false);
  }, [isCommandMenuOpen, onCommandMenuOpenChange]);

  const onPressPreview = (source: FilePreviewSource) => {
    wasExpandedBeforePreviewRef.current = isFocused;
    setPreviewVideo(null);
    setPreviewFile(
      (current) =>
        current ?? {
          ...source,
          gallery: filePreviewGallery(source, composerImageGallery(draftAttachments)),
        },
    );
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewVideo(null);
    if (wasExpandedBeforePreviewRef.current) {
      setTimeout(() => {
        if (navigation.isFocused()) focusComposerEditor(inputRef);
      }, 100);
    }
  };

  const onPressVideo = (attachment: DraftComposerFileAttachment, sourceIdentifier: string) => {
    wasExpandedBeforePreviewRef.current = isFocused;
    setPreviewFile(null);
    setPreviewVideo((current) => current ?? { type: "local", attachment, sourceIdentifier });
  };

  const onEditorFocusChange = props.onEditorFocusChange;
  const handleFocus = () => {
    setIsFocused(true);
    onExpandedChange?.(true);
    onEditorFocusChange?.(true);
    setComposerEditing(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (!settingsSheetPresentation.keepsComposerExpanded) {
      onExpandedChange?.(false);
    }
    onEditorFocusChange?.(false);
    setComposerEditing(false);
  };
  const handleSend = async (followUp?: ActiveTurnComposerAction) => {
    if (
      isSubmissionLocked ||
      sendBlockedReason !== null ||
      pendingPastedTextAttachmentCountRef.current > 0 ||
      pendingNativeImagePasteCountRef.current > 0
    )
      return;
    if (usageLimitsOffered && isUsageLimitsCommand(draftMessage) && draftAttachments.length === 0) {
      if (openUsageLimits()) onChangeDraftMessage("");
      return;
    }
    const threadKey = scopedThreadKey(props.environmentId, props.selectedThread.id);
    if (inFlightThreadIdsRef.current.has(threadKey)) return;
    inFlightThreadIdsRef.current.add(threadKey);
    const draftAtSend = getComposerDraftSnapshot(composerDraftKey);
    const stillSendable = () => {
      const draft = getComposerDraftSnapshot(composerDraftKey);
      return (
        pendingPastedTextAttachmentCountRef.current === 0 &&
        pendingNativeImagePasteCountRef.current === 0 &&
        draft.text === draftAtSend.text &&
        draft.attachments.length === draftAtSend.attachments.length &&
        draft.attachments.every(
          (attachment, index) => attachment.id === draftAtSend.attachments[index]?.id,
        )
      );
    };
    await onSendMessage(followUp, stillSendable).finally(() => {
      inFlightThreadIdsRef.current.delete(threadKey);
    });
  };

  const lockedProviderInstanceId = props.canSwitchProvider
    ? undefined
    : currentModelSelection.instanceId;
  const modelOptions = buildModelOptions(
    props.serverConfig,
    currentModelSelection,
    lockedProviderInstanceId,
    props.selectedThread.projectId,
  );
  const threadProviderGroups = groupByProvider(modelOptions);
  const currentModelOption =
    modelOptions.find(
      (option) =>
        option.selection.instanceId === currentModelSelection.instanceId &&
        option.selection.model === currentModelSelection.model,
    ) ?? null;
  const providerOptionDescriptors = resolveProviderOptionDescriptors({
    capabilities: currentModelOption?.capabilities,
    selections: currentModelSelection.options,
  });
  const settingsOwnerId = composerOwnerKey;
  const onUpdateModelSelection = props.onUpdateModelSelection;
  const settingsRouteSession = {
    ownerId: settingsOwnerId,
    environmentId: props.environmentId,
    projectId: props.selectedThread.projectId,
    providerInstanceId: currentModelSelection.instanceId,
    ...(lockedProviderInstanceId ? { lockedProviderInstanceId } : {}),
    providerGroups: threadProviderGroups,
    selectedModel: currentModelSelection,
    prompt: draftMessage,
    onPromptChange: (text) => setComposerDraftText(composerDraftKey, text),
    reportedModelSelection: props.reportedModelSelection,
    onSelectModel: (option) => onUpdateModelSelection(withRememberedModelOptions(option.selection)),
    restoreSelection: withRememberedModelOptions,
    optionDescriptors: providerOptionDescriptors,
    onUpdateOptionSelections: (options) => {
      rememberModelOptions(
        currentModelSelection.instanceId,
        currentModelSelection.model,
        options ?? [],
      );
      onUpdateModelSelection({ ...currentModelSelection, options });
    },
    runtimeMode: currentRuntimeMode,
    onUpdateRuntimeMode: props.onUpdateRuntimeMode,
  } satisfies ExistingThreadSettingsRouteSession;
  const { clear: clearSettingsRoute, present: presentSettingsRoute } = settingsRoutePresentation;
  const { onDismissed: onSettingsSheetDismissed, open: openSettingsSheet } =
    settingsSheetPresentation;
  const openSettings = () => {
    presentSettingsRoute(settingsRouteSession);
    openSettingsSheet();
  };

  useEffect(() => {
    if (settingsSheetPresentation.isActive) {
      presentSettingsRoute(settingsRouteSession);
    }
  }, [presentSettingsRoute, settingsRouteSession, settingsSheetPresentation.isActive]);

  useEffect(() => {
    if (!settingsSheetPresentation.isVisible || settingsRoutePresentedRef.current) {
      return;
    }

    settingsRoutePresentedRef.current = true;
    navigation.dispatch(StackActions.push("ThreadSettingsSheet"));
  }, [navigation, settingsSheetPresentation.isVisible]);

  useFocusEffect(() => {
    if (!settingsRoutePresentedRef.current) {
      return;
    }

    settingsRoutePresentedRef.current = false;
    onSettingsSheetDismissed();
    clearSettingsRoute(settingsOwnerId);
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

  const startDictation = () => {
    inputRef.current?.blur();
    voiceInput.start();
  };
  const draftAction = (
    <ComposerDictationTrailingActions
      size={rowControlSize}
      state={voiceInput.state}
      isAvailable={voiceInput.isAvailable}
      disabled={isSubmissionLocked}
      reservesSendWidth={isExpanded}
      onStart={startDictation}
      onCancel={voiceInput.cancel}
    >
      {showStopAction ? (
        <ComposerActionButton
          size={rowControlSize}
          accessibilityLabel="Stop agent"
          disabled={!props.canOperateThread}
          icon="stop.fill"
          variant="danger"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            props.onStopThread();
          }}
        />
      ) : showResumeAction ? (
        <ComposerActionButton
          size={rowControlSize}
          accessibilityLabel="Resume queue"
          disabled={resumingQueue || !props.canOperateThread}
          icon="play"
          variant="primary"
          onPress={() => {
            void handleResumeQueue();
          }}
        />
      ) : hasContent || !voiceInput.isAvailable ? (
        <SendActionButton
          size={rowControlSize}
          accessibilityLabel={sendBlockedReason ?? sendLabel}
          presentation={sendPresentation}
          disabled={!canSend}
          onSend={handleSend}
        />
      ) : null}
    </ComposerDictationTrailingActions>
  );

  return (
    <Animated.View
      onLayout={(event) => props.onHeightChange?.(event.nativeEvent.layout.height)}
      className="px-[12px]"
      style={{
        paddingTop: isExpanded ? 8 : 6,
        paddingBottom: (props.bottomInset ?? 0) + (isExpanded ? 8 : THREAD_COMPOSER_BOTTOM_GUTTER),
        backgroundColor:
          Platform.OS === "android" ? themeColorWithAlpha(composerPanel, 1) : undefined,
      }}
    >
      {/* The backdrop gradient lives on a plain View: Reanimated's Animated.View
          silently drops experimental_backgroundImage on Android, which left this
          strip fully transparent and the feed text legible through the composer. */}
      <View
        className={
          Platform.OS === "android"
            ? "hidden"
            : "absolute inset-0 bg-linear-to-b from-screen/0 via-screen/60 to-screen/90"
        }
        pointerEvents="none"
      />
      <Animated.View
        className="relative w-full self-center"
        style={{ maxWidth: props.contentMaxWidth }}
      >
        {props.draftControls}
        {commandMenuTrigger ? (
          <ComposerPopoverAnchor>
            <ComposerCommandPopover
              items={composerMenu.items}
              triggerKind={commandMenuTrigger.kind}
              isLoading={composerMenu.isLoading}
              error={composerMenu.error}
              onSelect={composerMenu.onSelect}
            />
          </ComposerPopoverAnchor>
        ) : null}

        {selectedProviderStatus?.compatibilityAdvisory?.message &&
        (selectedProviderStatus.compatibilityAdvisory.status === "unsupported" ||
          selectedProviderStatus.compatibilityAdvisory.status === "broken") ? (
          <Text
            accessibilityRole={
              selectedProviderStatus.compatibilityAdvisory.status === "broken" ? "alert" : undefined
            }
            accessibilityLiveRegion={
              selectedProviderStatus.compatibilityAdvisory.status === "broken"
                ? "assertive"
                : "polite"
            }
            className={
              selectedProviderStatus.compatibilityAdvisory.status === "broken"
                ? "bg-danger px-3 py-2 text-xs text-danger-foreground"
                : "px-3 py-2 text-xs text-foreground"
            }
          >
            {selectedProviderStatus.compatibilityAdvisory.message}
          </Text>
        ) : null}
        {modelUnavailable ? (
          <Button
            label="Model unavailable. Open model settings."
            tone="text"
            onPress={openSettings}
          />
        ) : null}

        <ComposerSurface
          transparent={voiceInput.isBusy}
          style={
            isExpanded
              ? {
                  borderRadius: 26,
                  minHeight: 140,
                  overflow: "hidden" as const,
                  paddingBottom: 6,
                  paddingTop: 14,
                }
              : {
                  borderRadius: 27,
                  minHeight:
                    composerDictationToolbarHeight(voicePresentation.statusKind) +
                    COMPACT_SURFACE_INSET * 2,
                  overflow: "hidden" as const,
                  paddingVertical: COMPACT_SURFACE_INSET,
                }
          }
        >
          <ComposerDictationDraftContent
            className={isExpanded ? undefined : "flex-row items-center"}
            compact={!isExpanded}
            hidden={showsCompactDictation}
          >
            {!isExpanded ? (
              <ComposerAttachmentButton
                size={rowControlSize}
                disabled={isSubmissionLocked}
                supportsFiles={Boolean(
                  props.serverConfig?.environment.capabilities.fileAttachments,
                )}
                onPickMedia={props.onPickDraftMedia}
                onPickFiles={props.onPickDraftFiles}
              />
            ) : null}
            {isExpanded && queuedEdit !== null && queuedEdit.existingAttachments.length > 0 ? (
              <Animated.View
                className="px-[14px] pb-2.5"
                entering={COMPOSER_ATTACHMENT_ENTERING}
                exiting={FadeOut.duration(120)}
              >
                <ComposerQueuedEditAttachments
                  environmentId={props.environmentId}
                  attachments={queuedEdit.existingAttachments}
                  disabled={isSubmissionLocked}
                  onRemove={queuedEdit.onRemoveExistingAttachment}
                />
              </Animated.View>
            ) : null}
            {isExpanded && stripAttachments.length > 0 ? (
              <Animated.View
                className="px-[14px] pb-2.5"
                entering={COMPOSER_ATTACHMENT_ENTERING}
                exiting={FadeOut.duration(120)}
              >
                <ComposerAttachmentStrip
                  environmentId={props.environmentId}
                  attachments={stripAttachments}
                  onRemove={isSubmissionLocked ? () => undefined : props.onRemoveDraftImage}
                  onPressPreview={isSubmissionLocked ? undefined : onPressPreview}
                  onPressVideo={isSubmissionLocked ? undefined : onPressVideo}
                  onPressDocument={
                    isSubmissionLocked
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
            <Animated.View
              className={isExpanded ? "px-[14px]" : "min-w-0 flex-1 px-[4px]"}
              layout={COMPOSER_LAYOUT_TRANSITION}
            >
              <ComposerEditor
                hidden={props.hidden}
                draftKey={composerDraftKey}
                environmentId={props.environmentId}
                onOpenMention={(path) => {
                  Keyboard.dismiss();
                  if (props.isDraft) {
                    navigation.navigate("NewTaskFile", {
                      environmentId: String(props.environmentId),
                      cwd: props.projectCwd ?? undefined,
                      path: fileRoutePathSegments(path),
                    });
                  } else {
                    navigation.navigate("ThreadFile", {
                      environmentId: String(props.environmentId),
                      threadId: String(props.selectedThread.id),
                      path: fileRoutePathSegments(path),
                    });
                  }
                }}
                onOpenAttachment={openDraftDocument}
                chipsInert={!isExpanded}
                onInertChipPress={() => inputRef.current?.focus()}
                ref={inputRef}
                multiline
                value={draftMessage}
                // The save uses a draft snapshot; further typing would be discarded on success.
                readOnly={isSubmissionLocked}
                skills={composerMenu.skills}
                selection={composerMenu.selection}
                onChangeText={(text) => {
                  if (!isSubmissionLocked) props.onChangeDraftMessage(text);
                }}
                onSelectionChange={composerMenu.onSelectionChange}
                onPasteImages={(uris) => {
                  if (isSubmissionLocked) return;
                  pendingNativeImagePasteCountRef.current += 1;
                  void props.onNativePasteImages(uris).finally(() => {
                    pendingNativeImagePasteCountRef.current -= 1;
                  });
                }}
                onPasteText={(paste) => {
                  if (isSubmissionLocked) return;
                  const insertPaste = () => {
                    const insertion = replaceTextSelection({
                      value: paste.value,
                      selection: paste.selection,
                      text: paste.text,
                    });
                    const selection = { start: insertion.cursor, end: insertion.cursor };
                    props.onChangeDraftMessage(insertion.value);
                    composerMenu.onSelectionChange(selection);
                  };
                  const capabilities = props.serverConfig?.environment.capabilities;
                  const advertisedMax = capabilities?.fileAttachments?.maxUploadBytes;
                  const maxBytes =
                    advertisedMax === undefined
                      ? null
                      : clampFileAttachmentUploadBytes(advertisedMax);
                  const wouldExceedInputLimit =
                    paste.value.length -
                      Math.max(0, paste.selection.end - paste.selection.start) +
                      paste.text.length >
                    PROVIDER_SEND_TURN_MAX_INPUT_CHARS;
                  const canAttach =
                    maxBytes !== null &&
                    countComposerDraftAttachmentsAfterSelection(composerDraftKey, {
                      text: paste.value,
                      ...paste.selection,
                    }) < PROVIDER_SEND_TURN_MAX_ATTACHMENTS &&
                    new TextEncoder().encode(paste.text).byteLength <= maxBytes;
                  if (
                    pastedTextDisposition({
                      text: paste.text,
                      wouldExceedInputLimit,
                      canAttach: true,
                    }) === "attachment"
                  ) {
                    if (canAttach) {
                      pendingPastedTextAttachmentCountRef.current += 1;
                      setPendingPastedTextAttachmentCount(
                        pendingPastedTextAttachmentCountRef.current,
                      );
                      const finishAttachment = () => {
                        pendingPastedTextAttachmentCountRef.current = Math.max(
                          0,
                          pendingPastedTextAttachmentCountRef.current - 1,
                        );
                        setPendingPastedTextAttachmentCount(
                          pendingPastedTextAttachmentCountRef.current,
                        );
                      };
                      void props.onNativePasteText(paste).then(finishAttachment, finishAttachment);
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
                }}
                placeholder={props.placeholder}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onSubmit={(alternate) =>
                  void handleSend(
                    alternate && sendPresentation.alternate !== null
                      ? sendPresentation.alternate
                      : undefined,
                  )
                }
                submitTitle={sendPresentation.label}
                alternateSubmitTitle={
                  sendPresentation.alternate === null
                    ? sendPresentation.label
                    : FOLLOW_UP_ACTION_LABEL[sendPresentation.alternate]
                }
                scrollEnabled={isExpanded}
                singleLineCentered={!isExpanded}
                contentInsetVertical={
                  isExpanded || Platform.OS === "android" ? 0 : collapsedEditorInset(bodyText)
                }
                style={
                  isExpanded
                    ? {
                        minHeight: 72,
                        maxHeight: 160,
                        paddingVertical: 4,
                      }
                    : {
                        // Large text sizes need room for one full line plus the iOS inset.
                        height: Math.max(
                          INLINE_EDITOR_HEIGHT,
                          Math.ceil(bodyText.lineHeight) +
                            (Platform.OS === "android" ? 0 : 2 * collapsedEditorInset(bodyText)),
                        ),
                      }
                }
                textStyle={{
                  ...bodyText,
                  color: foregroundColor,
                }}
              />
            </Animated.View>
            {!isExpanded && stripAttachments.length > 0 ? (
              <View className="flex-row gap-1 pl-1">
                {stripAttachments.slice(0, 3).map((attachment) => (
                  <ComposerAttachmentThumbnail
                    environmentId={props.environmentId}
                    key={attachment.id}
                    attachment={attachment}
                    size={30}
                    borderRadius={8}
                    compact
                    onPressPreview={isSubmissionLocked ? undefined : onPressPreview}
                    onPressVideo={isSubmissionLocked ? undefined : onPressVideo}
                  />
                ))}
                {stripAttachments.length > 3 ? (
                  <View className="size-[30px] items-center justify-center rounded-lg bg-subtle-strong">
                    <Text className="text-foreground-muted text-2xs font-supaterm-bold">
                      +{stripAttachments.length - 3}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {!isExpanded ? draftAction : null}
            {isExpanded ? <View className="h-1" /> : null}
          </ComposerDictationDraftContent>
          <Animated.View
            accessibilityElementsHidden={!isToolbarVisible}
            collapsable={false}
            importantForAccessibility={isToolbarVisible ? "auto" : "no-hide-descendants"}
            layout={COMPOSER_LAYOUT_TRANSITION}
            pointerEvents={isToolbarVisible ? "auto" : "none"}
            style={
              isExpanded
                ? undefined
                : {
                    position: "absolute",
                    bottom: COMPACT_SURFACE_INSET,
                    left: 0,
                    right: 0,
                  }
            }
          >
            <ComposerDictationToolbar
              statusKind={voicePresentation.statusKind}
              visible={isToolbarVisible}
            >
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
                      disabled={isSubmissionLocked}
                      supportsFiles={Boolean(
                        props.serverConfig?.environment.capabilities.fileAttachments,
                      )}
                      onPickMedia={props.onPickDraftMedia}
                      onPickFiles={props.onPickDraftFiles}
                    />
                    <View className="min-w-0 shrink">
                      <ComposerModelControl
                        descriptors={providerOptionDescriptors}
                        selectedModel={currentModelSelection}
                        reportedModelSelection={props.reportedModelSelection}
                        modelOption={currentModelOption}
                        label={currentModelOption?.label ?? currentModelSelection.model}
                        prompt={draftMessage}
                        onPress={openSettings}
                      />
                    </View>
                    <ComposerSpeedToggle
                      provider={currentModelOption?.providerDriver}
                      descriptors={providerOptionDescriptors}
                      onChange={(options) =>
                        props.onUpdateModelSelection({ ...currentModelSelection, options })
                      }
                    />
                  </>
                )}
                {voicePresentation.showsSend ? (
                  draftAction
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

        {props.connectionState === "connected" && !props.canOperateThread ? (
          <Text className="pt-2 text-xs text-foreground-muted">
            This connection cannot control this task. You can still edit your draft.
          </Text>
        ) : null}
      </Animated.View>

      <VideoPreviewModal source={previewVideo} onRequestClose={closePreview} />
      <FilePreviewModal source={previewFile} onRequestClose={closePreview} />
    </Animated.View>
  );
};
