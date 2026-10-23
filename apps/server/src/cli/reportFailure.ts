import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";
import { CliError, CliOutput } from "effect/cli";

const MAX_CAUSE_DEPTH = 4;

const addMessage = (messages: Array<string>, message: string) => {
  const trimmed = message.trim();
  if (trimmed.length > 0 && !messages.some((seen) => seen.includes(trimmed))) {
    messages.push(trimmed);
  }
};

/**
 * Returns false when the chain holds a value with no text to show, so the
 * caller keeps the full logged cause instead of dropping that detail.
 */
const collectMessages = (value: unknown, depth: number, messages: Array<string>): boolean => {
  if (value === undefined || value === null || depth > MAX_CAUSE_DEPTH) return true;
  if (typeof value === "string") {
    addMessage(messages, value);
    return true;
  }
  if (Cause.isCause(value)) {
    for (const reason of value.reasons) {
      if (Cause.isFailReason(reason) && !collectMessages(reason.error, depth + 1, messages)) {
        return false;
      }
      if (Cause.isDieReason(reason) && !collectMessages(reason.defect, depth + 1, messages)) {
        return false;
      }
    }
    return true;
  }
  if (!(value instanceof Error)) return false;
  addMessage(messages, value.message);
  return collectMessages(value.cause, depth + 1, messages);
};

const renderFailure = (error: unknown) => {
  const messages: Array<string> = [];
  if (!collectMessages(error, 0, messages)) return undefined;
  const [headline, ...causes] = messages;
  if (headline === undefined) return undefined;
  return [headline, ...causes.map((message) => `Caused by: ${message}`)]
    .join("\n")
    .replaceAll("\n", "\n  ");
};

/**
 * Typed failures carry messages written for the person at the terminal, so they
 * print like CLI parse errors instead of the runtime's logged stack trace.
 * Defects and failures with nothing printable keep the full log. Errors are left
 * untouched so `Runtime.errorExitCode` still decides the exit status.
 */
export const reportCliFailure = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>) {
  if (Cause.hasInterruptsOnly(cause)) return;
  if (Cause.hasDies(cause)) return yield* Effect.logError(cause);
  const failures = cause.reasons
    .filter(Cause.isFailReason)
    .map((reason) => reason.error)
    .filter(Runtime.getErrorReported);
  const rendered: Array<CliError.UserError> = [];
  for (const error of failures) {
    const message = renderFailure(error);
    if (message === undefined) return yield* Effect.logError(cause);
    rendered.push(new CliError.UserError({ cause: error, userMessage: message }));
  }
  const formatter = yield* CliOutput.Formatter;
  for (const error of rendered) {
    yield* Console.error(formatter.formatError(error));
  }
});
