import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";

import {
  formatThreadLink,
  parseThreadLinkHref,
  relabelThreadLinks,
  resolveThreadLinkRef,
} from "./threadLinks.ts";

const ref = (environmentId: string, threadId = "chat-1") => ({
  environmentId: EnvironmentId.make(environmentId),
  threadId: ThreadId.make(threadId),
});

describe("thread link destinations", () => {
  it("prefers the local literal id, then the local decoded id, over remote matches", () => {
    const source = ref("local", "provider%3A1");
    const decoded = ref("local", "provider:1");
    const remote = ref("remote", "provider%3A1");
    expect(resolveThreadLinkRef(source, [remote, decoded, source])).toEqual(source);
    expect(resolveThreadLinkRef(source, [remote, decoded])).toEqual(decoded);
  });

  it("opens the unique matching chat in another environment", () => {
    const destination = ref("remote");
    expect(resolveThreadLinkRef(ref("local"), [ref("local", "other-chat"), destination])).toEqual(
      destination,
    );
  });

  it("leaves ambiguous or missing destinations unresolved", () => {
    const source = ref("local", "provider%3A1");
    const literal = ref("remote", "provider%3A1");
    const decoded = ref("remote", "provider:1");
    expect(
      resolveThreadLinkRef(source, [literal, ref("other-remote", literal.threadId), decoded]),
    ).toBeNull();
    expect(
      resolveThreadLinkRef(source, [decoded, ref("other-remote", decoded.threadId)]),
    ).toBeNull();
    expect(resolveThreadLinkRef(source, [ref("remote", "other-chat")])).toBeNull();
  });
});

describe("thread links", () => {
  it("takes the thread id verbatim, percent escapes included", () => {
    expect(parseThreadLinkHref("supaterm-thread://v1/mcp:1234")).toBe("mcp:1234");
    expect(parseThreadLinkHref("supaterm-thread://v1/thread:delegated-task:mcp%3A1")).toBe(
      "thread:delegated-task:mcp%3A1",
    );
  });

  it("rejects other links and an empty id", () => {
    expect(parseThreadLinkHref("https://supaterm.com")).toBeNull();
    expect(parseThreadLinkHref("supaterm-thread://v1/")).toBeNull();
    expect(parseThreadLinkHref("supaterm-thread://v1/ ")).toBeNull();
  });

  it("resolves a percent-encoded id when the id as written names no thread", () => {
    const titles = new Map([
      ["thread:project:1", "Decoded"],
      ["provider%3A1", "Literal escape"],
    ]);
    expect(
      relabelThreadLinks(
        "[a](supaterm-thread://v1/thread%3Aproject%3A1) [b](supaterm-thread://v1/provider%3A1)",
        (threadId) => titles.get(threadId),
      ),
    ).toBe(
      "[Decoded](supaterm-thread://v1/thread:project:1) [Literal escape](supaterm-thread://v1/provider%3A1)",
    );

    const untitled = new Map([
      ["a%3A1", ""],
      ["a:1", "Other"],
    ]);
    expect(
      relabelThreadLinks("[Kept](supaterm-thread://v1/a%3A1)", (threadId) =>
        untitled.get(threadId),
      ),
    ).toBe("[Kept](supaterm-thread://v1/a%3A1)");
  });

  it("leaves links inside code spans and fences as written", () => {
    const markdown = [
      "Live [old](supaterm-thread://v1/t1), literal `[old](supaterm-thread://v1/t1)`.",
      "```md",
      "[old](supaterm-thread://v1/t1)",
      "```",
      "After [old](supaterm-thread://v1/t1)",
    ].join("\n");
    expect(relabelThreadLinks(markdown, () => "New")).toBe(
      [
        "Live [New](supaterm-thread://v1/t1), literal `[old](supaterm-thread://v1/t1)`.",
        "```md",
        "[old](supaterm-thread://v1/t1)",
        "```",
        "After [New](supaterm-thread://v1/t1)",
      ].join("\n"),
    );
  });

  it("writes the thread id verbatim so the link opens that exact thread", () => {
    const link = formatThreadLink("thread:delegated-task:mcp%3A1", "Fix");
    expect(link).toBe("[Fix](supaterm-thread://v1/thread:delegated-task:mcp%3A1)");
    expect(parseThreadLinkHref(link.slice(link.indexOf("](") + 2, -1))).toBe(
      "thread:delegated-task:mcp%3A1",
    );
  });

  it("formats a label that would otherwise break the Markdown link", () => {
    expect(formatThreadLink("t1", "Fix [ci] \\ build")).toBe(
      "[Fix ci build](supaterm-thread://v1/t1)",
    );
    expect(formatThreadLink("t1", " ] ")).toBe("[t1](supaterm-thread://v1/t1)");
  });
});
