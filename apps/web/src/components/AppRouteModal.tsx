import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "@supaterm/icons";
import { useRef, useState, type ReactNode } from "react";

import { useCloseAppModal } from "./sidebar/mainAppLocation";
import { Button } from "./ui/button";
import { DialogBackdrop } from "./ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function isAppRouteModalOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector("[data-app-modal]") !== null;
}

export function AppRouteModal({ label, children }: { label: string; children: ReactNode }) {
  const close = useCloseAppModal();
  const [open, setOpen] = useState(true);
  const backdropPress = useRef(false);
  const popupRef = useRef<HTMLDivElement>(null);

  return (
    <DialogPrimitive.Root
      open={open}
      disablePointerDismissal
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) void close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogBackdrop />
        <DialogPrimitive.Viewport
          className="fixed inset-0 z-50 flex items-center justify-center sm:p-6 lg:p-10"
          onPointerDown={(event) => {
            backdropPress.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            if (backdropPress.current && event.target === event.currentTarget) setOpen(false);
            backdropPress.current = false;
          }}
        >
          <DialogPrimitive.Popup
            ref={popupRef}
            initialFocus={popupRef}
            finalFocus={false}
            aria-label={label}
            data-slot="dialog-popup"
            data-app-modal=""
            className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground outline-none transition-[opacity,scale] duration-150 ease-out [-webkit-app-region:no-drag] data-ending-style:scale-[0.985] data-ending-style:opacity-0 data-starting-style:scale-[0.985] data-starting-style:opacity-0 sm:max-h-[60rem] sm:max-w-[80rem] sm:rounded-2xl sm:border sm:shadow-2xl/40"
          >
            {children}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function AppRouteModalClose() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DialogPrimitive.Close
            aria-label="Close"
            render={<Button size="icon-sm" variant="ghost" />}
          />
        }
      >
        <XIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">Close (Esc)</TooltipPopup>
    </Tooltip>
  );
}
