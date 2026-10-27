import type { EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { nextPromptSuggestionReplyId } from "@supaterm/client-runtime/state/orchestration";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";

import type { ChatMessage, SessionPhase } from "../../types";

interface SuggestedReply {
  readonly threadId: ThreadId;
  readonly replyId: MessageId;
}

/**
 * What the user is likely to send after the agent's latest reply. It lives in this component
 * only; the server decides whether the reply is recent enough to spend a model call on.
 */
export function useNextPromptSuggestion(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly enabled: boolean;
  readonly phase: SessionPhase;
  readonly messages: ReadonlyArray<ChatMessage>;
}) {
  const { environmentId, threadId, enabled, phase, messages } = input;
  const canSuggest = useAtomValue(
    orchestrationEnvironment.suggestNextPrompt.permissionAtom(environmentId),
  );
  const suggestNextPrompt = useStableCallback(
    useAtomCommand(orchestrationEnvironment.suggestNextPrompt, {
      reportFailure: false,
      reportDefect: false,
    }),
  );
  const [result, setResult] = useState<(SuggestedReply & { readonly text: string }) | null>(null);
  const [dismissed, setDismissed] = useState<SuggestedReply | null>(null);
  const replyId =
    phase === "ready" ? nextPromptSuggestionReplyId(messages, (message) => message) : null;
  const active = enabled && canSuggest && threadId !== null && replyId !== null;

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

  const matches = (entry: SuggestedReply | null) =>
    entry !== null && entry.threadId === threadId && entry.replyId === replyId;
  const suggestion = active && result !== null && matches(result) && !matches(dismissed);

  return {
    suggestion: suggestion ? result.text : null,
    dismiss: () => {
      if (threadId !== null && replyId !== null) setDismissed({ threadId, replyId });
    },
  };
}
