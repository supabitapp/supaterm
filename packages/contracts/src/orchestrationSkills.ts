import * as Schema from "effect/Schema";

export const OrchestrationSkillsStatus = Schema.Struct({
  targets: Schema.Array(
    Schema.Struct({
      directory: Schema.String,
      providers: Schema.Array(Schema.String),
      skills: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          state: Schema.Literals(["not-installed", "installed", "update-available", "conflict"]),
          managed: Schema.Boolean,
        }),
      ),
    }),
  ),
  unsupportedProviders: Schema.Array(Schema.String),
});
export type OrchestrationSkillsStatus = typeof OrchestrationSkillsStatus.Type;

export class OrchestrationSkillsError extends Schema.TaggedError<OrchestrationSkillsError>()(
  "OrchestrationSkillsError",
  { cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return "Could not manage orchestration skills on this environment.";
  }
}
