import { describe, expect, it } from "vite-plus/test";

import {
  resolveSideChatCommand,
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
