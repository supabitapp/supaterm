import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@supaterm/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@supaterm/contracts/settings";
import { threadContextRecord } from "@supaterm/shared/composerContextReferences";
import { createRef, type ComponentProps, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { useComposerDraftStore } from "../../composerDraftStore";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";

// The real layer positions itself from the composer's on-screen rect, which a test page lacks.
vi.mock("./ComposerCommandMenuLayer", () => ({
  ComposerCommandMenuLayer: ({ children }: { children: ReactNode }) => children,
}));

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

function readyProvider(
  instanceId: string,
  driver: string,
  model: { slug: string; name: string },
  overrides: Partial<ServerProvider> = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-01T00:00:00.000Z",
    models: [{ ...model, isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("ChatComposer model mentions", () => {
  it("names a model from the @ menu without switching the thread's model", async () => {
    const composerRef = createRef<ChatComposerHandle | null>();
    const onProviderModelSelect = vi.fn();
    const threadModel = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
    const threadRef = scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("model-mention-thread"));
    await using screen = await render(
      <ChatComposer
        {...composerProps(composerRef)}
        composerDraftTarget={threadRef}
        routeThreadRef={threadRef}
        activeThreadId={threadRef.threadId}
        providerStatuses={[
          readyProvider("codex", "codex", { slug: "gpt-5.4", name: "GPT-5.4" }),
          readyProvider("claudeAgent", "claudeAgent", {
            slug: "claude-opus-4-5",
            name: "Claude Opus 4.5",
          }),
          readyProvider(
            "claudeSignedOut",
            "claudeAgent",
            { slug: "claude-opus-4-1", name: "Claude Opus 4.1" },
            { auth: { status: "unauthenticated" } },
          ),
        ]}
        activeThreadModelSelection={threadModel}
        onProviderModelSelect={onProviderModelSelect}
      />,
    );
    const modelBefore = composerRef.current!.getSendContext().selectedModelSelection;
    expect(modelBefore).toMatchObject(threadModel);

    await act(async () => composerRef.current!.focusAtEnd());
    await userEvent.keyboard("Ask @opus");
    await expect.element(screen.getByRole("option", { name: /Claude Opus 4\.5/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Claude Opus 4\.1/ }).query()).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: /Claude Opus 4\.5/ }));

    await vi.waitFor(() =>
      expect(
        useComposerDraftStore.getState().getComposerDraft(threadRef)?.referenceContexts,
      ).toMatchObject([
        {
          kind: "model",
          instanceId: "claudeAgent",
          model: "claude-opus-4-5",
          label: "Claude Opus 4.5",
        },
      ]),
    );
    const draft = useComposerDraftStore.getState().getComposerDraft(threadRef)!;
    const [record] = draft.referenceContexts;
    expect(draft.prompt).toBe(
      `Ask [Claude Opus 4.5](supaterm-context://v1/model/${record!.contextId}) `,
    );
    await expect.element(screen.getByLabelText("Model, Claude Opus 4.5")).toBeVisible();
    expect(onProviderModelSelect).not.toHaveBeenCalled();
    expect(composerRef.current!.getSendContext().selectedModelSelection).toEqual(modelBefore);
  });
});

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
      store.addReferenceContexts(THREAD_REF, [mentioned], { appendReference: false }),
    );
    expect(composerRef.current!.getSendContext().referenceContexts).toEqual([mentioned]);

    const renamed = { ...mentioned, title: "Fix the signup flow" };
    await act(async () => store.setReferenceContexts(THREAD_REF, [renamed]));
    expect(composerRef.current!.getSendContext().referenceContexts).toEqual([renamed]);
  });
});
