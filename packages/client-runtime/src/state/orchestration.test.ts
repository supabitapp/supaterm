import { MessageId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { nextPromptSuggestionReplyId } from "./orchestration.ts";

const message = (id: string, role: "user" | "assistant" | "system", streaming = false) => ({
  id: MessageId.make(id),
  role,
  streaming,
});
type Message = ReturnType<typeof message>;
const replyId = (messages: ReadonlyArray<Message>) =>
  nextPromptSuggestionReplyId(messages, (entry) => entry);

describe("nextPromptSuggestionReplyId", () => {
  it("answers the assistant reply the thread ends on, past system notices", () => {
    expect(
      replyId([message("u1", "user"), message("a1", "assistant"), message("s1", "system")]),
    ).toBe("a1");
  });

  it("has nothing to answer while the reply streams or after the user writes again", () => {
    expect(replyId([message("u1", "user"), message("a1", "assistant", true)])).toBeNull();
    expect(replyId([message("a1", "assistant"), message("u2", "user")])).toBeNull();
    expect(replyId([])).toBeNull();
  });

  it("reads past feed rows that are not messages", () => {
    const feed = [{ message: message("a1", "assistant") }, { message: null }];
    expect(nextPromptSuggestionReplyId(feed, (entry) => entry.message)).toBe("a1");
  });
});
