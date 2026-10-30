import type { TurnItemSource } from "./timelineRowContext";
import type { CommandOutputView } from "@supaterm/client-runtime/state/command-output";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  ThreadId,
  TurnItemId,
} from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  commandOutputUnavailable,
  NO_COMMAND_OUTPUT,
} from "@supaterm/client-runtime/state/command-output";
import { TERMINAL_PALETTES, terminalOutputSpans } from "@supaterm/shared/terminalOutput";
import { useLayoutEffect, useRef } from "react";

import { useTheme } from "../../hooks/useTheme";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";

// Within this many pixels of the end still counts as following the output.
const FOLLOW_SLACK_PX = 8;

/**
 * True for a command row whose output streams from the server. Older servers
 * reject the subscription, and their rows show the fetched item's output.
 */
export function useCommandOutputStreaming(
  environmentId: EnvironmentId,
  projectedItem: OrchestrationV2ProjectedTurnItem,
  source?: TurnItemSource,
): boolean {
  const isCommand = projectedItem.item.type === "command_execution";
  // Shares the panel's subscription, and re-renders only when availability changes.
  const unavailable = useAtomValue(
    isCommand && source
      ? source.commandOutput({
          threadId: projectedItem.sourceThreadId,
          itemId: projectedItem.sourceItemId,
        })
      : isCommand
        ? orchestrationEnvironment.v2.commandOutput({
            environmentId,
            input: { threadId: projectedItem.sourceThreadId, itemId: projectedItem.sourceItemId },
          })
        : NO_COMMAND_OUTPUT,
    commandOutputUnavailable,
  );
  return isCommand && !unavailable;
}

/**
 * Output of one expanded command row: streams while the command runs, then
 * shows its final output. Mount it only when `useCommandOutputStreaming` holds.
 * It subscribes only while mounted, so collapsed rows and other threads receive nothing.
 */
export function CommandOutputPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly source?: TurnItemSource["commandOutput"] | undefined;
}) {
  const input = { threadId: props.threadId, itemId: props.itemId };
  const { data, error } = useEnvironmentQuery<CommandOutputView, unknown>(
    props.source
      ? props.source(input)
      : orchestrationEnvironment.v2.commandOutput({ environmentId: props.environmentId, input }),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new output until the reader scrolls up; scrolling back down resumes.
  const followRef = useRef(true);
  const text = data?.output.text ?? "";
  const { resolvedTheme } = useTheme();

  // This panel only re-renders when its output changes, so keep the end in view after each.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  });

  if (text.length === 0) {
    if (error) return <div className="text-destructive">Couldn&apos;t load output: {error}</div>;
    if (data === null) return <div className="text-muted-foreground italic">Loading output…</div>;
    return data.running ? null : <div className="text-muted-foreground italic">No output.</div>;
  }
  // Parsed after the layout effect, the last hook, so the compiler caches it on text and theme.
  const spans = terminalOutputSpans(text, TERMINAL_PALETTES[resolvedTheme]);
  return (
    <div>
      {data?.output.truncated ? (
        <div className="text-muted-foreground italic">Earlier output not shown</div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX;
        }}
        className="max-h-80 overflow-auto text-muted-foreground"
      >
        {spans.map((span, index) =>
          span.style === null ? (
            span.text
          ) : (
            // Spans are rebuilt from scratch on every update and never reorder.
            // oxlint-disable-next-line react/no-array-index-key
            <span key={index} style={span.style}>
              {span.text}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
