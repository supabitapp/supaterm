import * as Dialog from "../../components/ui/Dialog";
import { resolveFilesystemReadAccess } from "@supaterm/client-runtime/state/filesystem";
import { useEnvironmentPresentation } from "../../state/presentation";
import { environmentSession } from "../../state/session";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIsFocused } from "@react-navigation/native";

import type {
  EnvironmentId,
  ModelSelection,
  ProjectReadFileResult,
  ProviderOptionSelection,
  RuntimeMode,
  ServerProvider,
} from "@supaterm/contracts";
import {
  CommandId,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_SERVER_SETTINGS,
  MessageId,
  repositoryGroupingKeyOf,
  SUPATERM_PROJECT_FILE_NAME,
  ThreadId,
} from "@supaterm/contracts";
import { sanitizeNewRefName } from "@supaterm/shared/git";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { parseSupatermProjectFile } from "@supaterm/shared/supatermProjectFile";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";

import {
  useEnvironmentServerConfig,
  useProjects,
  useServerConfigs,
  useThreadShells,
} from "../../state/entities";
import type { TurnCommandMetadata } from "../../lib/commandMetadata";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import {
  buildModelOptions,
  groupByProvider,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
  resolveSelectableModelSelection,
} from "../../lib/modelOptions";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { appAtomRegistry } from "../../state/atom-registry";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  appendComposerDraftAttachments,
  type ComposerDraftInsertion,
  clearComposerDraft,
  composerDraftsAtom,
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
import { holdNewTaskDraft } from "../../state/use-pending-new-tasks";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import {
  capturePendingTaskEditorWriteBaseline,
  flushPendingTaskEditorWrite,
} from "../../state/pending-task-editor-writes";
import {
  rememberModelOptions,
  withRememberedModelOptions,
} from "../../state/use-model-option-memory";
import { useDebouncedValue, usePaginatedBranches } from "../../state/queries";
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
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { type VcsRef } from "@supaterm/client-runtime/state/vcs";
import {
  buildHomeProjectScopes,
  sortHomeProjectScopes,
  type HomeProjectScope,
} from "../home/homeThreadList";
import { useMobileProjectGroupingSettings } from "../../state/project-grouping";
import {
  filterNewTaskBranches,
  resolveNewTaskBranchWorktreePath,
  resolveNewTaskLocalWorkspaceSelection,
} from "./new-task-context-presentation";
import { resolveEnvironmentProjectMatch } from "./new-task-project-selection";
import { resolveDefaultWorktreeBaseBranch } from "../../lib/worktree-base-branch";
import { resolveProjectThreadCreationBranch } from "./projectThreadCreationValidation";

type WorkspaceMode = "local" | "worktree";

const BRANCH_SEARCH_DEBOUNCE_MS = 150;

function pendingTaskDraftKey(messageId: string): string {
  return `pending-task:${messageId}`;
}

// The message id owned by the currently active editing session, tracked
// across provider instances. An in-flight flush from a dismissed session
// consults it so it never drops the draft or releases the drain lock out from
// under a newer session editing the same task.
let activeEditingMessageId: string | null = null;

function findQueuedPendingTask(messageId: string): QueuedThreadMessage | null {
  const message = flattenQueuedThreadMessages(
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  ).find((candidate) => candidate.messageId === messageId);
  return message?.creation !== undefined ? message : null;
}

