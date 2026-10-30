import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { use, useLayoutEffect, useRef, type ReactNode } from "react";
import { MaximizedContext } from "./PreviewPanelLayout";

import { cn } from "~/lib/utils";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

/**
 * Frame for the preview panel. Its parent owns the size: a `PreviewPanelInline`
 * in inline mode, the sheet or sidebar otherwise.
 */
export function PreviewPanelShell(props: {
  mode: PreviewPanelMode;
  workspaceArea?: boolean;
  workspaceFocusKey?: string;
  workspaceLabel?: string;
  open?: boolean;
  children: ReactNode;
}) {
  const maximized = use(MaximizedContext);
  const hostRef = useRef<HTMLDivElement>(null);
  const returnedFocus = useRef(false);
  const collapsible = props.mode === "inline" && props.open !== undefined;
  const open = props.open ?? true;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- restores panel focus when the mounted inline host is removed
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !collapsible) return;
    return () => {
      if (!host.contains(host.ownerDocument.activeElement) && !returnedFocus.current) return;
      queueMicrotask(() => {
        if (host.ownerDocument.activeElement === host.ownerDocument.body) {
          (host.closest("[data-chat-pane]") ?? host.ownerDocument)
            .querySelector<HTMLButtonElement>("[data-right-panel-toggle]")
            ?.focus();
        }
      });
    };
  }, [collapsible]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- synchronizes the mounted panel inert state and focus as visibility changes
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const collapsed = collapsible && !open;
    if (!collapsed) returnedFocus.current = false;
    if (collapsed && host.contains(host.ownerDocument.activeElement)) {
      const toggle = (
        host.closest("[data-chat-pane]") ?? host.ownerDocument
      ).querySelector<HTMLButtonElement>("[data-right-panel-toggle]");
      toggle?.focus();
      returnedFocus.current = toggle !== null && host.ownerDocument.activeElement === toggle;
    }
    host.toggleAttribute("inert", collapsed);
  }, [collapsible, open]);
  return (
    <div
      ref={hostRef}
      {...(props.workspaceArea
        ? workspaceAreaProps("panel", 4, props.workspaceLabel ?? "Workspace panel")
        : {})}
      data-workspace-focus-key={props.workspaceFocusKey}
      data-workspace-unavailable={collapsible && !open ? "true" : undefined}
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
