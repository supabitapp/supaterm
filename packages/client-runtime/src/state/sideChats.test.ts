import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { scopedThreadKey } from "../environment/scoped.ts";
import {
  resolveSideChatCommand,
  sendSideChatFirstMessage,
  type SideChatParent,
  sideChatStartBlockedReason,
} from "./sideChats.ts";

const thread = (
  overrides: Partial<Extract<SideChatParent, { kind: "thread" }>> = {},
): SideChatParent => ({
  kind: "thread",
  lineage: { relationshipToParent: null },
  deletedAt: null,
  worktreePending: false,
  ...overrides,
});

describe("sideChatStartBlockedReason", () => {
  it.each([
    ["a listed thread, even mid first turn", thread(), true, true, null],
    [
      "a forked thread",
      thread({ lineage: { relationshipToParent: "fork", sideChat: false } }),
      true,
      true,
      null,
    ],
    [
      "a side chat",
      thread({ lineage: { relationshipToParent: "fork", sideChat: true } }),
      true,
      true,
      "Side chats cannot start side chats.",
    ],
    [
      "a side chat draft",
      { kind: "draft", sideChat: true },
      true,
      true,
      "Side chats cannot start side chats.",
    ],
    [
      "a subagent",
      thread({ lineage: { relationshipToParent: "subagent" } }),
      true,
      true,
      "Subagent threads cannot start side chats.",
    ],
    ["a read-only connection", thread(), false, true, "This connection cannot start side chats."],
    [
      "a server config still loading",
      thread(),
      true,
      null,
      "Side chats are not ready yet. Try again in a moment.",
    ],
    [
      "a server without side chats",
      thread(),
      true,
      false,
      "Update this environment's Supaterm server to use side chats.",
    ],
    [
      "a draft before its first send",
      { kind: "draft", sideChat: false },
      true,
      true,
      "Side chats start after the first message.",
    ],
    [
      "a deleted thread",
      thread({ deletedAt: "2026-11-01T00:00:00.000Z" }),
      true,
      true,
      "This thread was deleted.",
    ],
    [
      "a thread whose worktree is pending",
      thread({ worktreePending: true }),
      true,
      true,
      "Available once the thread's worktree is set up.",
    ],
  ] satisfies ReadonlyArray<
    readonly [string, SideChatParent, boolean, boolean | null, string | null]
  >)("%s", (_name, parent, canOperate, supported, expected) => {
    expect(sideChatStartBlockedReason({ parent, canOperate, supported })).toBe(expected);
  });
});

describe("resolveSideChatCommand", () => {
  it("starts a side chat from /side or /btw when available", () => {
    expect(resolveSideChatCommand("/side why is CI red?", null)).toEqual({
      kind: "start",
      prompt: "why is CI red?",
    });
    expect(resolveSideChatCommand("/btw", null)).toEqual({ kind: "start", prompt: "" });
  });

  it("refuses /side with the reason instead of sending it to the thread", () => {
    expect(
      resolveSideChatCommand("/side why is CI red?", "Side chats start after the first message."),
    ).toEqual({ kind: "refuse", reason: "Side chats start after the first message." });
  });

  it("leaves other messages alone", () => {
    expect(resolveSideChatCommand("fix /side effects", "Blocked.")).toEqual({ kind: "none" });
  });
});

describe("sendSideChatFirstMessage", () => {
  const environmentId = EnvironmentId.make("env-1");
  const parentRef = { environmentId, threadId: ThreadId.make("parent") };
  const targetThreadId = ThreadId.make("side-chat");

  const harness = (options: { readonly refuse?: string; readonly landsOnFork?: boolean } = {}) => {
    const shells = new Map<string, { lineage: { parentThreadId: ThreadId } }>();
    const forks: Array<ThreadId> = [];
    const enqueued: Array<string> = [];
    const send = (text: string) =>
      sendSideChatFirstMessage({
        registry: AtomRegistry.make(),
        forkSideChat: {
          label: "fork-side-chat",
          run: async (_registry, { input }) => {
            forks.push(input.targetThreadId);
            if (options.refuse !== undefined) {
              return AsyncResult.failure(Cause.fail(new Error(options.refuse)));
            }
            if (options.landsOnFork === true) {
              shells.set(scopedThreadKey({ environmentId, threadId: input.targetThreadId }), {
                lineage: { parentThreadId: input.sourceThreadId },
              });
            }
            return AsyncResult.success(undefined);
          },
        },
        readThread: (ref) => shells.get(scopedThreadKey(ref)) ?? null,
        waitForThread: async () => false,
        parentRef,
        targetThreadId,
        creationSource: "web",
        enqueue: async () => {
          enqueued.push(text);
          return text;
        },
      });
    return { send, forks, enqueued, shells };
  };

  it("queues the message once the fork succeeds, even before the side chat reaches the client", async () => {
    const { send, forks, enqueued } = harness();
    await expect(send("why is CI red?")).resolves.toEqual({
      kind: "queued",
      value: "why is CI red?",
    });
    expect(forks).toEqual([targetThreadId]);
    expect(enqueued).toEqual(["why is CI red?"]);
  });

  it("does not fork again for a side chat that already exists", async () => {
    const { send, forks, enqueued } = harness({ landsOnFork: true });
    await send("first");
    await send("retry");
    expect(forks).toEqual([targetThreadId]);
    expect(enqueued).toEqual(["first", "retry"]);
  });

  it("queues nothing when the server refuses the fork", async () => {
    const { send, enqueued } = harness({ refuse: "Thread parent has no worktree yet." });
    await expect(send("hi")).resolves.toEqual({
      kind: "failed",
      reason: "Thread parent has no worktree yet.",
    });
    expect(enqueued).toEqual([]);
  });

  it("sends a refused retry whose earlier fork landed", async () => {
    const { send, enqueued, shells } = harness({ refuse: "Thread side-chat already exists." });
    shells.set(scopedThreadKey({ environmentId, threadId: targetThreadId }), {
      lineage: { parentThreadId: parentRef.threadId },
    });
    await expect(send("hi")).resolves.toEqual({ kind: "queued", value: "hi" });
    expect(enqueued).toEqual(["hi"]);
  });

  it("forks once when the same first message is sent twice at once", async () => {
    const { send, forks, enqueued } = harness();
    const [first, second] = await Promise.all([send("hi"), send("hi")]);
    expect([first.kind, second.kind]).toEqual(["queued", "busy"]);
    expect(forks).toHaveLength(1);
    expect(enqueued).toEqual(["hi"]);
  });
});
