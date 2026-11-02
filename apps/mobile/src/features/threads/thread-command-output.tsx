import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  commandOutputUnavailable,
  type CommandOutputView,
  NO_COMMAND_OUTPUT,
} from "@supaterm/client-runtime/state/command-output";
import type { AsyncResult, Atom } from "effect/reactivity";
import { TERMINAL_PALETTES, terminalOutputSpans } from "@supaterm/shared/terminalOutput";
import type React from "react";
import { useMemo, useRef } from "react";
import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";

// Within this many points of the end still counts as following the output.
const FOLLOW_SLACK = 8;

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
export function ThreadCommandOutput(props: {
  readonly output: Atom.Atom<AsyncResult.AsyncResult<CommandOutputView, unknown>>;
  /** Shown while the command runs without output; rows whose header says it runs omit it. */
  readonly waitingLabel?: string;
  readonly themeAppearance: "light" | "dark";
}) {
  const { data, error } = useEnvironmentQuery(props.output);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  // Follow new output until the reader scrolls up; scrolling back down resumes.
  const followRef = useRef(true);
  const text = data?.output.text ?? "";
  const spans = useMemo(
    () => terminalOutputSpans(text, TERMINAL_PALETTES[props.themeAppearance]),
    [text, props.themeAppearance],
  );
  if (text.length === 0) {
    const message = error
      ? `Couldn't load output: ${error}`
      : data === null
        ? "Loading output…"
        : data.running
          ? (props.waitingLabel ?? null)
          : "No output.";
    return message === null ? null : (
      <Text className="pt-1.5 font-mono text-2xs leading-normal text-foreground-muted">
        {message}
      </Text>
    );
  }
  return (
    <View className="pt-1.5">
      {data?.output.truncated ? (
        <Text className="pb-0.5 text-3xs text-foreground-subtle">Earlier output not shown</Text>
      ) : null}
      <ScrollView
        ref={scrollRef}
        nestedScrollEnabled
        directionalLockEnabled
        showsVerticalScrollIndicator
        className="max-h-60"
        contentContainerStyle={{ paddingRight: 8 }}
        scrollEventThrottle={100}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          followRef.current =
            contentSize.height - contentOffset.y - layoutMeasurement.height <= FOLLOW_SLACK;
        }}
        onContentSizeChange={() => {
          if (followRef.current) scrollRef.current?.scrollToEnd({ animated: false });
        }}
      >
        <Text selectable className="font-mono text-2xs leading-normal text-foreground-muted">
          {spans.map((span, index) =>
            span.style === null ? (
              span.text
            ) : (
              // Spans are rebuilt from scratch on every update and never reorder.
              // oxlint-disable-next-line react/no-array-index-key
              <Text key={index} style={span.style}>
                {span.text}
              </Text>
            ),
          )}
        </Text>
      </ScrollView>
    </View>
  );
}
