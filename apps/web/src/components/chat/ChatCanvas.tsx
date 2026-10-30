import { useStore } from "zustand";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { type ChatCanvasStore, resolveChatCanvasModel } from "./canvasStore";
import { useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { ChatCanvasContext } from "./ChatCanvasContext";
import { observeResize } from "../../lib/observeResize";

export function ChatCanvas({
  store,
  threadRef,
  detailsCardInlineOpen,
  composerOverlayElement,
  detailsCardTopInset = 0,
  children,
  ...props
}: Omit<ComponentProps<"div">, "className" | "style" | "ref"> & {
  store: ChatCanvasStore;
  threadRef: ScopedThreadRef | null;
  detailsCardInlineOpen: boolean;
  composerOverlayElement: HTMLElement | null;
  detailsCardTopInset?: number;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const widthProbeRef = useRef<HTMLDivElement | null>(null);
  const [timelineElement, registerTimeline] = useState<HTMLElement | null>(null);
  const state = useStore(store);
  const { measurements, reportPreview, clearPreview, measureDetailsCard, setMeasurements } = state;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Resize observers measure the canvas, composer, find bar, and timeline DOM for placement.
  useLayoutEffect(() => {
    const element = elementRef.current;
    const probe = widthProbeRef.current;
    if (!element || !probe) return;
    const findBar =
      detailsCardTopInset > 0 ? element.querySelector<HTMLElement>("[data-thread-find-bar]") : null;
    const measure = () => {
      const canvasBounds = element.getBoundingClientRect();
      const findBarBounds = findBar?.getBoundingClientRect();
      const styles = getComputedStyle(probe);
      setMeasurements({
        findBar: findBarBounds
          ? {
              left: findBarBounds.left - canvasBounds.left,
              right: findBarBounds.right - canvasBounds.left,
              bottom: findBarBounds.bottom - canvasBounds.top,
            }
          : null,
        width: element.clientWidth,
        height: element.clientHeight,
        padding: Number.parseFloat(styles.paddingLeft),
        maxChatWidth: Number.parseFloat(styles.width),
        minChatWidth: Number.parseFloat(styles.minWidth),
        composerHeight: composerOverlayElement?.getBoundingClientRect().height ?? 0,
        timelineGutter: timelineElement
          ? (timelineElement.offsetWidth - timelineElement.clientWidth) / 2
          : 0,
      });
    };
    measure();
    const observed: Element[] = [element, probe];
    if (findBar) observed.push(findBar);
    if (composerOverlayElement) observed.push(composerOverlayElement);
    if (timelineElement) observed.push(timelineElement);
    return observeResize(observed, measure);
  }, [composerOverlayElement, timelineElement, detailsCardTopInset, setMeasurements]);
  const model = resolveChatCanvasModel({ ...state, threadRef, detailsCardInlineOpen });
  const context = {
    ...model,
    previewKey: state.preview?.key ?? null,
    reportPreview,
    clearPreview,
    registerTimeline,
    measureDetailsCard,
  };
  const { layout } = context;
  return (
    <ChatCanvasContext value={context}>
      <div
        {...props}
        ref={elementRef}
        data-chat-canvas
        data-preview-overlaps-chat={layout.overlapsChat || undefined}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        style={
          {
            "--chat-timeline-gutter": `${measurements.timelineGutter}px`,
            "--chat-lane-inset-start": `${layout.chat.insetStart}px`,
            "--chat-lane-inset-end": `${layout.chat.insetEnd}px`,
          } as CSSProperties
        }
      >
        <div
          ref={widthProbeRef}
          aria-hidden
          className="pointer-events-none invisible absolute h-0 w-(--chat-content-max-width) min-w-[40rem] box-content ps-3 sm:ps-12"
        />
        {children}
      </div>
    </ChatCanvasContext>
  );
}
