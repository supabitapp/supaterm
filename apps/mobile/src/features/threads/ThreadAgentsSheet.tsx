import { formatDuration } from "@supaterm/shared/orchestrationTimingCopy";
import { useAtomValue } from "@effect/atom-react";
import {
  deriveWorkflowGroups,
  projectedSubagentsToRuntime,
} from "@supaterm/client-runtime/state/subagentRuntime";
import type { ThreadTurnSubagents } from "@supaterm/client-runtime/state/thread-subagents";
import {
  isOrchestrationV2WorkActive,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@supaterm/contracts";
import { deriveSubagentElapsedMs } from "@supaterm/shared/orchestrationTiming";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as DateTime from "effect/DateTime";
import * as Haptics from "expo-haptics";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SheetHeader } from "../../components/ui/SheetHeader";
import { AppText as Text } from "../../components/ui/AppText";
import { environmentThreadDetails } from "../../state/threads";
import { SubagentRow } from "./SubagentRow";
import { useVisibleSecondClock } from "./use-visible-second-clock";
import { SubagentStopButton } from "./SubagentStopButton";
import { ThreadWorkflowGroup } from "./ThreadWorkflowGroup";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { subagentThreadTarget, type SubagentThreadTarget } from "./threadAgentsPresentation";
import { linkedThreadRouteParams } from "./LinkedThreadSheet";
import { useLinkedThreadReach } from "../../state/linkedThread";

import { useOpenThreadInspector } from "./thread-inspector-navigation";
import { useMessages, useGT, T } from "gt-react-native";

type AgentsTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

function useThreadTurnSubagents(target: AgentsTarget): ThreadTurnSubagents | null {
  return useAtomValue(environmentThreadDetails.turnSubagentsAtom(target));
}

export function ThreadAgentsSheet({ route }: StaticScreenProps<AgentsTarget>) {
  const gt = useGT();
  const target = route.params;
  const navigation = useNavigation();
  const openInspector = useOpenThreadInspector();
  const insets = useSafeAreaInsets();
  const turn = useThreadTurnSubagents(target);
  const subagents = turn?.subagents ?? [];
  const hasLiveAgent = (turn?.liveCount ?? 0) > 0;
  const workflowGroups = useMemo(
    () =>
      new Map(
        deriveWorkflowGroups(projectedSubagentsToRuntime(subagents)).map((group) => [
          group.workflow.id,
          group,
        ]),
      ),
    [subagents],
  );

  const openChildThread = (child: SubagentThreadTarget, title: string | null = null) => {
    void Haptics.selectionAsync();
    if (child.linked !== undefined) {
      navigation.dispatch(
        StackActions.replace("LinkedThread", linkedThreadRouteParams(child, child.linked, title)),
      );
      return;
    }
    if (
      openInspector(target, {
        type: "thread",
        environmentId: child.environmentId,
        threadId: child.threadId,
      })
    )
      return;
    // Replace this leaf sheet so the child enters the workspace stack expected by Home's Back button.
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: child.environmentId,
        threadId: child.threadId,
      }),
    );
  };

  const content = (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      // UIKit must inset content beneath the floating translucent iOS header.
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {subagents.length === 0 ? (
        <Text className="px-5 pt-6 text-center text-sm text-foreground-muted">
          <T>No agents in this turn.</T>
        </Text>
      ) : (
        subagents.map((subagent, index) => {
          const group = workflowGroups.get(subagent.id);
          return group === undefined ? (
            <AgentRow
              key={subagent.id}
              subagent={subagent}
              environmentId={target.environmentId}
              tickSeconds={hasLiveAgent}
              isLast={index === subagents.length - 1}
              onOpen={openChildThread}
            />
          ) : (
            <View key={subagent.id} className="px-5">
              <ThreadWorkflowGroup
                environmentId={target.environmentId}
                subagent={subagent}
                group={group}
                onOpen={(threadId) =>
                  openChildThread({ environmentId: target.environmentId, threadId })
                }
              />
            </View>
          );
        })
      )}
    </ScrollView>
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("Agents")} onClose={() => navigation.goBack()} />
      <ScreenContent>{content}</ScreenContent>
    </View>
  );
}

function AgentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly subagent: OrchestrationV2Subagent;
  readonly tickSeconds: boolean;
  readonly isLast: boolean;
  readonly onOpen: (child: SubagentThreadTarget, title: string | null) => void;
}) {
  const gt = useGT();
  const { subagent } = props;
  const reach = useLinkedThreadReach(props.environmentId, [subagent]);
  const target = subagentThreadTarget(
    subagent,
    props.environmentId,
    reach.ownConnection,
    reach.isLinked,
  );

  const row = (
    <View className="px-5 py-3.5">
      <SubagentRow
        environmentId={props.environmentId}
        subagent={subagent}
        canOpenRemote={target !== null}
        elapsed={<AgentElapsed subagent={subagent} tickSeconds={props.tickSeconds} />}
      />
      {props.isLast ? null : (
        // left-10 is this row's padding plus SubagentRow's status dot and gap,
        // so the rule starts at the text column and the dots sit in a gutter.
        <View className="absolute right-0 bottom-0 left-10 h-px bg-border" />
      )}
    </View>
  );

  const content =
    target === null ? (
      <View
        accessible
        className="min-w-0 flex-1"
        accessibilityHint={
          subagent.remoteChild === undefined
            ? gt("Provider-managed agent. Its work appears in the transcript.")
            : `Runs on ${subagent.remoteChild.label}. Connect to it to open its thread.`
        }
      >
        {row}
      </View>
    ) : (
      <Pressable
        accessibilityRole="link"
        accessibilityHint={
          target.linked === undefined
            ? gt("Opens this agent's thread")
            : `Opens a read-only view of this agent's thread on ${target.linked.label}`
        }
        onPress={() => props.onOpen(target, subagent.title)}
        className="min-w-0 flex-1 active:bg-subtle"
      >
        {row}
      </Pressable>
    );

  return (
    <View className="flex-row items-center">
      {content}
      <SubagentStopButton
        environmentId={props.environmentId}
        subagent={subagent}
        className="mr-3"
      />
    </View>
  );
}

function AgentElapsed(props: {
  readonly subagent: OrchestrationV2Subagent;
  readonly tickSeconds: boolean;
}) {
  const elapsed = useSubagentElapsed(props.subagent, props.tickSeconds);
  return elapsed === null ? null : (
    <Text className="shrink-0 text-xs tabular-nums text-foreground-muted">{elapsed}</Text>
  );
}

function useSubagentElapsed(
  subagent: Pick<OrchestrationV2Subagent, "status" | "startedAt" | "completedAt">,
  tickSeconds: boolean,
): string | null {
  const messages = useMessages();
  const running = isOrchestrationV2WorkActive(subagent.status);
  const nowMs = useVisibleSecondClock(tickSeconds && running);
  const elapsedMs = deriveSubagentElapsedMs(
    {
      status: subagent.status,
      startedAt: subagent.startedAt === null ? null : DateTime.formatIso(subagent.startedAt),
      completedAt: subagent.completedAt === null ? null : DateTime.formatIso(subagent.completedAt),
    },
    nowMs,
  );
  return elapsedMs === null || elapsedMs === 0 ? null : formatDuration(elapsedMs, messages);
}
