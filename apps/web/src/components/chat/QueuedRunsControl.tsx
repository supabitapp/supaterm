import { resolveUserMessagePresentation } from "@supaterm/client-runtime/user-message";
import { Link } from "@tanstack/react-router";
import { useScheduledTaskTitle } from "./useScheduledTaskTitle";
import { isAttachmentOnlyBootstrapPrompt } from "@supaterm/shared/composerContextReferences";
import { queuedRunEditBlockedReason } from "@supaterm/client-runtime/queued-run-edit";
import { derivePendingThreadRequests } from "@supaterm/client-runtime/state/thread-requests";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { deriveThreadQueueWorkflowState } from "@supaterm/client-runtime/state/thread-workflows";
import { assistantCitationsToPlainText } from "@supaterm/shared/assistantCitations";
import { replaceComposerContextReferences } from "@supaterm/shared/composerContextReferences";
import type {
  ChatAttachment as ContractChatAttachment,
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import { Clock3Icon, CornerUpRightIcon, ListOrderedIcon, PencilIcon, XIcon } from "@supaterm/icons";
import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { threadEnvironment } from "../../state/threads";
import { useQuietThreadShell, useThreadProjection } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { isImageAttachment, type ChatMessage } from "../../types";
import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";
import { InlineConfirmButton } from "../InlineConfirm";
import { Button, InlineButton } from "../ui/button";
import { Collapsible, CollapsiblePanel } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface EditQueuedRunRequest {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ContractChatAttachment>;
}

interface QueuedRowThumbnail {
  readonly key: string;
  readonly name: string;
  readonly url: string | null;
}

export interface QueuedRunsControlHandle {
  steerNext: (repeat: boolean) => boolean;
  editLatest: (repeat: boolean) => boolean;
}

type ThreadQueueProjection = Parameters<typeof deriveThreadQueueWorkflowState>[0];

function queuedImageResources(projection: ThreadQueueProjection | undefined) {
  if (!projection) return [];
  return deriveThreadQueueWorkflowState(projection).queuedRuns.flatMap(({ attachments }) =>
    attachments.flatMap((attachment) =>
      attachment.type === "image"
        ? [{ _tag: "attachment" as const, attachmentId: attachment.id }]
        : [],
    ),
  );
}

export function QueuedRunsControl({
  ref,
  ...props
}: {
  readonly ref?: Ref<QueuedRunsControlHandle>;
  readonly steerShortcutLabel?: string | null;
  readonly editShortcutLabel?: string | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly optimisticMessages: ReadonlyArray<
    Pick<ChatMessage, "id" | "inputIntent" | "text" | "attachments">
  >;
  readonly editingRunId: RunId | null;
  readonly onEditQueuedRun: (request: EditQueuedRunRequest) => void;
  readonly onCancelEdit: () => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const projection = useThreadProjection(
    scopeThreadRef(props.environmentId, props.threadId),
  )?.projection;
  const promote = useAtomCommand(threadEnvironment.promoteQueuedRun);
  const resume = useAtomCommand(threadEnvironment.resumeThreadQueue);
  const cancel = useAtomCommand(threadEnvironment.cancelQueuedRun);
  const [expanded, setExpanded] = useState(true);
  const queueListId = useId();
  const [busyRunId, setBusyRunId] = useState<RunId | null>(null);
  const steerInFlightRef = useRef(false);
  // Once the projection holds the message the optimistic copy is stale no
  // matter what happened to its run — keying on still-queued runs alone would
  // resurrect a phantom "pending" row after the run is cancelled or started.
  const acknowledgedMessageIds = new Set((projection?.messages ?? []).map((message) => message.id));
  const queuedImageAttachmentResources = queuedImageResources(projection);
  const queuedImageAttachmentUrls = useAssetUrls(
    props.environmentId,
    queuedImageAttachmentResources,
  );
  const workflow = projection ? deriveThreadQueueWorkflowState(projection) : null;
  const editBlockedReason = queuedRunEditBlockedReason({
    openQuestionCount: projection ? derivePendingThreadRequests(projection).userInputs.length : 0,
  });
  const queued = workflow?.queuedRuns ?? [];
  const activeRun = workflow?.activeRun ?? null;
  const canSend = workflow?.canSendNow === true || workflow?.canPromoteToSteer === true;
  const queuedImageUrlById = new Map(
    queuedImageAttachmentUrls.flatMap((url, index) => {
      const resource = queuedImageAttachmentResources[index];
      return url && resource ? [[resource.attachmentId, url] as const] : [];
    }),
  );
  const optimisticQueued = props.optimisticMessages.filter(
    (message) => message.inputIntent === "queued_turn" && !acknowledgedMessageIds.has(message.id),
  );
  const items = [
    ...queued.map(({ run, text, attachments, message }, serverIndex) => ({
      message,
      key: run.id,
      runId: run.id,
      messageId: run.userMessageId,
      serverIndex,
      text,
      attachments,
      thumbnails: attachments
        .filter((attachment) => attachment.type === "image")
        .map<QueuedRowThumbnail>((attachment) => ({
          key: attachment.id,
          name: attachment.name,
          url: queuedImageUrlById.get(attachment.id) ?? null,
        })),
      pending: false,
    })),
    ...optimisticQueued.map((message) => ({
      message: undefined,
      key: message.id,
      runId: null,
      messageId: null,
      serverIndex: null,
      text: message.text,
      attachments: [] as ReadonlyArray<ContractChatAttachment>,
      thumbnails: (message.attachments ?? [])
        .filter(isImageAttachment)
        .map<QueuedRowThumbnail>((attachment) => ({
          key: attachment.id,
          name: attachment.name,
          url: attachment.previewUrl ?? null,
        })),
      pending: true,
    })),
  ];

  const sendQueuedMessage = async (queuedRunId: RunId) => {
    if (!canSend || steerInFlightRef.current) return;
    steerInFlightRef.current = true;
    setBusyRunId(queuedRunId);
    if (workflow?.canSendNow) {
      await resume({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, runId: queuedRunId },
      });
    } else if (activeRun !== null) {
      await promote({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, queuedRunId, targetRunId: activeRun.id },
      });
    }
    steerInFlightRef.current = false;
    setBusyRunId(null);
  };

  useImperativeHandle(ref, () => ({
    steerNext(repeat) {
      const next = queued[0];
      if (!next || !canSend) return false;
      if (!repeat && busyRunId === null) void sendQueuedMessage(next.run.id);
      return true;
    },
    // Takes the key while the last row is still saving rather than editing an
    // older message than the one shown last.
    editLatest(repeat) {
      const latest = items.at(-1);
      if (!latest || editBlockedReason !== null) return false;
      if (!repeat && latest.runId !== null && latest.messageId !== null && busyRunId === null) {
        setExpanded(true);
        props.onEditQueuedRun({
          runId: latest.runId,
          messageId: latest.messageId,
          text: latest.text,
          attachments: latest.attachments,
        });
      }
      return true;
    },
  }));

  const remove = async (runId: RunId) => {
    setBusyRunId(runId);
    await cancel({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, runId },
    });
    setBusyRunId(null);
  };

  return (
    <ComposerBanner.Drawer key={props.threadId} open={items.length > 0}>
      <ComposerBanner.Root
        role="region"
        aria-label={`${items.length} queued message${items.length === 1 ? "" : "s"}`}
        aria-live="polite"
        data-chat-composer-collapsed-controls="true"
        className="relative z-0"
      >
        <ComposerBanner.Row
          render={<button type="button" />}
          aria-label={expanded ? "Collapse queued messages" : "Expand queued messages"}
          aria-expanded={expanded}
          aria-controls={queueListId}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setExpanded((value) => !value)}
        >
          <ComposerBanner.Icon>
            <ListOrderedIcon />
          </ComposerBanner.Icon>
          <ComposerBanner.Content className="text-muted-foreground">Queued</ComposerBanner.Content>
          <ComposerBanner.Actions>
            <ComposerBanner.ToggleIcon expanded={expanded} />
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        <Collapsible open={expanded}>
          <CollapsiblePanel keepMounted>
            <ComposerBanner.Scroll className="max-h-32">
              <ComposerBanner.Children render={<ol />} id={queueListId}>
                {items.map((item) => {
                  const previewText = isAttachmentOnlyBootstrapPrompt(item.text)
                    ? ""
                    : assistantCitationsToPlainText(
                        replaceComposerContextReferences(item.text, (reference) =>
                          reference.kind === "image" && item.thumbnails.length > 0
                            ? ""
                            : reference.label,
                        ),
                      ).trim();
                  const rowRunId = item.runId;
                  const isEditing = rowRunId !== null && rowRunId === props.editingRunId;
                  return (
                    <ComposerBanner.Row
                      render={<li />}
                      key={item.key}
                      aria-current={isEditing ? "true" : undefined}
                      className={cn(
                        "relative rounded-sm",
                        isEditing && "bg-accent text-accent-foreground",
                      )}
                    >
                      <ComposerBanner.Content className="text-foreground/80">
                        <QueuedMessageSender
                          message={item.message}
                          environmentId={props.environmentId}
                          onOpenThread={props.onOpenThread}
                        />
                        {isEditing ? (
                          <span className="sr-only">Editing queued message: </span>
                        ) : null}
                        {item.pending ? (
                          <Clock3Icon
                            aria-label="Saving queued message"
                            className="size-3 shrink-0 text-muted-foreground/60"
                          />
                        ) : null}
                        {item.thumbnails.length > 0 ? (
                          <span className="flex shrink-0 items-center gap-0.5">
                            {item.thumbnails.map((thumbnail) => (
                              <span
                                key={thumbnail.key}
                                className="size-4 overflow-hidden rounded border border-border/70 bg-background"
                              >
                                {thumbnail.url ? (
                                  <img
                                    src={thumbnail.url}
                                    alt={thumbnail.name}
                                    className="size-full object-cover"
                                  />
                                ) : (
                                  <span
                                    aria-label={thumbnail.name}
                                    className="block size-full bg-muted/60"
                                  />
                                )}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        <Tooltip>
                          <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>
                            {previewText}
                          </TooltipTrigger>
                          <TooltipPopup side="top" className="max-w-96 break-words">
                            {previewText}
                          </TooltipPopup>
                        </Tooltip>
                      </ComposerBanner.Content>
                      <ComposerBanner.Actions>
                        {isEditing ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label="Cancel editing queued message"
                            onClick={props.onCancelEdit}
                          >
                            Cancel
                          </Button>
                        ) : (
                          <>
                            <Tooltip>
                              <TooltipTrigger render={<span className="flex shrink-0" />}>
                                <Button
                                  size="xs"
                                  variant="ghost-muted"
                                  disabled={item.runId === null || busyRunId !== null || !canSend}
                                  onClick={() => {
                                    if (item.runId !== null) {
                                      void sendQueuedMessage(item.runId);
                                    }
                                  }}
                                >
                                  <CornerUpRightIcon />
                                  Send now
                                </Button>
                              </TooltipTrigger>
                              <TooltipPopup
                                shortcut={item.serverIndex === 0 ? props.steerShortcutLabel : null}
                              >
                                {workflow?.canSendNow
                                  ? "Start a turn with this message"
                                  : "Send as a steer instead"}
                              </TooltipPopup>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    size="icon-xs"
                                    variant="ghost-muted"
                                    aria-label="Edit queued message"
                                    disabled={
                                      item.runId === null ||
                                      busyRunId !== null ||
                                      editBlockedReason !== null
                                    }
                                    onClick={() => {
                                      if (item.runId !== null && item.messageId !== null) {
                                        props.onEditQueuedRun({
                                          runId: item.runId,
                                          messageId: item.messageId,
                                          text: item.text,
                                          attachments: item.attachments,
                                        });
                                      }
                                    }}
                                  />
                                }
                              >
                                <PencilIcon />
                              </TooltipTrigger>
                              <TooltipPopup
                                shortcut={item === items.at(-1) ? props.editShortcutLabel : null}
                              >
                                {editBlockedReason ?? "Edit in the composer"}
                              </TooltipPopup>
                            </Tooltip>
                            <InlineConfirmButton
                              size="icon-xs"
                              variant="ghost"
                              disabled={item.runId === null || busyRunId !== null}
                              icon={<XIcon className="size-3.5" />}
                              label="Remove queued message"
                              confirmLabel="Confirm remove"
                              tooltip="Remove from queue"
                              confirmTooltip="Click again to remove from the queue and discard the message"
                              onConfirm={() => {
                                if (item.runId !== null) void remove(item.runId);
                              }}
                            />
                          </>
                        )}
                      </ComposerBanner.Actions>
                    </ComposerBanner.Row>
                  );
                })}
              </ComposerBanner.Children>
            </ComposerBanner.Scroll>
          </CollapsiblePanel>
        </Collapsible>
      </ComposerBanner.Root>
    </ComposerBanner.Drawer>
  );
}

function QueuedMessageSender({
  message,
  environmentId,
  onOpenThread,
}: {
  message: ThreadQueueProjection["messages"][number] | undefined;
  environmentId: EnvironmentId;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const presentation = message ? resolveUserMessagePresentation(message) : null;
  const taskTitle = useScheduledTaskTitle(environmentId, presentation?.scheduledTaskId);
  const senderId = message?.senderThreadId;
  const sender = useQuietThreadShell(
    presentation?.attribution === "agent" && senderId
      ? scopeThreadRef(environmentId, senderId)
      : null,
  );
  if (presentation?.attribution === "automation" && presentation.scheduledTaskId)
    return (
      <InlineButton
        tone="muted"
        render={
          <Link
            to="/automations"
            search={{ environmentId, taskId: presentation.scheduledTaskId }}
          />
        }
      >
        {taskTitle ?? "Automation"}
      </InlineButton>
    );
  if (presentation?.attribution === "agent" && senderId)
    return (
      <InlineButton tone="muted" onClick={() => onOpenThread(senderId)}>
        {sender?.title.trim() || "Agent"}
      </InlineButton>
    );
  if (presentation?.attribution === "guest")
    return <span className="text-guest-foreground">{presentation.guestName} (guest)</span>;
  if (presentation?.attribution === "supaterm")
    return <span className="text-muted-foreground">Sent by Supaterm</span>;
  return null;
}
