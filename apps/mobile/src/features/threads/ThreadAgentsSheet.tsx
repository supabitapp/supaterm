import { useAtomValue } from "@effect/atom-react";
import type { ThreadTurnSubagents } from "@supaterm/client-runtime/state/thread-subagents";
import {
  isOrchestrationV2WorkActive,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@supaterm/contracts";
import { deriveSubagentElapsedMs, formatDuration } from "@supaterm/shared/orchestrationTiming";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as DateTime from "effect/DateTime";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { ScreenStack } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/ui/AndroidScreenHeader";
import { AppText as Text } from "../../components/ui/AppText";
import { environmentThreadDetails } from "../../state/threads";
import { NativeStackScreenOptions, nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";
import { NativeHeader, NativeScreen } from "../../native/ThemedScreenStack";
import { SubagentRow } from "./SubagentRow";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

type AgentsTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

function useThreadTurnSubagents(target: AgentsTarget): ThreadTurnSubagents | null {
  return useAtomValue(environmentThreadDetails.turnSubagentsAtom(target));
}

export function ThreadAgentsSheet({ route }: StaticScreenProps<AgentsTarget>) {
  const { layout } = useAdaptiveWorkspaceLayout();
  const target = route.params;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const turn = useThreadTurnSubagents(target);
  const subagents = turn?.subagents ?? [];
  const hasLiveAgent = (turn?.liveCount ?? 0) > 0;

  const openChildThread = (childThreadId: ThreadId) => {
    void Haptics.selectionAsync();
    // Replace this leaf sheet so the child enters the workspace stack expected by Home's Back button.
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: target.environmentId,
        threadId: childThreadId,
      }),
    );
  };

  const content = (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      // UIKit must inset content beneath the floating translucent iOS header.
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {subagents.length === 0 ? (
        <Text className="px-5 pt-6 text-center text-sm text-foreground-muted">
          No agents in this turn.
        </Text>
      ) : (
        subagents.map((subagent, index) => (
          <AgentRow
            key={subagent.id}
            subagent={subagent}
            environmentId={target.environmentId}
            tickSeconds={hasLiveAgent}
            isLast={index === subagents.length - 1}
            onOpen={openChildThread}
          />
        ))
      )}
    </ScrollView>
  );

  if (Platform.OS === "ios") {
    // Plain formSheets lack stack headers; host one in a nested native stack.
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <ScreenStack style={{ flex: 1 }}>
          <NativeScreen
            activityState={2}
            enabled
            isNativeStack
            screenId="thread-agents-sheet-native"
            scrollEdgeEffects={HEADER_SCROLL_EDGE_EFFECTS}
            className="flex-1 bg-sheet"
          >
            {content}
            <NativeHeader
              backgroundColor="rgba(0,0,0,0)"
              tintColorClassName="accent-foreground"
              hideBackButton
              hideShadow={false}
              title="Agents"
              titleColorClassName="accent-foreground"
              titleFontSize={18}
              titleFontWeight="800"
              translucent
            />
          </NativeScreen>
        </ScreenStack>
      </View>
    );
  }

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ sheetCornerRadius: 28 }} />
      <AndroidSheetHeader title="Agents" onBack={() => navigation.goBack()} />
      <ScreenContent insetHorizontal={layout.usesSplitView}>{content}</ScreenContent>
    </View>
  );
}

function AgentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly subagent: OrchestrationV2Subagent;
  readonly tickSeconds: boolean;
  readonly isLast: boolean;
  readonly onOpen: (childThreadId: ThreadId) => void;
}) {
  const { subagent } = props;
  const childThreadId = subagent.childThreadId;

  const row = (
    <View className="px-5 py-3.5">
      <SubagentRow
        environmentId={props.environmentId}
        subagent={subagent}
        elapsed={<AgentElapsed subagent={subagent} tickSeconds={props.tickSeconds} />}
      />
      {props.isLast ? null : (
        // left-10 is this row's padding plus SubagentRow's status dot and gap,
        // so the rule starts at the text column and the dots sit in a gutter.
        <View className="absolute right-0 bottom-0 left-10 h-px bg-border" />
      )}
    </View>
  );

  if (childThreadId === null) {
    return (
      <View
        accessible
        accessibilityHint="Provider-managed agent. Its work appears in the transcript."
      >
        {row}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityHint="Opens this agent's thread"
      onPress={() => props.onOpen(childThreadId)}
      className="active:bg-subtle"
    >
      {row}
    </Pressable>
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const running = isOrchestrationV2WorkActive(subagent.status);
  useEffect(() => {
    if (!tickSeconds || !running) return;
    const intervalId = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(intervalId);
  }, [running, tickSeconds]);
  const elapsedMs = deriveSubagentElapsedMs(
    {
      status: subagent.status,
      startedAt: subagent.startedAt === null ? null : DateTime.formatIso(subagent.startedAt),
      completedAt: subagent.completedAt === null ? null : DateTime.formatIso(subagent.completedAt),
    },
    nowMs,
  );
  return elapsedMs === null || elapsedMs === 0 ? null : formatDuration(elapsedMs);
}
