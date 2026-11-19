import type {
  PreviewAnnotationContextRecord,
  PreviewAnnotationPayload,
  ReviewCommentContextRecord,
  UserInputQuestion,
} from "@supaterm/contracts";
import {
  formatModelContextText,
  projectComposerContextForProvider,
  replaceComposerContextReferences,
} from "@supaterm/shared/composerContextReferences";
import { formatThreadLink } from "@supaterm/shared/threadLinks";
import {
  buildPendingUserInputAnswers,
  normalizeSelectedOptionValues,
  resolvePendingUserInputAnswer,
  type PendingUserInputAnswer,
  type PendingUserInputDraftAnswer,
} from "@supaterm/client-runtime/state/pending-user-input";

import { collectInlineContextIds } from "./lib/composerContextReferences";
import {
  previewAnnotationContextRecord,
  type ReferenceContextRecord,
  reviewCommentContextRecord,
} from "./lib/composerContextRecords";
import type { ReviewCommentContext } from "./reviewCommentContext";

type AnswerContextRecord =
  | ReferenceContextRecord
  | ReviewCommentContextRecord
  | PreviewAnnotationContextRecord;

export function answerContextRecords(
  questionDraft: { referenceContexts: ReadonlyArray<ReferenceContextRecord> } | null | undefined,
  threadDraft:
    | {
        reviewComments: ReadonlyArray<ReviewCommentContext>;
        previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
      }
    | null
    | undefined,
) {
  return [
    ...(questionDraft?.referenceContexts ?? []),
    ...(threadDraft?.reviewComments ?? []).map(reviewCommentContextRecord),
    ...(threadDraft?.previewAnnotations ?? []).map((annotation) =>
      previewAnnotationContextRecord(annotation),
    ),
  ] satisfies AnswerContextRecord[];
}

export function projectPendingUserInputAnswer(
  answer: unknown,
  records: ReadonlyArray<AnswerContextRecord>,
) {
  if (typeof answer !== "string" || records.length === 0) return answer;
  const recordsById = new Map(records.map((record) => [record.contextId, record]));
  return replaceComposerContextReferences(answer, (reference) => {
    const record = recordsById.get(reference.contextId);
    if (record?.kind !== reference.kind) return reference.source;
    return record.kind === "thread"
      ? formatThreadLink(record, reference.label)
      : record.kind === "model"
        ? formatModelContextText(record)
        : projectComposerContextForProvider({ text: reference.source, records: [record] });
  });
}

export function referenceContextsReferencedByAnswer(
  answer: string,
  referenceContexts: ReadonlyArray<ReferenceContextRecord>,
) {
  const referencedIds = new Set(collectInlineContextIds(answer));
  return referenceContexts.filter((record) => referencedIds.has(record.contextId));
}

export interface PendingUserInputProgress<Q extends UserInputQuestion = UserInputQuestion> {
  questionIndex: number;
  activeQuestion: Q | null;
  activeDraft: PendingUserInputDraftAnswer | undefined;
  selectedOptionValues: ReadonlyArray<string>;
  customAnswer: string;
  resolvedAnswer: PendingUserInputAnswer | null;
  usingCustomAnswer: boolean;
  answeredQuestionCount: number;
  isLastQuestion: boolean;
  isComplete: boolean;
  canAdvance: boolean;
}

const DISPLACED_ANSWER_SEPARATOR = "\n\n";

export function carryDisplacedCustomAnswerIntoPrompt(
  prompt: string,
  customAnswer: string | undefined,
) {
  const displaced = customAnswer?.trim() ?? "";
  if (displaced.length === 0) {
    return prompt;
  }
  if (prompt.trim().length === 0) {
    return displaced;
  }
  return `${prompt.trimEnd()}${DISPLACED_ANSWER_SEPARATOR}${displaced}`;
}

/**
 * Takes set-aside answer text back out of the thread draft once it is the answer again.
 * `laterDisplaced` is what was set aside after it, in order: together they locate this copy,
 * so equal text inside another answer or the user's own draft is never the one removed.
 */
export function withdrawDisplacedCustomAnswerFromPrompt(
  prompt: string,
  displaced: string,
  laterDisplaced: ReadonlyArray<string> = [],
) {
  const text = displaced.trim();
  if (text.length === 0) return prompt;
  const later = laterDisplaced.flatMap((entry) => {
    const trimmed = entry.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  });
  const suffix = [text, ...later].join(DISPLACED_ANSWER_SEPARATOR);
  if (!prompt.endsWith(suffix)) return prompt;
  const before = prompt.slice(0, prompt.length - suffix.length);
  const after = later.join(DISPLACED_ANSWER_SEPARATOR);
  if (before.length === 0) return after;
  if (!before.endsWith(DISPLACED_ANSWER_SEPARATOR)) return prompt;
  return after.length === 0 ? before.slice(0, -DISPLACED_ANSWER_SEPARATOR.length) : before + after;
}

function countAnsweredPendingUserInputQuestions(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
) {
  return questions.reduce((count, question) => {
    return resolvePendingUserInputAnswer(question, draftAnswers[question.id]) !== null
      ? count + 1
      : count;
  }, 0);
}

export function derivePendingUserInputProgress<Q extends UserInputQuestion>(
  questions: ReadonlyArray<Q>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
  questionIndex: number,
) {
  const normalizedQuestionIndex =
    questions.length === 0 ? 0 : Math.max(0, Math.min(questionIndex, questions.length - 1));
  const activeQuestion = questions[normalizedQuestionIndex] ?? null;
  const activeDraft = activeQuestion ? draftAnswers[activeQuestion.id] : undefined;
  const resolvedAnswer = activeQuestion
    ? resolvePendingUserInputAnswer(activeQuestion, activeDraft)
    : null;
  const customAnswer =
    activeQuestion?.allowCustomAnswer === false ? "" : (activeDraft?.customAnswer ?? "");
  const answeredQuestionCount = countAnsweredPendingUserInputQuestions(questions, draftAnswers);
  const isLastQuestion =
    questions.length === 0 ? true : normalizedQuestionIndex >= questions.length - 1;

  return {
    questionIndex: normalizedQuestionIndex,
    activeQuestion,
    activeDraft,
    selectedOptionValues: activeQuestion
      ? normalizeSelectedOptionValues(activeQuestion, activeDraft?.selectedOptionValues)
      : [],
    customAnswer,
    resolvedAnswer,
    usingCustomAnswer:
      (activeQuestion?.initialAnswer !== undefined ? customAnswer : customAnswer.trim()).length > 0,
    answeredQuestionCount,
    isLastQuestion,
    isComplete: buildPendingUserInputAnswers(questions, draftAnswers) !== null,
    canAdvance: resolvedAnswer !== null,
  };
}
