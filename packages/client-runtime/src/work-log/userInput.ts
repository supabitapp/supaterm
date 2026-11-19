import { type UserInputAttachmentAnswerPayload } from "@supaterm/contracts";
import { composerContextProviderTextForDisplay } from "@supaterm/shared/composerContextReferences";

function record(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function getQuestionAnswerText(value: unknown): string;
export function getQuestionAnswerText(value: unknown) {
  if (typeof value === "string")
    return composerContextProviderTextForDisplay(value) satisfies string;
  if (Array.isArray(value))
    return value.map(getQuestionAnswerText).filter(Boolean).join(", ") satisfies string;
  const nested = record(value);
  return (nested ? getQuestionAnswerText(nested.answers) : "") satisfies string;
}

export function getQuestionTextPreview(answer: UserInputAttachmentAnswerPayload): string;
export function getQuestionTextPreview(answer: UserInputAttachmentAnswerPayload) {
  return Object.values(answer.questionTextById ?? {})
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ") satisfies string;
}

export function getQuestionAnswerPreview(answer: UserInputAttachmentAnswerPayload) {
  const answers = Object.values(answer.answers).map(getQuestionAnswerText).filter(Boolean);
  const attachments = Object.values(answer.attachmentsByQuestionId)
    .flat()
    .map((attachment) => attachment.name);
  return (
    answers.length > 0
      ? answers.join(" · ")
      : attachments.length > 0
        ? attachments.join(", ")
        : Object.values(answer.questionTextById ?? {}).join(" · ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function hasQuestionAnswer(answer: UserInputAttachmentAnswerPayload) {
  return (
    Object.values(answer.answers).some(getQuestionAnswerText) ||
    Object.values(answer.attachmentsByQuestionId).some((attachments) => attachments.length > 0)
  );
}
