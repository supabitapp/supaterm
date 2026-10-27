import {
  ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  threadContextsOutsideEnvironment,
} from "@supaterm/shared/composerContextReferences";
import { AuthOrchestrationOperateScope, type PreviewAnnotationPayload } from "@supaterm/contracts";
import { type ComposerDispatchMode } from "@supaterm/client-runtime/state/composer-dispatch";
import {
  type ComposerImageAttachment,
  composerDraftHasUserContent,
  markPromotedDraftThreadByRef,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { type ComposerSubmissionIntent } from "../../composer-logic";
import { type MultipleModelTarget, resolveMultipleModelTargets } from "./chatViewSend";
import {
  buildExpiredTerminalContextToastCopy,
  deriveComposerSendState,
  formatOutgoingPrompt,
  mergeDirectPreviewAnnotation,
  planComposerTurn,
  sendTitleFallbackLabels,
  shouldDockDraftHeroForSubmission,
  shouldRequireWorktreeBaseBranch,
  snapshotComposerSend,
} from "../ChatView.logic";
import {
  buildMessageContext,
  previewAnnotationContextReference,
} from "../../lib/composerContextRecords";
import { captureOutboxAttachments } from "../../state/threadOutboxEditing";
import { declinePendingApprovals } from "@supaterm/client-runtime/state/thread-requests";
import { deriveThreadTitleSeed } from "@supaterm/client-runtime/operations";
import { enqueueThreadOutboxTurns } from "../../state/threadOutbox";
import { ensureInlineContextReferences } from "../../lib/composerContextReferences";
import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { isUsageLimitsCommand } from "@supaterm/shared/usageLimits";
import { newMessageId, newThreadId } from "~/lib/utils";
import {
  parseCodexFeedbackCommand,
  submitCodexFeedback,
} from "@supaterm/client-runtime/state/threads";
import { readCanQueueComposerMessage } from "../../state/composerQueue";
import { readEnvironmentScope } from "../../state/session";
import { releaseDraftAttachments } from "../../lib/attachmentUploadQueue";
import { runMobileComposerTransition } from "./draftHeroTransition";
import { scopeThreadRef, scopedThreadKey } from "@supaterm/client-runtime/environment";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import {
  type DraftId,
  type DraftThreadEnvMode,
  type ComposerThreadTarget,
} from "../../composerDraftStore";
import type { EnvironmentId, RuntimeMode } from "@supaterm/contracts";
import type { CodexFeedbackSubmission } from "@supaterm/client-runtime/state/threads";
import { type Dispatch, type SetStateAction, useLayoutEffect, useRef } from "react";
import type { ComposerHandleRef } from "../../composerHandleContext";
import type { SessionPhase } from "../../types";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { useLogicalProjectEnvironments } from "../../hooks/useLogicalProjectEnvironments";
import { usePaneThreadNavigation } from "../../chatPanes/paneScope";
import { useClientSettingsHydrated } from "../../hooks/useSettings";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentPresentations } from "../../state/presentation";
import {
  approvalRedirectNotice,
  loadBalancingSendWarning,
  multipleModelSendBlock,
  referencedThreadContexts,
} from "./composerSend.logic";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { draftSendState } from "./chatViewSend";
import { parseSideChatCommand } from "./sideChat.logic";
import type { makeThreadErrorSetter } from "../ChatView.logic";
import type { usePendingThreadRequests } from "./usePendingThreadRequests";
import type { useQueuedRunEditWithOutbox } from "./useQueuedRunEditWithOutbox";
import type { useUsageLimitsPanel } from "./useUsageLimitsPanel";
import type { useWorktreeSetup } from "./useWorktreeSetup";
import type { useDraftEnvironmentRouting } from "./useDraftEnvironmentRouting";
import type { useTimelineFollow } from "./useTimelineFollow";

type PendingThreadRequests = ReturnType<typeof usePendingThreadRequests>;

function readEnvironmentPresentation(environmentId: EnvironmentId) {
  return appAtomRegistry.get(environmentPresentations.presentationsAtom).get(environmentId);
}

