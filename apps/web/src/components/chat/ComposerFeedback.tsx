import {
  codexFeedbackNotice,
  type CodexFeedbackSubmission,
} from "@supaterm/client-runtime/state/threads";
import { MessageSquareIcon } from "@supaterm/icons";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { m, type MessageResolver } from "../../i18n/messages";
import { msg } from "gt-react";

export function feedbackBannerItem(
  submission: CodexFeedbackSubmission,
  onDismiss: () => void,
  resolve: MessageResolver = m,
): ComposerBannerStackItem | null {
  const notice = codexFeedbackNotice(submission, resolve);
  if (!notice) return null;
  return {
    id: `feedback:${submission.id}`,
    variant:
      submission.status === "failed" ? "error" : submission.status === "sent" ? "success" : "info",
    icon: <MessageSquareIcon />,
    ...notice,
    actions:
      submission.status === "sent" ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            void writeTextToClipboard(submission.feedbackId, "Codex feedback thread ID").catch(
              (error: unknown) => {
                toastManager.add({
                  type: "error",
                  title: m(msg("Could not copy thread ID")),
                  description:
                    error instanceof Error ? error.message : m(msg("An error occurred.")),
                });
              },
            );
          }}
        >
          {resolve(msg("Copy ID"))}
        </Button>
      ) : undefined,
    ...(submission.status !== "uploading"
      ? { dismissLabel: resolve(msg("Dismiss feedback notice")), onDismiss }
      : {}),
  };
}
