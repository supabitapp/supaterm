import {
  CODEX_MICRO_AGENT_KEYS,
  type CodexMicroAction,
  type CodexMicroAgentSource,
  type CodexMicroCustomAgentKeys,
  type CodexMicroLightingModel,
  type CodexMicroThreadRef,
  type EnvironmentId,
} from "@supaterm/contracts";
import { parseScopedThreadKey, scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/models";
import { effectiveSnoozed } from "@supaterm/client-runtime/state/thread-snooze";
import { sortInboxThreadsByReturn } from "@supaterm/client-runtime/state/thread-inbox";
import { sortPinnedThreadsByOrderKey } from "@supaterm/client-runtime/state/thread-sort";

import { hasUnseenCompletion, resolveSidebarThreadStatus } from "../Sidebar.logic";
import type { CodexMicroSlotView } from "./codexMicroStore";

export type CodexMicroSlotBinding =
  | { readonly type: "empty" }
  | {
      readonly type: "thread";
      readonly ref: CodexMicroThreadRef;
      /** Null when the assigned thread is no longer loaded. */
      readonly thread: EnvironmentThreadShell | null;
    }
  | { readonly type: "action"; readonly action: CodexMicroAction };

const EMPTY_BINDING: CodexMicroSlotBinding = { type: "empty" };

function threadRef(thread: EnvironmentThreadShell) {
  return { environmentId: thread.environmentId, threadId: thread.id };
}

function shellBinding(thread: EnvironmentThreadShell) {
  return { type: "thread", ref: threadRef(thread), thread } satisfies CodexMicroSlotBinding;
}

function isOpenWork(thread: EnvironmentThreadShell, now: string) {
  return (
    thread.archivedAt === null &&
    thread.doneOverride !== "done" &&
    !effectiveSnoozed(thread, { now })
  );
}

function attentionRank(thread: EnvironmentThreadShell) {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval" || status === "input") return 0;
  if (hasUnseenCompletion(thread)) return 1;
  if (status === "preparing" || status === "working") return 2;
  return 3;
}

function bindThreads(threads: ReadonlyArray<EnvironmentThreadShell>) {
  return CODEX_MICRO_AGENT_KEYS.map((_, index) => {
    const thread = threads[index];
    return thread === undefined ? EMPTY_BINDING : shellBinding(thread);
  });
}

function threadsByKey(threads: ReadonlyArray<EnvironmentThreadShell>) {
  return new Map(threads.map((thread) => [scopedThreadKey(threadRef(thread)), thread] as const));
}

/** The six threads or actions the agent keys follow, in key order. */
export function selectCodexMicroSlotBindings(input: {
  readonly source: CodexMicroAgentSource;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly jumpTargets: ReadonlyArray<string>;
  readonly customAgentKeys: CodexMicroCustomAgentKeys;
  readonly now: string;
}) {
  const { threads, now } = input;
  switch (input.source) {
    case "sidebar": {
      const byKey = threadsByKey(threads);
      return CODEX_MICRO_AGENT_KEYS.map((_, index) => {
        const key = input.jumpTargets[index];
        const ref = key === undefined ? null : parseScopedThreadKey(key);
        if (ref === null) return EMPTY_BINDING satisfies CodexMicroSlotBinding;
        return {
          type: "thread",
          ref,
          thread: byKey.get(scopedThreadKey(ref)) ?? null,
        } satisfies CodexMicroSlotBinding;
      }) satisfies ReadonlyArray<CodexMicroSlotBinding>;
    }
    case "pinned":
      return bindThreads(
        sortPinnedThreadsByOrderKey(
          threads.filter((thread) => thread.pinnedAt !== null && thread.archivedAt === null),
        ),
      ) satisfies ReadonlyArray<CodexMicroSlotBinding>;
    case "attention":
      return bindThreads(
        sortInboxThreadsByReturn(threads.filter((thread) => isOpenWork(thread, now))).toSorted(
          (left, right) => attentionRank(left) - attentionRank(right),
        ),
      ) satisfies ReadonlyArray<CodexMicroSlotBinding>;
    case "custom": {
      const byKey = threadsByKey(threads);
      return CODEX_MICRO_AGENT_KEYS.map((key) => {
        const assignment = input.customAgentKeys[key];
        if (assignment === null) return EMPTY_BINDING satisfies CodexMicroSlotBinding;
        if (assignment.type === "action")
          return { type: "action", action: assignment.action } satisfies CodexMicroSlotBinding;
        const ref = { environmentId: assignment.environmentId, threadId: assignment.threadId };
        return {
          type: "thread",
          ref,
          thread: byKey.get(scopedThreadKey(ref)) ?? null,
        } satisfies CodexMicroSlotBinding;
      }) satisfies ReadonlyArray<CodexMicroSlotBinding>;
    }
  }
}

function codexMicroSlotStatus(
  thread: EnvironmentThreadShell,
  options: { readonly connected: boolean; readonly viewing: boolean },
) {
  if (!options.connected) return "idle";
  switch (resolveSidebarThreadStatus(thread)) {
    case "failed":
      return "error";
    case "approval":
      return "awaiting-approval";
    case "input":
    case "limited":
      return "awaiting-response";
    case "preparing":
    case "working":
      return "working";
    case "waiting":
    case "ready":
      return hasUnseenCompletion(thread) && !options.viewing ? "unread" : "idle";
  }
}

export function buildCodexMicroSlotViews(input: {
  readonly bindings: ReadonlyArray<CodexMicroSlotBinding>;
  readonly routeThreadKey: string | null;
  readonly windowFocused: boolean;
  readonly connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
}) {
  return CODEX_MICRO_AGENT_KEYS.map((key, index) => {
    const binding = input.bindings[index] ?? EMPTY_BINDING;
    if (binding.type === "action") {
      return {
        key,
        thread: null,
        title: null,
        status: "idle",
        selected: false,
        action: binding.action,
      } satisfies CodexMicroSlotView;
    }
    if (binding.type === "empty") {
      return {
        key,
        thread: null,
        title: null,
        status: "off",
        selected: false,
        action: null,
      } satisfies CodexMicroSlotView;
    }
    const selected = scopedThreadKey(binding.ref) === input.routeThreadKey;
    return {
      key,
      thread: binding.ref,
      title: binding.thread?.title ?? null,
      status:
        binding.thread === null
          ? "off"
          : codexMicroSlotStatus(binding.thread, {
              connected: input.connectedEnvironmentIds.has(binding.ref.environmentId),
              viewing: selected && input.windowFocused,
            }),
      selected,
      action: null,
    } satisfies CodexMicroSlotView;
  }) satisfies ReadonlyArray<CodexMicroSlotView>;
}

export function buildCodexMicroLightingModel(
  views: ReadonlyArray<CodexMicroSlotView>,
  voiceActivity: CodexMicroLightingModel["voiceActivity"],
) {
  return {
    voiceActivity,
    slots: CODEX_MICRO_AGENT_KEYS.map((_key, index) => {
      const view = views[index];
      if (!view) return { thread: null, status: "off", selected: false };
      return {
        thread: view.status === "off" ? null : view.thread,
        status: view.status,
        selected: view.selected,
      };
    }),
  } satisfies CodexMicroLightingModel;
}
