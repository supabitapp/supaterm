import type { RuntimeMode } from "@supaterm/contracts";
import { ComposerControl } from "./chat/ComposerControl";
import { runtimeModeConfig } from "./chat/runtimeModeConfig";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ComposerContextPermissions({
  runtimeMode,
  shortcutLabel,
  onOpen,
}: {
  runtimeMode: RuntimeMode;
  shortcutLabel: string | null;
  onOpen: () => void;
}) {
  const { icon: Icon, label } = runtimeModeConfig[runtimeMode];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            size="xs"
            className="ms-auto min-w-0 shrink-0"
            aria-label={`Permissions: ${label}`}
            data-composer-context-control
            onClick={onOpen}
          />
        }
      >
        <Icon aria-hidden="true" className="size-3" />
        <ComposerContextLabel>{label}</ComposerContextLabel>
      </TooltipTrigger>
      <TooltipPopup>Permissions{shortcutLabel ? ` · ${shortcutLabel}` : null}</TooltipPopup>
    </Tooltip>
  );
}
