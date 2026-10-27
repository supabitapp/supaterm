import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell, ThreadStructure } from "@supaterm/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId, RuntimeMode, ScopedThreadRef } from "@supaterm/contracts";
import {
  EllipsisIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useState } from "react";

import { openThreadBeside } from "../../chatPanes/actions";
import { usePaneThreadNavigation } from "../../chatPanes/paneScope";
import { isThreadShownInSplit } from "../../chatPanes/store";
import { useMergeBack } from "../../hooks/useMergeBack";
import { useThreadActions } from "../../hooks/useThreadActions";
import { readLocalApi } from "../../localApi";
import { useQuietThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button, InlineButton } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import {
  hasPendingSideChatMerge,
  isSideChatParentBusy,
  sideChatContextNote,
} from "./sideChat.logic";

function reportFailure(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  });
}

/** The parent opens beside its side chat, or in its place when the panes have no room. */
function useShowParent(parentRef: ScopedThreadRef | null) {
  const openThread = usePaneThreadNavigation();
  return async () => {
    if (parentRef === null) return;
    const target = { kind: "server" as const, threadRef: parentRef };
    if (!openThreadBeside(target, "left")) await openThread(target);
  };
}

function SideChatParentLink(props: {
  readonly parentRef: ScopedThreadRef;
  readonly title: string;
}) {
  const showParent = useShowParent(props.parentRef);
  return (
    <InlineButton tone="muted" onClick={() => void showParent()}>
      {props.title}
    </InlineButton>
  );
}

function OpenParentButton(props: { readonly parentRef: ScopedThreadRef }) {
  const showParent = useShowParent(props.parentRef);
  return (
    <Button size="xs" variant="ghost" onClick={() => void showParent()}>
      Open parent
    </Button>
  );
}

function SideChatActions(props: {
  readonly environmentId: EnvironmentId;
  readonly sideChat: EnvironmentThreadShell;
  readonly parentRef: ScopedThreadRef | null;
  readonly parent: EnvironmentThreadShell | null;
  readonly projection: ThreadStructure | null;
  readonly runtimeMode: RuntimeMode;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const { environmentId, sideChat, parentRef, parent, projection, runtimeMode } = props;
  const threadId = sideChat.id;
  const openThread = usePaneThreadNavigation();
  const showParent = useShowParent(parentRef);
  const { deleteThread } = useThreadActions();
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const setRuntimeMode = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const {
    latestRun: mergeRun,
    isMerging,
    merge,
  } = useMergeBack({ environmentId, threadId, targetThreadId: parent?.id ?? null, projection });
  const [pendingAction, setPendingAction] = useState<"edits" | "promote" | "discard" | null>(null);
  const transfers = projection?.contextTransfers ?? [];

  const mergeBack = async () => {
    if (await merge()) await showParent();
  };

  const toggleEdits = async () => {
    const next: RuntimeMode =
      runtimeMode === "approval-required" ? "auto-accept-edits" : "approval-required";
    setPendingAction("edits");
    props.onRuntimeModeChange(next);
    const result = await setRuntimeMode({
      environmentId,
      input: { threadId, runtimeMode: next },
    });
    setPendingAction(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not change edit permissions", squashAtomCommandFailure(result));
    }
  };

  const promote = async () => {
    setPendingAction("promote");
    const result = await updateMetadata({
      environmentId,
      input: { threadId, sideChat: false },
    });
    setPendingAction(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not promote the side chat", squashAtomCommandFailure(result));
    }
  };

  const discard = async () => {
    const localApi = readLocalApi();
    if (localApi) {
      const lines = [
        `Discard side chat "${sideChat.title}"?`,
        "This permanently clears its conversation.",
      ];
      if (hasPendingSideChatMerge(transfers, threadId)) {
        lines.push(
          `The merge you sent still reaches ${parent?.title ?? "the parent thread"} on its next turn.`,
        );
      }
      const confirmed = await settlePromise(() =>
        localApi.dialogs.confirm(lines.join("\n"), { variant: "destructive" }),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;
    }
    setPendingAction("discard");
    const threadRef = scopeThreadRef(environmentId, threadId);
    // Shown alone, the side chat would otherwise give way to an unrelated thread.
    if (parentRef !== null && parent !== null && !isThreadShownInSplit(threadRef)) {
      await openThread({ kind: "server", threadRef: parentRef }, { replace: true });
    }
    const result = await deleteThread(threadRef);
    setPendingAction(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not discard the side chat", squashAtomCommandFailure(result));
    }
  };

  const mergeBlockedReason =
    parent === null
      ? null
      : isSideChatParentBusy(parent)
        ? `Available when ${parent.title} is idle`
        : mergeRun === null
          ? "Available once this side chat finishes a reply"
          : null;
  const mergeBlocked = mergeBlockedReason !== null || isMerging;

  return (
    <>
      {parent === null ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                aria-disabled={mergeBlocked}
                onClick={mergeBlocked ? undefined : () => void mergeBack()}
              />
            }
          >
            {isMerging ? "Merging..." : "Merge back"}
          </TooltipTrigger>
          <TooltipPopup side="top">
            {mergeBlockedReason ?? `Send this side chat's latest reply to ${parent.title}`}
          </TooltipPopup>
        </Tooltip>
      )}
      <Button
        size="xs"
        variant="ghost"
        disabled={pendingAction !== null}
        onClick={() => void toggleEdits()}
      >
        {runtimeMode === "approval-required" ? "Allow edits" : "Ask before edits"}
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="More side chat actions"
              disabled={pendingAction !== null}
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => void promote()}>Promote to thread</MenuItem>
          <MenuItem variant="destructive" onClick={() => void discard()}>
            Discard
          </MenuItem>
        </MenuPopup>
      </Menu>
    </>
  );
}

