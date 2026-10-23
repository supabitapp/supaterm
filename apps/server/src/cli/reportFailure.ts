import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";
import { CliError, CliOutput } from "effect/cli";

const MAX_CAUSE_DEPTH = 4;

const failureMessages = (error: unknown) => {
  const messages: Array<string> = [];
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth++) {
    const message = current.message.trim();
    if (message.length > 0 && !messages.some((seen) => seen.includes(message))) {
      messages.push(message.replaceAll("\n", "\n  "));
    }
    current = current.cause;
  }
  return messages;
};

/**
 * Typed failures carry messages written for the person at the terminal, so they
 * print like CLI parse errors instead of the runtime's logged stack trace.
 * Defects and failures without any message keep the full log. The error is left
 * untouched so `Runtime.errorExitCode` still decides the exit status.
 */
export const reportCliFailure = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>) {
  if (Cause.hasInterruptsOnly(cause)) return;
  const error = Cause.squash(cause);
  if (!Runtime.getErrorReported(error)) return;
  const [headline, ...causes] = Cause.hasDies(cause) ? [] : failureMessages(error);
  if (headline === undefined) {
    return yield* Effect.logError(cause);
  }
  const formatter = yield* CliOutput.Formatter;
  yield* Console.error(
    formatter.formatError(
      new CliError.UserError({
        cause: error,
        userMessage: [headline, ...causes.map((message) => `Caused by: ${message}`)].join("\n  "),
      }),
    ),
  );
});
