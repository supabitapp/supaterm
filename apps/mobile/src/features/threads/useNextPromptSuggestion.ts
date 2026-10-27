import type { EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { nextPromptSuggestionReplyId } from "@supaterm/client-runtime/state/orchestration";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * What the user is likely to send after the agent's latest reply. It lives in this screen only;
 * the server decides whether the reply is recent enough to spend a model call on.
 */
export function useNextPromptSuggestion(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly settled: boolean;
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
}): string | null {
  const { environmentId, threadId, settled, feed } = input;
  const canSuggest = useAtomValue(
    orchestrationEnvironment.suggestNextPrompt.permissionAtom(environmentId),
  );
  const suggestNextPrompt = useAtomCommand(orchestrationEnvironment.suggestNextPrompt, {
    reportFailure: false,
    reportDefect: false,
  });
  const [result, setResult] = useState<{
    readonly threadId: ThreadId;
    readonly replyId: MessageId;
    readonly text: string;
  } | null>(null);
  const replyId = settled
    ? nextPromptSuggestionReplyId(feed, (entry) =>
        entry.type === "message" ? entry.message : null,
      )
    : null;
  const active = canSuggest && threadId !== null && replyId !== null;

  useEffect(() => {
    if (!active) return;
    let current = true;
    void suggestNextPrompt({ environmentId, input: { threadId, afterMessageId: replyId } }).then(
      (answer) => {
        if (!current || answer._tag !== "Success" || answer.value.suggestion === null) return;
        setResult({ threadId, replyId, text: answer.value.suggestion });
      },
    );
    return () => {
      current = false;
    };
  }, [active, environmentId, threadId, replyId, suggestNextPrompt]);

  return active && result?.threadId === threadId && result.replyId === replyId ? result.text : null;
}