function draftHasNonPromptContent(target: ComposerThreadTarget) {
  const draft = useComposerDraftStore.getState().getComposerDraft(target);
  return draft ? composerDraftHasUserContent({ ...draft, prompt: "" }) : false;
}
type UsageLimitsPanel = ReturnType<typeof useUsageLimitsPanel>;
type DraftEnvironmentRouting = ReturnType<typeof useDraftEnvironmentRouting>;
type TimelineFollow = ReturnType<typeof useTimelineFollow>;

interface ComposerSendInput {
  readonly environmentId: EnvironmentId;
  readonly routeThreadKey: string;
  readonly currentRouteThreadKeyRef: { readonly current: string | null };
  readonly draftId: DraftId | null;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly activeThreadKey: string | null;
  readonly activeThreadBranch: string | null;
  readonly activeProject: EnvironmentProject | null;
  readonly isServerThread: boolean;
  readonly isLocalDraftThread: boolean;
  readonly isGitRepo: boolean;
  readonly phase: SessionPhase;
  readonly runtimeMode: RuntimeMode;
  readonly sendEnvMode: DraftThreadEnvMode;
  readonly startFromOrigin: boolean;
  readonly worktreeBaseRefsSettled: boolean;
  readonly localCheckoutBranchMismatch: {
    readonly threadBranch: string;
    readonly currentBranch: string;
  } | null;
  readonly logicalProjectEnvironments: ReturnType<typeof useLogicalProjectEnvironments>;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly composerRef: ComposerHandleRef;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly promptRef: { current: string };
  readonly feedbackUploadsInFlightRef: { readonly current: Set<string> };
  readonly queuedRunEdit: ReturnType<typeof useQueuedRunEditWithOutbox>;
  readonly isConnecting: boolean;
  readonly isRevertingCheckpoint: boolean;
  readonly threadDetailLoading: boolean;
  readonly activeEnvironmentUnavailable: boolean;
  readonly isSendBusy: boolean;
  readonly sendQueuesBehindSetup: boolean;
  readonly isDraftHeroState: boolean;
  readonly panelAnimationsActive: boolean;
  readonly panelAnimationDurationMs: number;
  readonly usageLimitsKey: string | null;
  readonly usageLimitsOffered: UsageLimitsPanel["offered"];
  readonly openUsageLimits: UsageLimitsPanel["open"];
  readonly clearUsageLimitsFor: UsageLimitsPanel["clearFor"];
  readonly needsLoadBalancing: DraftEnvironmentRouting["needsLoadBalancing"];
  readonly loadBalancing: DraftEnvironmentRouting["loadBalancing"];
  readonly readPendingEnvironmentChange: DraftEnvironmentRouting["readPendingEnvironmentChange"];
  readonly pendingApprovals: PendingThreadRequests["pendingApprovals"];
  readonly respondingRequestIds: PendingThreadRequests["respondingRequestIds"];
  readonly activePendingProgress: PendingThreadRequests["activePendingProgress"];
  readonly onAdvanceActivePendingUserInput: PendingThreadRequests["onAdvanceActivePendingUserInput"];
  readonly onRespondToApproval: PendingThreadRequests["onRespondToApproval"];
  readonly beginWorktreeSetup: ReturnType<typeof useWorktreeSetup>["begin"];
  readonly captureDraftHeroLayout: () => void;
  readonly setDockedDraftHeroThreadKey: Dispatch<SetStateAction<string | null>>;
  readonly setFeedbackSubmissionsByThreadKey: Dispatch<
    SetStateAction<Record<string, ReadonlyArray<CodexFeedbackSubmission>>>
  >;
  readonly setThreadError: ReturnType<typeof makeThreadErrorSetter>;
  readonly anchorNewTurn: TimelineFollow["anchorNewTurn"];
  readonly handleNewThreadInActiveProject: () => void;
  /** Set where `/side` and `/btw` open a side chat instead of reaching this thread. */
  readonly openSideChat: ((question: string) => Promise<boolean>) | null;
}

/**
 * Every way the composer sends: a new message through the IndexedDB outbox, an outbox or
 * queued-message edit save, and the Codex feedback and usage-limits commands. A send that
 * redirects pending approvals declines them before it enqueues.
 */
