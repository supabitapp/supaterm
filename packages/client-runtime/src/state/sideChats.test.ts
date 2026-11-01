import { describe, expect, it } from "vite-plus/test";

import { type SideChatParent, sideChatStartBlockedReason } from "./sideChats.ts";

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
