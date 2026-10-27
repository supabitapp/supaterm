import type { DevicePlatformAvailability } from "@supaterm/contracts";
import { CheckIcon, MinusIcon } from "@supaterm/icons";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

export function DeviceHostAvailability({
  platforms,
}: {
  platforms: ReadonlyArray<DevicePlatformAvailability>;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {platforms.map((platform) => (
        <Tooltip key={platform.platform}>
          <TooltipTrigger render={<span tabIndex={0} className="inline-flex items-center gap-1" />}>
            {platform.available ? (
              <CheckIcon className="size-3" />
            ) : (
              <MinusIcon className="size-3" />
            )}
            {platform.platform === "ios" ? "iOS" : "Android"}{" "}
            {platform.available ? "available" : "unavailable"}
          </TooltipTrigger>
          <TooltipPopup>
            {platform.reason ??
              (platform.platform === "ios" ? "iOS available" : "Android available")}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
