import { T, useGT } from "gt-react";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@supaterm/contracts";
import { TrashIcon } from "@supaterm/icons";
import { threadContextRecord } from "@supaterm/shared/composerContextReferences";
import { useState } from "react";

import { useChatPaneStore } from "../../chatPanes/store";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useClientSettings } from "../../hooks/useSettings";
import { releaseComposerDraftUploads } from "../../lib/composerDraftUploads";
import { readLocalApi } from "../../localApi";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Add to chat, Promote and Delete for a side chat, in its pane's header. */
export function SideChatHeaderActions(props: {
  readonly threadRef: ScopedThreadRef;
  readonly parentRef: ScopedThreadRef;
}) {
  const { threadRef, parentRef } = props;
  const gt = useGT();
  const shell = useQuietThreadShell(threadRef);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const promoteSideChat = useAtomCommand(threadEnvironment.promoteSideChat, {
    reportFailure: false,
  });
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const [busy, setBusy] = useState(false);
  // Closing an unused side chat deletes it, which would leave the link unreadable.
  const canAddToChat = shell !== null && shell.latestUserMessageAt !== null;

  const failureToast = (title: string, result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title,
      ...(error instanceof Error ? { description: error.message } : {}),
    });
  };

  const addToChat = () => {
    if (!canAddToChat) return;
    useComposerDraftStore
      .getState()
      .addReferenceContexts(parentRef, [threadContextRecord(threadRef, shell.title)], {
        insertAtCaret: false,
      });
  };

  const promote = async () => {
    if (!canOperate || busy) return;
    setBusy(true);
    const result = await promoteSideChat({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    setBusy(false);
    if (result._tag === "Success") {
      useChatPaneStore.getState().unlinkSideChat({ kind: "server", threadRef });
    } else if (!isAtomCommandInterrupted(result)) {
      failureToast(gt("Could not promote the side chat"), result);
    }
  };

  const deleteSideChat = async () => {
    if (!canOperate || shell === null || busy) return;
    if (confirmThreadDelete) {
      const api = readLocalApi();
      if (!api) return;
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(
          [
            gt('Delete side chat "{title}"?', { title: shell.title }),
            gt("This permanently clears its conversation history."),
          ].join("\n"),
          { variant: "destructive" },
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;
    }
    setBusy(true);
    const result = await deleteThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    setBusy(false);
    if (result._tag === "Success") {
      releaseComposerDraftUploads(threadRef);
      useComposerDraftStore.getState().clearDraftThread(threadRef);
    } else if (!isAtomCommandInterrupted(result)) {
      failureToast(gt("Could not delete the side chat"), result);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              aria-disabled={!canAddToChat || undefined}
              onClick={addToChat}
            >
              <T>Add to chat</T>
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          {canAddToChat
            ? gt("Adds this side chat to the main thread's next message.")
            : gt("Available after the first message.")}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              disabled={!canOperate || busy}
              onClick={() => void promote()}
            >
              <T context="verb, turns the side chat into a full thread">Promote</T>
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          <T>Make this a full thread: it shows in the sidebar and can be forked.</T>
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost-destructive"
              size="icon-xs"
              aria-label={gt("Delete side chat")}
              disabled={!canOperate || shell === null || busy}
              onClick={() => void deleteSideChat()}
            >
              <TrashIcon />
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          <T>Delete side chat</T>
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
