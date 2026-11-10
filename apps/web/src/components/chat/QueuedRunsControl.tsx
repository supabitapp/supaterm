import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { deriveThreadQueueWorkflowState } from "@supaterm/client-runtime/state/thread-workflows";
import { assistantCitationsToPlainText } from "@supaterm/shared/assistantCitations";
import {
  isAttachmentOnlyBootstrapPrompt,
  replaceComposerContextReferences,
} from "@supaterm/shared/composerContextReferences";
import type {
  ChatAttachment as ContractChatAttachment,
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import { resolveUserMessagePresentation } from "@supaterm/client-runtime/user-message";
import {
  ArrowUpIcon,
  CalendarClockIcon,
  ListOrderedIcon,
  MessagesSquareIcon,
  PencilIcon,
  XIcon,
} from "@supaterm/icons";
import { Link } from "@tanstack/react-router";
import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { threadEnvironment } from "../../state/threads";
import { useQuietThreadShell, useThreadProjection } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";

import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";
import { InlineConfirmButton } from "../InlineConfirm";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel } from "../ui/collapsible";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useScheduledTaskTitle } from "./TimelineUserMessageRow";

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
  readonly editingRunId: RunId | null;
  /** Set while something else holds the composer, such as an open question. */
  readonly editBlockedReason: string | null;
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
  const queuedImageAttachmentResources = queuedImageResources(projection);
  const queuedImageAttachmentUrls = useAssetUrls(
    props.environmentId,
    queuedImageAttachmentResources,
  );
  const workflow = projection ? deriveThreadQueueWorkflowState(projection) : null;
  const queued = workflow?.queuedRuns ?? [];
  const activeRun = workflow?.activeRun ?? null;
  // A fresh message starts its own turn: it may skip compaction, but not steer into a turn.
  const canSendRun = (freshContext: boolean) =>
    workflow?.canSendNow === true ||
    (workflow?.canPromoteToSteer === true &&
      (!freshContext || workflow.promoteSkipsCompaction === true));
  const queuedImageUrlById = new Map(
    queuedImageAttachmentUrls.flatMap((url, index) => {
      const resource = queuedImageAttachmentResources[index];
      return url && resource ? [[resource.attachmentId, url] as const] : [];
    }),
  );
  const items = queued.map(({ run, text, attachments, message }) => ({
    message,
    runId: run.id,
    messageId: run.userMessageId,
    freshContext: run.freshContext === true,
    text,
    attachments,
    thumbnails: attachments
      .filter((attachment) => attachment.type === "image")
      .map<QueuedRowThumbnail>((attachment) => ({
        key: attachment.id,
        name: attachment.name,
        url: queuedImageUrlById.get(attachment.id) ?? null,
      })),
  }));

  const sendQueuedMessage = async (queuedRunId: RunId) => {
    const freshContext = queued.some(
      ({ run }) => run.id === queuedRunId && run.freshContext === true,
    );
    if (!canSendRun(freshContext) || steerInFlightRef.current) return;
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
      if (!next || !canSendRun(next.run.freshContext === true)) return false;
      if (!repeat && busyRunId === null) void sendQueuedMessage(next.run.id);
      return true;
    },
    editLatest(repeat) {
      const latest = items.at(-1);
      if (!latest || props.editBlockedReason !== null) return false;
      if (!repeat && busyRunId === null) {
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
                {items.map((item, index) => {
                  const previewText = isAttachmentOnlyBootstrapPrompt(item.text)
                    ? ""
                    : assistantCitationsToPlainText(
                        replaceComposerContextReferences(item.text, (reference) =>
                          reference.kind === "image" && item.thumbnails.length > 0
                            ? ""
                            : reference.label,
                        ),
                      ).trim();
                  const isEditing = item.runId === props.editingRunId;
                  return (
                    <ComposerBanner.Row
                      render={<li />}
                      key={item.runId}
                      aria-current={isEditing ? "true" : undefined}
                      className={cn(
                        "relative rounded-sm",
                        isEditing && "bg-accent text-accent-foreground",
                      )}
                    >
                      <ComposerBanner.Icon />
                      <ComposerBanner.Content className="text-foreground/80">
                        {isEditing ? (
                          <span className="sr-only">Editing queued message: </span>
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
                        {item.message ? (
                          <QueuedRunSender
                            environmentId={props.environmentId}
                            message={item.message}
                            onOpenThread={props.onOpenThread}
                          />
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
                        {canSendRun(item.freshContext) && !isEditing ? (
                          <>
                            <Tooltip>
                              <TooltipTrigger render={<span className="flex shrink-0" />}>
                                <Button
                                  size="xs"
                                  variant="ghost-muted"
                                  disabled={busyRunId !== null}
                                  onClick={() => void sendQueuedMessage(item.runId)}
                                >
                                  <ArrowUpIcon />
                                  Send now
                                </Button>
                              </TooltipTrigger>
                              <TooltipPopup
                                shortcut={index === 0 ? props.steerShortcutLabel : null}
                              >
                                {workflow?.canSendNow
                                  ? "Start a turn with this message"
                                  : workflow?.promoteSkipsCompaction
                                    ? "Skip compaction and send this message"
                                    : "Send into the current turn"}
                              </TooltipPopup>
                            </Tooltip>
                            <Separator orientation="vertical" className="mx-1 h-4" />
                          </>
                        ) : null}
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
                              {/* The span keeps the tooltip, and its reason, on a disabled button. */}
                              <TooltipTrigger render={<span className="flex shrink-0" />}>
                                <Button
                                  size="icon-xs"
                                  variant="ghost-muted"
                                  aria-label="Edit queued message"
                                  disabled={busyRunId !== null || props.editBlockedReason !== null}
                                  onClick={() =>
                                    props.onEditQueuedRun({
                                      runId: item.runId,
                                      messageId: item.messageId,
                                      text: item.text,
                                      attachments: item.attachments,
                                    })
                                  }
                                >
                                  <PencilIcon />
                                </Button>
                              </TooltipTrigger>
                              <TooltipPopup
                                shortcut={
                                  props.editBlockedReason === null && item === items.at(-1)
                                    ? props.editShortcutLabel
                                    : null
                                }
                              >
                                {props.editBlockedReason ?? "Edit in the composer"}
                              </TooltipPopup>
                            </Tooltip>
                            <InlineConfirmButton
                              size="icon-xs"
                              variant="ghost"
                              disabled={busyRunId !== null}
                              icon={<XIcon className="size-3.5" />}
                              label="Remove queued message"
                              confirmLabel="Confirm remove"
                              tooltip="Remove from queue"
                              confirmTooltip="Click again to remove from the queue and discard the message"
                              onConfirm={() => void remove(item.runId)}
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

type QueuedRunMessage = NonNullable<ThreadQueueProjection["messages"][number]>;

const SENDER_CLASS_NAME = "flex max-w-40 shrink-0 items-center gap-1 text-muted-foreground";

/** Who sent a queued message, as its sent form in the thread names it. */
function QueuedRunSender(props: {
  readonly environmentId: EnvironmentId;
  readonly message: QueuedRunMessage;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { attribution, scheduledTaskId } = resolveUserMessagePresentation(props.message);
  const senderThreadId = attribution === "agent" ? props.message.senderThreadId : undefined;
  const taskTitle = useScheduledTaskTitle(props.environmentId, scheduledTaskId);
  const senderShell = useQuietThreadShell(
    senderThreadId ? scopeThreadRef(props.environmentId, senderThreadId) : null,
  );
  if (attribution === "supaterm") {
    return <span className={SENDER_CLASS_NAME}>Supaterm</span>;
  }
  if (attribution === "automation" && scheduledTaskId) {
    return (
      <Link
        to="/automations"
        search={{ environmentId: props.environmentId, taskId: scheduledTaskId }}
        aria-label={`Open automation ${taskTitle ?? ""}`.trim()}
        className={cn(SENDER_CLASS_NAME, "rounded-sm hover:text-foreground")}
      >
        <CalendarClockIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{taskTitle ?? "Automation"}</span>
      </Link>
    );
  }
  if (attribution !== "agent") return null;
  const label = senderShell?.title.trim() || "Agent";
  const content = (
    <>
      <MessagesSquareIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  return senderThreadId ? (
    <button
      type="button"
      aria-label={`Open thread ${label}`}
      className={cn(SENDER_CLASS_NAME, "rounded-sm hover:text-foreground")}
      onClick={() => props.onOpenThread(senderThreadId)}
    >
      {content}
    </button>
  ) : (
    <span className={SENDER_CLASS_NAME}>{content}</span>
  );
}
