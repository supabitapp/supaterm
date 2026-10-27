import { ShrinkIcon } from "@supaterm/icons";

import {
  type ContextWindowSnapshot,
  formatContextWindowPercentage,
  formatContextWindowTokens,
} from "~/lib/contextWindow";
import { Button } from "../ui/button";
import {
  formatContextWindowCompactionMessage,
  formatContextWindowCost,
  usageFillColor,
} from "./ContextWindow.logic";

export function ContextWindowDetails(props: {
  usage: ContextWindowSnapshot;
  modelDisplayName?: string | null;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}) {
  const { usage, modelDisplayName, onCompact, compactDisabled, compactDisabledReason } = props;
  const usedPercentage = formatContextWindowPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const totalProcessedTokens = usage.totalProcessedTokens ?? null;
  const showTotalProcessed = totalProcessedTokens !== null && totalProcessedTokens > 0;
  const usageColor = usageFillColor(normalizedPercentage);

  return (
    <div className="flex flex-col gap-2 p-(--floating-content-inset)">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-muted-foreground text-xs">Context Window</div>
        {usage.maxTokens !== null && usedPercentage ? (
          <div className="text-secondary-label text-2xs tabular-nums">
            <span>{usedPercentage}</span>
            <span className="mx-1">·</span>
            <span>
              {formatContextWindowTokens(usage.usedTokens)}/
              {formatContextWindowTokens(usage.maxTokens ?? null)}
            </span>
          </div>
        ) : (
          <div className="text-secondary-label text-2xs tabular-nums">
            {formatContextWindowTokens(usage.usedTokens)}
          </div>
        )}
      </div>
      {usage.maxTokens !== null ? (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(normalizedPercentage)}
          aria-label="Context window usage"
        >
          <div
            className="h-full rounded-full transition-[translate,background-color] duration-500 ease-out motion-reduce:transition-none"
            style={{
              translate: `${normalizedPercentage - 100}% 0`,
              backgroundColor: usageColor,
            }}
          />
        </div>
      ) : null}
      {showTotalProcessed ? (
        <div className="flex items-center justify-between gap-3 text-2xs leading-4">
          <span className="text-secondary-label">Total processed</span>
          <span className="font-medium tabular-nums text-secondary-label">
            {formatContextWindowTokens(totalProcessedTokens)}
          </span>
        </div>
      ) : null}
      {usage.cost != null ? (
        <div className="flex items-center justify-between gap-3 text-2xs leading-4">
          <span className="text-secondary-label">Cost</span>
          <span className="font-medium tabular-nums text-secondary-label">
            {formatContextWindowCost(usage.cost)}
          </span>
        </div>
      ) : null}
      {usage.compactsAutomatically ? (
        <div className="mt-1 text-pretty text-secondary-label text-2xs font-medium">
          {formatContextWindowCompactionMessage(modelDisplayName, usage.autoCompactThreshold)}
        </div>
      ) : null}
      {onCompact ? (
        <>
          <Button
            size="xs"
            variant="outline"
            className="mt-1 w-full justify-center"
            disabled={compactDisabled}
            onClick={onCompact}
          >
            <ShrinkIcon aria-hidden="true" />
            Compact context
          </Button>
          {compactDisabled && compactDisabledReason ? (
            <div className="text-pretty text-secondary-label text-2xs">{compactDisabledReason}</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
