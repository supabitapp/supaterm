import type { DevicePlatformAvailability } from "@supaterm/contracts";
import { CheckIcon, MinusIcon } from "@supaterm/icons";
import { useGT } from "gt-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

export function DeviceHostAvailability({
  platforms,
}: {
  platforms: ReadonlyArray<DevicePlatformAvailability>;
}) {
  const gt = useGT();
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
            {platform.available
              ? gt("{platform} available", {
                  platform: platform.platform === "ios" ? "iOS" : "Android",
                })
              : gt("{platform} unavailable", {
                  platform: platform.platform === "ios" ? "iOS" : "Android",
                })}
          </TooltipTrigger>
          <TooltipPopup>
            {platform.reason ??
              gt("{platform} available", {
                platform: platform.platform === "ios" ? "iOS" : "Android",
              })}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
