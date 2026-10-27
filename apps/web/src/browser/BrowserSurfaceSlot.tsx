import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface } from "./browserSurfaceStore";
import { observeResize } from "../lib/observeResize";
import { usePaneLayoutVersion } from "../chatPanes/paneScope";

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    zIndex = 30,
    className,
    fitSourceContent = false,
  } = props;
  // A pane moving to another spot in a split can keep its size, which no resize observer reports.
  const paneLayoutVersion = usePaneLayoutVersion();
  const layoutVersion = `${props.layoutVersion ?? ""}:${paneLayoutVersion ?? ""}`;
  const presentationRef = useRef({ visible, cornerRadius, zIndex, layoutVersion });
  const updateRef = useRef<(() => void) | null>(null);

  // The lease lives as long as this element for one tab, so the ref callback owns it.
  const attachSurface = (element: HTMLDivElement) => {
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    const update = () => {
      const rect = element.getBoundingClientRect();
      const presentation = presentationRef.current;
      const presented = lease.present(
        {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        },
        presentation.visible && rect.width > 0 && rect.height > 0,
        presentation.cornerRadius,
        presentation.zIndex,
      );
      if (presentation.visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(
          {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          },
          rect.width > 0 && rect.height > 0,
          presentation.cornerRadius,
          presentation.zIndex,
        );
      }
    };
    updateRef.current = update;
    update();
    const observed: Element[] = [element];
    // Collapsible panels animate their outer width while keeping the content at
    // full width. The slot moves without resizing, so measure on panel resizes too.
    const panel = element.closest("[data-panel]");
    if (panel) observed.push(panel);

    observed.push(...document.querySelectorAll("[data-sidebar-panel]"));
    const stopObserving = observeResize(observed, update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      stopObserving();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  };

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- pushes visibility, radius and stacking to the desktop browser surface after layout
  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius, zIndex, layoutVersion };
    updateRef.current?.();
  }, [cornerRadius, layoutVersion, visible, zIndex]);

  return <div ref={attachSurface} className={className} data-browser-surface-slot={tabId} />;
}
