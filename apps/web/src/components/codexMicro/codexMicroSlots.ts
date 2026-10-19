import {
  CODEX_MICRO_AGENT_KEYS,
  type CodexMicroAction,
  type CodexMicroAgentSource,
  type CodexMicroCustomAgentKeys,
  type CodexMicroLightingModel,
  type CodexMicroSlotStatus,
  type CodexMicroThreadRef,
  type CodexMicroVoiceState,
  type EnvironmentId,
} from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
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

function threadRef(thread: EnvironmentThreadShell): CodexMicroThreadRef {
  return { environmentId: thread.environmentId, threadId: thread.id };
}

function shellBinding(thread: EnvironmentThreadShell): CodexMicroSlotBinding {
  return { type: "thread", ref: threadRef(thread), thread };
}

// Matches the sidebar: a reopened thread keeps its doneAt, so the override decides.
function isOpenWork(thread: EnvironmentThreadShell, now: string): boolean {
  return (
    thread.archivedAt === null &&
    thread.doneOverride !== "done" &&
    !effectiveSnoozed(thread, { now })
  );
}

function attentionRank(thread: EnvironmentThreadShell): number {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval" || status === "input") return 0;
  if (hasUnseenCompletion(thread)) return 1;
  if (status === "working") return 2;
  return 3;
}

function bindThreads(threads: ReadonlyArray<EnvironmentThreadShell>) {
  return CODEX_MICRO_AGENT_KEYS.map((_, index) => {
    const thread = threads[index];
    return thread === undefined ? EMPTY_BINDING : shellBinding(thread);
  });
}

function recentOpenWork(threads: ReadonlyArray<EnvironmentThreadShell>, now: string) {
  return sortInboxThreadsByReturn(threads.filter((thread) => isOpenWork(thread, now)));
}

/** The six threads or actions the agent keys follow, in key order. */
export function selectCodexMicroSlotBindings(input: {
  readonly source: CodexMicroAgentSource;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly customAgentKeys: CodexMicroCustomAgentKeys;
  readonly now: string;
}): ReadonlyArray<CodexMicroSlotBinding> {
  const { threads, now } = input;
  switch (input.source) {
    case "recent":
      return bindThreads(recentOpenWork(threads, now));
    case "pinned":
      return bindThreads(
        sortPinnedThreadsByOrderKey(
          threads.filter((thread) => thread.pinnedAt !== null && thread.archivedAt === null),
        ),
      );
    case "attention":
      // toSorted is stable, so equally urgent threads keep their recent order.
      return bindThreads(
        recentOpenWork(threads, now).toSorted(
          (left, right) => attentionRank(left) - attentionRank(right),
        ),
      );
    case "custom": {
      const byKey = new Map(
        threads.map((thread) => [scopedThreadKey(threadRef(thread)), thread] as const),
      );
      return CODEX_MICRO_AGENT_KEYS.map((key): CodexMicroSlotBinding => {
        const assignment = input.customAgentKeys[key];
        if (assignment === null) return EMPTY_BINDING;
        if (assignment.type === "action") return { type: "action", action: assignment.action };
        const ref = { environmentId: assignment.environmentId, threadId: assignment.threadId };
        return { type: "thread", ref, thread: byKey.get(scopedThreadKey(ref)) ?? null };
      });
    }
  }
}

function codexMicroSlotStatus(
  thread: EnvironmentThreadShell,
  options: { readonly connected: boolean; readonly viewing: boolean },
): CodexMicroSlotStatus {
  if (!options.connected) return "idle";
  switch (resolveSidebarThreadStatus(thread)) {
    case "failed":
      return "error";
    case "approval":
      return "awaiting-approval";
    case "input":
    case "limited":
      return "awaiting-response";
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
}): ReadonlyArray<CodexMicroSlotView> {
  return CODEX_MICRO_AGENT_KEYS.map((key, index): CodexMicroSlotView => {
    const binding = input.bindings[index] ?? EMPTY_BINDING;
    if (binding.type === "action") {
      return {
        key,
        thread: null,
        title: null,
        status: "idle",
        selected: false,
        action: binding.action,
      };
    }
    if (binding.type === "empty") {
      return { key, thread: null, title: null, status: "off", selected: false, action: null };
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
    };
  });
}

export function buildCodexMicroLightingModel(
  views: ReadonlyArray<CodexMicroSlotView>,
  voice: CodexMicroVoiceState,
): CodexMicroLightingModel {
  return {
    slots: views.map((view) => ({
      thread: view.status === "off" ? null : view.thread,
      status: view.status,
      selected: view.selected,
    })),
    voice,
  };
}
