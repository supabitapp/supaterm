import { type OrchestrationV2UserInputQuestion, TrimmedNonEmptyString } from "@supaterm/contracts";
import type { AcpAdapterV2Flavor } from "@supaterm/provider-acp/server/adapter";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

const isForm = Schema.is(
  Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }),
);
const choice = Schema.Struct({
  const: Schema.String,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
});
const isChoiceQuestion = Schema.is(
  Schema.Struct({
    type: Schema.Literal("string"),
    title: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String),
    oneOf: Schema.Array(choice),
  }),
);
const isTextQuestion = Schema.is(
  Schema.Struct({
    type: Schema.Literal("string"),
    title: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String),
  }),
);
const isCustomCompanion = Schema.is(
  Schema.Struct({
    type: Schema.Literal("string"),
    description: Schema.Literals(["Type your own answer", "Add your own answer"]),
  }),
);

const questionId = /^q\d+$/;
const companionSuffix = "_custom";

const splitAttachments = (value: string) => {
  const marker = value.indexOf("\n\n");
  if (marker < 0) return undefined;
  const suffix = value.slice(marker);
  if (!/^\n\nAttached (?:image|file) "(?:\\.|[^"\\\r\n])*": "/.test(suffix)) return undefined;
  return { prefix: value.slice(0, marker), suffix };
};

type Option = OrchestrationV2UserInputQuestion["options"][number];

const findChoice = (options: ReadonlyArray<Option>, value: string) =>
  options.find((option) => option.value === value);

export const extractOpenCodeElicitationForm: NonNullable<
  AcpAdapterV2Flavor["extractElicitationForm"]
> = (request) => {
  if (request.mode !== "form" || !isForm(request.requestedSchema)) return undefined;
  const { properties } = request.requestedSchema;
  const questions: Array<OrchestrationV2UserInputQuestion> = [];
  const withCompanion = new Set<string>();
  let choices = 0;
  for (const [id, field] of Object.entries(properties)) {
    if (!questionId.test(id)) {
      const owner = id.endsWith(companionSuffix) ? id.slice(0, -companionSuffix.length) : undefined;
      if (owner === undefined || !questionId.test(owner) || !Object.hasOwn(properties, owner)) {
        return undefined;
      }
      continue;
    }
    const companion = properties[`${id}${companionSuffix}`];
    const hasCompanion = companion !== undefined;
    if (hasCompanion && !isCustomCompanion(companion)) return undefined;
    if (!isTextQuestion(field)) return undefined;
    const fieldChoices = isChoiceQuestion(field) ? field.oneOf : undefined;
    if (
      fieldChoices === undefined &&
      ("enum" in field || "oneOf" in field || "anyOf" in field || "items" in field)
    ) {
      return undefined;
    }
    const options = (fieldChoices ?? []).map((option) => ({
      label: option.title,
      description: option.description?.trim() || option.title,
      value: option.const,
    }));
    if (options.length > 0) choices += 1;
    if (hasCompanion) withCompanion.add(id);
    questions.push({
      id,
      header: field.title,
      question: field.description?.trim() || field.title,
      options,
      allowCustomAnswer: hasCompanion || options.length === 0,
    });
  }
  if (choices === 0) return undefined;
  return {
    questions,
    respond: (answers) => {
      const content: Record<string, string> = {};
      for (const question of questions) {
        const answer = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
        if (!Predicate.isString(answer)) return { action: "cancel" };
        const companionId = `${question.id}${companionSuffix}`;
        const exact = findChoice(question.options, answer);
        if (exact !== undefined) {
          content[question.id] = answer;
          continue;
        }
        if (answer.trim().length === 0) return { action: "cancel" };
        const split = splitAttachments(answer);
        const attached =
          split === undefined ? undefined : findChoice(question.options, split.prefix);
        if (withCompanion.has(question.id)) {
          if (attached !== undefined && split !== undefined) {
            content[question.id] = split.prefix;
            content[companionId] = `${attached.label}${split.suffix}`;
          } else {
            content[companionId] = answer;
          }
        } else if (question.options.length === 0) {
          content[question.id] = answer;
        } else {
          return { action: "cancel" };
        }
      }
      return { action: "accept", content };
    },
  };
};
