import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import type { EnvironmentId } from "@supaterm/contracts";
import { withOccurrenceKeys } from "@supaterm/shared/occurrenceKeys";
import { isJavaScriptReplTool } from "@supaterm/shared/toolActivity";
import {
  toolCallLines,
  turnItemOutputImages,
  turnItemOutputText,
} from "@supaterm/client-runtime/work-log/item-detail";
import {
  toolGroupAction,
  workEntryViewedImagePath,
} from "@supaterm/client-runtime/work-log/presentation";

import { AppText as Text } from "../../components/ui/AppText";
import type { FilePreviewSource } from "../../components/FilePreviewModal";
import type { MarkdownImageRenderer } from "../../native/SelectableMarkdownText";
import { cn } from "../../lib/cn";
import { formatItemFullDetail, type ThreadFeedActivity } from "../../lib/threadActivity";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useTurnItemDetail } from "../../state/queries";
import { useMarkdownCodeHighlight } from "./markdownCodeHighlightState";
import { QuestionAnswerHistory } from "./QuestionAnswerHistory";
import { ThreadCommandOutput, useCommandOutputStreaming } from "./thread-command-output";
import { ThreadMarkdownImage } from "./ThreadMarkdownImage";

function ReplCodeText({
  code,
  theme,
}: {
  readonly code: string;
  readonly theme: "light" | "dark";
}) {
  const lines = useMarkdownCodeHighlight({ code, language: "typescript", theme, enabled: true });
  let offset = 0;
  const highlighted = lines?.flatMap((line, lineIndex) => {
    const separator = lineIndex > 0 ? "\n" : "";
    offset += separator.length;
    return [
      separator,
      ...line.map((token) => {
        const start = offset;
        offset += token.content.length;
        return (
          <Text key={start} style={token.color ? { color: token.color } : undefined}>
            {token.content}
          </Text>
        );
      }),
    ];
  });
  return (
    <Text selectable className="font-mono text-2xs leading-normal text-foreground">
      {highlighted ?? code}
    </Text>
  );
}

