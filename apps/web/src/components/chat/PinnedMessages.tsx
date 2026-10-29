import type { ThreadPinnedMessage } from "@supaterm/contracts";
import type { TimestampFormat } from "@supaterm/contracts/settings";
import { PinIcon, PinOffIcon } from "@supaterm/icons";
import { use, useState } from "react";
import { cn } from "~/lib/utils";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { type TimelineRow, TimelineRowCtx } from "./timelineRowContext";

export type PinnableProjectedItem = NonNullable<
  Extract<TimelineRow, { kind: "message" }>["projectedItem"]
>;

export function isPinnableProjectedItem(
  projectedItem: Extract<TimelineRow, { kind: "message" }>["projectedItem"],
): projectedItem is PinnableProjectedItem {
  const type = projectedItem?.item.type;
  return type === "user_message" || type === "assistant_message";
}

export function useMessagePinned(
  projectedItem: Extract<TimelineRow, { kind: "message" }>["projectedItem"],
): boolean {
  const ctx = use(TimelineRowCtx);
  return projectedItem !== undefined && ctx.pinnedItemIds.has(projectedItem.sourceItemId);
}

export function MessagePinButton({ projectedItem }: { projectedItem: PinnableProjectedItem }) {
  const ctx = use(TimelineRowCtx);
  const pinned = ctx.pinnedItemIds.has(projectedItem.sourceItemId);
  if (ctx.onTogglePinnedMessage === null) return null;
  const onToggle = ctx.onTogglePinnedMessage;
  const label = pinned ? "Unpin message" : "Pin message";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={label}
            aria-pressed={pinned}
            onClick={() => onToggle(projectedItem, pinned)}
          />
        }
      >
        <PinIcon className={cn("size-3", pinned && "fill-current text-info")} />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function PinnedMessagesMenu({
  pins,
  timestampFormat,
  onJump,
  onUnpin,
}: {
  pins: ReadonlyArray<ThreadPinnedMessage>;
  timestampFormat: TimestampFormat;
  onJump: (pin: ThreadPinnedMessage) => void;
  onUnpin: ((pin: ThreadPinnedMessage) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (pins.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="sm"
                  className="shrink-0 [-webkit-app-region:no-drag]"
                  aria-label={`${pins.length} pinned ${pins.length === 1 ? "message" : "messages"}`}
                />
              }
            />
          }
        >
          <PinIcon className="size-3.5" />
          <span className="tabular-nums">{pins.length}</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">Pinned messages</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" side="bottom" width="md" padding="compact">
        <ul className="-mx-1 flex flex-col">
          {pins.map((pin) => {
            const sentAt = formatDayAwareTimestamp(pin.sentAt, timestampFormat);
            return (
              <li key={pin.itemId} className="group/pin relative">
                <button
                  type="button"
                  className="flex w-full min-w-0 items-start gap-2.5 rounded-md py-1.5 ps-2 pe-8 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => {
                    setOpen(false);
                    onJump(pin);
                  }}
                >
                  {/* The same mark the timeline minimap draws for a pinned turn. */}
                  <span aria-hidden className="mt-[9px] h-0.5 w-3 shrink-0 rounded-full bg-info" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="line-clamp-2 text-sm break-words">
                      {pin.preview === "" ? "Message with attachments" : pin.preview}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {pin.role === "user" ? `You · ${sentAt}` : sentAt}
                    </span>
                  </span>
                </button>
                {onUnpin ? (
                  <span className="absolute end-1 top-1 opacity-0 transition-opacity duration-150 pointer-coarse:opacity-100 group-has-[:focus-visible]/pin:opacity-100 group-hover/pin:opacity-100">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost-muted"
                            aria-label="Unpin message"
                            onClick={() => onUnpin(pin)}
                          />
                        }
                      >
                        <PinOffIcon className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipPopup side="left">Unpin message</TooltipPopup>
                    </Tooltip>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}
