import { ActiveNewTaskContext } from "../../state/active-new-task";
import { resolveNewThreadModelSelection } from "@supaterm/shared/usageLimits";
import { useNowMinuteMs } from "../../lib/clock";
import * as Dialog from "../../components/ui/Dialog";
import { CommonActions, useNavigation } from "@react-navigation/native";
import React, { useEffect, useEffectEvent, useLayoutEffect } from "react";

import type {
  EnvironmentId,
  ModelSelection,
  ProviderOptionSelection,
  RuntimeMode,
} from "@supaterm/contracts";
import {
  CommandId,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  repositoryGroupingKeyOf,
  ThreadId,
} from "@supaterm/contracts";
import { threadContextsOutsideEnvironment } from "@supaterm/shared/composerContextReferences";
import { isTriagePrompt, replaceTriagePlaybookLink } from "@supaterm/shared/triagePrompt";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";

import { useProjects, useServerConfigs, useThreadShells } from "../../state/entities";
import type { TurnCommandMetadata } from "../../lib/commandMetadata";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import {
  buildModelOptions,
  groupByProvider,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
  resolveSelectableModelSelection,
  serverConfigForCwd,
} from "../../lib/modelOptions";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { useAtomValue } from "@effect/atom-react";
import { appAtomRegistry } from "../../state/atom-registry";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  type ComposerDraftWorkspaceSelection,
  clearComposerDraft,
  composerDraftsLoadedAtom,
  createNewTaskDraft,
  getComposerDraftSnapshot,
  isComposerDraftEmpty,
  isNewTaskDraftKey,
  removeComposerDraftAttachment,
  replaceComposerDraftAttachments,
  retargetNewTaskDraft,
  scheduleUnusedComposerAttachmentCleanup,
  setComposerDraftText,
  setComposerDraftContext,
  setStickyComposerModelSelection,
  setStickyNewTaskProject,
  updateComposerDraftSettings,
  useComposerDraft,
  useStickyComposerModelSelection,
} from "../../state/use-composer-drafts";
import {
  capturePendingTaskEditorWriteBaseline,
  flushPendingTaskEditorWrite,
} from "../../state/pending-task-editor-writes";
import {
  rememberModelOptions,
  withRememberedModelOptions,
} from "../../state/use-model-option-memory";
import { useBranches, usePaginatedBranches } from "../../state/queries";
import { vcsEnvironment } from "../../state/vcs";
import {
  flattenQueuedThreadMessages,
  hasQueuedFollowUps,
  threadOutboxManager,
  type QueuedThreadMessage,
} from "../../state/thread-outbox";
import {
  holdEditingQueuedMessage,
  pauseEditingQueuedMessage,
  releaseEditingQueuedMessage,
  useThreadOutboxMessages,
} from "../../state/use-thread-outbox";
import {
  setPendingConnectionError,
  useRemoteConnectionStatus,
  useSavedRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { availableScratchWorkspaceRoot } from "@supaterm/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { type VcsRef } from "@supaterm/client-runtime/state/vcs";
import {
  buildHomeProjectScopes,
  sortHomeProjectScopes,
  type HomeProjectScope,
} from "../home/homeThreadList";
import { useMobileProjectGroupingSettings } from "../../state/project-grouping";
import {
  resolveNewTaskBranchWorktreePath,
  resolveNewTaskDraftWorkspace,
  resolveNewTaskLocalWorkspaceSelection,
} from "./new-task-context-presentation";
import { useNewTaskProjectDefaults } from "./use-new-task-project-defaults";
import {
  INACTIVE_FLOW_KEY,
  type NewTaskEnvironmentSwitch,
  type NewTaskFlowRoute,
  type NewTaskFlowState,
  newTaskFlowRoute,
  newTaskFlowStateAtom,
  newTaskPendingKey,
  readNewTaskFlowState,
  resolveRouteDraft,
  type RouteDraftResolution,
  stampedEnvironmentProjectsLoading,
  updateNewTaskFlowState,
} from "./new-task-flow-state";
import { usePrepareTriage } from "../triage/usePrepareTriage";
import { useEnvironmentShellReadiness } from "../../state/shell";
import { useConnectionsReady, useWorkspaceEnvironments } from "../../state/workspace";
import { isSameRepository, resolveEnvironmentProjectMatch } from "./new-task-project-selection";
import { resolveDefaultWorktreeBaseBranch } from "../../lib/worktree-base-branch";
import { resolveProjectThreadCreationBranch } from "./projectThreadCreationValidation";

type WorkspaceMode = "local" | "worktree";

function pendingTaskDraftKey(messageId: string) {
  return `pending-task:${messageId}`;
}

let activeEditingMessageId: string | null = null;

function findQueuedPendingTask(messageId: string) {
  const message = flattenQueuedThreadMessages(
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  ).find((candidate) => candidate.messageId === messageId);
  return message?.creation !== undefined ? message : null;
}

function canMoveEditedPendingTask(
  editing: QueuedThreadMessage | null,
  environmentId: EnvironmentId,
) {
  if (
    editing === null ||
    editing.environmentId === environmentId ||
    !hasQueuedFollowUps(
      appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
      editing,
    )
  ) {
    return true;
  }
  Dialog.alert(
    "Messages are queued behind this task",
    "They wait on this machine, so the task stays here until they send.",
  );
  return false;
}

type NewTaskFlowContextValue = {
  readonly projectScopes: ReadonlyArray<HomeProjectScope>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly workspaceMode: WorkspaceMode;
  readonly isGitRepo: boolean;
  readonly isGitRepoKnown: boolean;
  readonly canChooseWorkspace: boolean;
  readonly selectedBranchName: string | null;
  readonly defaultBaseBranchName: string | null;
  readonly selectedWorktreePath: string | null;
  readonly workspaceCwd: string | null;
  readonly startFromOrigin: boolean;
  readonly pullRequestReference: string | undefined;
  readonly draftKey: string | null;
  readonly editingPendingTask: QueuedThreadMessage | null;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly submitting: boolean;
  readonly branchesLoading: boolean;
  readonly availableBranches: ReadonlyArray<VcsRef>;
  readonly currentCheckoutBranchName: string | null;
  readonly runtimeMode: RuntimeMode;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string;
  }>;
  readonly selectedProject: EnvironmentProject | null;
  readonly isScratchDraft: boolean;
  readonly selectedModel: ModelSelection | null;
  readonly selectedModelOption: ModelOption | null;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly flowKey: string;
  readonly served: boolean;
  readonly setProject: (project: EnvironmentProject) => void;
  readonly getSelectedProjectKey: () => string | null;
  readonly unopenableRouteDraft: {
    readonly draftId: string;
    readonly kind: "missing" | "pickProject";
  } | null;
  readonly switchEnvironment: (environmentId: EnvironmentId) => Promise<boolean>;
  readonly switchingToEnvironmentId: EnvironmentId | null;
  readonly environmentPinned: boolean;
  readonly setSelectedModelKey: (
    key: string | null,
    options?: ReadonlyArray<ProviderOptionSelection>,
  ) => void;
  readonly setWorkspaceMode: (mode: WorkspaceMode) => void;
  readonly selectBranch: (branch: VcsRef) => void;
  readonly setStartFromOrigin: (value: boolean) => void;
  readonly finishEditingPendingTask: () => void;
  readonly buildPendingTaskMessage: (
    metadata: TurnCommandMetadata,
    options?: {
      readonly currentCheckoutBranch?: string | null;
      readonly useDefaultBranch?: boolean;
    },
  ) => QueuedThreadMessage | null;
  readonly setPrompt: (value: string) => void;
  readonly removeAttachment: (imageId: string) => void;
  readonly setSubmitting: (value: boolean) => void;
  readonly loadBranches: () => void;
  readonly setRuntimeMode: (value: RuntimeMode) => void;
  readonly setSelectedModelOptions: (
    value: ReadonlyArray<ProviderOptionSelection> | undefined,
  ) => void;
};

