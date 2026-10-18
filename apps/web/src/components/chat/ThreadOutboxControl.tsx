import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { CircleAlertIcon, Clock3Icon, PencilIcon, RotateCwIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { replaceComposerContextReferences } from "@supaterm/shared/composerContextReferences";
import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";

import { newThreadId } from "../../lib/utils";
import {
  DraftId,
  restoreFailedBackgroundDraftThread,
  useComposerDraftStore,
} from "../../composerDraftStore";
import {
  cancelThreadOutboxTurn,
  useThreadOutbox,
  webThreadOutbox,
  replaceThreadOutboxTurn,
  threadOutboxDeliverableAtom,
  type PendingThreadTurn,
} from "../../state/threadOutbox";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { ComposerBanner, type ComposerBannerVariant } from "./ComposerBanner";
import { resolveThreadOutboxStatus, type ThreadOutboxStatus } from "./ThreadOutboxControl.logic";
import { useThreadOutboxVisibility } from "./useThreadOutboxVisibility";

const STATUS_HEADERS = {
  failed: { icon: <CircleAlertIcon className="text-error" />, label: "Not sent", variant: "error" },
  editing: { icon: <PencilIcon />, label: "Paused while editing", variant: "default" },
  offline: { icon: <Clock3Icon />, label: "Sends once connected", variant: "default" },
  sending: { icon: <Spinner />, label: "Sending…", variant: "default" },
  retrying: { icon: <RotateCwIcon />, label: "Retrying shortly", variant: "default" },
  waiting: { icon: <Clock3Icon />, label: "Waiting to send", variant: "default" },
} satisfies Record<
  ThreadOutboxStatus,
  { icon: ReactNode; label: string; variant: ComposerBannerVariant }
>;

export function ThreadOutboxControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly editingMessageId: string | null;
  readonly onEditMessage: (entry: PendingThreadTurn) => Promise<void>;
  readonly onCancelEdit: () => void;
}) {
  const entries = useThreadOutbox();
  const scope = scopedThreadKey(scopeThreadRef(props.environmentId, props.threadId));
  const pending = entries.filter((entry) => entry.scope === scope && entry.status !== "delivered");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const deliverable = useAtomValue(threadOutboxDeliverableAtom(props.environmentId));
  const status = resolveThreadOutboxStatus({
    head: pending[0],
    editingMessageId: props.editingMessageId,
    deliverable,
    isSending: webThreadOutbox.isSending,
  });
  const header = STATUS_HEADERS[status];
  const open = useThreadOutboxVisibility(
    scope,
    pending.length > 0,
    props.editingMessageId !== null ||
      pending.some((entry) => entry.status === "failed" || entry.error !== null),
  );

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    const result = await settlePromise(action);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not update the pending message.");
    }
    setBusy(false);
  }

  return (
    <ComposerBanner.Drawer open={open}>
      <ComposerBanner.Root
        role="region"
        aria-label={`${pending.length} pending ${pending.length === 1 ? "message" : "messages"}`}
        variant={header.variant}
      >
        <ComposerBanner.Row>
          <ComposerBanner.Icon>{header.icon}</ComposerBanner.Icon>
          <ComposerBanner.Content role="status" className="text-muted-foreground">
            {header.label}
          </ComposerBanner.Content>
          {pending.length > 1 ? (
            <ComposerBanner.Actions>
              <ComposerBanner.Count>{pending.length}</ComposerBanner.Count>
            </ComposerBanner.Actions>
          ) : null}
        </ComposerBanner.Row>
        <ComposerBanner.Scroll className="max-h-56">
          <ComposerBanner.Children render={<ol />}>
            {pending.map((entry) => {
              const canChange = !entry.attempted || entry.status === "failed";
              const isEditing = props.editingMessageId === entry.id;
              const deliveryError = webThreadOutbox.isSending(entry.id) ? null : entry.error;
              return (
                <ComposerBanner.Row
                  render={<li />}
                  key={entry.id}
                  aria-current={isEditing ? "true" : undefined}
                  className={isEditing ? "rounded-sm bg-accent text-accent-foreground" : undefined}
                >
                  <ComposerBanner.Icon />
                  <ComposerBanner.Content className="text-foreground/80">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {isEditing ? <span className="sr-only">Editing: </span> : null}
                        {replaceComposerContextReferences(
                          entry.payload.input.message.text,
                          (reference) => reference.label,
                        ) || "Attachment"}
                      </span>
                      {deliveryError ? (
                        <span className="block text-muted-foreground">{deliveryError}</span>
                      ) : null}
                      {entry.payload.localAttachments.length > 0 ? (
                        <span className="block truncate text-muted-foreground">
                          {entry.payload.localAttachments
                            .map((attachment) => attachment.name)
                            .join(", ")}
                        </span>
                      ) : null}
                    </span>
                  </ComposerBanner.Content>
                  <ComposerBanner.Actions>
                    {entry.status === "failed" && !isEditing ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          void act(async () => {
                            const threadRef = await replaceThreadOutboxTurn(entry, entry.payload);
                            if (threadRef)
                              void navigate({
                                to: "/$environmentId/$threadId",
                                params: threadRef,
                                replace: true,
                              });
                          });
                        }}
                      >
                        Retry
                      </Button>
                    ) : null}
                    {isEditing ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label="Cancel editing pending message"
                        disabled={busy}
                        onClick={() => props.onCancelEdit()}
                      >
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label="Edit pending message"
                        disabled={busy || !canChange || props.editingMessageId !== null}
                        onClick={() => {
                          void act(() => props.onEditMessage(entry));
                        }}
                      >
                        <PencilIcon />
                      </Button>
                    )}
                    {!isEditing ? (
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label="Cancel pending message"
                        disabled={busy || !canChange}
                        onClick={() => {
                          void act(async () => {
                            await cancelThreadOutboxTurn(entry);
                            if (entry.payload.draftId) {
                              const draftId = DraftId.make(entry.payload.draftId);
                              const draft = useComposerDraftStore
                                .getState()
                                .getDraftSession(draftId);
                              if (draft)
                                restoreFailedBackgroundDraftThread(
                                  draftId,
                                  draft,
                                  entry.status === "failed" ? newThreadId() : draft.threadId,
                                );
                              void navigate({ to: "/draft/$draftId", params: { draftId } });
                            } else if (entry.payload.input.bootstrap?.createThread) {
                              void navigate({ to: "/" });
                            }
                          });
                        }}
                      >
                        <XIcon />
                      </Button>
                    ) : null}
                  </ComposerBanner.Actions>
                </ComposerBanner.Row>
              );
            })}
          </ComposerBanner.Children>
        </ComposerBanner.Scroll>
        {error ? (
          <p role="alert" className="px-2 text-destructive">
            {error}
          </p>
        ) : null}
      </ComposerBanner.Root>
    </ComposerBanner.Drawer>
  );
}
