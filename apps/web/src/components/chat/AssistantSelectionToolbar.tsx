import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import { QuoteIcon } from "@supaterm/icons";
import {
  htmlRenderClearSelectionMessage,
  htmlRenderSelectionActionMessage,
  type HtmlRenderBox,
  type HtmlRenderSelection,
} from "@supaterm/shared/htmlRender";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import {
  captureAssistantTextSelection,
  createAssistantTextSelector,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import {
  isSelectionRectVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "../ui/button";
import type { HtmlRenderSelectionReport } from "./HtmlRenderFrame";
import { usePresence } from "~/hooks/usePresence";
import { EASE_DRAWER, EASE_IN, prefersReducedMotion } from "~/lib/motion";
import { cn } from "~/lib/utils";

export interface AssistantSelectionToolbarHandle {
  /** An HTML render's page reported its text selection, cleared it, or asked for the action. */
  reportRenderSelection: (messageId: MessageId, report: HtmlRenderSelectionReport) => void;
}

type SelectionSource =
  | { readonly _tag: "document"; readonly anchor: AssistantCitationSourceAnchor }
  | {
      readonly _tag: "render";
      readonly frame: HTMLIFrameElement;
      readonly collapse: (() => void) | undefined;
    };

type ClipRect = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

function ancestorClips(from: Element | null, until: Element | null) {
  const clips: ClipRect[] = [];
  for (let element = from; element && element !== until; element = element.parentElement) {
    const style = getComputedStyle(element);
    const clipX = style.overflowX !== "visible";
    const clipY = style.overflowY !== "visible";
    if (!clipX && !clipY) continue;
    const bounds = element.getBoundingClientRect();
    const left = bounds.left + element.clientLeft;
    const top = bounds.top + element.clientTop;
    clips.push({
      left: clipX ? left : -Infinity,
      right: clipX ? left + element.clientWidth : Infinity,
      top: clipY ? top : -Infinity,
      bottom: clipY ? top + element.clientHeight : Infinity,
    });
  }
  return clips;
}

export function AssistantSelectionToolbar({
  ref,
  viewport,
  threadRef,
  onCite,
}: {
  ref?: Ref<AssistantSelectionToolbarHandle>;
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor | undefined,
  ) => boolean;
}) {
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    position: SelectionActionPoint;
    source: SelectionSource;
  } | null>(null);
  const renderReportRef = useRef<{
    messageId: MessageId;
    frame: HTMLIFrameElement;
    selection: HtmlRenderSelection;
    collapse: (() => void) | undefined;
  } | null>(null);
  const toolbarRef = useRef<HTMLButtonElement | null>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const presence = usePresence(selection);
  const presenceRef = presence.props.ref;
  const setToolbar = (node: HTMLButtonElement | null) => {
    toolbarRef.current = node;
    presenceRef(node);
  };
  const shown = presence.value !== null;

  useImperativeHandle(
    ref,
    () => ({
      reportRenderSelection(messageId, { frame, event, collapse }) {
        const actions = actionsRef.current;
        const toolbar = toolbarRef.current;
        if (event._tag === "selected") {
          if (!actions) return;
          renderReportRef.current = { messageId, frame, selection: event.selection, collapse };
          actions.selectionReported();
          return;
        }
        if (renderReportRef.current?.frame !== frame) return;
        if (event._tag === "focus-action") {
          if (toolbar && !toolbar.disabled && !toolbar.inert)
            toolbar.focus({ preventScroll: true });
          return;
        }
        if (document.activeElement === toolbar) return;
        renderReportRef.current = null;
        setSelection(null);
      },
    }),
    [],
  );

  const offeredFrame =
    selection?.source._tag === "render" &&
    selection.citation.text.length <= ASSISTANT_CITATION_MAX_TEXT_LENGTH
      ? selection.source.frame
      : null;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- tells the render's sandboxed page while an action is offered for its selection, so Tab pressed in the page can reach the button
  useEffect(() => {
    const page = offeredFrame?.contentWindow;
    if (!page) return;
    page.postMessage(htmlRenderSelectionActionMessage(true), "*");
    return () => page.postMessage(htmlRenderSelectionActionMessage(false), "*");
  }, [offeredFrame]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- measures the toolbar DOM node and clamps its position inside the window before paint
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - toolbar.offsetWidth - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - toolbar.offsetHeight - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- runs the toolbar's Web Animations entrance or exit before paint and cancels it on cleanup
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!shown || !toolbar || prefersReducedMotion()) return;
    const hidden = { opacity: 0, scale: 0.98 };
    const animation = presence.exiting
      ? toolbar.animate(hidden, { duration: 100, easing: EASE_IN, fill: "forwards" })
      : toolbar.animate([hidden, { opacity: 1, scale: 1 }], {
          duration: 150,
          easing: EASE_DRAWER,
        });
    return () => animation.cancel();
  }, [shown, presence.exiting]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to document selectionchange and keydown to track text selections in the viewport
  useEffect(() => {
    if (!viewport) return;
    const clear = () => setSelection(null);
    const updateFromRender = () => {
      const reported = renderReportRef.current;
      if (!reported) return false;
      const { frame, messageId, collapse } = reported;
      if (document.activeElement !== frame) {
        renderReportRef.current = null;
        return false;
      }
      const frameRect = frame.getBoundingClientRect();
      const scaleX = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1;
      const scaleY = frame.offsetHeight > 0 ? frameRect.height / frame.offsetHeight : 1;
      const within = (value: number, max: number) => Math.min(Math.max(value, 0), max);
      const inHost = (box: HtmlRenderBox) => ({
        left: frameRect.left + within(box.left * scaleX, frameRect.width),
        top: frameRect.top + within(box.top * scaleY, frameRect.height),
        right: frameRect.left + within(box.right * scaleX, frameRect.width),
        bottom: frameRect.top + within(box.bottom * scaleY, frameRect.height),
      });
      const inline = collapse === undefined;
      const viewportRect = viewport.getBoundingClientRect();
      const { text } = reported.selection;
      const selector = createAssistantTextSelector(text, 0, text.length);
      if (
        !selector ||
        !isSelectionRectVisible(inHost(reported.selection.bounds), [
          frameRect,
          ...ancestorClips(frame.parentElement, inline ? viewport : document.body),
          ...(inline ? [viewportRect] : []),
        ])
      ) {
        clear();
        return true;
      }
      setSelection({
        source: { _tag: "render", frame, collapse },
        citation: { version: 1, ...threadRef, messageId, ...selector },
        position: resolveSelectionActionPosition({
          bounds: inline ? viewportRect : frameRect,
          selectionRect: inHost(reported.selection.rect),
          pointer: null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
      return true;
    };
    const update = (pointer: SelectionActionPoint | null) => {
      if (updateFromRender()) return;
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (!isSelectionRectVisible(rect, [viewportRect])) {
        clear();
        return;
      }
      const common = captured.range.commonAncestorContainer;
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
      let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
      let visible = false;
      for (; node && !visible; node = walker.nextNode()) {
        if (!captured.range.intersectsNode(node)) continue;
        if (node.parentElement && getComputedStyle(node.parentElement).userSelect === "none")
          continue;
        const fragment = document.createRange();
        fragment.selectNodeContents(node);
        if (node === captured.range.startContainer) {
          fragment.setStart(node, captured.range.startOffset);
        }
        if (node === captured.range.endContainer) {
          fragment.setEnd(node, captured.range.endOffset);
        }
        if (!fragment.toString().trim()) continue;
        const lines = Array.from(fragment.getClientRects());
        if (!lines.some((line) => isSelectionRectVisible(line, [viewportRect]))) continue;
        const clips = [viewportRect, ...ancestorClips(node.parentElement, viewport)];
        visible = lines.some((line) => isSelectionRectVisible(line, clips));
      }
      if (!visible) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      const pointerOnText =
        pointer !== null &&
        Array.from(rects).some(
          (line) =>
            pointer.x >= line.left - 8 &&
            pointer.x <= line.right + 8 &&
            pointer.y >= line.top - 8 &&
            pointer.y <= line.bottom + 8,
        );
      setSelection({
        source: {
          _tag: "document",
          anchor: { source: captured.source, range: captured.range, viewport },
        },
        citation: {
          version: 1,
          ...threadRef,
          messageId: MessageId.make(messageId),
          ...captured.selector,
        },
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer: pointerOnText ? pointer : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      restoreAfterScroll: true,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const onOuterScroll = (event: Event) => {
      const frame = renderReportRef.current?.frame;
      const scrolled = event.target;
      if (
        frame &&
        scrolled instanceof Node &&
        scrolled.contains(frame) &&
        !viewport.contains(scrolled)
      ) {
        actions.scrolled();
      }
    };
    document.addEventListener("scroll", onOuterScroll, true);
    const focusActions = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      if (toolbar.disabled || toolbar.inert) return;
      event.preventDefault();
      event.stopPropagation();
      toolbar.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("scroll", onOuterScroll, true);
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
      renderReportRef.current = null;
    };
  }, [threadRef, viewport]);

  const shownSelection = presence.value;
  if (!shownSelection) return null;
  const tooLong = shownSelection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const { source } = shownSelection;
  const expanded = source._tag === "render" && source.collapse !== undefined;
  const dismiss = () => {
    actionsRef.current?.cancel();
    renderReportRef.current = null;
    setSelection(null);
  };
  const cite = () => {
    const anchor = source._tag === "document" ? source.anchor : undefined;
    if (tooLong || !onCite(shownSelection.citation, anchor)) return false;
    if (source._tag === "render") {
      source.frame.contentWindow?.postMessage(htmlRenderClearSelectionMessage(), "*");
      source.collapse?.();
    } else {
      window.getSelection()?.removeAllRanges();
    }
    dismiss();
    return true;
  };
  return createPortal(
    <Button
      ref={setToolbar}
      type="button"
      size="xs"
      variant="glass"
      disabled={tooLong}
      inert={presence.exiting}
      aria-label={tooLong ? "Selection is too long to annotate" : "Add annotation in composer"}
      data-selection-action=""
      className={cn("fixed max-w-[calc(100vw-1rem)] origin-top-left", expanded ? "z-[70]" : "z-50")}
      style={{ left: shownSelection.position.x, top: shownSelection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onClick={cite}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <QuoteIcon aria-hidden="true" className="size-3.5" />
      {tooLong ? "Shorten selection" : "Add annotation"}
    </Button>,
    document.body,
  );
}