/**
 * The bar a side chat shows above its composer: what it asks about, and the ways out of it.
 * A parent waiting on the user gets its own notice, since the side chat may cover it.
 */
export function useSideChatBannerItems(input: {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell | null;
  readonly projection: ThreadStructure | null;
  readonly canOperate: boolean;
  readonly runtimeMode: RuntimeMode;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
}): ReadonlyArray<ComposerBannerStackItem> {
  const { environmentId, thread, projection } = input;
  const sideChat = thread?.sideChat === true ? thread : null;
  const parentThreadId = sideChat?.lineage.parentThreadId ?? null;
  const parentRef = parentThreadId === null ? null : scopeThreadRef(environmentId, parentThreadId);
  const parent = useQuietThreadShell(parentRef);
  if (sideChat === null) return [];

  const contextNote = sideChatContextNote(projection?.contextTransfers ?? [], sideChat.id);
  const bar: ComposerBannerStackItem = {
    id: `side-chat:${sideChat.id}`,
    variant: "default",
    priority: "activity",
    icon: <MessagesSquareIcon />,
    title:
      parent === null || parentRef === null ? (
        "Side chat"
      ) : (
        <>
          Side chat of <SideChatParentLink parentRef={parentRef} title={parent.title} />
        </>
      ),
    ...(contextNote === null ? {} : { description: contextNote }),
    ...(input.canOperate
      ? {
          actions: (
            <SideChatActions
              environmentId={environmentId}
              sideChat={sideChat}
              parentRef={parentRef}
              parent={parent}
              projection={projection}
              runtimeMode={input.runtimeMode}
              onRuntimeModeChange={input.onRuntimeModeChange}
            />
          ),
        }
      : {}),
  };

  if (
    parent === null ||
    parentRef === null ||
    (!parent.hasPendingApprovals && !parent.hasPendingUserInput)
  ) {
    return [bar];
  }
  return [
    {
      id: `side-chat-parent:${parent.id}`,
      variant: "info",
      priority: "activity",
      icon: parent.hasPendingApprovals ? <ShieldQuestionIcon /> : <MessageCircleIcon />,
      title: parent.hasPendingApprovals
        ? `${parent.title} is waiting for an approval`
        : `${parent.title} is waiting for your answer`,
      actions: <OpenParentButton parentRef={parentRef} />,
    },
    bar,
  ];
}
