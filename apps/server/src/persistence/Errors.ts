import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

function summarizeSchemaIssue(issue: SchemaIssue.Issue): string;
function summarizeSchemaIssue(issue: SchemaIssue.Issue) {
  switch (issue._tag) {
    case "Filter":
    case "Encoding":
    case "Pointer":
      return `${issue._tag}(${summarizeSchemaIssue(issue.issue)})` satisfies string;
    case "Composite":
    case "AnyOf":
      return `${issue._tag}(${issue.issues.map(summarizeSchemaIssue).join(",")})` satisfies string;
    default:
      return issue._tag satisfies string;
  }
}

export const PersistenceErrorCorrelation = Schema.Union([
  Schema.Struct({ sessionId: Schema.String }),
  Schema.Struct({ currentSessionId: Schema.String }),
  Schema.Struct({ pairingLinkId: Schema.String }),
  Schema.Struct({ threadId: Schema.String }),
]);
export type PersistenceErrorCorrelation = typeof PersistenceErrorCorrelation.Type;

export class PersistenceSqlError extends Schema.TaggedError<PersistenceSqlError>()(
  "PersistenceSqlError",
  {
    operation: Schema.String,
    detail: Schema.optional(Schema.String),
    correlation: Schema.optional(PersistenceErrorCorrelation),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return this.detail === undefined
      ? `SQL error in ${this.operation}`
      : `SQL error in ${this.operation}: ${this.detail}`;
  }
}

export class PersistenceDecodeError extends Schema.TaggedError<PersistenceDecodeError>()(
  "PersistenceDecodeError",
  {
    operation: Schema.String,
    issue: Schema.String,
    correlation: Schema.optional(PersistenceErrorCorrelation),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  static fromSchemaError(
    operation: string,
    cause: Schema.SchemaError,
    correlation?: PersistenceErrorCorrelation,
  ) {
    return new PersistenceDecodeError({
      operation,
      issue: summarizeSchemaIssue(cause.issue),
      ...(correlation === undefined ? {} : { correlation }),
      cause,
    });
  }

  override get message() {
    return `Decode error in ${this.operation}: ${this.issue}`;
  }
}

function sqliteCondition(cause: unknown) {
  let value = cause;
  for (let depth = 0; depth < 4 && Predicate.isObject(value); depth += 1) {
    if (
      "errcode" in value &&
      typeof value.errcode === "number" &&
      "errstr" in value &&
      typeof value.errstr === "string"
    ) {
      return `SQLITE(${value.errcode}) ${value.errstr}`;
    }
    value = "cause" in value ? value.cause : undefined;
  }
  return undefined;
}

function describeSqlCause(cause: unknown): string | undefined;
function describeSqlCause(cause: unknown) {
  if (Schema.isSchemaError(cause))
    return summarizeSchemaIssue(cause.issue) satisfies string | undefined;
  return sqliteCondition(cause) satisfies string | undefined;
}

export function toPersistenceSqlError(operation: string) {
  return (cause: unknown) => {
    const detail = describeSqlCause(cause);
    return new PersistenceSqlError({
      operation,
      ...(detail === undefined ? {} : { detail }),
      cause,
    });
  };
}

export function toPersistenceDecodeError(operation: string) {
  return (cause: Schema.SchemaError) => PersistenceDecodeError.fromSchemaError(operation, cause);
}

export type OrchestrationEventStoreError = PersistenceSqlError | PersistenceDecodeError;

export type OrchestrationCommandReceiptRepositoryError =
  | PersistenceSqlError
  | PersistenceDecodeError;

export type ProviderSessionRuntimeRepositoryError = PersistenceSqlError | PersistenceDecodeError;
export type AuthPairingLinkRepositoryError = PersistenceSqlError | PersistenceDecodeError;
export type AuthSessionRepositoryError = PersistenceSqlError | PersistenceDecodeError;
export type PullRequestFilesViewedRepositoryError = PersistenceSqlError | PersistenceDecodeError;
export type PullRequestReviewGuideRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export type ProjectionRepositoryError = PersistenceSqlError | PersistenceDecodeError;
