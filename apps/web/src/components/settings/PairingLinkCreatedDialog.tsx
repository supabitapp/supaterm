import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { CheckIcon, CopyIcon } from "@supaterm/icons";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { QRCodeSvg } from "../ui/qr-code";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import type { resolvePairingShareValue } from "./pairingUrls";
import { type RefObject, useEffect, useRef } from "react";

export function PairingLinkCreatedDialog({
  result,
  connected,
  onClose,
  finalFocus,
}: {
  readonly result: ReturnType<typeof resolvePairingShareValue> | null;
  readonly connected: boolean;
  readonly onClose: () => void;
  readonly finalFocus: RefObject<HTMLButtonElement | null>;
}) {
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  const notifiedRef = useRef(false);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- closes the pairing dialog and reports the externally observed device connection
  useEffect(() => {
    if (!result || !connected || notifiedRef.current) return;
    notifiedRef.current = true;
    onClose();
    toastManager.add({ type: "success", title: "Device connected successfully" });
  }, [connected, onClose, result]);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "pairing link or code",
    onError: () =>
      toastManager.add({
        type: "error",
        title: "Could not copy",
        description: "Select and copy the value shown above.",
      }),
  });
  const isLink = result?.kind === "link";
  const copyLabel = isLink ? "Copy link" : "Copy code";
  const valueLabel = isLink ? "Pairing link" : "Pairing code";

  return (
    <Dialog
      open={result !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-md" finalFocus={finalFocus} initialFocus={copyButtonRef}>
        <DialogHeader>
          <DialogTitle>
            {isLink ? "Your pairing link is ready" : "Your pairing code is ready"}
          </DialogTitle>
          <DialogDescription>
            {result?.qrShareable
              ? "Scan the QR code or open the link on your other device to connect."
              : "Use this one-time link or code on a device that can reach this environment."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {result?.qrShareable ? (
            <figure className="flex flex-col items-center gap-3 py-2">
              <div className="pointer-events-none size-56 shrink-0 select-none rounded-xl bg-white p-4">
                <QRCodeSvg
                  value={result.value}
                  size={192}
                  level="M"
                  marginSize={2}
                  title="Pairing link QR code"
                />
              </div>
              <figcaption className="text-center text-xs text-muted-foreground">
                Scan with the camera on your other device.
              </figcaption>
            </figure>
          ) : null}
          <label className="block space-y-2">
            <span className="block text-xs font-medium">
              {result?.qrShareable ? "Or copy the pairing link" : valueLabel}
            </span>
            <Textarea
              aria-label={valueLabel}
              readOnly
              value={result?.value ?? ""}
              rows={3}
              font="mono"
              autoGrow={false}
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            This link or code works once. Create a new one for each device.
          </p>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button size="comfortable" variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button
            ref={copyButtonRef}
            size="comfortable"
            className="w-full sm:w-36"
            onClick={() => {
              if (result) copyToClipboard(result.value, undefined);
            }}
          >
            {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            <span aria-live="polite">{isCopied ? "Copied" : copyLabel}</span>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
