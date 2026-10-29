import type { MessageId, RunId } from "@supaterm/contracts";
import type { ThreadHistoryControls } from "./threadHistoryPrefetch.ts";

export interface MessageJump {
  readonly key: number;
  readonly messageId: MessageId;
}

export interface MessageJumpProgress {
  readonly requestedCursors: ReadonlySet<string>;
  readonly expandedRunId: RunId | null;
}

export type MessageJumpStep =
  | { readonly type: "scroll"; readonly index: number }
  | { readonly type: "expand"; readonly runId: RunId }
  | { readonly type: "load-earlier"; readonly cursor: string }
  | { readonly type: "wait" }
  | { readonly type: "missing" };

/**
 * The next move toward showing a message: scroll to its row, unfold the turn hiding it, or page
 * earlier history through it. Each fold and history page is tried once, so a message that was
 * reverted ends as missing instead of looping.
 */
export function nextMessageJumpStep(input: {
  readonly rowIndex: number;
  readonly loaded: boolean;
  readonly foldRunId: RunId | null | undefined;
  readonly cursor: string;
  readonly history: Pick<ThreadHistoryControls, "loading" | "hasMoreHistory" | "error"> | undefined;
  readonly progress: MessageJumpProgress;
}): MessageJumpStep {
  if (input.rowIndex >= 0) return { type: "scroll", index: input.rowIndex };
  if (input.loaded) {
    return input.foldRunId != null && input.progress.expandedRunId !== input.foldRunId
      ? { type: "expand", runId: input.foldRunId }
      : { type: "missing" };
  }
  if (input.history?.loading) return { type: "wait" };
  if (
    !input.history?.hasMoreHistory ||
    input.history.error !== null ||
    input.progress.requestedCursors.has(input.cursor)
  ) {
    return { type: "missing" };
  }
  return { type: "load-earlier", cursor: input.cursor };
}
