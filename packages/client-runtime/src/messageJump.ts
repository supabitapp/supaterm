import type { MessageId } from "@supaterm/contracts";
import type { ThreadHistoryControls } from "./threadHistoryPrefetch.ts";

export interface MessageJump {
  readonly key: number;
  readonly messageId: MessageId;
}

export interface MessageJumpView {
  /** The message's row in the list, or -1 when no row shows it. */
  readonly rowIndex: number;
  /** Whether the message is in the loaded history, shown or folded away. */
  readonly loaded: boolean;
  /** Identifies the loaded history page, so each page is requested once. */
  readonly cursor: string;
  readonly history: Pick<ThreadHistoryControls, "loading" | "hasMoreHistory" | "error"> | undefined;
}

export type MessageJumpFailure = "missing" | "history-error";

export interface MessageJumpHandlers {
  readonly start: () => void;
  readonly scroll: (index: number) => void;
  readonly unfold: (messageId: MessageId) => void;
  readonly loadEarlier: (messageId: MessageId) => void;
  readonly fail: (jump: MessageJump, failure: MessageJumpFailure) => void;
}

/**
 * Moves one jump at a time toward its message as the list re-renders: scroll to its row, unfold
 * what hides it, or page earlier history through it. Unfolding and each history page are tried
 * once, so a reverted message ends as missing instead of looping.
 */
export function createMessageJumpRunner() {
  let current: {
    readonly key: number;
    readonly requestedCursors: Set<string>;
    unfolded: boolean;
    done: boolean;
  } | null = null;
  return (jump: MessageJump | null, view: MessageJumpView, handlers: MessageJumpHandlers) => {
    if (jump === null) return;
    if (current?.key !== jump.key) {
      current = { key: jump.key, requestedCursors: new Set(), unfolded: false, done: false };
      handlers.start();
    }
    const navigation = current;
    if (navigation.done) return;
    const fail = (failure: MessageJumpFailure) => {
      navigation.done = true;
      handlers.fail(jump, failure);
    };
    if (view.rowIndex >= 0) {
      navigation.done = true;
      handlers.scroll(view.rowIndex);
      return;
    }
    if (view.loaded) {
      if (navigation.unfolded) return fail("missing");
      navigation.unfolded = true;
      handlers.unfold(jump.messageId);
      return;
    }
    if (view.history?.loading) return;
    if (navigation.requestedCursors.has(view.cursor)) {
      return fail(view.history?.error ? "history-error" : "missing");
    }
    if (!view.history?.hasMoreHistory) return fail("missing");
    navigation.requestedCursors.add(view.cursor);
    handlers.loadEarlier(jump.messageId);
  };
}
