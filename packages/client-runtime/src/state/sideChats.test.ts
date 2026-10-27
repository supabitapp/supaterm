import { ThreadId } from "@supaterm/contracts";
import { describe, expect, it } from "vitest";

import { isHiddenSideChat, sideChatsOf } from "./sideChats.ts";

const parentId = ThreadId.make("thread:parent");
const lineage = {
  parentThreadId: parentId,
  relationshipToParent: "fork" as const,
  rootThreadId: parentId,
};
const sideChat = { id: ThreadId.make("thread:side"), sideChat: true, lineage };
const fork = { id: ThreadId.make("thread:fork"), lineage };

describe("side chats", () => {
  it("hides a side chat only while its parent is still listed", () => {
    expect(isHiddenSideChat(sideChat, new Set([parentId]))).toBe(true);
    expect(isHiddenSideChat(sideChat, new Set())).toBe(false);
    expect(isHiddenSideChat(fork, new Set([parentId]))).toBe(false);
  });

  it("lists a parent's side chats, not its ordinary forks", () => {
    expect(sideChatsOf([sideChat, fork], parentId)).toEqual([sideChat]);
  });
});
