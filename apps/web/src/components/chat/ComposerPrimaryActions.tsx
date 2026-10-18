import { memo, type MouseEventHandler, type PointerEventHandler } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  CornerUpRightIcon,
  ListPlusIcon,
  PlayIcon,
} from "lucide-react";
import type { ResolvedKeybindingsConfig } from "@supaterm/contracts";
import type { ClientSettings } from "@supaterm/contracts/settings";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useEnvironmentIdentificationMode } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { composerSendShortcutLabels, type ComposerSendAction } from "../../composer-logic";
import { shortcutLabelForCommand } from "../../keybindings";
import { useShortcutModifierState } from "../../shortcutModifierState";
import { StageBackdropButtonArt, useSidebarStageBackdrop } from "../SidebarStageBackdrop";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipShortcutLabel, TooltipTrigger } from "../ui/tooltip";
import {
  type ActiveTurnComposerAction,
  alternateComposerDispatchAction,
  resolveComposerDispatchMode,
} from "@supaterm/client-runtime/state/composer-dispatch";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

interface ComposerPrimaryActionsProps {
  compact: boolean;
  keybindings: ResolvedKeybindingsConfig;
  canOperateThread: boolean;
  canQueueMessage: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  canInterrupt: boolean;
  followUpBehavior?: "queue" | "steer";
  canSteer?: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  sendShortcut?: ClientSettings["sendShortcut"] | undefined;
  isDraftThread?: boolean | undefined;
  hasMultilinePrompt?: boolean | undefined;
  canResume?: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  isEditingQueuedMessage?: boolean;
  onSubmitMessage?: MouseEventHandler<HTMLButtonElement>;
  onResume?: () => void;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
}

const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

// The composer's labeled primary action shares the send button's
// message-action pill, so they are composer-owned buttons rather than restyled Buttons.
const messageActionPillClassName =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-message-action font-medium text-base text-message-action-foreground shadow-xs shadow-message-action/24 outline-none hover:bg-message-action-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none sm:text-sm";

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

const FOLLOW_UP_ACTION_LABELS: Record<ActiveTurnComposerAction, string> = {
  queue: "Queue message",
  steer: "Steer current run",
  restart: "Restart run",
};

// The click action leads; the others only appear while a key runs them.
const SEND_ACTION_ORDER: ReadonlyArray<ComposerSendAction> = [
  "foreground",
  "newLine",
  "alternate",
  "background",
];