function canMoveEditedPendingTask(
  editing: QueuedThreadMessage | null,
  environmentId: EnvironmentId,
): boolean {
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

export function branchBadgeLabel(input: {
  readonly branch: VcsRef;
  readonly project: EnvironmentProject | null;
}): string | null {
  if (input.branch.current) {
    return "current";
  }
  if (input.branch.worktreePath && input.branch.worktreePath !== input.project?.workspaceRoot) {
    return "worktree";
  }
  if (input.branch.isRemote) {
    return "remote";
  }
  if (input.branch.isDefault) {
    return "default";
  }
  return null;
}

type NewTaskFlowContextValue = {
  readonly projectScopes: ReadonlyArray<HomeProjectScope>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly selectedModelKey: string | null;
  readonly workspaceMode: WorkspaceMode;
  readonly canChooseWorkspace: boolean;
  readonly selectedBranchName: string | null;
  readonly defaultBaseBranchName: string | null;
  readonly selectedWorktreePath: string | null;
  readonly startFromOrigin: boolean;
  readonly pullRequestReference: string | undefined;
  readonly draftKey: string | null;
  readonly editingPendingTask: QueuedThreadMessage | null;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly submitting: boolean;
  readonly branchQuery: string;
  readonly branchesLoading: boolean;
  readonly branchesError: string | null;
  readonly branchesFetchingNextPage: boolean;
  readonly hasMoreBranches: boolean;
  readonly availableBranches: ReadonlyArray<VcsRef>;
  readonly currentCheckoutBranchName: string | null;
  readonly runtimeMode: RuntimeMode;
  readonly expandedProvider: string | null;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string;
  }>;
  readonly selectedProject: EnvironmentProject | null;
  readonly isScratchDraft: boolean;
  readonly modelOptions: ReadonlyArray<ModelOption>;
  readonly selectedModel: ModelSelection | null;
  readonly selectedModelOption: ModelOption | null;
  readonly selectedProviderStatus: ServerProvider | null;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly filteredBranches: ReadonlyArray<VcsRef>;
  readonly reset: () => void;
  readonly setProject: (project: EnvironmentProject) => void;
  /**
   * Binds the composer to an existing new-task draft (a row in the thread
   * list). Returns false when the draft is gone, so the caller can fall back
   * to a fresh one.
   */
  readonly openDraft: (draftKey: string) => boolean;
  readonly selectEnvironment: (environmentId: EnvironmentId) => void;
  readonly switchEnvironment: (environmentId: EnvironmentId) => Promise<boolean>;
  readonly switchingToEnvironmentId: EnvironmentId | null;
  /** An edited pending task with follow-ups queued behind it stays on its machine. */
  readonly environmentPinned: boolean;
  readonly setSelectedModelKey: (
    key: string | null,
    options?: ReadonlyArray<ProviderOptionSelection>,
  ) => void;
  readonly setWorkspaceMode: (mode: WorkspaceMode) => void;
  readonly selectBranch: (branch: VcsRef) => void;
  readonly setStartFromOrigin: (value: boolean) => void;
  readonly beginEditingPendingTask: (messageId: string) => boolean;
  readonly finishEditingPendingTask: () => void;
  readonly cancelEditingPendingTask: () => void;
  readonly buildPendingTaskMessage: (
    metadata: TurnCommandMetadata,
    options?: {
      readonly currentCheckoutBranch?: string | null;
      readonly useDefaultBranch?: boolean;
    },
  ) => QueuedThreadMessage | null;
  readonly setPrompt: (value: string) => void;
  readonly replaceAttachments: (attachments: ReadonlyArray<DraftComposerAttachment>) => void;
  /** Appends draft attachments; returns how many the live cap rejected. */
  readonly appendAttachments: (
    attachments: ReadonlyArray<DraftComposerAttachment>,
    insertion?: ComposerDraftInsertion,
  ) => number;
  readonly removeAttachment: (imageId: string) => void;
  readonly clearAttachments: () => void;
  readonly setSubmitting: (value: boolean) => void;
  readonly setBranchQuery: (value: string) => void;
  readonly loadBranches: () => void;
  readonly loadMoreBranches: () => void;
  readonly setRuntimeMode: (value: RuntimeMode) => void;
  readonly setSelectedModelOptions: (
    value: ReadonlyArray<ProviderOptionSelection> | undefined,
  ) => void;
  readonly setExpandedProvider: (value: string | null) => void;
};

const NewTaskFlowContext = React.createContext<NewTaskFlowContextValue | null>(null);

