import type {
  EnvironmentId,
  OrchestrationV2AppThreadLineage,
  OrchestrationV2CreationSource,
  ScopedThreadRef,
  ThreadId,
} from "@supaterm/contracts";
import { parseSideChatCommand } from "@supaterm/shared/composerTrigger";
import type { AtomRegistry } from "effect/reactivity";

import { scopedThreadKey, scopeThreadRef } from "../environment/scoped.ts";
import type { ForkSideChatInput } from "../operations/commands.ts";
import {
  type AtomCommand,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "./runtime.ts";

export type SideChatParent =
  /** A thread that exists only on this client until its first send. */
  | { readonly kind: "draft"; readonly sideChat: boolean }
  | {
      readonly kind: "thread";
      readonly lineage: Pick<OrchestrationV2AppThreadLineage, "relationshipToParent" | "sideChat">;
      /** The thread on a linked environment that delegated this one, if any. */
      readonly delegatedFrom: unknown;
      readonly deletedAt: unknown;
      /** See `orchestrationV2WorktreePending`. */
      readonly worktreePending: boolean;
    };

/**
 * Why `parent` cannot start a side chat, or null when it can. Mirrors the server's side chat fork
 * refusals; a parent still in its first turn is allowed, its side chat starts from a digest.
 */
export function sideChatStartBlockedReason(input: {
  readonly parent: SideChatParent;
  readonly canOperate: boolean;
  /** The environment's `sideChats` capability, or null while its server config loads. */
  readonly supported: boolean | null;
}): string | null {
  const { parent } = input;
  if (parent.kind === "draft" ? parent.sideChat : parent.lineage.sideChat === true) {
    return "Side chats cannot start side chats.";
  }
  // A delegated task is a remote thread's subagent.
  if (
    parent.kind === "thread" &&
    (parent.lineage.relationshipToParent === "subagent" || parent.delegatedFrom != null)
  ) {
    return "Subagent threads cannot start side chats.";
  }
  if (!input.canOperate) return "This connection cannot start side chats.";
  if (input.supported === null) return "Side chats are not ready yet. Try again in a moment.";
  if (!input.supported) return "Update this environment's Supaterm server to use side chats.";
  if (parent.kind === "draft") return "Side chats start after the first message.";
  if (parent.deletedAt != null) return "This thread was deleted.";
  if (parent.worktreePending) return "Available once the thread's worktree is set up.";
  return null;
}

export type SideChatCommandAction =
  | { readonly kind: "none" }
  | { readonly kind: "refuse"; readonly reason: string }
  | { readonly kind: "start"; readonly prompt: string };

/**
 * What sending `text` does: `/side [prompt]` or `/btw [prompt]` starts a side chat, or is refused
 * with `blockedReason` rather than reaching the thread's agent as a message.
 */
export function resolveSideChatCommand(
  text: string,
  blockedReason: string | null,
): SideChatCommandAction {
  const command = parseSideChatCommand(text);
  if (command === null) return { kind: "none" };
  return blockedReason === null
    ? { kind: "start", prompt: command.prompt }
    : { kind: "refuse", reason: blockedReason };
}

export type SideChatFirstMessageResult<A> =
  | { readonly kind: "queued"; readonly value: A }
  /** Another send of this side chat's first message is still running. */
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly reason: string };

const firstMessagesInFlight = new Set<string>();

/**
 * Sends a side chat's first message: forks `parentRef` into `targetThreadId` unless that side
 * chat already exists, then queues the message with `enqueue`. Callers keep the target id and the
 * message until this resolves "queued", so a retry forks at most once and a fork that succeeded
 * always gets its message, even when its shell is slow to reach this client.
 */
export async function sendSideChatFirstMessage<A>(input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly forkSideChat: AtomCommand<
    { readonly environmentId: EnvironmentId; readonly input: ForkSideChatInput },
    unknown,
    unknown
  >;
  readonly readThread: (
    ref: ScopedThreadRef,
  ) => { readonly lineage: Pick<OrchestrationV2AppThreadLineage, "parentThreadId"> } | null;
  /** Gives the shell a moment to land so navigation finds it; the send goes on either way. */
  readonly waitForThread: (ref: ScopedThreadRef) => Promise<unknown>;
  readonly parentRef: ScopedThreadRef;
  readonly targetThreadId: ThreadId;
  readonly creationSource: OrchestrationV2CreationSource;
  readonly enqueue: () => Promise<A>;
}): Promise<SideChatFirstMessageResult<A>> {
  const targetRef = scopeThreadRef(input.parentRef.environmentId, input.targetThreadId);
  const key = scopedThreadKey(targetRef);
  if (firstMessagesInFlight.has(key)) return { kind: "busy" };
  firstMessagesInFlight.add(key);
  const forked = () =>
    input.readThread(targetRef)?.lineage.parentThreadId === input.parentRef.threadId;
  try {
    if (!forked()) {
      const fork = await runAtomCommand(
        input.registry,
        input.forkSideChat,
        {
          environmentId: input.parentRef.environmentId,
          input: {
            sourceThreadId: input.parentRef.threadId,
            targetThreadId: input.targetThreadId,
            title: "Side chat",
            creationSource: input.creationSource,
          },
        },
        { reportFailure: false },
      );
      // A retry whose earlier fork landed is refused as a duplicate; its shell says so.
      if (fork._tag === "Failure" && !forked()) {
        if (isAtomCommandInterrupted(fork)) {
          return { kind: "failed", reason: "Starting the side chat was cancelled." };
        }
        const error = squashAtomCommandFailure(fork);
        return {
          kind: "failed",
          reason: error instanceof Error ? error.message : "Could not start a side chat.",
        };
      }
      if (!forked()) await input.waitForThread(targetRef);
    }
    return { kind: "queued", value: await input.enqueue() };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : "Could not send the side chat's message.",
    };
  } finally {
    firstMessagesInFlight.delete(key);
  }
}
