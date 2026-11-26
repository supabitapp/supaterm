import { Debouncer } from "@tanstack/react-pacer";
import { EnvironmentId, PullRequestMergeMethod } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";

export const PERSISTED_STATE_KEY = "supaterm:ui-state:v1";

export interface PersistedUiState {
  projectOrder?: string[];
  defaultAdvertisedEndpointKey?: string | null;
  sidebarProjectScopeKey?: string | null;
  sidebarProjectScopeKeys?: string[];
  sidebarEnvironmentScopeId?: string | null;
  pullRequestMergeMethod?: string;
}

export interface UiProjectState {
  projectOrder: string[];
  sidebarProjectScopeKeys: string[];
  sidebarEnvironmentScopeId: EnvironmentId | null;
}

export interface UiEndpointState {
  defaultAdvertisedEndpointKey: string | null;
}

export interface UiPullRequestState {
  pullRequestMergeMethod: PullRequestMergeMethod;
}

export interface UiState extends UiProjectState, UiEndpointState, UiPullRequestState {}

const initialState: UiState = {
  projectOrder: [],
  sidebarProjectScopeKeys: [],
  sidebarEnvironmentScopeId: null,
  defaultAdvertisedEndpointKey: null,
  pullRequestMergeMethod: "merge",
};

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    ),
  ];
}

function sanitizeOptionalKey(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const isPullRequestMergeMethod = Schema.is(PullRequestMergeMethod);
const isEnvironmentId = Schema.is(EnvironmentId);

export function parsePersistedState(parsed: PersistedUiState): UiState {
  return {
    projectOrder: sanitizeStringArray(parsed.projectOrder),
    defaultAdvertisedEndpointKey: sanitizeOptionalKey(parsed.defaultAdvertisedEndpointKey),
    sidebarProjectScopeKeys: sanitizeStringArray(
      parsed.sidebarProjectScopeKeys ?? [parsed.sidebarProjectScopeKey],
    ),
    sidebarEnvironmentScopeId: isEnvironmentId(parsed.sidebarEnvironmentScopeId)
      ? parsed.sidebarEnvironmentScopeId
      : null,
    pullRequestMergeMethod: isPullRequestMergeMethod(parsed.pullRequestMergeMethod)
      ? parsed.pullRequestMergeMethod
      : initialState.pullRequestMergeMethod,
  };
}

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    return raw ? parsePersistedState(JSON.parse(raw) as PersistedUiState) : initialState;
  } catch {
    return initialState;
  }
}

export function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        projectOrder: state.projectOrder,
        defaultAdvertisedEndpointKey: state.defaultAdvertisedEndpointKey,
        sidebarProjectScopeKeys: state.sidebarProjectScopeKeys,
        // Older clients read only this field.
        sidebarProjectScopeKey:
          state.sidebarProjectScopeKeys.length === 1
            ? (state.sidebarProjectScopeKeys[0] ?? null)
            : null,
        sidebarEnvironmentScopeId: state.sidebarEnvironmentScopeId,
        pullRequestMergeMethod: state.pullRequestMergeMethod,
      } satisfies PersistedUiState),
    );
  } catch {}
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

function setDefaultAdvertisedEndpointKey(state: UiState, key: string | null): UiState {
  const nextKey = key && key.length > 0 ? key : null;
  if (state.defaultAdvertisedEndpointKey === nextKey) {
    return state;
  }
  return {
    ...state,
    defaultAdvertisedEndpointKey: nextKey,
  };
}

function setSidebarProjectScopeKeys(state: UiState, projectKeys: readonly string[]): UiState {
  const nextKeys = sanitizeStringArray(projectKeys);
  if (
    nextKeys.length === state.sidebarProjectScopeKeys.length &&
    nextKeys.every((key, index) => key === state.sidebarProjectScopeKeys[index])
  ) {
    return state;
  }
  return {
    ...state,
    sidebarProjectScopeKeys: nextKeys,
  };
}

function setSidebarEnvironmentScopeId(
  state: UiState,
  environmentId: EnvironmentId | null,
): UiState {
  return state.sidebarEnvironmentScopeId === environmentId
    ? state
    : { ...state, sidebarEnvironmentScopeId: environmentId };
}

function setPullRequestMergeMethod(state: UiState, method: PullRequestMergeMethod): UiState {
  return state.pullRequestMergeMethod === method
    ? state
    : { ...state, pullRequestMergeMethod: method };
}

export function reorderProjects(
  state: UiState,
  currentProjectOrder: readonly string[],
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
): UiState {
  if (draggedProjectIds.length === 0) {
    return state;
  }
  const draggedSet = new Set(draggedProjectIds);
  const targetSet = new Set(targetProjectIds);
  if (draggedProjectIds.every((id) => targetSet.has(id))) {
    return state;
  }

  const originalTargetIndex = currentProjectOrder.findIndex((id) => targetSet.has(id));
  if (originalTargetIndex < 0) {
    return state;
  }

  const projectOrder = [...currentProjectOrder];

  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = projectOrder.length - 1; i >= 0; i--) {
    if (draggedSet.has(projectOrder[i]!)) {
      removed.unshift(projectOrder.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return state;
  }

  const insertIndex = originalTargetIndex - Math.max(0, draggedBeforeTarget - 1);
  projectOrder.splice(insertIndex, 0, ...removed);
  return {
    ...state,
    projectOrder,
  };
}

interface UiStateStore extends UiState {
  setDefaultAdvertisedEndpointKey: (key: string | null) => void;
  setSidebarProjectScopeKeys: (projectKeys: readonly string[]) => void;
  setSidebarEnvironmentScopeId: (environmentId: EnvironmentId | null) => void;
  setPullRequestMergeMethod: (method: PullRequestMergeMethod) => void;
  reorderProjects: (
    currentProjectOrder: readonly string[],
    draggedProjectIds: readonly string[],
    targetProjectIds: readonly string[],
  ) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  setDefaultAdvertisedEndpointKey: (key) =>
    set((state) => setDefaultAdvertisedEndpointKey(state, key)),
  setSidebarProjectScopeKeys: (projectKeys) =>
    set((state) => setSidebarProjectScopeKeys(state, projectKeys)),
  setSidebarEnvironmentScopeId: (environmentId) =>
    set((state) => setSidebarEnvironmentScopeId(state, environmentId)),
  setPullRequestMergeMethod: (method) => set((state) => setPullRequestMergeMethod(state, method)),
  reorderProjects: (currentProjectOrder, draggedProjectIds, targetProjectIds) =>
    set((state) =>
      reorderProjects(state, currentProjectOrder, draggedProjectIds, targetProjectIds),
    ),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
