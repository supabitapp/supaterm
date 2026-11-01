import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import {
  makeQueuedRunsAtom,
  queuedRunEditBlockedReason,
} from "@supaterm/client-runtime/queued-run-edit";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type RunId,
  type ThreadId,
} from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, { FadeOut } from "react-native-reanimated";

import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { beginQueuedRunEdit, useQueuedRunEdit } from "../../state/queued-run-edit";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import {
  REMOVE_QUEUED_MESSAGE_ACCESSIBILITY_LABEL,
  buildCancelQueuedRunCommand,
  resolveThreadQueueRowControls,
} from "./threadQueueControlPresentation";
import { ThreadQueueMessage, type QueueMessageAction } from "./ThreadQueueMessage";

const QUEUE_ACTION_WIDTH = 76;

type QueueTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

function useThreadQueueWorkflow(target: QueueTarget) {
  return useAtomValue(environmentThreadDetails.queueWorkflowAtom(target));
}

export function ThreadQueueSheet({ route }: StaticScreenProps<QueueTarget>) {
  const target = route.params;
  const canOperate = useEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const theme = useUniwindTheme();
  const workflow = useThreadQueueWorkflow(target);
  const threadKey = scopedThreadKey(target.environmentId, target.threadId);
  const editing = useQueuedRunEdit(threadKey);
  const pendingRequests = useAtomValue(environmentThreadDetails.pendingRequestsAtom(target));
  const editBlockedReason = queuedRunEditBlockedReason({
    openQuestionCount: pendingRequests?.userInputs.length ?? 0,
  });
  const promote = useAtomCommand(threadEnvironment.promoteQueuedRun, "promote queued message");
  const cancel = useAtomCommand(threadEnvironment.cancelQueuedRun, "remove queued message");
  const resume = useAtomCommand(threadEnvironment.resumeThreadQueue, "resume queue");
  const [resuming, setResuming] = useState(false);
  const [busyRunId, setBusyRunId] = useState<RunId | null>(null);
  const busyRef = useRef(false);
  const queuedRuns = workflow?.queuedRuns ?? [];
  const canSendNow = workflow?.canSendNow === true;
  const canSendQueuedMessages = workflow?.canPromoteToSteer === true || canSendNow;
  const showResume = workflow?.isHeld === true && queuedRuns.length > 0;
  const sheetHeight = contentHeight + (showResume ? footerHeight : 0);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- sizes the iOS sheet detent to the measured queue content through navigation options before paint
  useLayoutEffect(() => {
    if (Platform.OS !== "ios" || contentHeight === 0) return;
    navigation.setOptions({
      sheetAllowedDetents: [
        Math.min(0.85, Math.max(0.25, sheetHeight / (windowHeight - insets.top))),
      ],
    });
  }, [contentHeight, insets.top, navigation, sheetHeight, windowHeight]);

  const hadQueuedRuns = useRef(queuedRuns.length > 0);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- pops the navigator once the server-side queue empties after it had runs
  useEffect(() => {
    if (queuedRuns.length > 0) {
      hadQueuedRuns.current = true;
      return;
    }
    if (hadQueuedRuns.current) navigation.goBack();
  }, [navigation, queuedRuns.length]);

  const act = async (runId: RunId, action: QueueMessageAction) => {
    if (
      !readEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope) ||
      busyRef.current
    )
      return;
    const index = queuedRuns.findIndex(({ run }) => run.id === runId);
    if (index < 0) return;
    if (action === "edit") {
      if (editing?.runId === runId) {
        navigation.goBack();
        return;
      }
      if (editBlockedReason !== null) return;
      const entry = queuedRuns[index]!;
      void Haptics.selectionAsync();
      beginQueuedRunEdit(
        threadKey,
        {
          runId,
          messageId: entry.messageId,
          originalText: entry.text,
          existingAttachments: entry.attachments,
          ...(entry.context ? { context: entry.context } : {}),
        },
        makeQueuedRunsAtom({
          threadId: target.threadId,
          snapshot: threadEnvironment.snapshotAtom(target.environmentId),
          detailStatus: environmentThreadDetails.statusAtom(target),
          runs: Atom.make(
            (get) => get(environmentThreadDetails.quietThreadAtom(target))?.projection.runs ?? null,
          ),
        }),
      );
      navigation.goBack();
      return;
    }
    if (action !== "steer" && action !== "remove") return;
    busyRef.current = true;
    setBusyRunId(runId);
    void Haptics.selectionAsync();
    if (action === "remove") {
      await cancel(buildCancelQueuedRunCommand({ ...target, runId }));
    } else if (workflow?.canSendNow) {
      await resume({ ...target, input: { threadId: target.threadId, runId } });
    } else if (workflow?.activeRun && workflow.canPromoteToSteer) {
      await promote({
        ...target,
        input: {
          threadId: target.threadId,
          queuedRunId: runId,
          targetRunId: workflow.activeRun.id,
        },
      });
    }
    busyRef.current = false;
    setBusyRunId(null);
  };

  const content = (
    <ScrollView
      nestedScrollEnabled
      className="ios:flex-1 android:shrink android:grow-0"
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
      onContentSizeChange={(_, height) => setContentHeight(height)}
      contentContainerClassName="px-5 pt-7"
      contentContainerStyle={{ paddingBottom: showResume ? 8 : Math.max(insets.bottom, 16) + 12 }}
    >
      <View className="mb-5 flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text
              accessibilityRole="header"
              className="shrink text-lg font-supaterm-bold text-foreground"
            >
              Queued
            </Text>
            <Text className="text-base tabular-nums text-foreground-muted">
              {queuedRuns.length}
            </Text>
          </View>
          {canOperate ? (
            <Text className="text-sm text-foreground-muted">
              {editBlockedReason ??
                (canSendQueuedMessages
                  ? "Tap to edit · Send now or swipe for more"
                  : "Tap to edit · Swipe for actions")}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close message queue"
          onPress={() => navigation.goBack()}
          className="size-11 items-center justify-center rounded-full bg-subtle active:opacity-70"
        >
          <SymbolView name="xmark" size={16} tintColorClassName="accent-foreground-muted" />
        </Pressable>
      </View>
      {queuedRuns.length === 0 ? (
        <View className="gap-2 py-6">
          <Text className="text-center text-base font-supaterm-medium text-foreground">
            Your queue is empty
          </Text>
          <Text className="text-center text-sm text-foreground-muted">
            Messages you queue during a turn will appear here.
          </Text>
        </View>
      ) : null}
      {queuedRuns.map(({ run, text, attachments, message }) => {
        const controls = resolveThreadQueueRowControls({
          canOperate,
          busy: busyRunId !== null,
          canPromoteToSteer: workflow?.canPromoteToSteer ?? false,
          canSendNow,
          editBlocked: editBlockedReason !== null,
          isEditing: editing?.runId === run.id,
          text,
        });
        const title =
          controls.displayText.trim() ||
          (attachments.length > 0 ? "Attachments" : "Queued message");
        return (
          <Reanimated.View
            key={run.id}
            exiting={FadeOut.duration(120)}
            className="flex-row items-center border-b border-border bg-sheet-solid"
          >
            <QueueRowSwipeable
              enabled={busyRunId === null && controls.canDismiss}
              background={theme["--color-sheet-solid"]}
              onRemove={() => void act(run.id, "remove")}
            >
              <View className="flex-1 flex-row items-stretch">
                <View className="min-w-0 flex-1">
                  <ThreadQueueMessage
                    environmentId={target.environmentId}
                    title={title}
                    message={message}
                    attachments={attachments}
                    controls={controls}
                    canPromoteToSteer={workflow?.canPromoteToSteer ?? false}
                    canSendNow={canSendNow}
                    onAction={(action) => void act(run.id, action)}
                  />
                </View>
                {canSendQueuedMessages ? (
                  <QueueSendButton
                    canSend={controls.canSend}
                    sendsNow={canSendNow}
                    skipsCompaction={workflow?.promoteSkipsCompaction === true}
                    onPress={() => void act(run.id, "steer")}
                  />
                ) : null}
              </View>
            </QueueRowSwipeable>
          </Reanimated.View>
        );
      })}
    </ScrollView>
  );

  return (
    <GestureHandlerRootView
      style={Platform.OS === "ios" ? { flex: 1 } : { maxHeight: windowHeight * 0.85 }}
    >
      <View collapsable={false} className="ios:flex-1 android:shrink bg-sheet-solid">
        {content}
        {showResume ? (
          <View
            onLayout={({ nativeEvent }) => setFooterHeight(nativeEvent.layout.height)}
            className="gap-3 bg-sheet-solid px-5 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 16) + 12 }}
          >
            <Text className="text-center text-sm text-foreground-muted">Paused after restart</Text>
            <Button
              label={resuming ? "Resuming…" : "Resume queue"}
              tone="primary"
              fullWidth
              loading={resuming}
              disabled={!canOperate || resuming || busyRunId !== null}
              onPress={async () => {
                if (
                  !readEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope) ||
                  busyRef.current
                )
                  return;
                busyRef.current = true;
                setResuming(true);
                await resume({ ...target, input: { threadId: target.threadId } });
                busyRef.current = false;
                setResuming(false);
              }}
            />
          </View>
        ) : null}
      </View>
    </GestureHandlerRootView>
  );
}

