import { formatResetsIn } from "@supaterm/shared/usageLimitsCopy";
import { T, useGT, useMessages, Var } from "gt-react";
import type { ServerProviderUsageWindow } from "@supaterm/contracts";
import { type headlineUsageWindows, remainingPercent } from "@supaterm/shared/usageLimits";
import { memo } from "react";

import { useNowMinuteMs } from "../../hooks/useNowMinute";
import { usePrimarySettings } from "../../hooks/useSettings";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usageFillColor } from "./ContextWindow.logic";

export const ComposerUsageMeter = memo(function ComposerUsageMeter({
  windows,
}: {
  readonly windows: ReturnType<typeof headlineUsageWindows>;
}) {
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 px-1 text-xs tabular-nums group-has-data-[chat-composer-resting]/composer-surface:hidden group-data-model-strip-transition/composer-surface:invisible">
      {windows.map(({ label, window }) => (
        <UsageWindowMeter key={window.id} label={label} window={window} />
      ))}
    </div>
  );
});

function UsageWindowMeter({
  label,
  window,
}: {
  readonly label: string;
  readonly window: ServerProviderUsageWindow;
}) {
  const gt = useGT();
  const remaining = remainingPercent(window);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="meter"
            aria-label={window.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={remaining}
            aria-valuetext={gt("{remaining}% left", { remaining })}
            className="flex cursor-default items-center gap-1.5"
          />
        }
      >
        <span className="text-muted-foreground/70">{label}</span>
        <span aria-hidden className="h-1 w-8 overflow-hidden rounded-full bg-muted-foreground/24">
          <span
            className="block h-full rounded-full transition-[translate,background-color] duration-500 ease-out motion-reduce:transition-none"
            style={{
              translate: `${remaining - 100}% 0`,
              backgroundColor: usageFillColor(100 - remaining),
            }}
          />
        </span>
        <span className="text-muted-foreground">{gt("{remaining}% left", { remaining })}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">
            {gt("{label}: {remaining}% left", { label: window.label, remaining })}
          </span>
          {window.resetsAt ? <WindowReset window={window} resetsAt={window.resetsAt} /> : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

function WindowReset({
  window,
  resetsAt,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly resetsAt: string;
}) {
  const messages = useMessages();
  const now = useNowMinuteMs();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const resetsIn = formatResetsIn(window, now, messages);
  return (
    <span className="text-muted-foreground">
      <T>
        Resets <Var>{formatUpcomingTimestamp(resetsAt, timestampFormat, now)}</Var>
      </T>
      {resetsIn ? ` · ${resetsIn}` : ""}
    </span>
  );
}
