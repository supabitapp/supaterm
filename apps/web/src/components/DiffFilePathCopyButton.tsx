import { formatFilePathForClipboard } from "@supaterm/client-runtime/media-actions";
import { CheckIcon, CopyIcon } from "@supaterm/icons";

import { useRef } from "react";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";
import { ANCHORED_COPY_TOAST_TIMEOUT_MS, showAnchoredCopyErrorToast } from "./ui/anchoredCopyToast";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function DiffFilePathCopyButton({
  filePath,
  workspaceRoot,
}: {
  filePath: string;
  workspaceRoot: string | undefined;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });

  const Icon = isCopied ? CheckIcon : CopyIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Copy file path"
            onClick={() =>
              copyToClipboard(formatFilePathForClipboard(filePath, workspaceRoot), undefined)
            }
          />
        }
      >
        <Icon className={cn("size-3", isCopied && "text-success")} />
      </TooltipTrigger>
      <TooltipPopup>
        <p>{isCopied ? "Copied" : "Copy path"}</p>
      </TooltipPopup>
    </Tooltip>
  );
}
