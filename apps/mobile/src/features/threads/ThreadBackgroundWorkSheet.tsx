import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  presentPendingBackgroundWork,
  type PendingBackgroundWorkItem,
} from "@supaterm/client-runtime/state/thread-execution";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SheetHeader } from "../../components/ui/SheetHeader";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { orchestrationEnvironment } from "../../state/orchestration";
import { environmentThreadShells } from "../../state/threads";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { ThreadCommandOutput } from "./thread-command-output";

const KIND_LABELS = {
  subagent: "Subagent",
  command: "Command",
  monitor: "Monitor",
  background_task: "Background task",
} as const;

type BackgroundWorkTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

export function ThreadBackgroundWorkSheet({ route }: StaticScreenProps<BackgroundWorkTarget>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const target = route.params;
  const thread = useAtomValue(
    environmentThreadShells.threadShellAtom(scopeThreadRef(target.environmentId, target.threadId)),
  );
  const presentation = presentPendingBackgroundWork(thread?.pendingBackgroundTasks ?? []);
  const openThread = (threadId: ThreadId) => {
    void Haptics.selectionAsync();
    // A thread replaces the leaf sheet so workspace back navigation still works.
    navigation.dispatch(
      StackActions.replace("Thread", { environmentId: target.environmentId, threadId }),
    );
  };
  const content = (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-5 pb-6"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {presentation === null ? (
        <Text className="pt-6 text-center text-sm text-foreground-muted">
          Nothing running in the background.
        </Text>
      ) : (
        presentation.items.map((item) => (
          <BackgroundWorkRow
            key={item.taskId}
            item={item}
            target={target}
            // The pill already said what runs; with one command, its output is the detail.
            initiallyShowingOutput={presentation.items.length === 1}
            onOpen={openThread}
          />
        ))
      )}
    </ScrollView>
  );
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title="Background work" onClose={() => navigation.goBack()} />
      <ScreenContent>{content}</ScreenContent>
    </View>
  );
}

function BackgroundWorkRow(props: {
  readonly item: PendingBackgroundWorkItem;
  readonly target: BackgroundWorkTarget;
  readonly initiallyShowingOutput: boolean;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const { item, target } = props;
  const childThreadId = item.childThreadId;
  const [showingOutput, setShowingOutput] = useState(props.initiallyShowingOutput);
  const { themeAppearance } = useAppearancePreferences();
  const row = (trailingSymbol: "chevron.right" | "chevron.up" | "chevron.down" | null) => (
    <View className="flex-row items-center gap-3 py-3.5">
      <SymbolView
        name={
          item.kind === "subagent" ? "person.2" : item.kind === "monitor" ? "clock" : "terminal"
        }
        size={15}
        tintColorClassName="accent-foreground-muted"
        type="monochrome"
      />
      <View className="min-w-0 flex-1">
        <Text className="font-supaterm-medium text-sm text-foreground">{item.label}</Text>
        <Text className="text-xs text-foreground-muted">{KIND_LABELS[item.kind]}</Text>
      </View>
      {trailingSymbol === null ? null : (
        <SymbolView name={trailingSymbol} size={12} tintColorClassName="accent-icon-subtle" />
      )}
    </View>
  );
  if (childThreadId !== undefined) {
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open subagent ${item.label}`}
        onPress={() => props.onOpen(childThreadId)}
        className="border-b border-border active:opacity-70"
      >
        {row("chevron.right")}
      </Pressable>
    );
  }
  if (!item.hasOutput) {
    return (
      <View accessible className="border-b border-border">
        {row(null)}
      </View>
    );
  }
  return (
    <View className="border-b border-border">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${showingOutput ? "Hide" : "Show"} output of ${item.label}`}
        accessibilityState={{ expanded: showingOutput }}
        onPress={() => {
          void Haptics.selectionAsync();
          setShowingOutput((showing) => !showing);
        }}
        className="active:opacity-70"
      >
        {row(showingOutput ? "chevron.up" : "chevron.down")}
      </Pressable>
      {showingOutput ? (
        <View className="pb-3.5">
          <ThreadCommandOutput
            output={orchestrationEnvironment.v2.backgroundTaskOutput({
              environmentId: target.environmentId,
              input: { threadId: target.threadId, taskId: item.taskId },
            })}
            waitingLabel="No output yet."
            themeAppearance={themeAppearance}
          />
        </View>
      ) : null}
    </View>
  );
}