function QueueRowSwipeable(props: {
  readonly enabled: boolean;
  readonly background: string;
  readonly onRemove: () => void;
  readonly children: React.ReactNode;
}) {
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- closes the open swipeable through its imperative handle when swiping becomes disabled
  useEffect(() => {
    if (!props.enabled) swipeableRef.current?.close();
  }, [props.enabled]);
  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      enabled={props.enabled}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      // The sheet scrolls vertically; a swipe has to be clearly sideways before it
      // takes the gesture.
      failOffsetY={[-12, 12]}
      containerStyle={{ backgroundColor: props.background, flex: 1 }}
      childrenContainerStyle={{ backgroundColor: props.background }}
      onSwipeableOpen={() => setIsOpen(true)}
      onSwipeableClose={() => setIsOpen(false)}
      renderRightActions={() => (
        <View
          className="flex-row"
          accessibilityElementsHidden={!isOpen}
          importantForAccessibility={isOpen ? "auto" : "no-hide-descendants"}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={REMOVE_QUEUED_MESSAGE_ACCESSIBILITY_LABEL}
            disabled={!props.enabled}
            onPress={() => {
              swipeableRef.current?.close();
              props.onRemove();
            }}
            className="min-h-11 items-center justify-center bg-danger active:opacity-70"
            style={{ width: QUEUE_ACTION_WIDTH }}
          >
            <SymbolView name="trash" size={16} tintColorClassName="accent-danger-foreground" />
            <Text className="pt-1 text-2xs font-supaterm-medium text-danger-foreground">
              Remove
            </Text>
          </Pressable>
        </View>
      )}
    >
      {props.children}
    </ReanimatedSwipeable>
  );
}

function QueueSendButton(props: {
  readonly canSend: boolean;
  readonly sendsNow: boolean;
  readonly skipsCompaction: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send queued message now"
      accessibilityHint={
        props.sendsNow
          ? "Start a turn with this message"
          : props.skipsCompaction
            ? "Skip compaction and send this message"
            : "Send into the current turn"
      }
      accessibilityState={{ disabled: !props.canSend }}
      disabled={!props.canSend}
      onPress={props.onPress}
      className="min-h-16 items-center justify-center border-l border-border bg-subtle px-2 active:opacity-70"
      style={{ width: QUEUE_ACTION_WIDTH }}
    >
      <SymbolView
        name="arrow.up"
        size={16}
        tintColorClassName={props.canSend ? "accent-primary-text" : "accent-foreground-muted"}
      />
      <Text
        className={
          props.canSend
            ? "pt-1 text-2xs font-supaterm-medium text-primary-text"
            : "pt-1 text-2xs font-supaterm-medium text-foreground-muted"
        }
      >
        Send now
      </Text>
    </Pressable>
  );
}
