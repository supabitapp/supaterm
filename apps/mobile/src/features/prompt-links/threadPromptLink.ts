import * as Dialog from "../../components/ui/Dialog";
import type { NavigationState, PartialState } from "@react-navigation/native";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@supaterm/contracts";
import { parseThreadLinkPrompt, type LinkedPrompt } from "@supaterm/shared/promptLinks";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { findStackRoute } from "../../lib/appLinking";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadShells, environmentThreads } from "../../state/threads";
import { applyLinkedPromptToThreadDraft } from "./prompt-link-actions";
import {
  promptLinkNotice,
  promptLinkSearchFromParams,
  stepPendingPromptLink,
} from "./prompt-link-model";

const THREAD_LINK_KEYS = ["prompt"];

type PendingThreadLink = { readonly ref: ScopedThreadRef; readonly prompt: LinkedPrompt };

function firstString(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length > 0 ? first : null;
}

let pendingLink: PendingThreadLink | null = null;
let stopWaitingForShell: (() => void) | null = null;
let stopWaitingForDetail: (() => void) | null = null;

export function takeThreadPromptLink(
  state: PartialState<NavigationState> | undefined,
): PartialState<NavigationState> | undefined {
  if (!state) return state;
  const index = state.routes.findIndex((route) => route.name === "Thread");
  const route = state.routes[index];
  const params = route?.params as Readonly<Record<string, unknown>> | undefined;
  const search = promptLinkSearchFromParams(params, THREAD_LINK_KEYS);
  if (!route || !params || search === null) return state;

  dropPendingLink();
  const { prompt: _prompt, ...rest } = params;
  const routes = state.routes.slice();
  routes[index] = { ...route, params: rest };
  const nextState = { ...state, routes };

  const environmentId = firstString(params.environmentId);
  const threadId = firstString(params.threadId);
  if (environmentId === null || threadId === null) return nextState;
  const parsed = parseThreadLinkPrompt(search);
  if (!parsed.ok) {
    Dialog.alert("Could not open link", parsed.error);
    return nextState;
  }
  if (parsed.value !== null) {
    pendingLink = {
      ref: { environmentId: EnvironmentId.make(environmentId), threadId: ThreadId.make(threadId) },
      prompt: parsed.value,
    };
  }
  return nextState;
}

export function resolvePendingThreadPromptLink(state: NavigationState | undefined): void {
  if (pendingLink === null) return;
  const { ref } = pendingLink;

  const shellAtom = environmentThreadShells.threadShellAtom(ref);
  const detailAtom = environmentThreads.stateAtom(ref.environmentId, ref.threadId);

  const screenHoldsDetail = appAtomRegistry.getNodes().has(detailAtom);
  const step = stepPendingPromptLink(pendingLink, {
    screenOnStack:
      findStackRoute(
        state,
        "Thread",
        (params) =>
          firstString(params?.environmentId) === ref.environmentId &&
          firstString(params?.threadId) === ref.threadId,
      ) !== undefined,
    ready:
      appAtomRegistry.get(shellAtom) !== null ||
      (screenHoldsDetail && detailLoaded(appAtomRegistry.get(detailAtom))),
  });
  if (step.pending === null) dropPendingLink();
  if (step.resolve !== null) {
    const { prompt } = step.resolve;
    void applyLinkedPromptToThreadDraft(
      scopedThreadKey(ref.environmentId, ref.threadId),
      prompt,
      promptLinkNotice({ hiddenCharacters: prompt.hiddenCharacters }),
    );
  } else if (step.pending !== null) {
    stopWaitingForShell ??= appAtomRegistry.subscribe(shellAtom, (shell) => {
      if (shell !== null) resolvePendingThreadPromptLink(rootNavigationRef.getRootState());
    });
    if (screenHoldsDetail) {
      stopWaitingForDetail ??= appAtomRegistry.subscribe(detailAtom, (detail) => {
        if (detailLoaded(detail)) resolvePendingThreadPromptLink(rootNavigationRef.getRootState());
      });
    }
  }
}

function detailLoaded(
  result: AsyncResult.AsyncResult<{ readonly data: Option.Option<unknown> }, unknown>,
): boolean {
  return Option.isSome(Option.flatMap(AsyncResult.value(result), (state) => state.data));
}

function dropPendingLink(): void {
  pendingLink = null;
  stopWaitingForShell?.();
  stopWaitingForShell = null;
  stopWaitingForDetail?.();
  stopWaitingForDetail = null;
}
