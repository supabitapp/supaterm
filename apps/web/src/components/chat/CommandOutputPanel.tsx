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
import { useInitialOutputReady } from "./timelineRowContext";

const FOLLOW_SLACK_PX = 8;

/**
 * True for a command row whose output streams from the server. Older servers
 * reject the subscription, and their rows show the fetched item's output.
 */
export function useCommandOutputStreaming(
  environmentId: EnvironmentId,
  projectedItem: OrchestrationV2ProjectedTurnItem,
) {
  const isCommand = projectedItem.item.type === "command_execution";
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
  readonly onInitialOutputReady?: (() => void) | undefined;
}) {
  const { data, error } = useEnvironmentQuery(props.output);
  useInitialOutputReady(data === null && !error, props.onInitialOutputReady);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const text = data?.output.text ?? "";
  const { resolvedTheme } = useTheme();

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
  const spans = terminalOutputSpans(text, TERMINAL_PALETTES[resolvedTheme]);
  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX;
        }}
        className="max-h-80 min-h-0 flex-auto overflow-auto text-muted-foreground"
      >
        {data?.output.truncated ? <div className="italic">Earlier output not shown</div> : null}
        {spans.map((span, index) =>
          span.style === null ? (
            span.text
          ) : (
            // oxlint-disable-next-line react/no-array-index-key -- Spans are rebuilt from scratch on every update and never reorder.
            <span key={index} style={span.style}>
              {span.text}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