export function NewTaskFlowProvider(props: React.PropsWithChildren) {
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

  const [selectedEnvironmentIdOverride, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const selectedEnvironmentId =
    selectedEnvironmentIdOverride !== null &&
    projects.some((project) => project.environmentId === selectedEnvironmentIdOverride)
      ? selectedEnvironmentIdOverride
      : (projects[0]?.environmentId ?? null);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const [activeDraftKey, setActiveDraftKey] = useState<string | null>(null);
  const [submitting, setSubmittingState] = useState(false);
  const submittingRef = useRef(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [editingPendingTask, setEditingPendingTask] = useState<QueuedThreadMessage | null>(null);
  const pendingLocalBranchSyncDraftKeysRef = useRef(new Set<string>());
  // Mirrors `editingPendingTask` synchronously so the unmount flush cannot act
  // on a task whose editing session already ended this render.
  const editingPendingTaskRef = useRef<QueuedThreadMessage | null>(null);
  const editingRevisionRef = useRef(Promise.resolve(0));

  const [switchingToEnvironmentId, setSwitchingToEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const latestSwitchRef = useRef<{
    readonly environmentId: EnvironmentId;
    readonly draftKey: string | null;
    readonly projectKey: string | null;
  } | null>(null);
  const cancelEnvironmentSwitch = () => {
    latestSwitchRef.current = null;
    setSwitchingToEnvironmentId(null);
  };
  const setSubmitting = (value: boolean) => {
    if (value) cancelEnvironmentSwitch();
    submittingRef.current = value;
    setSubmittingState(value);
  };

  const reset = () => {
    cancelEnvironmentSwitch();
    setSelectedEnvironmentId(null);
    setSelectedProjectKey(null);
    setActiveDraftKey(null);
    setSubmitting(false);
    setBranchQuery("");
    setExpandedProvider(null);
    pendingLocalBranchSyncDraftKeysRef.current.clear();
    const editing = editingPendingTaskRef.current;
    editingPendingTaskRef.current = null;
    setEditingPendingTask(null);
    if (editing) {
      if (activeEditingMessageId === editing.messageId) {
        activeEditingMessageId = null;
      }
      releaseEditingQueuedMessage(editing.messageId);
    }
  };

  const projectsForEnvironment = pipe(
    projects,
    Arr.filter((project) => project.environmentId === selectedEnvironmentId),
  );

  const editingPendingProject = ((): EnvironmentProject | null => {
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
    projectsForEnvironment.find(
      (project) => scopedProjectKey(project.environmentId, project.id) === selectedProjectKey,
    ) ??
    // While editing a queued task whose project shell is absent, keep the task
    // pinned to its own project — falling through to an arbitrary first
    // project would silently retarget it (and its reused turn identifiers).
    (editingPendingProject !== null &&
    selectedProjectKey ===
      scopedProjectKey(editingPendingProject.environmentId, editingPendingProject.id)
      ? editingPendingProject
      : (projectsForEnvironment[0] ?? null));

  const selectedEnvironmentServerConfig = useEnvironmentServerConfig(
    selectedProject?.environmentId ?? null,
  );
  const isScratchDraft =
    selectedProject !== null &&
    isScratchProject(selectedProject, selectedEnvironmentServerConfig?.scratchWorkspaceRoot);
  const serverConfigs = useServerConfigs();
  const { connectedEnvironments } = useRemoteConnectionStatus();
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
  // `|| null` (not `??`): a pending-task placeholder project can have an empty
  // workspaceRoot, and an "" basename would reject every real host below.
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

  const selectedProjectDraftKey = editingPendingTask
    ? pendingTaskDraftKey(editingPendingTask.messageId)
    : selectedProject
      ? activeDraftKey
      : null;
  const draftProjectKey = selectedProject
    ? scopedProjectKey(selectedProject.environmentId, selectedProject.id)
    : null;
  // A request belongs to the draft/project that started it, including when
  // catalog changes or unmounting replace that owner without a user action.
  useLayoutEffect(
    () => () => {
      const request = latestSwitchRef.current;
      if (request?.draftKey === selectedProjectDraftKey && request.projectKey === draftProjectKey) {
        cancelEnvironmentSwitch();
      }
    },
    [cancelEnvironmentSwitch, selectedProjectDraftKey, draftProjectKey],
  );
  useEffect(() => {
    if (activeDraftKey !== null || editingPendingTask !== null || selectedProject === null) {
      return;
    }
    // oxlint-disable-next-line react/set-state-in-effect -- a draft is created once a project becomes selectable
    setActiveDraftKey(
      createNewTaskDraft({
        environmentId: selectedProject.environmentId,
        projectId: selectedProject.id,
      }),
    );
  }, [activeDraftKey, editingPendingTask, selectedProject]);
  const focused = useIsFocused();
  const { panes } = useAdaptiveWorkspaceLayout();
  const heldDraftKey = focused && panes.primarySidebarVisible ? selectedProjectDraftKey : null;
  useEffect(
    () => (heldDraftKey === null ? undefined : holdNewTaskDraft(heldDraftKey)),
    [heldDraftKey],
  );
  const selectedProjectDraft = useComposerDraft(selectedProjectDraftKey);
  const prompt = selectedProjectDraft.text;
  const attachments = selectedProjectDraft.attachments;
  const fileAccessSession = useEnvironmentQuery(
    selectedProject !== null && selectedProject.workspaceRoot !== ""
      ? environmentSession.sessionStateAtom(selectedProject.environmentId)
      : null,
  );
  const fileEnvironment = useEnvironmentPresentation(selectedProject?.environmentId ?? null);
  const fileAccess = resolveFilesystemReadAccess({
    isCatalogReady: fileEnvironment.isReady,
    connection: fileEnvironment.presentation?.connection ?? null,
    session: fileAccessSession.data,
    sessionError: fileAccessSession.error,
  });
  const { canReadFiles } = fileAccess;
  const fileAccessPending =
    selectedProject !== null && selectedProject.workspaceRoot !== "" && fileAccess.isPending;
  const supatermProjectFileQuery = useEnvironmentQuery(
    canReadFiles && selectedProject !== null && selectedProject.workspaceRoot !== ""
      ? projectEnvironment.readFile({
          environmentId: selectedProject.environmentId,
          input: { cwd: selectedProject.workspaceRoot, relativePath: SUPATERM_PROJECT_FILE_NAME },
        })
      : null,
  );
  const supatermProjectFileData = supatermProjectFileQuery.data as ProjectReadFileResult | null;
  const supatermProjectFile =
    supatermProjectFileData === null || supatermProjectFileData.truncated
      ? null
      : parseSupatermProjectFile(supatermProjectFileData.contents);
  const projectSettings = resolveProjectSettings(
    selectedEnvironmentServerConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
    selectedProject?.id ?? null,
    selectedProject,
    supatermProjectFile,
  );
  const canChooseWorkspace = !isScratchDraft;
  const selectedProjectHasThreads =
    selectedProject !== null &&
    threads.some(
      (thread) =>
        thread.environmentId === selectedProject.environmentId &&
        thread.projectId === selectedProject.id,
    );
  const defaultWorkspaceMode: WorkspaceMode = canChooseWorkspace
    ? resolveNewThreadEnvMode({
        projectSettings,
        workspaceRoot: selectedProject?.workspaceRoot ?? null,
        newProjectsRoot: selectedEnvironmentServerConfig?.newProjectsRoot,
        projectHasThreads: selectedProjectHasThreads,
      })
    : "local";
  // While the file read is pending and nothing above it decided, the
  // resolved default is provisional. Nothing may write it into the draft
  // during that window (the auto-branch effect does), or the frozen interim
  // value beats the supaterm.json default once it loads.
  const defaultWorkspaceModeSettled =
    selectedProjectDraft.workspaceSelection?.mode !== undefined ||
    projectSettings.sources.defaultThreadEnvMode !== "environment" ||
    (!supatermProjectFileQuery.isPending && !fileAccessPending);
  const workspaceMode = canChooseWorkspace
    ? (selectedProjectDraft.workspaceSelection?.mode ?? defaultWorkspaceMode)
    : "local";
  const selectedBranchName = selectedProjectDraft.workspaceSelection?.branch ?? null;
  const selectedWorktreePath = selectedProjectDraft.workspaceSelection?.worktreePath ?? null;
  // Keep the user's explicit choice separate from the resolved display value:
  // only the explicit flag is ever written back to the draft, so the resolved
  // value keeps tracking the server setting when the config loads late.
  const draftStartFromOrigin = selectedProjectDraft.workspaceSelection?.startFromOrigin;
  const startFromOrigin =
    draftStartFromOrigin ?? projectSettings.settings.newWorktreesStartFromOrigin;
  const defaultRuntimeMode = editingPendingTask
    ? (editingPendingTask.runtimeMode ?? DEFAULT_RUNTIME_MODE)
    : projectSettings.settings.defaultRuntimeMode;
  const runtimeMode = selectedProjectDraft.runtimeMode ?? defaultRuntimeMode;

  // Antigravity keeps unavailable selections so sign-out or a catalog change
  // cannot switch the user's model.
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
  const storedStickyModelSelection = useStickyComposerModelSelection();
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

  const selectedModel = resolveNewTaskModelSelection({
    draftSelection: draftModelSelection,
    projectDefaultSelection: projectDefaultModelSelection,
    stickySelection: stickyModelSelection,
    modelOptions,
  });
  const selectedModelKey = selectedModel
    ? `${selectedModel.instanceId}:${selectedModel.model}`
    : null;

  const selectedModelOption =
    modelOptions.find(
      (option) =>
        selectedModel &&
        option.selection.instanceId === selectedModel.instanceId &&
        option.selection.model === selectedModel.model,
    ) ?? null;
  const selectedProviderStatus =
    selectedEnvironmentServerConfig?.providers.find(
      (provider) => provider.instanceId === selectedModel?.instanceId,
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
  const replaceAttachments = (nextAttachments: ReadonlyArray<DraftComposerAttachment>) => {
    if (!selectedProjectDraftKey) {
      return;
    }
    replaceComposerDraftAttachments(selectedProjectDraftKey, nextAttachments);
  };
  const appendAttachments = (
    nextAttachments: ReadonlyArray<DraftComposerAttachment>,
    insertion?: ComposerDraftInsertion,
  ): number => {
    if (!selectedProjectDraftKey) {
      return 0;
    }
    return appendComposerDraftAttachments(selectedProjectDraftKey, nextAttachments, {
      appendReference: true,
      insertion,
    });
  };
  const removeAttachment = (imageId: string) => {
    if (!selectedProjectDraftKey) {
      return;
    }
    removeComposerDraftAttachment(selectedProjectDraftKey, imageId);
  };
  const clearAttachments = () => {
    if (!selectedProjectDraftKey) {
      return;
    }
    replaceComposerDraftAttachments(selectedProjectDraftKey, []);
  };
  const branchSearchQuery = sanitizeNewRefName(branchQuery);
  const debouncedBranchQuery = useDebouncedValue(branchSearchQuery, BRANCH_SEARCH_DEBOUNCE_MS);
  const branchTarget = {
    environmentId: selectedProject?.environmentId ?? null,
    cwd: selectedProject?.workspaceRoot || null,
    query: debouncedBranchQuery,
  };
  const branchState = usePaginatedBranches(branchTarget);
  const branchSearchIsDebouncing = branchSearchQuery !== debouncedBranchQuery;
  const branchesLoading =
    branchSearchIsDebouncing || (branchState.isPending && branchState.data === null);
  const branchesFetchingNextPage = branchState.isFetchingNextPage;
  const hasMoreBranches =
    branchState.data?.nextCursor !== null && branchState.data?.nextCursor !== undefined;
  const allBranchRefs = branchState.refs;
  const defaultBaseBranchName = resolveDefaultWorktreeBaseBranch(allBranchRefs);
  const availableBranches = pipe(
    allBranchRefs,
    Arr.filter((branch) => !branch.isRemote),
  );
  const projectGitStatus = useEnvironmentQuery(
    branchTarget.environmentId !== null && branchTarget.cwd !== null
      ? vcsEnvironment.status({
          environmentId: branchTarget.environmentId,
          input: { cwd: branchTarget.cwd },
        })
      : null,
  );
  const currentCheckoutBranchName = projectGitStatus.data?.refName ?? null;

  const filteredBranches = filterNewTaskBranches(allBranchRefs, branchQuery);

  const carryDraftContentTo = (project: EnvironmentProject) => {
    const target = { environmentId: project.environmentId, projectId: project.id };
    if (activeDraftKey !== null && isNewTaskDraftKey(activeDraftKey)) {
      retargetNewTaskDraft(activeDraftKey, target);
    } else if (!editingPendingTaskRef.current) {
      setActiveDraftKey(createNewTaskDraft(target));
    }
  };

  const setProject = (project: EnvironmentProject) => {
    if (!canMoveEditedPendingTask(editingPendingTaskRef.current, project.environmentId)) return;
    cancelEnvironmentSwitch();
    carryDraftContentTo(project);
    setStickyNewTaskProject({ environmentId: project.environmentId, projectId: project.id });
    setSelectedEnvironmentId(project.environmentId);
    setSelectedProjectKey(scopedProjectKey(project.environmentId, project.id));
  };

  const openDraft = (draftKey: string): boolean => {
    const draft = appAtomRegistry.get(composerDraftsAtom)[draftKey];
    const stamp = draft?.project;
    if (!isNewTaskDraftKey(draftKey) || !stamp) {
      return false;
    }
    // The stamped project must be loaded: selectedProject falls back to
    // the environment's first project otherwise, and the draft would be
    // sent somewhere the user never chose.
    const projectLoaded = projects.some(
      (project) => project.environmentId === stamp.environmentId && project.id === stamp.projectId,
    );
    if (!projectLoaded) {
      return false;
    }
    cancelEnvironmentSwitch();
    setActiveDraftKey(draftKey);
    setSelectedEnvironmentId(stamp.environmentId);
    setSelectedProjectKey(scopedProjectKey(stamp.environmentId, stamp.projectId));
    return true;
  };

  const selectEnvironment = (environmentId: EnvironmentId) => {
    cancelEnvironmentSwitch();
    const match = resolveEnvironmentProjectMatch(
      projects.filter((project) => project.environmentId === environmentId),
      selectedProject,
    );
    if (match) {
      carryDraftContentTo(match);
      setStickyNewTaskProject({
        environmentId: match.environmentId,
        projectId: match.id,
      });
    }
    setSelectedEnvironmentId(environmentId);
    setSelectedProjectKey(match ? scopedProjectKey(match.environmentId, match.id) : null);
  };

  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const switchEnvironment = async (environmentId: EnvironmentId): Promise<boolean> => {
    if (submittingRef.current) return false;
    if (!canMoveEditedPendingTask(editingPendingTaskRef.current, environmentId)) return false;
    if (environmentId === selectedEnvironmentId) {
      cancelEnvironmentSwitch();
      return true;
    }
    if (!isScratchDraft) {
      selectEnvironment(environmentId);
      return true;
    }
    const request = {
      environmentId,
      draftKey: selectedProjectDraftKey,
      projectKey: draftProjectKey,
    };
    latestSwitchRef.current = request;
    setSwitchingToEnvironmentId(environmentId);
    const result = await openScratch({ environmentId, input: {} });
    if (latestSwitchRef.current !== request) return false;
    cancelEnvironmentSwitch();
    if (result._tag === "Success") {
      setProject(result.value);
      return true;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        "Could not switch machine",
        error instanceof Error
          ? error.message
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
    if (mode === "local" && localSelection.awaitsCurrentBranch) {
      pendingLocalBranchSyncDraftKeysRef.current.add(selectedProjectDraftKey);
    } else {
      pendingLocalBranchSyncDraftKeysRef.current.delete(selectedProjectDraftKey);
    }
    updateComposerDraftSettings(selectedProjectDraftKey, {
      workspaceSelection: {
        mode,
        branch: mode === "local" ? localSelection.branch : selectedBranchName,
        worktreePath: mode === "local" ? localSelection.worktreePath : selectedWorktreePath,
        ...(draftStartFromOrigin !== undefined ? { startFromOrigin: draftStartFromOrigin } : {}),
      },
    });
  };

  useEffect(() => {
    if (
      workspaceMode !== "local" ||
      !selectedProject ||
      !selectedProjectDraftKey ||
      !pendingLocalBranchSyncDraftKeysRef.current.has(selectedProjectDraftKey)
    ) {
      return;
    }
    const localSelection = resolveNewTaskLocalWorkspaceSelection({
      branches: availableBranches,
      projectCwd: selectedProject.workspaceRoot,
    });
    if (localSelection.awaitsCurrentBranch) {
      return;
    }

    pendingLocalBranchSyncDraftKeysRef.current.delete(selectedProjectDraftKey);
    updateComposerDraftSettings(selectedProjectDraftKey, {
      workspaceSelection: {
        mode: "local",
        branch: localSelection.branch,
        worktreePath: localSelection.worktreePath,
        ...(draftStartFromOrigin !== undefined ? { startFromOrigin: draftStartFromOrigin } : {}),
      },
    });
  }, [
    availableBranches,
    draftStartFromOrigin,
    selectedProject,
    selectedProjectDraftKey,
    workspaceMode,
  ]);

  const selectBranch = (branch: VcsRef) => {
    if (!selectedProject || !selectedProjectDraftKey) {
      return;
    }
    pendingLocalBranchSyncDraftKeysRef.current.delete(selectedProjectDraftKey);
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
      },
    });
  };

  const refreshBranches = branchState.refresh;
  const loadMoreBranches = branchState.loadNext;
  const loadBranches = () => {
    if (!selectedProject) {
      return;
    }
    setPendingConnectionError(null);
    refreshBranches();
  };

  useEffect(() => {
    if (
      !selectedProjectDraftKey ||
      !defaultWorkspaceModeSettled ||
      workspaceMode !== "worktree" ||
      selectedBranchName !== null
    ) {
      return;
    }
    // The draft screen writes a thread's branch and worktree into the draft in
    // the same commit this effect runs, so the rendered selection above can be
    // stale. Re-read the draft before replacing it.
    const live = getComposerDraftSnapshot(selectedProjectDraftKey).workspaceSelection;
    if (live && (live.mode !== "worktree" || live.branch !== null)) {
      return;
    }
    // The default may only exist as origin/<default> (isRemote), which
    // availableBranches filters out — search the unfiltered refs for it.
    const preferredBranch =
      allBranchRefs.find((branch) => branch.isDefault) ??
      availableBranches.find((branch) => branch.current) ??
      null;
    if (preferredBranch) {
      selectBranch(preferredBranch);
    }
  }, [
    allBranchRefs,
    availableBranches,
    defaultWorkspaceModeSettled,
    selectBranch,
    selectedBranchName,
    selectedProjectDraftKey,
    workspaceMode,
  ]);

  const setRuntimeMode = (value: RuntimeMode) => {
    if (selectedProjectDraftKey) {
      updateComposerDraftSettings(selectedProjectDraftKey, { runtimeMode: value });
    }
  };
  const beginEditingPendingTask = (messageId: string): boolean => {
    const message = findQueuedPendingTask(messageId);
    if (!message?.creation || !holdEditingQueuedMessage(message.messageId)) {
      return false;
    }
    cancelEnvironmentSwitch();
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
    setSelectedEnvironmentId(message.environmentId);
    setSelectedProjectKey(scopedProjectKey(message.environmentId, message.creation.projectId));
    activeEditingMessageId = message.messageId;
    editingPendingTaskRef.current = message;
    editingRevisionRef.current = capturePendingTaskEditorWriteBaseline(message.messageId);
    setEditingPendingTask(message);
    return true;
  };

  const buildPendingTaskMessage = (
    metadata: TurnCommandMetadata,
    options?: {
      readonly currentCheckoutBranch?: string | null;
      readonly useDefaultBranch?: boolean;
    },
  ): QueuedThreadMessage | null => {
    // Read the request synchronously: a keyboard send can arrive before
    // React has rendered the pending switch's disabled composer controls.
    if (latestSwitchRef.current !== null) return null;
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
    const workspaceSelection = canChooseWorkspace ? draft.workspaceSelection : undefined;
    const mode = workspaceSelection?.mode ?? workspaceMode;
    const branch = resolveProjectThreadCreationBranch({
      workspaceMode: mode,
      selectedBranch:
        workspaceSelection?.branch ?? (mode === "worktree" ? defaultBaseBranchName : null),
      currentCheckoutBranch: options?.currentCheckoutBranch ?? null,
    });
    // When the selection is the stand-in built from the queued snapshot,
    // persist the original (possibly absent) snapshot values — the
    // stand-in's placeholder title/workspaceRoot must never be written back
    // as if they were real project metadata.
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
        ...(mode === "worktree" && workspaceSelection?.pullRequestReference
          ? { pullRequestReference: workspaceSelection.pullRequestReference }
          : {}),
        branch,
        ...(mode === "worktree" &&
        !branch &&
        (options?.useDefaultBranch || editingPendingTask?.creation?.useDefaultBranch)
          ? { useDefaultBranch: true as const }
          : {}),
        worktreePath: mode === "worktree" ? null : (workspaceSelection?.worktreePath ?? null),
        ...((workspaceSelection?.startFromOrigin ?? startFromOrigin)
          ? { startFromOrigin: true }
          : {}),
      },
      createdAt: metadata.createdAt,
    };
  };

  const finishEditingPendingTask = () => {
    cancelEnvironmentSwitch();
    const editing = editingPendingTaskRef.current;
    editingPendingTaskRef.current = null;
    if (editing) {
      if (activeEditingMessageId === editing.messageId) {
        activeEditingMessageId = null;
      }
      clearComposerDraft(pendingTaskDraftKey(editing.messageId));
      releaseEditingQueuedMessage(editing.messageId);
      scheduleUnusedComposerAttachmentCleanup(editing.attachments);
    }
    setEditingPendingTask(null);
  };

  // If the queued task disappears mid-edit (deleted from the list, or
  // delivered), end the editing session immediately without saving — a later
  // flush must not resurrect it, and the composer should fall back to the
  // regular per-project draft.
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const environmentPinned =
    editingPendingTask !== null &&
    hasQueuedFollowUps(queuedMessagesByThreadKey, editingPendingTask);
  useEffect(() => {
    const editing = editingPendingTaskRef.current;
    if (!editing) {
      return;
    }
    const stillQueued = flattenQueuedThreadMessages(queuedMessagesByThreadKey).some(
      (candidate) => candidate.messageId === editing.messageId,
    );
    if (!stillQueued) {
      finishEditingPendingTask();
    }
  }, [finishEditingPendingTask, queuedMessagesByThreadKey]);

  const editingFlushRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    editingFlushRef.current = () => {
      const editing = editingPendingTaskRef.current;
      if (!editing) {
        return;
      }
      editingPendingTaskRef.current = null;
      setEditingPendingTask(null);
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
        // The edits are currently unsendable (e.g. the prompt was cleared).
        // Keep both the draft and the drain lock: the stale queued payload
        // must not auto-send content the user just removed, and reopening the
        // task resumes from the saved draft.
        return;
      }

      // The write handoff lets a reopened editor follow this editor's pending
      // save. Its CAS still rejects unrelated queue edits, deletes, and
      // deliveries, so the flush cannot resurrect or overwrite them.
      void flushPendingTaskEditorWrite({
        message,
        baseline: editingRevisionRef.current,
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
          // Keep the drain lock and the draft: delivering the stale payload
          // would silently drop the newer edits. Reopening the task retries.
          console.warn("[new-task] failed to save edited pending task", error);
        });
    };
  }, [buildPendingTaskMessage]);
  const cancelEditingPendingTask = () => {
    cancelEnvironmentSwitch();
    editingFlushRef.current?.();
  };
  useEffect(
    () => () => {
      editingFlushRef.current?.();
    },
    [],
  );

  const value = {
    projectScopes,
    selectedEnvironmentId,
    selectedProjectKey,
    selectedModelKey,
    workspaceMode,
    canChooseWorkspace,
    selectedBranchName,
    defaultBaseBranchName,
    selectedWorktreePath,
    startFromOrigin,
    draftKey: selectedProjectDraftKey,
    pullRequestReference: selectedProjectDraft.workspaceSelection?.pullRequestReference,
    editingPendingTask,
    prompt,
    attachments,
    submitting,
    branchQuery,
    branchesLoading,
    branchesError: branchState.error,
    branchesFetchingNextPage,
    hasMoreBranches,
    availableBranches,
    currentCheckoutBranchName,
    runtimeMode,
    expandedProvider,
    environments,
    selectedProject,
    isScratchDraft,
    modelOptions,
    selectedModel,
    selectedModelOption,
    selectedProviderStatus,
    providerGroups,
    filteredBranches,
    reset,
    setProject,
    openDraft,
    selectEnvironment,
    switchEnvironment,
    switchingToEnvironmentId,
    environmentPinned,
    setSelectedModelKey,
    setWorkspaceMode,
    selectBranch,
    setStartFromOrigin,
    beginEditingPendingTask,
    finishEditingPendingTask,
    cancelEditingPendingTask,
    buildPendingTaskMessage,
    setPrompt,
    replaceAttachments,
    appendAttachments,
    removeAttachment,
    clearAttachments,
    setSubmitting,
    setBranchQuery,
    loadBranches,
    loadMoreBranches,
    setRuntimeMode,
    setSelectedModelOptions,
    setExpandedProvider,
  } satisfies NewTaskFlowContextValue;

  return <NewTaskFlowContext.Provider value={value}>{props.children}</NewTaskFlowContext.Provider>;
}

export function useNewTaskFlow() {
  const value = React.use(NewTaskFlowContext);
  if (value === null) {
    throw new Error("useNewTaskFlow must be used within NewTaskFlowProvider.");
  }
  return value;
}
