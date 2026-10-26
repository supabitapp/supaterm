import { ThreadId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import { collectComposerContextReferences } from "@supaterm/shared/composerContextReferences";
import { terminalContextRecord } from "./composerContextRecords";

import { formatTerminalContextReference, type TerminalContextDraft } from "./terminalContext";

function makeContext(overrides?: Partial<TerminalContextDraft>): TerminalContextDraft {
  return {
    id: "context-1",
    threadId: ThreadId.make("thread-1"),
    terminalId: "default",
    terminalLabel: "Terminal 1",
    lineStart: 12,
    lineEnd: 13,
    text: "git status\nOn branch main",
    createdAt: "2026-03-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("terminalContext", () => {
  it("folds legacy producer ids consistently in records and references", () => {
    const context = makeContext({ id: "old terminal:one" });
    const reference = collectComposerContextReferences(formatTerminalContextReference(context))[0];
    expect(reference).toBeDefined();
    expect(reference?.contextId).toBe(terminalContextRecord(context).contextId);
  });
});