/** Mounted by MotionPresence, so fetched output survives a closing or reversed fade. */
export function ThreadWorkLogDetail(props: {
  readonly row: ThreadFeedActivity;
  readonly environmentId: EnvironmentId;
  readonly renderImage: MarkdownImageRenderer;
  readonly renderReasoning: (text: string) => ReactNode;
  readonly onPressPreview: (source: FilePreviewSource) => void;
  readonly themeAppearance: "light" | "dark";
}) {
  const { row } = props;
  // Command rows stream their output, including the final output, from the server.
  const streamsOutput = useCommandOutputStreaming(props.environmentId, row.projectedItem);
  const fetchedDetail = useTurnItemDetail(
    row.fetchesDetail && !streamsOutput
      ? { environmentId: props.environmentId, row: row.projectedItem }
      : null,
  );
  const reasoning = row.projectedItem.item.type === "reasoning" ? row.projectedItem.item : null;
  const fetchedItem = fetchedDetail.data?.item ?? null;
  // Reads keep their path list; the fetched file contents show as output.
  const isRead = toolGroupAction(row.workEntry) === "read";
  // Tool calls show the call in the foreground and the result muted below it.
  const shownItem = fetchedItem ?? row.projectedItem.item;
  const call =
    !isRead && shownItem.type === "command_execution"
      ? toolCallLines({ command: shownItem.input })
      : !isRead && shownItem.type === "dynamic_tool"
        ? toolCallLines({ args: shownItem.input })
        : shownItem.type === "file_search"
          ? toolCallLines({ args: { pattern: shownItem.pattern } })
          : shownItem.type === "web_search"
            ? toolCallLines({ args: { query: shownItem.patterns?.join(", ") } })
            : null;
  const highlightsCode =
    shownItem.type === "dynamic_tool" && isJavaScriptReplTool(shownItem.toolName);
  const failedExitCode =
    call && shownItem.type === "command_execution" && shownItem.exitCode
      ? shownItem.exitCode
      : null;
  const fullDetail =
    !reasoning && !call
      ? fetchedItem && !isRead
        ? formatItemFullDetail(row.projectedItem, fetchedItem)
        : row.getFullDetail()
      : null;
  const outputImages = fetchedItem ? turnItemOutputImages(fetchedItem) : [];
  const viewedImagePath = workEntryViewedImagePath(row.workEntry);
  const fetchedOutput = streamsOutput
    ? null
    : shownItem.type === "file_search" || shownItem.type === "web_search"
      ? turnItemOutputText(shownItem)
      : fetchedItem
        ? (turnItemOutputText(fetchedItem) ??
          (outputImages.length > 0 || viewedImagePath ? null : "No output."))
        : fetchedDetail.error
          ? `Couldn't load output: ${fetchedDetail.error}`
          : row.fetchesDetail
            ? fetchedDetail.data
              ? "Output is no longer available."
              : "Loading output…"
            : null;
  const exitLine =
    failedExitCode === null ? null : (
      <Text className="mt-1.5 font-mono text-2xs leading-normal text-danger-foreground">
        exit {failedExitCode}
      </Text>
    );
  return (
    <View className={reasoning ? "ml-7 py-1" : "pb-1 pt-0.5"}>
      {row.workEntry.questionAnswer ? (
        <QuestionAnswerHistory
          environmentId={props.environmentId}
          answer={row.workEntry.questionAnswer}
        />
      ) : null}
      {viewedImagePath ? (
        <View className="pb-1.5">
          {props.renderImage({ href: viewedImagePath, alt: null, title: null })}
        </View>
      ) : null}
      {outputImages.map((resource) => (
        <View key={resource.index} className="pb-1.5">
          <ThreadMarkdownImage
            environmentId={props.environmentId}
            resource={resource}
            alt={null}
            onPressPreview={props.onPressPreview}
          />
        </View>
      ))}
      <ScrollView
        nestedScrollEnabled
        directionalLockEnabled
        showsVerticalScrollIndicator
        className="max-h-60"
        contentContainerStyle={{ paddingRight: 8 }}
      >
        {reasoning ? (
          props.renderReasoning(reasoning.text)
        ) : call ? (
          withOccurrenceKeys(
            [
              call.command,
              ...(call.args ?? []).map(([key, value]) =>
                key === "code" && highlightsCode ? { code: value } : `${key} ${value}`,
              ),
              call.argsText,
            ].flatMap((line) => (line ? [line] : [])),
            (line) => (typeof line === "string" ? line : `code ${line.code}`),
          ).map(({ item: line, key }) =>
            typeof line === "string" ? (
              <Text
                key={key}
                selectable
                className="font-mono text-2xs leading-normal text-foreground"
              >
                {line}
              </Text>
            ) : (
              <View key={key}>
                <Text className="font-mono text-2xs leading-normal text-foreground-muted">
                  code
                </Text>
                <ReplCodeText code={line.code} theme={props.themeAppearance} />
              </View>
            ),
          )
        ) : fullDetail ? (
          <Text selectable className="font-mono text-2xs leading-normal text-foreground-muted">
            {fullDetail}
          </Text>
        ) : null}
        {fetchedOutput ? (
          <Text
            selectable
            className={cn(
              "font-mono text-2xs leading-normal text-foreground-muted",
              (!call || call.command || call.args || call.argsText) && "mt-1.5",
            )}
          >
            {fetchedOutput}
          </Text>
        ) : null}
        {streamsOutput ? null : exitLine}
      </ScrollView>
      {streamsOutput ? (
        <>
          <ThreadCommandOutput
            output={orchestrationEnvironment.v2.commandOutput({
              environmentId: props.environmentId,
              input: {
                threadId: row.projectedItem.sourceThreadId,
                itemId: row.projectedItem.sourceItemId,
              },
            })}
            themeAppearance={props.themeAppearance}
          />
          {exitLine}
        </>
      ) : null}
    </View>
  );
}