/** Every way to send from the composer with the key that does it. */
function SendActionsTooltip(props: {
  keybindings: ResolvedKeybindingsConfig;
  isRunning: boolean;
  sendShortcut: ClientSettings["sendShortcut"];
  followUpBehavior: ClientSettings["followUpBehavior"];
  canSteer: boolean;
  isDraftThread: boolean;
  hasMultilinePrompt: boolean;
}) {
  const { isRunning, followUpBehavior, canSteer, isDraftThread } = props;
  const isMobileViewport = useMediaQuery("max-sm");
  const shortcuts = composerSendShortcutLabels({
    ...props,
    platform: navigator.platform,
    isMobileViewport,
  });
  const labels: Record<ComposerSendAction, string> = {
    foreground: isRunning
      ? FOLLOW_UP_ACTION_LABELS[canSteer ? followUpBehavior : "queue"]
      : "Send message",
    newLine: "New line",
    alternate: FOLLOW_UP_ACTION_LABELS[alternateComposerDispatchAction(followUpBehavior)],
    background: isDraftThread ? "Send in background" : "Send and start new thread",
  };

  return (
    <div className="grid gap-1.5 py-0.5">
      {SEND_ACTION_ORDER.flatMap((action) =>
        action === "foreground" ||
        (shortcuts[action] !== undefined && (action !== "alternate" || canSteer))
          ? [
              <TooltipShortcutLabel key={action} shortcut={shortcuts[action] ?? null}>
                {action === "foreground" ? (
                  <span className="font-medium">{labels[action]}</span>
                ) : (
                  labels[action]
                )}
              </TooltipShortcutLabel>,
            ]
          : [],
      )}
    </div>
  );
}

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  keybindings,
  canOperateThread,
  canQueueMessage,
  pendingAction,
  isRunning,
  canInterrupt,
  followUpBehavior = "steer",
  canSteer = true,
  isSendBusy,
  sendDisabledReason,
  isConnecting,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  sendShortcut = "enter",
  isDraftThread = false,
  hasMultilinePrompt = false,
  canResume = false,
  preserveComposerFocusOnPointerDown = false,
  isEditingQueuedMessage = false,
  onSubmitMessage,
  onResume,
  onPreviousPendingQuestion,
  onInterrupt,
}: ComposerPrimaryActionsProps) {
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const shortcutModifiers = useShortcutModifierState();
  const isQueuing =
    !isEditingQueuedMessage &&
    resolveComposerDispatchMode({
      running: isRunning,
      activeTurnDefault: followUpBehavior,
      canSteer,
      alternateModifier: shortcutModifiers.metaKey || shortcutModifiers.ctrlKey,
    }) === "queue";
  const showStageBackdrop = useSidebarStageBackdrop(environmentIdentificationMode === "artwork");

  const renderStopGenerationButton = (insidePendingAction: boolean) => (
    <Tooltip key="interrupt">
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-control-highlight transition-colors duration-150 ease-out hover:bg-destructive active:inset-shadow-control-pressed active:shadow-none motion-reduce:transition-none [&_svg]:pointer-events-none",
              insidePendingAction ? "size-8 sm:size-7" : "size-8 sm:h-8 sm:w-8",
            )}
            {...pointerFocusProps}
            disabled={!canOperateThread}
            onClick={() => {
              if (canOperateThread) onInterrupt();
            }}
            aria-label="Stop generation"
          />
        }
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
        </svg>
      </TooltipTrigger>
      <TooltipPopup shortcut={shortcutLabelForCommand(keybindings, "thread.stop")}>
        Interrupt
      </TooltipPopup>
    </Tooltip>
  );

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {canInterrupt ? renderStopGenerationButton(true) : null}
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label="Previous question"
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <button
          type="submit"
          className={cn(messageActionPillClassName, "h-8 sm:h-7", compact ? "px-3" : "px-4")}
          {...pointerFocusProps}
          disabled={
            !canOperateThread ||
            isEnvironmentUnavailable ||
            pendingAction.isResponding ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
          })}
        </button>
      </div>
    );
  }

  if (canInterrupt && !hasSendableContent && !isEditingQueuedMessage) {
    return renderStopGenerationButton(false);
  }

  const showResume = canResume && !hasSendableContent && !isEditingQueuedMessage;

  const submitLabel = showResume
    ? "Resume thread"
    : isEditingQueuedMessage
      ? "Update queued message"
      : isQueuing
        ? "Queue message"
        : isRunning
          ? "Steer message"
          : "Submit message";
  const submitStatus = isEnvironmentUnavailable
    ? "Environment disconnected"
    : (sendDisabledReason ??
      (isConnecting
        ? "Connecting"
        : isPreparingWorktree
          ? "Preparing worktree"
          : isSendBusy
            ? isEditingQueuedMessage
              ? "Updating queued message"
              : "Submitting message"
            : null));

  const sendButton = (
    <button
      type={showResume ? "button" : "submit"}
      className={cn(
        "relative isolate flex h-9 w-9 items-center justify-center overflow-hidden rounded-full shadow-xs transition-[scale,background-color,filter] duration-150 ease-out motion-reduce:transition-none enabled:cursor-pointer enabled:inset-shadow-control-highlight hover:scale-105 active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8 [&_svg]:pointer-events-none",
        showStageBackdrop
          ? "bg-transparent text-white enabled:shadow-black/24 enabled:hover:brightness-110"
          : "bg-message-action text-message-action-foreground enabled:shadow-message-action/24 hover:bg-message-action-hover",
      )}
      {...pointerFocusProps}
      onClick={showResume ? onResume : onSubmitMessage}
      disabled={
        isSendBusy ||
        !(showResume ? canOperateThread : canQueueMessage) ||
        sendDisabledReason !== null ||
        isConnecting ||
        isEnvironmentUnavailable ||
        (!hasSendableContent && !showResume)
      }
      aria-label={submitStatus ?? submitLabel}
    >
      {showStageBackdrop ? (
        <span className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <StageBackdropButtonArt />
        </span>
      ) : null}
      {isConnecting || isSendBusy ? (
        <Spinner size="sm" aria-hidden="true" />
      ) : showResume ? (
        <PlayIcon className="size-4 fill-current" aria-hidden="true" />
      ) : isEditingQueuedMessage ? (
        <CheckIcon className="size-4" aria-hidden="true" />
      ) : isRunning ? (
        isQueuing ? (
          <ListPlusIcon className="size-4" aria-hidden="true" />
        ) : (
          <CornerUpRightIcon className="size-4" aria-hidden="true" />
        )
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );

  return (
    <>
      {canInterrupt ? renderStopGenerationButton(false) : null}
      <Tooltip key="submit">
        <TooltipTrigger render={<span className="inline-flex" />}>{sendButton}</TooltipTrigger>
        <TooltipPopup side="top">
          {submitStatus || showResume || isEditingQueuedMessage ? (
            (submitStatus ?? submitLabel)
          ) : (
            <SendActionsTooltip
              keybindings={keybindings}
              isRunning={isRunning}
              sendShortcut={sendShortcut}
              followUpBehavior={followUpBehavior}
              canSteer={canSteer}
              isDraftThread={isDraftThread}
              hasMultilinePrompt={hasMultilinePrompt}
            />
          )}
        </TooltipPopup>
      </Tooltip>
    </>
  );
});
