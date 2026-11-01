import { CheckIcon, CopyIcon } from "@supaterm/icons";
import { memo, useRef } from "react";

import { Button } from "../ui/button";
import { cn } from "~/lib/utils";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "../ui/anchoredCopyToast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const MessageCopyButton = memo(function MessageCopyButton({
  text,
  label = "Copy message",
  icon = CopyIcon,
  extraFlavors,
  size = "xs",
  variant = "outline",
  className,
}: {
  text: string;
  label?: string;
  icon?: typeof CopyIcon;
  extraFlavors?: Readonly<Record<string, string>>;
  size?: "xs" | "icon-xs";
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error: Error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
    ...(extraFlavors ? { extraFlavors } : {}),
  });

  const Icon = isCopied ? CheckIcon : icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            onClick={() => {
              if (!isCopied) copyToClipboard(text);
            }}
            ref={ref}
            type="button"
            size={size}
            variant={variant === "ghost" ? "ghost-muted" : variant}
            className={className}
          />
        }
      >
        <Icon className={cn("size-3", isCopied && "text-primary")} />
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
});