const NewTaskFlowContext = React.createContext<NewTaskFlowContextValue | null>(null);

interface ServedNewTaskRoute {
  readonly route: NewTaskFlowRoute;
  readonly active: boolean;
}

const ServedNewTaskRouteContext = React.createContext<ServedNewTaskRoute | null>(null);

/**
 * Names the topmost draft route on the stack. Its flow backs the pickers and
 * overlays above it, and the thread list highlights it while it is active.
 */
export function ServedNewTaskRouteProvider(
  props: React.PropsWithChildren<{
    readonly route: { readonly key: string; readonly params?: object } | undefined;
    readonly active: boolean;
  }>,
) {
  const route = props.route === undefined ? undefined : newTaskFlowRoute(props.route);
  const flow = useAtomValue(newTaskFlowStateAtom(route?.flowKey ?? INACTIVE_FLOW_KEY));
  const served = route === undefined ? null : { route, active: props.active };
  const activeNewTask =
    route !== undefined && props.active ? { pendingKey: newTaskPendingKey(route, flow) } : null;
  return (
    <ServedNewTaskRouteContext value={served}>
      <ActiveNewTaskContext value={activeNewTask}>{props.children}</ActiveNewTaskContext>
    </ServedNewTaskRouteContext>
  );
}

/** The flow of one draft Thread route, which owns its draft and pending-task edit. */
export function NewTaskFlowProvider(
  props: React.PropsWithChildren<{ readonly route: NewTaskFlowRoute }>,
) {
  const servedRoute = React.use(ServedNewTaskRouteContext);
  const served = servedRoute?.route.flowKey === props.route.flowKey;
  const value = useNewTaskFlowValue(props.route, {
    owner: true,
    served,
    active: served && servedRoute?.active === true,
  });
  return <NewTaskFlowContext value={value}>{props.children}</NewTaskFlowContext>;
}

/** The draft route's own flow. */
export function useNewTaskFlow() {
  const value = React.use(NewTaskFlowContext);
  if (value === null) {
    throw new Error("useNewTaskFlow must be used within NewTaskFlowProvider.");
  }
  return value;
}

/** The served draft route's flow, for the pickers and overlays stacked above it. */
export function useServedNewTaskFlow() {
  const servedRoute = React.use(ServedNewTaskRouteContext);
  return useNewTaskFlowValue(servedRoute?.route, {
    owner: false,
    served: servedRoute !== null,
    active: servedRoute?.active === true,
  });
}

