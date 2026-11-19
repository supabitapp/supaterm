import type { OrchestrationV2CommandOutputFrame } from "@supaterm/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  appendTerminalOutput,
  EMPTY_TERMINAL_OUTPUT,
  type TerminalOutputState,
} from "@supaterm/shared/terminalOutput";

/** One command row's output as a client holds it. */
export interface CommandOutputView {
  readonly output: TerminalOutputState;
  /** False once the command settled and `output` is final. */
  readonly running: boolean;
}

export const EMPTY_COMMAND_OUTPUT: CommandOutputView = {
  output: EMPTY_TERMINAL_OUTPUT,
  running: true,
};

/**
 * Applies one server frame. A `replace` carries the whole bounded tail (the
 * first frame, a viewer that fell behind, or the final output); an `append`
 * is raw terminal text normalized with the same rules the server uses.
 */
export function applyCommandOutputFrame(
  view: CommandOutputView,
  frame: OrchestrationV2CommandOutputFrame,
): CommandOutputView {
  const base = frame.kind === "replace" ? EMPTY_TERMINAL_OUTPUT : view.output;
  return {
    output: appendTerminalOutput(
      { ...base, truncated: base.truncated || frame.truncated },
      frame.text,
    ),
    running: frame.running,
  };
}

/** A row with no output subscription, for hooks that subscribe only for command rows. */
export const NO_COMMAND_OUTPUT = Atom.make(AsyncResult.initial<CommandOutputView>());

/**
 * Whether a row's output subscription failed before it sent any output, as it
 * does on servers from before live command output. Such rows show the fetched
 * item's final output instead.
 */
export function commandOutputUnavailable(
  result: AsyncResult.AsyncResult<CommandOutputView, unknown>,
): boolean {
  return (
    result._tag === "Failure" &&
    (AsyncResult.getOrElse(result, () => undefined)?.output.text ?? "") === ""
  );
}
