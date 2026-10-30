import type { NavigationState } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import * as Linking from "expo-linking";
import { AppState, Dimensions, Platform } from "react-native";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { environmentCatalog } from "../../connection/catalog";
import { deriveLayout } from "../../lib/layout";
import {
  NATIVE_METRICS_TIMEOUT_MS,
  nativeWorkspaceColumnsSupportedFor,
} from "../../native/NativeWorkspaceColumns";
import {
  currentNativeLayoutMetrics,
  firstNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { loadPreferences, savePreferencesPatch } from "../../persistence/imperative";
import { rootStackState, type RootStackNavigation } from "../../lib/root-stack-reset";
import { workspaceRoutesOf } from "../layout/workspace-overlay-routes";
import type { WorkspaceSelections } from "../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { environmentThreads, startOpeningEnvironmentThread } from "../../state/threads";
import {
  rememberedSettingsPage,
  workspaceSelectionsIn,
  type WorkspaceSelectionCheck,
} from "./workspace-tab-navigation";

const REMEMBERS = Platform.OS === "ios";

let selections: WorkspaceSelections = {};
let saved = selections;
let hydration: Promise<void> | null = null;

function save() {
  const writing = selections;
  if (saved === writing) return;

  void savePreferencesPatch({ workspaceSelections: writing })
    .then(() => {
      saved = writing;
    })
    .catch(() => undefined);
}

function withoutRouteKeys(saved: WorkspaceSelections | undefined): WorkspaceSelections {
  const omitKey = <Selection extends { readonly key?: string }>({ key: _, ...rest }: Selection) =>
    rest;
  const { threads, pullRequests, settingsKey: _, threadsDraft: _draft, ...rest } = saved ?? {};
  return {
    ...rest,
    ...(threads ? { threads: omitKey(threads) } : {}),
    ...(pullRequests ? { pullRequests: omitKey(pullRequests) } : {}),
  };
}

export function hydrateWorkspaceSelections() {
  if (!REMEMBERS) return Promise.resolve();
  hydration ??= loadPreferences()
    .then((preferences) => {
      selections = { ...withoutRouteKeys(preferences.workspaceSelections), ...selections };
      saved = selections;
      AppState.addEventListener("change", (status) => {
        if (status !== "active") save();
      });
    })
    .catch(() => undefined);
  return hydration;
}

export function currentWorkspaceSelections() {
  return selections;
}

export function recordWorkspaceSelections(state: NavigationState | undefined) {
  if (!REMEMBERS || !state) return;
  selections = workspaceSelectionsIn(state.routes.slice(0, state.index + 1), selections);
}

function environmentRemoved(environmentId: string) {
  const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
  return (
    catalog.isReady &&
    !appAtomRegistry
      .get(environmentPresentations.presentationsAtom)
      .has(environmentId as EnvironmentId)
  );
}

export const workspaceSelectionCheck: WorkspaceSelectionCheck = {
  thread: (selection) => {
    if (environmentRemoved(selection.environmentId)) return false;
    const environmentId = selection.environmentId as EnvironmentId;
    const detail = appAtomRegistry.get(
      environmentThreads.stateAtom(environmentId, selection.threadId as ThreadId),
    );
    return Option.getOrNull(AsyncResult.value(detail))?.status !== "deleted";
  },
  pullRequest: (selection) => !environmentRemoved(selection.environmentId),
};

export function workspaceHasColumns() {
  const metrics = currentNativeLayoutMetrics();
  const { width, height } = metrics ?? Dimensions.get("window");
  return deriveLayout({
    width,
    height,
    nativeMetrics: metrics,
    nativeWorkspace: nativeWorkspaceColumnsSupportedFor(metrics),
  }).usesSplitView;
}

export function settingsLinkPage() {
  return REMEMBERS && workspaceHasColumns() ? rememberedSettingsPage(selections) : undefined;
}

export async function launchWorkspaceURL(): Promise<string | null> {
  if (!REMEMBERS) return null;
  const metrics = firstNativeLayoutMetrics(NATIVE_METRICS_TIMEOUT_MS);
  await hydrateWorkspaceSelections();
  const thread = selections.threads;

  if (thread) {
    startOpeningEnvironmentThread(
      thread.environmentId as EnvironmentId,
      thread.threadId as ThreadId,
    );
  }
  await metrics;
  if (!thread || !workspaceHasColumns() || !workspaceSelectionCheck.thread(thread)) return null;
  return Linking.createURL(
    `threads/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.threadId)}`,
  );
}

export function firstWorkspaceDetailOpen(navigation: RootStackNavigation) {
  const state = rootStackState(navigation);
  if (!state) return false;
  const { workspace, overlays } = workspaceRoutesOf(state.routes.slice(0, state.index + 1));
  const list = (name: string | undefined) => name === "Home" || name === "Settings";
  return overlays.length === 0 && !list(workspace.at(-1)?.name) && list(workspace.at(-2)?.name);
}
