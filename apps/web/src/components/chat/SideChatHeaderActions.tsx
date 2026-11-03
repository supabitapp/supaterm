import {
  resolveLatestMergeBackRun,
  sideChatBringBackBlockedReason,
} from "@supaterm/client-runtime/state/thread-workflows";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@supaterm/contracts";
import { TrashIcon } from "@supaterm/icons";
import { useState } from "react";

import { useChatPaneStore } from "../../chatPanes/store";
import { useClientSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { useQuietThreadProjection, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Bring back, Promote and Delete for a side chat, in its pane's header. */
export function SideChatHeaderActions(props: {
  readonly threadRef: ScopedThreadRef;
  readonly parentRef: ScopedThreadRef;
}) {
  const { threadRef, parentRef } = props;
  const shell = useQuietThreadShell(threadRef);
  const parent = useQuietThreadShell(parentRef);
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const mergeBack = useAtomCommand(threadEnvironment.mergeBack, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const promoteSideChat = useAtomCommand(threadEnvironment.promoteSideChat, {
    reportFailure: false,
  });
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const [busy, setBusy] = useState(false);
  const mergeRun = projection ? resolveLatestMergeBackRun(projection) : null;
  const bringBackBlockedReason = sideChatBringBackBlockedReason({
    canOperate,
    parentRuntime: parent?.runtime,
    mergeRun,
  });

  const failureToast = (title: string, result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title,
      ...(error instanceof Error ? { description: error.message } : {}),
    });
  };

  const bringBack = async () => {
    if (bringBackBlockedReason !== null || mergeRun === null || busy) return;
    setBusy(true);
    const result = await mergeBack({
      environmentId: threadRef.environmentId,
      input: {
        sourceThreadId: threadRef.threadId,
        targetThreadId: parentRef.threadId,
        runId: mergeRun.id,
      },
    });
    setBusy(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Brought back",
        description: "The main thread gets this side chat with your next message there.",
      });
    } else if (!isAtomCommandInterrupted(result)) {
      failureToast("Could not bring back the side chat", result);
    }
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
      failureToast("Could not promote the side chat", result);
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
            `Delete side chat "${shell.title}"?`,
            "This permanently clears its conversation history.",
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
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      failureToast("Could not delete the side chat", result);
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
              aria-disabled={bringBackBlockedReason !== null || busy || undefined}
              onClick={() => void bringBack()}
            >
              Bring back
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          {bringBackBlockedReason ?? "Adds this side chat to the main thread's next message."}
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
              Promote
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          Make this a full thread: it shows in the sidebar and can be forked.
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost-destructive"
              size="icon-xs"
              aria-label="Delete side chat"
              disabled={!canOperate || shell === null || busy}
              onClick={() => void deleteSideChat()}
            >
              <TrashIcon />
            </Button>
          }
        />
        <TooltipPopup side="bottom">Delete side chat</TooltipPopup>
      </Tooltip>
    </div>
  );
}