export function useComposerSend(input: ComposerSendInput) {
  const {
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
    openSideChat,
  } = input;
  const openPaneThread = usePaneThreadNavigation();
  const clientSettingsHydrated = useClientSettingsHydrated();
  const uploadThreadFeedback = useOrchestrationCommand(threadEnvironment.uploadFeedback, {
    reportFailure: false,
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const { sendInFlight: sendInFlightRef } = draftSendState(routeThreadKey);
  // A send awaits its approval declines, so it reads the approvals pending by then.
  const pendingApprovalsRef = useRef(pendingApprovals);
  const respondingRequestIdsRef = useRef(respondingRequestIds);
  useLayoutEffect(() => {
    pendingApprovalsRef.current = pendingApprovals;
    respondingRequestIdsRef.current = respondingRequestIds;
  }, [pendingApprovals, respondingRequestIds]);

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
    // What the user pressed send on; declining approvals below takes a round trip, and a
    // redirect must not go out for a draft that changed meanwhile.
    const promptAtSend = promptRef.current;
    if (queuedRunEdit.outbox.isEditing) {
      if (!directAnnotation)
        await queuedRunEdit.outbox.saveEdit({ runtimeMode, sendInFlightRef }, setThreadError);
      return;
    }

    if (
      usageLimitsOffered &&
      usageLimitsKey !== null &&
      !directAnnotation &&
      !draftHasNonPromptContent(composerDraftTarget) &&
      isUsageLimitsCommand(promptRef.current)
    ) {
      if (openUsageLimits()) {
        promptRef.current = "";
        setComposerDraftPrompt(composerDraftTarget, "");
        composerRef.current?.resetCursorState();
      }
      return;
    }

    const answeringPendingUserInput =
      activePendingProgress !== null &&
      composerRef.current?.getSendContext().answeringPendingUserInput !== false;
    const sideChatQuestion =
      directAnnotation || queuedRunEdit.isEditing || answeringPendingUserInput
        ? null
        : parseSideChatCommand(promptAtSend);
    if (openSideChat !== null && sideChatQuestion !== null) {
      if (sideChatQuestion.length > 0 && draftHasNonPromptContent(composerDraftTarget)) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Side chat questions are text only",
            description:
              "Remove the attachments, or open the side chat with /side and add them there.",
          }),
        );
        return;
      }
      // Cleared only once the side chat has the question, so a failed open keeps it.
      if ((await openSideChat(sideChatQuestion)) && promptRef.current === promptAtSend) {
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
      readPendingEnvironmentChange() !== null ||
      sendInFlightRef.current ||
      feedbackUploadsInFlightRef.current.has(routeThreadKey)
    ) {
      notifyDirectAnnotationAttached();
      return;
    }
    if (needsLoadBalancing) {
      const draft = useComposerDraftStore.getState().getComposerDraft(composerDraftTarget);
      toastManager.add({
        type: "warning",
        ...loadBalancingSendWarning({
          pending: loadBalancing.pending,
          threadContexts: draft ? referencedThreadContexts(draft) : [],
          candidateEnvironmentIds: logicalProjectEnvironments.map(
            (candidate) => candidate.environmentId,
          ),
        }),
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
    const multipleModelBlock =
      multipleModelSelections === null
        ? null
        : multipleModelSendBlock({
            selectionCount: multipleModelSelections.length,
            environmentConnected:
              readEnvironmentPresentation(activeThread.environmentId)?.serverConfig != null,
            isLocalDraftThread,
            isGitRepo,
            missingBaseBranch: shouldRequireWorktreeBaseBranch({
              shouldCreateWorktree: true,
              activeThreadBranch,
              refsSettled: worktreeBaseRefsSettled,
              environmentUnavailable: activeEnvironmentUnavailable,
            }),
          });
    if (multipleModelBlock === "environment-disconnected") {
      setThreadError(
        activeThread.id,
        "Connect to this environment before starting multiple models.",
      );
      return;
    }
    if (multipleModelBlock === "needs-new-git-thread") {
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
    const { images: composerImages, previewAnnotations: composerPreviewAnnotations } =
      mergeDirectPreviewAnnotation({
        images: sendContextImages,
        fileCount: composerFiles.length,
        previewAnnotations: sendContextPreviewAnnotations,
        direct: directAnnotation,
      });
    // A direct "send annotation" writes the draft and sends in the same tick; the reference
    // must be in the text now, not after the next render.
    const promptForSend = directAnnotation
      ? ensureInlineContextReferences(promptRef.current, [
          previewAnnotationContextReference(directAnnotation.annotation),
        ])
      : promptRef.current;
    const strandedThread = threadContextsOutsideEnvironment({
      text: promptForSend,
      records: composerThreadContexts,
      environmentId,
    })[0];
    if (strandedThread) {
      const owner =
        readEnvironmentPresentation(strandedThread.environmentId)?.entry.target.label ??
        "its machine";
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Attached thread is on another machine",
          description: `This machine's agent can't read "${strandedThread.title}". Remove it, or switch back to ${owner} to send.`,
        }),
      );
      return;
    }
    if (queuedRunEdit.isEditing) {
      // Edit mode repurposes the composer: sending saves the queued message
      // in place instead of dispatching a new turn.
      await queuedRunEdit.saveEdit(
        {
          prompt: promptForSend,
          images: composerImages,
          files: composerFiles,
          terminalContexts: composerTerminalContexts,
          reviewComments: composerReviewComments,
          previewAnnotations: composerPreviewAnnotations,
          threadContexts: composerThreadContexts,
        },
        setThreadError,
      );
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
    const {
      shouldCreateWorktree,
      missingWorktreeBaseBranch,
      baseBranchForWorktree,
      turnDispatchMode,
      shouldQueueBehindActiveRun,
    } = planComposerTurn({
      sendQueuesBehindSetup,
      isLocalDraftThread,
      sendEnvMode,
      worktreePath: activeThread.worktreePath,
      activeThreadBranch,
      worktreeBaseRefsSettled,
      environmentUnavailable: activeEnvironmentUnavailable,
      phase,
      dispatchMode,
    });
    if (missingWorktreeBaseBranch) {
      setThreadError(threadIdForSend, "Select a base branch before sending in New worktree mode.");
      return;
    }

    const sendSnapshot = snapshotComposerSend({
      prompt: promptForSend,
      images: composerImages,
      files: composerFiles,
      terminalContexts: composerTerminalContexts,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      previewAnnotations: composerPreviewAnnotations,
      reviewComments: composerReviewComments,
      threadContexts: composerThreadContexts,
    });
    const composerAttachmentsSnapshot = sendSnapshot.attachments;
    const messageTextForSend = sendSnapshot.messageText;
    // Records bind attachments by their local id; the outbox rebinds them to the upload id
    // on delivery and the server to the persisted id.
    const outgoingMessageContext = buildMessageContext({
      terminalContexts: sendSnapshot.terminalContexts,
      reviewComments: sendSnapshot.reviewComments,
      previewAnnotations: sendSnapshot.previewAnnotations,
      threadContexts: sendSnapshot.threadContexts,
      attachments: composerAttachmentsSnapshot.map((attachment) => ({
        attachment,
        attachmentId: attachment.id,
      })),
    });
    const messageIdForSend = newMessageId();
    const messageCreatedAt = new Date().toISOString();
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

    const multipleTargets: MultipleModelTarget[] = [];
    for (const target of resolveMultipleModelTargets({
      selections: multipleModelSelections ?? [],
      providerInstanceEntries,
      messageText: messageTextForSend,
      interactionMode: sendInteractionMode,
    })) {
      if ("error" in target) {
        setThreadError(threadIdForSend, target.error);
        return;
      }
      if (composerRef.current?.validateProviderInput(target.text) === false) return;
      multipleTargets.push(target);
    }

    sendInFlightRef.current = true;
    // A message sent while approvals are pending redirects the agent. They are declined only
    // here, after everything above has accepted the send and before the message enters the
    // outbox, so local commands and rejected drafts leave them alone.
    const approvalsToDecline =
      currentRouteThreadKeyRef.current === routeThreadKey
        ? pendingApprovalsRef.current.filter((approval) =>
            sendCtx.shownPendingApprovalIds.includes(approval.requestId),
          )
        : [];
    if (approvalsToDecline.length > 0) {
      // A draft edited since send, or a paste still landing in it, is no longer the message
      // the user sent.
      const attachmentIdsAtSend = composerAttachmentsSnapshot.map((attachment) => attachment.id);
      // A direct annotation send writes its image and reference into the draft as it sends,
      // so the live draft may still lack them; anything else differing is a real edit.
      const annotationImageId = directAnnotation?.image?.id;
      const attachmentIdsBeforeAnnotation = attachmentIdsAtSend.filter(
        (id) => id !== annotationImageId,
      );
      const sameIds = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
        left.length === right.length && left.every((id, index) => id === right[index]);
      const draftChangedSinceSend = () => {
        if (composerRef.current?.hasPendingAttachments() === true) return true;
        const sendContext = composerRef.current?.getSendContext();
        const attachmentIds = sendContext
          ? [...sendContext.images, ...sendContext.files].map((attachment) => attachment.id)
          : attachmentIdsAtSend;
        const promptUnchanged =
          promptRef.current === promptAtSend || promptRef.current === promptForSend;
        const attachmentsUnchanged =
          sameIds(attachmentIds, attachmentIdsAtSend) ||
          (annotationImageId !== undefined &&
            sameIds(attachmentIds, attachmentIdsBeforeAnnotation));
        return !promptUnchanged || !attachmentsUnchanged;
      };
      const draftBeforeDecline = useComposerDraftStore
        .getState()
        .getComposerDraft(composerDraftTarget);
      const changedBeforeDecline = draftChangedSinceSend();
      const pendingIdsBeforeDecline = new Set(
        pendingApprovalsRef.current.map((approval) => approval.requestId),
      );
      const approvalResponding = approvalsToDecline.some((approval) =>
        respondingRequestIdsRef.current.includes(approval.requestId),
      );
      const declined =
        !changedBeforeDecline &&
        !approvalResponding &&
        (await declinePendingApprovals(approvalsToDecline, onRespondToApprovalStable).catch(
          () => false,
        ));
      const draftChanged =
        changedBeforeDecline ||
        draftChangedSinceSend() ||
        useComposerDraftStore.getState().getComposerDraft(composerDraftTarget) !==
          draftBeforeDecline;
      // An approval that arrived during the decline would block the redirect; keep the draft so
      // the next send declines it too.
      const approvalArrived = pendingApprovalsRef.current.some(
        (approval) => !pendingIdsBeforeDecline.has(approval.requestId),
      );
      if (
        !declined ||
        draftChanged ||
        approvalArrived ||
        currentRouteThreadKeyRef.current !== routeThreadKey
      ) {
        sendInFlightRef.current = false;
        const notice = approvalRedirectNotice({
          draftChanged,
          declined,
          approvalResponding,
          approvalArrived,
        });
        if (notice !== null) {
          toastManager.add({
            type: "info",
            title: notice,
            description: "Send again when it's ready.",
          });
        }
        return;
      }
    }
    const savedDraft = useComposerDraftStore.getState().getComposerDraft(composerDraftTarget);
    // Anything thrown while saving to the outbox shows on the thread; the send flag still clears.
    const sendResult = await settlePromise(async () => {
      const title = deriveThreadTitleSeed({
        text: trimmed,
        attachments: composerAttachmentsSnapshot.map((attachment) => ({
          type: attachment.type,
          name: attachment.name,
        })),
        fallbackLabels: sendTitleFallbackLabels(sendSnapshot),
      });
      const localAttachments = captureOutboxAttachments(environmentId, composerAttachmentsSnapshot);
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
      if (multipleModelSelections === null && !shouldQueueBehindActiveRun) {
        // Anchor the sent turn when its acknowledged row arrives in the transcript.
        anchorNewTurn(
          scopedThreadKey(scopeThreadRef(environmentId, threadIdForSend)),
          messageIdForSend,
        );
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
        beginWorktreeSetup(
          multipleModelSelections === null && baseBranchForWorktree
            ? { environmentId, threadId: threadIdForSend }
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
        void openPaneThread(
          { kind: "server", threadRef: scopeThreadRef(environmentId, targets[0].threadId) },
          { replace: true },
        );
      }
    });
    if (sendResult._tag === "Failure") {
      const error = squashAtomCommandFailure(sendResult);
      setThreadError(
        threadIdForSend,
        error instanceof Error ? error.message : "Could not save the pending message.",
      );
    }
    sendInFlightRef.current = false;
  };

  return { onSend };
}
