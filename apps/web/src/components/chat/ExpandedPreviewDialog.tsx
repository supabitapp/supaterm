import { PREVIEW_ZOOM, stepPreviewZoom } from "@supaterm/client-runtime/preview-zoom";
import { MinusIcon, PlusIcon, XIcon } from "@supaterm/icons";
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";

import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";

export const ExpandedPreviewHostContext = createContext<((open: boolean) => void) | null>(null);

/** Content that reflows to the card's width and is as tall as it says, so only the card scrolls. */
interface ContentFit {
  readonly heightAtWidth: (layoutWidth: number) => number;
  readonly initialWidth: number;
}

export function ExpandedPreviewDialog(props: {
  readonly title: string;
  readonly fit: ContentFit;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(props.fit.initialWidth);
  const measureBox = (box: HTMLDivElement) => {
    setWidth(box.clientWidth);
    return observeResize(box, ([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
  };
  const height = props.fit.heightAtWidth(width / zoom);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reportOpen = use(ExpandedPreviewHostContext);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- tells the host timeline row the dialog is open so the virtualized list keeps it mounted; clears it on unmount
  useEffect(() => {
    reportOpen?.(true);
    return () => reportOpen?.(false);
  }, [reportOpen]);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="row-start-1"
        initialFocus={closeButtonRef}
      >
        <DialogTitle className="sr-only">Expanded {props.title} preview</DialogTitle>
        <div className="relative w-[min(92vw,1176px)]">
          <Button
            ref={closeButtonRef}
            aria-label="Close"
            size="icon-xs"
            variant="media-close"
            className="absolute right-0 -top-10 z-20"
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
          <div
            tabIndex={0}
            className="max-h-[min(86vh,calc(100vh-160px))] overflow-y-auto overscroll-contain rounded-lg bg-background p-4 shadow-2xl ring-1 ring-border/70 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <div ref={measureBox}>
              <div style={{ zoom, height }}>{props.children}</div>
            </div>
          </div>
          <div className="mt-2 flex min-w-0 items-center justify-center gap-3 text-xs text-white/80">
            <span className="truncate">{props.title}</span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label="Zoom out"
                size="icon-sm"
                variant="overlay"
                disabled={zoom <= PREVIEW_ZOOM.min}
                onClick={() => setZoom((value) => stepPreviewZoom(value, -1))}
              >
                <MinusIcon />
              </Button>
              <Button
                aria-label="Reset zoom"
                size="sm"
                variant="overlay"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </Button>
              <Button
                aria-label="Zoom in"
                size="icon-sm"
                variant="overlay"
                disabled={zoom >= PREVIEW_ZOOM.max}
                onClick={() => setZoom((value) => stepPreviewZoom(value, 1))}
              >
                <PlusIcon />
              </Button>
            </div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
