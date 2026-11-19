import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH } from "@supaterm/contracts";

type AssistantCitationCommentDismissal =
  | { kind: "commit"; comment: string }
  | { kind: "close" }
  | { kind: "keep-open" };

export function resolveAssistantCitationCommentDismissal({
  reason,
  draft,
  savedComment,
}: {
  reason: string;
  draft: string | null;
  savedComment: string | undefined;
}) {
  if (reason === "escape-key" || draft === null)
    return { kind: "close" } satisfies AssistantCitationCommentDismissal;
  if (draft.trim() === (savedComment ?? "").trim())
    return { kind: "close" } satisfies AssistantCitationCommentDismissal;
  if (draft.length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH)
    return { kind: "keep-open" } satisfies AssistantCitationCommentDismissal;
  return { kind: "commit", comment: draft } satisfies AssistantCitationCommentDismissal;
}
