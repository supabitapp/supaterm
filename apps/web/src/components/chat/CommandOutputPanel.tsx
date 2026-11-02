import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  commandOutputUnavailable,
  type CommandOutputView,
  NO_COMMAND_OUTPUT,
} from "@supaterm/client-runtime/state/command-output";
import type { AsyncResult, Atom } from "effect/reactivity";
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
): boolean {
  const isCommand = projectedItem.item.type === "command_execution";
  // Shares the panel's subscription, and re-renders only when availability changes.
  const unavailable = useAtomValue(
    isCommand
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
 * Output of one command: streams while it runs, then shows its final output. For a timeline
 * row, mount it only when `useCommandOutputStreaming` holds. It subscribes only while mounted,
 * so collapsed rows and other threads receive nothing.
 */
export function CommandOutputPanel(props: {
  readonly output: Atom.Atom<AsyncResult.AsyncResult<CommandOutputView, unknown>>;
  /** Shown while the command runs without output; rows whose header says it runs omit it. */
  readonly waitingLabel?: string;
}) {
  const { data, error } = useEnvironmentQuery(props.output);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new output until the reader scrolls up; scrolling back down resumes.
  const followRef = useRef(true);
  const text = data?.output.text ?? "";
  const { resolvedTheme } = useTheme();

  // This panel only re-renders when its output changes, so keep the end in view after each.
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- pins the output scroller's scrollTop to the bottom after each commit while the user follows
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  });

  if (text.length === 0) {
    if (error) return <div className="text-destructive">Couldn&apos;t load output: {error}</div>;
    if (data === null) return <div className="text-muted-foreground italic">Loading output…</div>;
    const label = data.running ? props.waitingLabel : "No output.";
    return label === undefined ? null : <div className="text-muted-foreground italic">{label}</div>;
  }
  // Parsed after the layout effect, the last hook, so the compiler caches it on text and theme.
  const spans = terminalOutputSpans(text, TERMINAL_PALETTES[resolvedTheme]);
  // Fills a parent with a fixed height, and sizes to its output up to max-h-80 otherwise.
  return (
    <div className="flex h-full flex-col">
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
        className="max-h-80 min-h-0 flex-auto overflow-auto text-muted-foreground"
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
