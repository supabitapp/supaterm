import { PREVIEW_ZOOM, stepPreviewZoom } from "@supaterm/client-runtime/preview-zoom";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";

// A virtualized timeline row unmounts once it leaves the draw window, taking an
// open dialog with it; hosts that recycle rows pin the row while this reports open.
export const ExpandedPreviewHostContext = createContext<((open: boolean) => void) | null>(null);

const FIT_CLASS_NAMES = {
  fill: "h-[100cqh] w-[100cqw]",
  center: "p-6",
} as const;

export function ExpandedPreviewDialog(props: {
  readonly title: string;
  readonly fit: keyof typeof FIT_CLASS_NAMES;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const [zoom, setZoom] = useState(1);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reportOpen = use(ExpandedPreviewHostContext);
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
        <div className="relative w-[92vw]">
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
            className="grid h-[min(86vh,calc(100vh-160px))] place-items-center-safe overflow-auto overscroll-contain rounded-lg bg-background shadow-2xl ring-1 ring-border/70 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [container-type:size]"
          >
            <div className={FIT_CLASS_NAMES[props.fit]} style={{ zoom }}>
              {props.children}
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
