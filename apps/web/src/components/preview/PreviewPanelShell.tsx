import {
  type FocusEvent,
  type MouseEventHandler,
  use,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { MaximizedContext } from "./PreviewPanelLayout";
import { canReturnFocusTo, workspaceAreaProps } from "../../lib/workspaceFocus";

import { cn } from "~/lib/utils";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

// Prefers the element focus entered the panel from, falling back to the panel toggle.
function returnFocus(host: HTMLElement, origin: HTMLElement | null) {
  const { ownerDocument } = host;
  // focus() is a no-op on a disabled origin, so activeElement says whether it took.
  if (origin?.isConnected && !host.contains(origin) && canReturnFocusTo(origin)) {
    origin.focus({ preventScroll: true });
    if (ownerDocument.activeElement === origin) return true;
  }
  const toggle = ownerDocument.querySelector<HTMLButtonElement>("[data-right-panel-toggle]");
  toggle?.focus();
  return toggle !== null && ownerDocument.activeElement === toggle;
}

/**
 * Frame for the preview panel. Its parent owns the size: a `PreviewPanelInline`
 * in inline mode, the sheet or sidebar otherwise.
 */
export function PreviewPanelShell(props: {
  workspaceArea?: boolean;
  workspaceFocusKey?: string;
  workspaceLabel?: string;
  mode: PreviewPanelMode;
  open?: boolean;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  onMouseUp?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const maximized = use(MaximizedContext);
  const panelArea = workspaceAreaProps("panel", 4, props.workspaceLabel ?? "Workspace panel");
  const hostRef = useRef<HTMLDivElement>(null);
  const returnedFocus = useRef(false);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const lastBlurred = useRef<EventTarget | null>(null);
  const collapsible = props.mode === "inline" && props.open !== undefined;
  const open = props.open ?? true;
  // React focus events also see content that focuses itself while mounting (a terminal does,
  // from a ref that attaches before the host's). Focus moving within the panel, portalled menus
  // included, first blurs an element of it.
  const rememberFocusOrigin = (event: FocusEvent<HTMLDivElement>) => {
    const from = event.relatedTarget;
    if (from === null || from === lastBlurred.current) return;
    focusOrigin.current = from instanceof HTMLElement ? from : null;
  };
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- on unmount, returns DOM focus to where it came from if removal dropped it on the body
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !collapsible) return;
    return () => {
      if (!host.contains(host.ownerDocument.activeElement) && !returnedFocus.current) return;
      const origin = focusOrigin.current;
      queueMicrotask(() => {
        if (host.ownerDocument.activeElement === host.ownerDocument.body) {
          returnFocus(host, origin);
        }
      });
    };
  }, [collapsible]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- moves focus out of the host and sets inert on it before a collapse paints
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const collapsed = collapsible && !open;
    if (!collapsed) returnedFocus.current = false;
    if (collapsed && host.contains(host.ownerDocument.activeElement)) {
      returnedFocus.current = returnFocus(host, focusOrigin.current);
    }
    // An origin belongs to one open; the next one records its own.
    if (collapsed) focusOrigin.current = null;
    host.toggleAttribute("inert", collapsed);
  }, [collapsible, open]);
  return (
    <div
      ref={hostRef}
      onFocus={rememberFocusOrigin}
      onBlur={(event) => {
        lastBlurred.current = event.target;
      }}
      {...(props.workspaceArea ? panelArea : {})}
      data-workspace-focus-key={props.workspaceFocusKey}
      data-workspace-unavailable={collapsible && !open ? "true" : undefined}
      onMouseDown={props.onMouseDown}
      onMouseUp={props.onMouseUp}
      className={cn(
        "relative flex h-full min-h-0 w-full min-w-0 max-w-full flex-col self-stretch bg-background",
        props.mode === "inline" && !maximized && "border-l border-border",
        props.open === false && "pointer-events-none",
      )}
      data-preview-panel-mode={props.mode}
    >
      {props.children}
    </div>
  );
}
