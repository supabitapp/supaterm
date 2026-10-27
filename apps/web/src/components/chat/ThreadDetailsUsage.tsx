import { CircleGaugeIcon, DollarSignIcon } from "@supaterm/icons";
import type { ComponentProps, ReactNode } from "react";

import { formatContextWindowPercentage, formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { formatContextWindowCost, usageFillColor } from "./ContextWindow.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ContextWindowDetails } from "./ContextWindowDetails";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS,
  THREAD_DETAILS_PANEL_ROW_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadDetailsUsage({
  contextWindow,
  children,
}: {
  contextWindow: ComponentProps<typeof ContextWindowDetails> | null;
  children?: ReactNode;
}) {
  const usage = contextWindow?.usage;
  if (!usage && !children) return null;

  const percentage = formatContextWindowPercentage(usage?.usedPercentage ?? null);
  const usedPercentage = Math.max(0, Math.min(100, usage?.usedPercentage ?? 0));
  const cost = usage?.cost ? formatContextWindowCost(usage.cost) : null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title="Usage"
      showHeading={false}
    >
      {contextWindow && usage ? (
        <dl className="m-0">
          <Popover>
            <PopoverTrigger
              nativeButton={false}
              openOnHover
              delay={150}
              closeDelay={contextWindow.onCompact ? 150 : 0}
              render={
                <div
                  className={cn(
                    THREAD_DETAILS_PANEL_ROW_CLASS,
                    "flex items-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-muted-foreground/50",
                  )}
                >
                  <CircleGaugeIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                  <dt className="min-w-0 flex-1 truncate">Context used</dt>
                  <dd
                    className={cn(
                      "m-0 flex shrink-0 items-center gap-2 font-normal text-muted-foreground tabular-nums",
                      (usage.usedPercentage ?? 0) > 90 && "text-error",
                    )}
                  >
                    {percentage !== null ? (
                      <span
                        aria-hidden
                        className="h-1 w-8 overflow-hidden rounded-full bg-muted-foreground/24"
                      >
                        <span
                          className="block h-full rounded-full"
                          style={{
                            translate: `${usedPercentage - 100}% 0`,
                            backgroundColor: usageFillColor(usedPercentage),
                          }}
                        />
                      </span>
                    ) : null}
                    <span className="min-w-10 text-right pointer-coarse:min-w-11">
                      {percentage ?? `${formatContextWindowTokens(usage.usedTokens)} tokens`}
                    </span>
                  </dd>
                </div>
              }
            />
            <PopoverPopup
              tooltipStyle
              side="left"
              align="start"
              padding="none"
              width="sm"
              className="text-left whitespace-normal"
            >
              <ContextWindowDetails {...contextWindow} />
            </PopoverPopup>
          </Popover>
          {cost !== null ? (
            <div className={cn(THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS, "flex items-center")}>
              <DollarSignIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
              <dt className="min-w-0 flex-1 truncate">Estimated cost</dt>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <dd
                      tabIndex={0}
                      className="m-0 flex h-7 min-w-10 max-w-1/2 shrink-0 items-center justify-end rounded-sm font-normal text-muted-foreground tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-muted-foreground/50 pointer-coarse:h-11 pointer-coarse:min-w-11"
                    />
                  }
                >
                  <span className="truncate">{cost}</span>
                </TooltipTrigger>
                <TooltipPopup side="left">{cost}</TooltipPopup>
              </Tooltip>
            </div>
          ) : null}
        </dl>
      ) : null}
      {children}
    </ThreadDetailsSection>
  );
}
