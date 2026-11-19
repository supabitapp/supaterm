import { describe, expect, it } from "vite-plus/test";

import { getQuestionAnswerPreview, getQuestionAnswerText } from "./userInput.js";

const answerWithReviewComment = [
  "See my note: [Review comment: notes.md L2; ref=review-comment_c1]",
  "",
  '<supaterm_context version="1">',
  '<context kind="review-comment" id="review-comment_c1">',
  "file: notes.md",
  "range: L2 (2-2)",
  "comment:",
  "  Rename this",
  "diff:",
  "  +line changed",
  "</context>",
  "</supaterm_context>",
].join("\n");

describe("question answer display", () => {
  it("keeps the provider context envelope out of answer history and preview", () => {
    const history = getQuestionAnswerText(answerWithReviewComment);
    const preview = getQuestionAnswerPreview({
      requestId: "request-1",
      answers: { q1: answerWithReviewComment },
      attachmentsByQuestionId: {},
      questionTextById: { q1: "What should change?" },
    });

    expect(history).toBe("See my note: [Review comment: notes.md L2]");
    expect(preview).toContain("See my note:");
    expect(preview).not.toContain("<supaterm_context");

    const typedXml =
      'Use this XML literally: <supaterm_context version="1"><context kind="review-comment" id="example">keep me</context></supaterm_context>';
    expect(getQuestionAnswerText(typedXml)).toBe(typedXml);
  });
});