function useNewTaskFlowValue(
  route: NewTaskFlowRoute | undefined,
  instance: { readonly owner: boolean; readonly served: boolean; readonly active: boolean },
): NewTaskFlowContextValue;
function useNewTaskFlowValue(
  route: NewTaskFlowRoute | undefined,
  instance: { readonly owner: boolean; readonly served: boolean; readonly active: boolean },
) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const groupingSettings = useMobileProjectGroupingSettings();

  const projectScopes = sortHomeProjectScopes({
    scopes: buildHomeProjectScopes({
      projects,
      environmentId: null,
      projectGroupingMode: groupingSettings.sidebarProjectGroupingMode,
    }),
    threads,
    pendingTasks: [],
    projectSortOrder: "updated_at",
  });

  const flowKey = route?.flowKey ?? INACTIVE_FLOW_KEY;
  const routePendingTaskId = route?.pendingTaskId;
  const routeDraftId = routePendingTaskId === undefined ? route?.draftId : undefined;
  const ownsSession = instance.owner && instance.served;
  const createsDraft = instance.owner && instance.active;
  const storedFlowState = useAtomValue(newTaskFlowStateAtom(flowKey));
  const draftsLoaded = useAtomValue(composerDraftsLoadedAtom);
  const routeDraft = useComposerDraft(
    storedFlowState.draftKey === null ? (routeDraftId ?? null) : null,
  );
  const stampedEnvironmentId = routeDraft.project?.environmentId ?? null;
  const connectionsReady = useConnectionsReady();
  const stampedEnvironmentConnection =
    useWorkspaceEnvironments().find(
      (environment) => environment.environmentId === stampedEnvironmentId,
    )?.connectionState ?? null;
  const stampedEnvironmentShell = useEnvironmentShellReadiness(stampedEnvironmentId);
  const stampedEnvironmentLoading = stampedEnvironmentProjectsLoading({
    connectionsReady,
    connectionState: stampedEnvironmentConnection,
    shellCacheRead: stampedEnvironmentShell.cacheRead,
    shellStatus: stampedEnvironmentShell.status,
    shellHasError: stampedEnvironmentShell.hasError,
  });
  const resolveRoute = (
    flow: NewTaskFlowState,
    loaded: boolean,
    stamp: Parameters<typeof resolveRouteDraft>[0]["stamp"],
  ) =>
    resolveRouteDraft({
      flow,
      routeDraftId,
      draftsLoaded: loaded,
      stamp,
      projects,
      stampedEnvironmentLoading,
    }) satisfies RouteDraftResolution;
  const routeDraftResolution = resolveRoute(storedFlowState, draftsLoaded, routeDraft.project);
  const flowState =
    routeDraftResolution.kind === "open" ? routeDraftResolution.flow : storedFlowState;
  const {
    environmentId: selectedEnvironmentIdOverride,
    projectKey: selectedProjectKey,
    draftKey: activeDraftKey,
    submitting,
  } = flowState;
  const editingPendingTask = flowState.editingPendingTask?.message ?? null;
  const switchingToEnvironmentId = flowState.environmentSwitch?.environmentId ?? null;
  const readFlow = () => {
    const stored = readNewTaskFlowState(flowKey);
    const resolution = resolveRoute(
      stored,
      appAtomRegistry.get(composerDraftsLoadedAtom),
      routeDraftId === undefined ? undefined : getComposerDraftSnapshot(routeDraftId).project,
    );
    return (resolution.kind === "open" ? resolution.flow : stored) satisfies NewTaskFlowState;
  };
  const updateFlow = (patch: Partial<NewTaskFlowState>) =>
    updateNewTaskFlowState(flowKey, { ...readFlow(), ...patch });
  const readEditingPendingTask = () => readFlow().editingPendingTask?.message ?? null;
  const draftStamp = useComposerDraft(activeDraftKey).project;
  const stampedProject =
    draftStamp === undefined
      ? undefined
      : projects.find(
          (project) =>
            project.environmentId === draftStamp.environmentId &&
            project.id === draftStamp.projectId,
        );
  const selectedEnvironmentId =
    stampedProject?.environmentId ??
    (selectedEnvironmentIdOverride !== null &&
    projects.some((project) => project.environmentId === selectedEnvironmentIdOverride)
      ? selectedEnvironmentIdOverride
      : (projects[0]?.environmentId ?? null));

  const cancelEnvironmentSwitch = () => updateFlow({ environmentSwitch: null });
  const setSubmitting = (value: boolean) =>
    updateFlow({ submitting: value, ...(value ? { environmentSwitch: null } : {}) });

  const projectsForEnvironment = pipe(
    projects,
    Arr.filter((project) => project.environmentId === selectedEnvironmentId),
  );

  const editingPendingProject = (() => {
    const creation = editingPendingTask?.creation;
    if (!editingPendingTask || !creation) {
      return null;
    }
    return {
      environmentId: editingPendingTask.environmentId,
      id: creation.projectId,
      title: creation.projectTitle ?? "Unknown project",
      workspaceRoot: creation.projectCwd ?? "",
      repositoryIdentity: null,
      defaultModelSelection: editingPendingTask.modelSelection ?? null,
      scripts: [],
      createdAt: editingPendingTask.createdAt,
      updatedAt: editingPendingTask.createdAt,
    };
  })();

  const selectedProject =
    routeDraftResolution.kind === "pending"
      ? null
      : (stampedProject ??
        projectsForEnvironment.find(
          (project) => scopedProjectKey(project.environmentId, project.id) === selectedProjectKey,
        ) ??
        (editingPendingProject !== null &&
        selectedProjectKey ===
          scopedProjectKey(editingPendingProject.environmentId, editingPendingProject.id)
          ? editingPendingProject
          : (projectsForEnvironment[0] ?? null)));

  const storedStickyModelSelection = useStickyComposerModelSelection();
  const modelSelectionNow = useNowMinuteMs();
  const projectDefaults = useNewTaskProjectDefaults(selectedProject);
  const isScratchDraft = projectDefaults.isScratch;
  const serverConfigs = useServerConfigs();
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const selectedProjectDraftKey = editingPendingTask
    ? pendingTaskDraftKey(editingPendingTask.messageId)
    : selectedProject
      ? activeDraftKey
      : null;
  const draftProjectKey = selectedProject
    ? scopedProjectKey(selectedProject.environmentId, selectedProject.id)
    : null;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- abandons the in-flight environment switch when its owning draft or project changes, or the route stops being served or unmounts
  useLayoutEffect(() => {
    if (!ownsSession) return;
    return () => {
      const request = readNewTaskFlowState(flowKey).environmentSwitch;
      if (request?.draftKey === selectedProjectDraftKey && request.projectKey === draftProjectKey) {
        updateNewTaskFlowState(flowKey, { environmentSwitch: null });
      }
    };
  }, [flowKey, ownsSession, selectedProjectDraftKey, draftProjectKey]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- creates the persistent draft in the new-task flow store once a project is selected
  useEffect(() => {
    if (
      !createsDraft ||
      routeDraftId !== undefined ||
      activeDraftKey !== null ||
      editingPendingTask !== null ||
      selectedProject === null ||
      readNewTaskFlowState(flowKey).draftKey !== null
    ) {
      return;
    }
    updateNewTaskFlowState(flowKey, {
      draftKey: createNewTaskDraft({
        environmentId: selectedProject.environmentId,
        projectId: selectedProject.id,
      }),
    });
  }, [activeDraftKey, createsDraft, editingPendingTask, flowKey, selectedProject, routeDraftId]);
  const selectedProjectDraft = useComposerDraft(selectedProjectDraftKey);
  const prompt = selectedProjectDraft.text;
  const attachments = selectedProjectDraft.attachments;
  const projectGitStatus = useEnvironmentQuery(
    instance.served && selectedProject !== null && selectedProject.workspaceRoot !== ""
      ? vcsEnvironment.status({
          environmentId: selectedProject.environmentId,
          input: { cwd: selectedProject.workspaceRoot },
        })
      : null,
  );
  const currentCheckoutBranchName = projectGitStatus.data?.refName ?? null;
  const projectBranches = useBranches({
    environmentId: selectedProject?.environmentId ?? null,
    cwd: selectedProject?.workspaceRoot || null,
  });
  const knownIsGitRepo = projectGitStatus.data?.isRepo ?? projectBranches.data?.isRepo ?? null;
  const isGitRepo = knownIsGitRepo ?? true;
  const projectSettings = projectDefaults.projectSettings;
  const canChooseWorkspace = !isScratchDraft;
  const defaultWorkspaceMode: WorkspaceMode = projectDefaults.defaultWorkspaceMode;
  const branchState = usePaginatedBranches({
    environmentId: selectedProject?.environmentId ?? null,
    cwd: selectedProject?.workspaceRoot || null,
  });
  const branchesLoading = branchState.isPending && branchState.data === null;
  const allBranchRefs = branchState.refs;
  const defaultBaseBranchName = resolveDefaultWorktreeBaseBranch(allBranchRefs);
  const availableBranches = pipe(
    allBranchRefs,
    Arr.filter((branch) => !branch.isRemote),
  );

  const resolveWorkspaceSelection = (selection: ComposerDraftWorkspaceSelection | undefined) =>
    resolveNewTaskDraftWorkspace({
      selection,
      canChooseWorkspace,
      defaultMode: defaultWorkspaceMode,
      defaultModeSettled: projectDefaults.defaultWorkspaceModeSettled,
      isGitRepo,
      branches: allBranchRefs,
      projectCwd: selectedProject?.workspaceRoot ?? null,
    });
  const workspaceSelection = resolveWorkspaceSelection(selectedProjectDraft.workspaceSelection);
  const workspaceMode = workspaceSelection.mode;
  const selectedBranchName = workspaceSelection.branch;
  const selectedWorktreePath = workspaceSelection.worktreePath;
  const workspaceCwd =
    (workspaceMode === "worktree"
      ? selectedProject?.workspaceRoot
      : (selectedWorktreePath ?? selectedProject?.workspaceRoot)) || null;
  const selectedEnvironmentServerConfig = serverConfigForCwd(
    projectDefaults.serverConfig,
    workspaceCwd,
  );
  const draftStartFromOrigin = selectedProjectDraft.workspaceSelection?.startFromOrigin;
  const startFromOrigin =
    isGitRepo && (draftStartFromOrigin ?? projectSettings.settings.newWorktreesStartFromOrigin);
  const defaultRuntimeMode = editingPendingTask
    ? (editingPendingTask.runtimeMode ?? DEFAULT_RUNTIME_MODE)
    : projectSettings.settings.defaultRuntimeMode;
  const runtimeMode = selectedProjectDraft.runtimeMode ?? defaultRuntimeMode;

  const draftModelSelection = resolveSelectableModelSelection(
    selectedEnvironmentServerConfig,
    selectedProjectDraft.modelSelection ?? null,
    selectedProject?.id ?? null,
  );
  const projectDefaultModelSelection = resolveDefaultableModelSelection(
    selectedEnvironmentServerConfig,
    projectSettings.settings.defaultModelSelection,
    selectedProject?.id ?? null,
  );
  const stickyModelSelection = resolveDefaultableModelSelection(
    selectedEnvironmentServerConfig,
    storedStickyModelSelection,
    selectedProject?.id ?? null,
  );
  const modelOptions = buildModelOptions(
    selectedEnvironmentServerConfig,
    draftModelSelection ?? projectDefaultModelSelection ?? stickyModelSelection,
    undefined,
    selectedProject?.id ?? null,
  );

  const selectedDefaultModel = resolveNewTaskModelSelection({
    draftSelection: draftModelSelection,
    projectDefaultSelection: projectDefaultModelSelection,
    stickySelection: stickyModelSelection,
    modelOptions,
  });
  const selectedModel = resolveNewThreadModelSelection({
    defaultSelection: selectedDefaultModel,
    explicitSelection:
      draftModelSelection ?? (projectDefaultModelSelection ? null : stickyModelSelection),
    fallbackSelection: selectedEnvironmentServerConfig?.settings.fallbackModelSelection ?? null,
    providers: selectedEnvironmentServerConfig?.providers ?? [],
    ...(selectedEnvironmentServerConfig
      ? { settings: selectedEnvironmentServerConfig.settings }
      : {}),
    projectId: selectedProject?.id ?? null,
    now: modelSelectionNow,
  }).selection;

  const selectedModelOption =
    modelOptions.find(
      (option) =>
        selectedModel &&
        option.selection.instanceId === selectedModel.instanceId &&
        option.selection.model === selectedModel.model,
    ) ?? null;
  const setSelectedModelKey = (
    key: string | null,
    options?: ReadonlyArray<ProviderOptionSelection>,
  ) => {
    if (!key || !selectedProjectDraftKey) {
      return;
    }
    const option = modelOptions.find((candidate) => candidate.key === key);
    if (!option) {
      return;
    }
    const selection = withRememberedModelOptions(
      options ? { ...option.selection, options } : option.selection,
    );
    updateComposerDraftSettings(selectedProjectDraftKey, {
      modelSelection: selection,
    });
    setStickyComposerModelSelection(selection);
  };
  const setSelectedModelOptions = (options: ReadonlyArray<ProviderOptionSelection> | undefined) => {
    if (!selectedModel || !selectedProjectDraftKey) {
      return;
    }
    rememberModelOptions(selectedModel.instanceId, selectedModel.model, options ?? []);
    const nextSelection: ModelSelection = options
      ? { ...selectedModel, options }
      : {
          instanceId: selectedModel.instanceId,
          model: selectedModel.model,
        };
    updateComposerDraftSettings(selectedProjectDraftKey, {
      modelSelection: nextSelection,
    });
    setStickyComposerModelSelection(nextSelection);
  };

  const providerGroups = groupByProvider(modelOptions);
  const setPrompt = (value: string) => {
    if (!selectedProjectDraftKey) {
      return;
    }
    setComposerDraftText(selectedProjectDraftKey, value);
  };
  const removeAttachment = (imageId: string) => {
    if (!selectedProjectDraftKey) {
      return;
    }
    removeComposerDraftAttachment(selectedProjectDraftKey, imageId);
  };

  const carryDraftContentTo = (
    project: EnvironmentProject,
    options?: Parameters<typeof retargetNewTaskDraft>[2],
  ) => {
    const target = { environmentId: project.environmentId, projectId: project.id };
    const flow = readFlow();
    if (flow.draftKey !== null && isNewTaskDraftKey(flow.draftKey)) {
      retargetNewTaskDraft(flow.draftKey, target, options);
      return flow.draftKey;
    }
    return flow.editingPendingTask ? flow.draftKey : createNewTaskDraft(target);
  };

  const setProject = (project: EnvironmentProject) => {
    if (!canMoveEditedPendingTask(readEditingPendingTask(), project.environmentId)) return;
    setStickyNewTaskProject({ environmentId: project.environmentId, projectId: project.id });
    updateFlow({
      draftKey: carryDraftContentTo(project),
      environmentId: project.environmentId,
      projectKey: scopedProjectKey(project.environmentId, project.id),
      environmentSwitch: null,
    });
  };

  const selectEnvironment = (environmentId: EnvironmentId) => {
    const match = resolveEnvironmentProjectMatch(
      projects.filter((project) => project.environmentId === environmentId),
      selectedProject,
    );
    if (match) {
      setStickyNewTaskProject({
        environmentId: match.environmentId,
        projectId: match.id,
      });
    }
    updateFlow({
      draftKey: match
        ? carryDraftContentTo(match, {
            keepPullRequestWorkspace: isSameRepository(match, selectedProject),
          })
        : readFlow().draftKey,
      environmentId,
      projectKey: match ? scopedProjectKey(match.environmentId, match.id) : null,
      environmentSwitch: null,
    });
  };

  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const prepareTriage = usePrepareTriage();
  const switchEnvironment = async (environmentId: EnvironmentId) => {
    if (readFlow().submitting) return false;
    if (!canMoveEditedPendingTask(readEditingPendingTask(), environmentId)) return false;
    if (environmentId === selectedEnvironmentId) {
      cancelEnvironmentSwitch();
      return true;
    }
    if (!isScratchDraft) {
      selectEnvironment(environmentId);
      return true;
    }
    const request: NewTaskEnvironmentSwitch = {
      environmentId,
      draftKey: selectedProjectDraftKey,
      projectKey: draftProjectKey,
    };
    updateFlow({ environmentSwitch: request });
    const { draftKey } = request;
    const triage =
      draftKey !== null && isTriagePrompt(getComposerDraftSnapshot(draftKey).text)
        ? await prepareTriage(environmentId)
        : null;
    const result =
      triage?._tag === "Failure" ? triage : await openScratch({ environmentId, input: {} });
    if (readFlow().environmentSwitch !== request) return false;
    cancelEnvironmentSwitch();
    if (result._tag === "Success") {
      if (triage?._tag === "Success" && draftKey !== null) {
        const text = getComposerDraftSnapshot(draftKey).text;
        const nextText = replaceTriagePlaybookLink(text, triage.value.prompt);
        if (nextText !== text) setComposerDraftText(draftKey, nextText);
      }
      setProject(result.value);
      return true;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        "Could not switch machine",
        error instanceof Error
          ? error.message
          : triage?._tag === "Failure"
            ? "The server could not prepare triage."
            : "The folder for threads without a project could not be created.",
      );
    }
    return false;
  };

  const setWorkspaceMode = (mode: WorkspaceMode) => {
    if (!selectedProjectDraftKey) {
      return;
    }
    if (!selectedProject) {
      return;
    }
    const localSelection = resolveNewTaskLocalWorkspaceSelection({
      branches: availableBranches,
      projectCwd: selectedProject.workspaceRoot,
    });
    updateComposerDraftSettings(selectedProjectDraftKey, {
      workspaceSelection: {
        mode,
        branch: mode === "local" ? localSelection.branch : selectedBranchName,
        worktreePath: mode === "local" ? localSelection.worktreePath : selectedWorktreePath,
        ...(draftStartFromOrigin !== undefined ? { startFromOrigin: draftStartFromOrigin } : {}),
        ...(mode === "local" && localSelection.awaitsCurrentBranch
          ? { followsCurrentCheckout: true }
          : {}),
      },
    });
  };

  const selectBranch = (branch: VcsRef) => {
    if (!selectedProject || !selectedProjectDraftKey) {
      return;
    }
    updateComposerDraftSettings(selectedProjectDraftKey, {
      workspaceSelection: {
        mode: workspaceMode,
        branch: branch.name,
        worktreePath: resolveNewTaskBranchWorktreePath({
          workspaceMode,
          projectCwd: selectedProject.workspaceRoot,
          branchWorktreePath: branch.worktreePath,
        }),
        ...(draftStartFromOrigin !== undefined ? { startFromOrigin: draftStartFromOrigin } : {}),
      },
    });
  };

  const setStartFromOrigin = (value: boolean) => {
    if (!selectedProjectDraftKey) {
      return;
    }
    updateComposerDraftSettings(selectedProjectDraftKey, {
      workspaceSelection: {
        mode: workspaceMode,
        branch: selectedBranchName,
        worktreePath: selectedWorktreePath,
        startFromOrigin: value,
        ...(selectedBranchName === null && workspaceSelection.followsCurrentCheckout
          ? { followsCurrentCheckout: true }
          : {}),
      },
    });
  };

  const refreshBranches = branchState.refresh;
  const loadBranches = () => {
    if (!selectedProject) {
      return;
    }
    setPendingConnectionError(null);
    refreshBranches();
  };

  const setRuntimeMode = (value: RuntimeMode) => {
    if (selectedProjectDraftKey) {
      updateComposerDraftSettings(selectedProjectDraftKey, { runtimeMode: value });
    }
  };
  const beginEditingPendingTask = (messageId: string) => {
    const message = findQueuedPendingTask(messageId);
    if (!message?.creation || !holdEditingQueuedMessage(message.messageId)) {
      return false;
    }
    const draftKey = pendingTaskDraftKey(message.messageId);
    if (isComposerDraftEmpty(getComposerDraftSnapshot(draftKey))) {
      setComposerDraftText(draftKey, message.text);
      setComposerDraftContext(draftKey, message.context);
      replaceComposerDraftAttachments(draftKey, message.attachments);
      updateComposerDraftSettings(draftKey, {
        modelSelection: message.modelSelection,
        runtimeMode: message.runtimeMode,
        workspaceSelection: {
          mode: message.creation.workspaceMode,
          branch: message.creation.branch,
          worktreePath: message.creation.worktreePath,
          startFromOrigin: message.creation.startFromOrigin ?? false,
          pullRequestReference: message.creation.pullRequestReference,
        },
      });
    }
    activeEditingMessageId = message.messageId;
    updateFlow({
      environmentId: message.environmentId,
      projectKey: scopedProjectKey(message.environmentId, message.creation.projectId),
      editingPendingTask: {
        message,
        baseline: capturePendingTaskEditorWriteBaseline(message.messageId),
      },
      environmentSwitch: null,
    });
    return true;
  };

  const buildPendingTaskMessage = (
    metadata: TurnCommandMetadata,
    options?: {
      readonly currentCheckoutBranch?: string | null;
      readonly useDefaultBranch?: boolean;
    },
  ) => {
    if (readFlow().environmentSwitch !== null) return null;
    if (!selectedProject || !selectedProjectDraftKey) {
      return null;
    }
    const draft = getComposerDraftSnapshot(selectedProjectDraftKey);
    const text = draft.text.trim();
    const draftModelSelection =
      resolveSelectableModelSelection(
        selectedEnvironmentServerConfig,
        draft.modelSelection ?? null,
        selectedProject.id,
      ) ?? selectedModel;
    if ((text.length === 0 && draft.attachments.length === 0) || !draftModelSelection) {
      return null;
    }
    if (
      threadContextsOutsideEnvironment({
        text: draft.text,
        records: draft.context?.records ?? [],
        environmentId: selectedProject.environmentId,
      }).length > 0
    ) {
      return null;
    }
    const workspaceSelection = resolveWorkspaceSelection(draft.workspaceSelection);
    const mode = workspaceSelection.mode;
    const branch = resolveProjectThreadCreationBranch({
      workspaceMode: mode,
      selectedBranch:
        workspaceSelection.branch ?? (mode === "worktree" ? defaultBaseBranchName : null),
      currentCheckoutBranch: options?.currentCheckoutBranch ?? null,
    });
    const usingPendingSnapshot = selectedProject === editingPendingProject;
    const projectTitle = usingPendingSnapshot
      ? editingPendingTask?.creation?.projectTitle
      : selectedProject.title;
    const projectCwd = usingPendingSnapshot
      ? editingPendingTask?.creation?.projectCwd
      : selectedProject.workspaceRoot;
    return {
      environmentId: selectedProject.environmentId,
      threadId: ThreadId.make(metadata.threadId),
      messageId: MessageId.make(metadata.messageId),
      commandId: CommandId.make(metadata.commandId),
      text,
      attachments: draft.attachments,
      context: draft.context,
      modelSelection: draftModelSelection,
      runtimeMode: draft.runtimeMode ?? defaultRuntimeMode,
      creation: {
        projectId: selectedProject.id,
        ...(projectTitle !== undefined ? { projectTitle } : {}),
        ...(projectCwd !== undefined ? { projectCwd } : {}),
        workspaceMode: mode,
        ...(mode === "worktree" && workspaceSelection.pullRequestReference
          ? { pullRequestReference: workspaceSelection.pullRequestReference }
          : {}),
        branch,
        ...(mode === "worktree" &&
        !branch &&
        (options?.useDefaultBranch || editingPendingTask?.creation?.useDefaultBranch)
          ? { useDefaultBranch: true as const }
          : {}),
        worktreePath: mode === "worktree" ? null : workspaceSelection.worktreePath,
        ...((workspaceSelection.startFromOrigin ?? startFromOrigin)
          ? { startFromOrigin: true }
          : {}),
      },
      createdAt: metadata.createdAt,
    };
  };

  const finishEditingPendingTask = () => {
    const editing = readEditingPendingTask();
    updateFlow({ editingPendingTask: null, environmentSwitch: null });
    if (editing) {
      if (activeEditingMessageId === editing.messageId) {
        activeEditingMessageId = null;
      }
      clearComposerDraft(pendingTaskDraftKey(editing.messageId));
      releaseEditingQueuedMessage(editing.messageId);
      scheduleUnusedComposerAttachmentCleanup(editing.attachments);
    }
  };

  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const environmentPinned =
    editingPendingTask !== null &&
    hasQueuedFollowUps(queuedMessagesByThreadKey, editingPendingTask);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- ends the pending task edit once the thread outbox no longer holds the queued message
  useEffect(() => {
    if (!ownsSession || !editingPendingTask) {
      return;
    }
    const stillQueued = flattenQueuedThreadMessages(queuedMessagesByThreadKey).some(
      (candidate) => candidate.messageId === editingPendingTask.messageId,
    );
    if (!stillQueued) {
      finishEditingPendingTask();
    }
  }, [editingPendingTask, finishEditingPendingTask, ownsSession, queuedMessagesByThreadKey]);

  const navigation = useNavigation();
  const openEditingSession = useEffectEvent((messageId: string) => {
    if (!beginEditingPendingTask(messageId)) {
      navigation.dispatch(CommonActions.navigate("NewTaskProject"));
    }
  });
  const saveEditingSession = useEffectEvent(() => {
    const session = readFlow().editingPendingTask;
    if (!session) {
      return;
    }
    const editing = session.message;
    updateFlow({ editingPendingTask: null });
    if (activeEditingMessageId === editing.messageId) {
      activeEditingMessageId = null;
    }
    pauseEditingQueuedMessage(editing.messageId);

    const message = buildPendingTaskMessage({
      threadId: editing.threadId,
      commandId: editing.commandId,
      messageId: editing.messageId,
      createdAt: editing.createdAt,
    });

    if (!message) {
      return;
    }

    void flushPendingTaskEditorWrite({
      message,
      baseline: session.baseline,
      draftKey: pendingTaskDraftKey(editing.messageId),
    })
      .then((savedDraftStillCurrent) => {
        if (activeEditingMessageId === editing.messageId) {
          return;
        }
        if (!savedDraftStillCurrent) {
          return;
        }
        clearComposerDraft(pendingTaskDraftKey(editing.messageId));
        releaseEditingQueuedMessage(editing.messageId);
        scheduleUnusedComposerAttachmentCleanup(editing.attachments);
      })
      .catch((error) => {
        console.warn("[new-task] failed to save edited pending task", error);
      });
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- edits the route's queued task while the stack serves the route, saving it when another draft route covers this one or it leaves, and resuming when it is served again
  useEffect(() => {
    if (!ownsSession || !routePendingTaskId) return;
    openEditingSession(routePendingTaskId);
    return () => saveEditingSession();
  }, [ownsSession, routePendingTaskId]);

  const scratchEnvironments = connectedEnvironments.filter(
    (environment) =>
      availableScratchWorkspaceRoot({
        environmentId: environment.environmentId,
        connectionPhase: environment.connectionState,
        serverConfig: serverConfigs.get(environment.environmentId),
        projects,
      }) !== null,
  );

  const selectedRepositoryKey = selectedProject?.repositoryIdentity
    ? repositoryGroupingKeyOf(selectedProject.repositoryIdentity)
    : null;
  const selectedWorkspaceBasename = selectedProject?.workspaceRoot.split("/").at(-1) || null;
  const selectedProjectTitle = selectedProject?.title ?? null;
  const environments = (() => {
    if (isScratchDraft) {
      return scratchEnvironments.map((environment) => ({
        environmentId: environment.environmentId,
        environmentLabel: environment.environmentLabel,
      }));
    }
    const seen = new Set<EnvironmentId>();
    const result: Array<{
      readonly environmentId: EnvironmentId;
      readonly environmentLabel: string;
    }> = [];
    const hostsSelectedRepository = (project: EnvironmentProject) => {
      if (selectedRepositoryKey === null && selectedWorkspaceBasename === null) {
        return true;
      }
      const projectKey = project.repositoryIdentity
        ? repositoryGroupingKeyOf(project.repositoryIdentity)
        : null;
      if (selectedRepositoryKey !== null && projectKey !== null) {
        return projectKey === selectedRepositoryKey;
      }
      return (
        project.workspaceRoot.split("/").at(-1) === selectedWorkspaceBasename ||
        (selectedProjectTitle !== null && project.title === selectedProjectTitle)
      );
    };
    for (const project of projects) {
      if (!hostsSelectedRepository(project)) {
        continue;
      }
      if (seen.has(project.environmentId)) {
        continue;
      }
      const environment = savedConnectionsById[project.environmentId];
      if (!environment) {
        continue;
      }
      seen.add(project.environmentId);
      result.push({
        environmentId: project.environmentId,
        environmentLabel: environment.environmentLabel,
      });
    }
    return result;
  })();

  return {
    projectScopes,
    selectedEnvironmentId,
    selectedProjectKey,
    workspaceMode,
    isGitRepo,
    isGitRepoKnown: knownIsGitRepo !== null,
    canChooseWorkspace,
    selectedBranchName,
    defaultBaseBranchName,
    selectedWorktreePath,
    workspaceCwd,
    startFromOrigin,
    draftKey: selectedProjectDraftKey,
    pullRequestReference: selectedProjectDraft.workspaceSelection?.pullRequestReference,
    editingPendingTask,
    prompt,
    attachments,
    submitting,
    branchesLoading,
    availableBranches,
    currentCheckoutBranchName,
    runtimeMode,
    environments,
    selectedProject,
    isScratchDraft,
    selectedModel,
    selectedModelOption,
    providerGroups,
    flowKey,
    served: instance.served,
    setProject,
    getSelectedProjectKey: () => readFlow().projectKey,
    unopenableRouteDraft:
      routeDraftId !== undefined &&
      (routeDraftResolution.kind === "missing" || routeDraftResolution.kind === "pickProject")
        ? { draftId: routeDraftId, kind: routeDraftResolution.kind }
        : null,
    switchEnvironment,
    switchingToEnvironmentId,
    environmentPinned,
    setSelectedModelKey,
    setWorkspaceMode,
    selectBranch,
    setStartFromOrigin,
    finishEditingPendingTask,
    buildPendingTaskMessage,
    setPrompt,
    removeAttachment,
    setSubmitting,
    loadBranches,
    setRuntimeMode,
    setSelectedModelOptions,
  } satisfies NewTaskFlowContextValue;
}
