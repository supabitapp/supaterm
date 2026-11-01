import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@supaterm/contracts/settings";
import { threadContextRecord } from "@supaterm/shared/composerContextReferences";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { useComposerDraftStore } from "../../composerDraftStore";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const THREAD_REF = scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("composer-handle-thread"));
const noop = () => {};

function composerProps(
  composerRef: React.RefObject<ChatComposerHandle | null>,
): ComponentProps<typeof ChatComposer> {
  return {
    composerDraftTarget: THREAD_REF,
    environmentId: ENVIRONMENT_ID,
    canOperateThread: true,
    canQueueMessage: true,
    attachmentUploadsCapabilityKnown: true,
    supportsAttachmentUploads: true,
    supportsQuestionAttachments: false,
    maxFileAttachmentBytes: null,
    routeKind: "server",
    routeThreadRef: THREAD_REF,
    draftId: null,
    multipleModelSelections: null,
    supportsMultipleModels: false,
    onMultipleModelSelectionsChange: noop,
    activeThreadId: THREAD_REF.threadId,
    activeThread: undefined,
    activeThreadShell: null,
    promptHistoryMessages: [],
    isServerThread: true,
    isLocalDraftThread: false,
    forceExpandedOnMobile: false,
    projectSelectionRequired: false,
    phase: "ready",
    canInterrupt: false,
    isSendBusy: false,
    canResume: false,
    sendDisabledReason: null,
    isPreparingWorktree: false,
    isCompacting: false,
    bannerItems: [],
    environmentUnavailable: null,
    activePendingApproval: null,
    pendingApprovals: [],
    pendingUserInputs: [],
    activePendingProgress: null,
    activePendingResolvedAnswers: null,
    activePendingIsResponding: false,
    activePendingDraftAnswers: {},
    activePendingQuestionIndex: 0,
    respondingRequestIds: [],
    activeTasksProgress: null,
    activeTaskSteps: null,
    threadSyncPhase: null,
    runtimeMode: "full-access",
    lockedProvider: null,
    providerStatuses: [],
    providerCatalogKnown: true,
    activeProjectDefaultModelSelection: null,
    activeThreadModelSelection: null,
    activeProjectId: null,
    compactThreadUnavailable: false,
    compactDisabled: true,
    compactDisabledReason: null,
    resolvedTheme: "light",
    settings: DEFAULT_UNIFIED_SETTINGS,
    keybindings: [],
    terminalOpen: false,
    gitCwd: null,
    pullRequestProjectId: null,
    pullRequestRepository: null,
    threadPullRequests: undefined,
    restingControlsHost: null,
    restingControlsHaveLeadingContext: false,
    onRestingControlsVisibilityChange: noop,
    getTimelineScrollableNode: () => null,
    isTimelineAtLogicalEnd: () => true,
    timelineOverflows: false,
    onComposerOverlayHeightChange: noop,
    onRestingChange: noop,
    promptRef: { current: "" },
    composerImagesRef: { current: [] },
    composerFilesRef: { current: [] },
    composerTerminalContextsRef: { current: [] },
    composerRef,
    onPageScrollKeyDown: noop,
    onPageScrollKeyUp: noop,
    onPageScrollRelease: noop,
    editingQueuedAttachments: null,
    onRemoveEditingQueuedAttachment: noop,
    onEditLatestQueuedMessage: () => false,
    onCancelQueuedMessageEdit: noop,
    onCompactContext: noop,
    onSend: async () => {},
    onPrepareVoiceSend: () => async () => {},
    onResume: noop,
    onInterrupt: noop,
    onRespondToApproval: async () => undefined,
    onSelectActivePendingUserInputOption: noop,
    onAdvanceActivePendingUserInput: noop,
    onDismissActivePendingUserInput: noop,
    onPreviousActivePendingUserInputQuestion: noop,
    onChangeActivePendingUserInputCustomAnswer: noop,
    onProviderModelSelect: noop,
    onOpenProviderSetup: noop,
    getModelDisabledReason: () => null,
    handleRuntimeModeChange: noop,
    focusComposer: noop,
    scheduleComposerFocus: noop,
    setThreadError: noop,
    onExpandImage: noop,
    onFileOpen: noop,
  };
}

describe("ChatComposer handle", () => {
  it("sends the thread mentions' current records after only the records change", async () => {
    const composerRef = createRef<ChatComposerHandle | null>();
    await using _screen = await render(<ChatComposer {...composerProps(composerRef)} />);
    const mentioned = threadContextRecord(
      scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("mentioned-thread")),
      "Fix the login flow",
    );
    const store = useComposerDraftStore.getState();

    await act(async () =>
      store.addThreadContexts(THREAD_REF, [mentioned], { appendReference: false }),
    );
    expect(composerRef.current!.getSendContext().threadContexts).toEqual([mentioned]);

    const renamed = { ...mentioned, title: "Fix the signup flow" };
    await act(async () => store.setThreadContexts(THREAD_REF, [renamed]));
    expect(composerRef.current!.getSendContext().threadContexts).toEqual([renamed]);
  });
});
