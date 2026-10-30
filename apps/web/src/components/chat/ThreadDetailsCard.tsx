import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { ScrollArea } from "../ui/scroll-area";
import { TooltipProvider } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { usePresence } from "../../hooks/usePresence";
import { animationsSettled } from "../../lib/motion";
import { Popover, PopoverPopup, PopoverCreateHandle } from "../ui/popover";
import { selectThreadPanelOpen, useRightPanelStore } from "../../rightPanelStore";
import { useChatCanvas } from "./ChatCanvasContext";
import {
  THREAD_DETAILS_CARD_GAP,
  resolveThreadDetailsCardDensity,
} from "./threadDetailsCardLayout";
import { observeResize } from "../../lib/observeResize";

export function ThreadDetailsCard({
  threadRef,
  contentKey,
  anchor,
  handle,
  children,
}: {
  threadRef: ScopedThreadRef;
  contentKey?: string;
  anchor: RefObject<Element | null>;
  handle: ReturnType<typeof PopoverCreateHandle>;
  children: (density: "full" | "compact" | "essential") => ReactNode;
}) {
  const canvas = useChatCanvas();
  const preferredPlacement = canvas?.preferredDetailsCard ?? null;
  const placement = canvas?.detailsCardPlacement ?? null;
  const mode = placement ? "inline" : "popover";
  const topInset = canvas?.detailsCardTopInset ?? 0;
  const inlineOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "inline"),
  );
  const popoverOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "popover"),
  );
  const threadKey = `${threadRef.environmentId}:${threadRef.threadId}`;
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);
  const measurementKey = `${threadKey}:${preferredPlacement?.width ?? "popup"}:${contentKey ?? ""}`;
  const [measurements, setMeasurements] = useState({
    key: measurementKey,
    heights: { full: 0, compact: 0 },
    fullContentHeight: 0,
  });
  const contentHeights =
    measurements.key === measurementKey ? measurements.heights : { full: 0, compact: 0 };
  const height = placement?.height ?? Math.max(0, (canvas?.container.height ?? 0) - 52);
  const density = resolveThreadDetailsCardDensity(height, contentHeights);
  const measureDetailsCard = canvas?.measureDetailsCard;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- DOM-measured inline placement dismisses the no-longer-visible popover.
  useLayoutEffect(() => {
    if (mode === "inline" && popoverOpen)
      useRightPanelStore.getState().setThreadPanelOpen(threadRef, "popover", false);
  }, [mode, threadRef, popoverOpen]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Observe the rendered content height after its animations settle to select a fitting density.
  useLayoutEffect(() => {
    const element = contentElement;
    if (!element || density === "essential") return;
    // Measure the single content tree before the scroll viewport clips it. Retain each
    // observed height so increasing available space restores the detail it can hold.
    // A disclosure resizes the content every frame while it animates, so a resize measures
    // once its transitions settle instead of re-rendering the panel per frame.
    const measure = () => {
      const frame = element.closest<HTMLElement>("[data-thread-details-card]");
      const next = element.offsetHeight + (frame ? frame.offsetHeight - frame.clientHeight : 0);
      // PR lists and lineage scroll as they expand. Counting them toward density would hide
      // the section and workspace controls when the user asks to see more rows.
      const lists = element.querySelectorAll<HTMLElement>(
        "[data-thread-relationships-panel], [data-thread-details-pr-list]",
      );
      if (density === "full" && preferredPlacement)
        measureDetailsCard?.({
          threadRef,
          width: preferredPlacement.width,
          fullContentHeight: next,
        });
      const fittingHeight =
        next - Array.from(lists).reduce((sum, list) => sum + list.offsetHeight, 0);
      setMeasurements((current) => {
        const heights = current.key === measurementKey ? current.heights : { full: 0, compact: 0 };
        const fullContentHeight =
          density === "full"
            ? next
            : current.key === measurementKey
              ? current.fullContentHeight
              : 0;
        return current.key === measurementKey &&
          heights[density] === fittingHeight &&
          current.fullContentHeight === fullContentHeight
          ? current
          : {
              key: measurementKey,
              heights: { ...heights, [density]: fittingHeight },
              fullContentHeight,
            };
      });
    };
    let settling = false;
    let disposed = false;
    measure();
    const stopObserving = observeResize(element, () => {
      if (settling) return;
      settling = true;
      void animationsSettled(element, { subtree: true }).then(() => {
        settling = false;
        if (!disposed) measure();
      });
    });
    return () => {
      disposed = true;
      stopObserving();
    };
  }, [contentElement, density, measurementKey, measureDetailsCard, preferredPlacement, threadRef]);
  const renderCard = (motionProps?: PresenceProps) => (
    <div
      {...motionProps}
      className={cn(
        "dropdown-glass isolate contain-paint grid max-h-full grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl",
        mode === "popover" &&
          "max-h-[min(calc(100dvh-6.5rem),calc(var(--available-height,100dvh)-1rem))]",
        motionProps &&
          "transition-[opacity,translate] duration-200 ease-drawer data-enter:starting:translate-x-2 data-enter:starting:opacity-0 data-ending-style:translate-x-2 data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-in motion-reduce:transition-none",
      )}
      style={placement ? { maxHeight: height } : undefined}
      data-thread-details-card
    >
      <TooltipProvider>
        <ScrollArea scrollFade className="min-h-0">
          <div ref={setContentElement}>{children(density)}</div>
        </ScrollArea>
      </TooltipProvider>
    </div>
  );
  return (
    <Popover
      handle={handle}
      open={mode === "popover" && popoverOpen}
      onOpenChange={(open, details) => {
        const target =
          details.reason === "focus-out"
            ? (details.event as FocusEvent).relatedTarget
            : details.reason === "outside-press"
              ? details.event.target
              : null;
        if (!open && target instanceof Element && target.closest("[data-thread-find-bar]")) {
          details.cancel();
          return;
        }
        useRightPanelStore.getState().setThreadPanelOpen(threadRef, "popover", open);
      }}
    >
      {placement ? (
        <InlineThreadDetails
          key={threadKey}
          open={inlineOpen}
          density={density}
          style={{
            right: placement.right,
            top: placement.y,
            width: placement.width,
            maxHeight: height,
          }}
        >
          {renderCard}
        </InlineThreadDetails>
      ) : (
        <PopoverPopup
          anchor={anchor}
          align="end"
          // Lines the card up with the find bar: the panel pads its card by 8px.
          alignOffset={THREAD_DETAILS_CARD_GAP - 8}
          collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
          side="bottom"
          sideOffset={topInset}
          variant="panel"
          padding="none"
        >
          <div data-density={density} data-thread-details-panel="popover">
            {renderCard()}
          </div>
        </PopoverPopup>
      )}
    </Popover>
  );
}

type PresenceProps = ReturnType<typeof usePresence>["props"];

/** Keyed by thread, so switching threads shows or removes the card without an entrance. */
function InlineThreadDetails({
  open,
  density,
  style,
  children,
}: {
  open: boolean;
  density: "full" | "compact" | "essential";
  style: CSSProperties;
  children: (motionProps: PresenceProps) => ReactNode;
}) {
  const presence = usePresence(open ? true : null);
  if (!presence.value) return null;
  return (
    <aside
      aria-label="Thread details"
      inert={presence.exiting}
      className="absolute z-20"
      style={style}
      data-density={density}
      data-thread-details-panel="inline"
    >
      {children(presence.props)}
    </aside>
  );
}
