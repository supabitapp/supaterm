import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type RunId,
  type ThreadId,
} from "@supaterm/contracts";
import * as Haptics from "expo-haptics";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

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
  resolveQueueDragBeforeRunId,
  resolveQueueDropBeforeRunId,
  resolveThreadQueueRowControls,
} from "./threadQueueControlPresentation";
import { ThreadQueueMessage, type QueueMessageAction } from "./ThreadQueueMessage";
import { threadDragGapOffset } from "./threadDragGap";
import { useReducedMotionPreference } from "../../lib/useReducedMotionPreference";

const QUEUE_ACTION_WIDTH = 76;

type QueueTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
type QueueRowLayout = { readonly id: RunId; readonly y?: number; readonly height?: number };

export function useThreadQueueWorkflow(target: QueueTarget) {
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
  const reorder = useAtomCommand(threadEnvironment.reorderQueuedRun, "reorder queued message");
  const promote = useAtomCommand(threadEnvironment.promoteQueuedRun, "promote queued message");
  const cancel = useAtomCommand(threadEnvironment.cancelQueuedRun, "remove queued message");
  const resume = useAtomCommand(threadEnvironment.resumeThreadQueue, "resume queue");
  const [resuming, setResuming] = useState(false);
  const [busyRunId, setBusyRunId] = useState<RunId | null>(null);
  const busyRef = useRef(false);
  const [draggedRunId, setDraggedRunId] = useState<RunId | null>(null);
  const [previewBeforeRunId, setPreviewBeforeRunId] = useState<RunId | null | undefined>();
  const [dragRows, setDragRows] = useState<ReadonlyArray<QueueRowLayout> | null>(null);
  const rowLayouts = useRef(new Map<RunId, { y: number; height: number }>());
  const drag = useRef<{
    runId: RunId;
    order: string;
    beforeRunId: RunId | null | undefined;
    rows: ReadonlyArray<QueueRowLayout>;
  } | null>(null);
  const [translation] = useState(() => new Animated.Value(0));
  const reducedMotion = useReducedMotionPreference();
  const queuedRuns = workflow?.queuedRuns ?? [];
  const canSendNow = workflow?.canSendNow === true;
  const canSendQueuedMessages = workflow?.canPromoteToSteer === true || canSendNow;
  const showResume = workflow?.isHeld === true && queuedRuns.length > 0;
  const sheetHeight = contentHeight + (showResume ? footerHeight : 0);
  const order = queuedRuns.map(({ run }) => run.id).join(",");

  useLayoutEffect(() => {
    if (Platform.OS !== "ios" || contentHeight === 0) return;
    navigation.setOptions({
      sheetAllowedDetents: [
        Math.min(0.85, Math.max(0.25, sheetHeight / (windowHeight - insets.top))),
      ],
    });
  }, [contentHeight, insets.top, navigation, sheetHeight, windowHeight]);

  useEffect(() => {
    if (drag.current && drag.current.order !== order) {
      drag.current = null;
      setDraggedRunId(null);
      setPreviewBeforeRunId(undefined);
      setDragRows(null);
      translation.setValue(0);
    }
  }, [order, translation]);

  const hadQueuedRuns = useRef(queuedRuns.length > 0);
  useEffect(() => {
    if (queuedRuns.length > 0) {
      hadQueuedRuns.current = true;
      return;
    }
    if (hadQueuedRuns.current) navigation.goBack();
  }, [navigation, queuedRuns.length]);

  const move = async (runId: RunId, beforeRunId: RunId | null) => {
    if (
      !readEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope) ||
      busyRef.current ||
      !workflow?.canReorder
    )
      return;
    busyRef.current = true;
    setBusyRunId(runId);
    void Haptics.selectionAsync();
    await reorder({ ...target, input: { threadId: target.threadId, runId, beforeRunId } });
    busyRef.current = false;
    setBusyRunId(null);
  };

  const act = async (runId: RunId, action: QueueMessageAction) => {
    if (
      !readEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope) ||
      busyRef.current
    )
      return;
    const index = queuedRuns.findIndex(({ run }) => run.id === runId);
    if (index < 0) return;
    if (action === "up" && index > 0) {
      await move(runId, queuedRuns[index - 1]!.run.id);
      return;
    }
    if (action === "down" && index < queuedRuns.length - 1) {
      await move(runId, queuedRuns[index + 2]?.run.id ?? null);
      return;
    }
    if (action === "edit") {
      if (editing?.runId === runId) {
        navigation.goBack();
        return;
      }
      const entry = queuedRuns[index]!;
      void Haptics.selectionAsync();
      beginQueuedRunEdit(threadKey, {
        runId,
        messageId: entry.messageId,
        originalText: entry.text,
        existingAttachments: entry.attachments,
        ...(entry.context ? { context: entry.context } : {}),
      });
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

  const canReorder = canOperate && workflow?.canReorder === true && queuedRuns.length > 1;
  const sourceLayout = dragRows?.find((row) => row.id === draggedRunId);
  const lastLayout = dragRows?.at(-1);
  const insertionOffset =
    previewBeforeRunId === undefined
      ? undefined
      : previewBeforeRunId === null
        ? lastLayout?.y === undefined || lastLayout.height === undefined
          ? undefined
          : lastLayout.y + lastLayout.height
        : dragRows?.find((row) => row.id === previewBeforeRunId)?.y;
  const queueRows = () =>
    queuedRuns.map(({ run }) => ({ id: run.id, ...rowLayouts.current.get(run.id) }));
  const content = (
    <ScrollView
      nestedScrollEnabled
      className="ios:flex-1 android:shrink android:grow-0"
      scrollEnabled={draggedRunId === null}
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
              {canSendQueuedMessages
                ? `Tap to edit · ${canSendNow ? "Send now" : "Steer"} or swipe for more`
                : "Tap to edit · Swipe for actions"}
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
      {queuedRuns.map(({ run, text, attachments }, index) => {
        const layout = dragRows?.find((row) => row.id === run.id);
        const offset =
          sourceLayout?.y !== undefined &&
          sourceLayout.height !== undefined &&
          layout?.y !== undefined &&
          insertionOffset !== undefined
            ? threadDragGapOffset(layout.y, sourceLayout.y, sourceLayout.height, insertionOffset)
            : 0;
        const controls = resolveThreadQueueRowControls({
          canOperate,
          busy: busyRunId !== null || draggedRunId !== null,
          canPromoteToSteer: workflow?.canPromoteToSteer ?? false,
          canSendNow,
          canReorder: workflow?.canReorder ?? false,
          index,
          isEditing: editing?.runId === run.id,
          queuedCount: queuedRuns.length,
          text,
        });
        const title =
          controls.displayText.trim() ||
          (attachments.length > 0 ? "Attachments" : "Queued message");
        return (
          <QueueShiftedRow
            key={run.id}
            offset={offset}
            dragging={draggedRunId !== null}
            lifted={draggedRunId === run.id}
            onLayout={({ nativeEvent }) => rowLayouts.current.set(run.id, nativeEvent.layout)}
          >
            <Animated.View
              className="flex-row items-center border-b border-border bg-sheet-solid"
              style={
                draggedRunId === run.id
                  ? { transform: [{ translateY: translation }], zIndex: 1, opacity: 0.85 }
                  : undefined
              }
            >
              {canReorder ? (
                // Outside the swipeable: two pans on one row would race, and
                // the handle owns vertical movement while the row owns sideways.
                <QueueDragHandle
                  disabled={!canOperate || busyRunId !== null}
                  title={title}
                  canMoveUp={controls.canMoveUp}
                  canMoveDown={controls.canMoveDown}
                  onStep={(action) => void act(run.id, action)}
                  onStart={() => {
                    const rows = queueRows();
                    const beforeRunId = resolveQueueDragBeforeRunId(rows, run.id, 0);
                    drag.current = { runId: run.id, order, beforeRunId, rows };
                    translation.setValue(0);
                    setDragRows(rows);
                    setPreviewBeforeRunId(beforeRunId);
                    setDraggedRunId(run.id);
                    void Haptics.selectionAsync();
                  }}
                  onMove={(y) => {
                    const current = drag.current;
                    if (current?.runId !== run.id || current.order !== order) return;
                    translation.setValue(y);
                    const before = resolveQueueDragBeforeRunId(current.rows, run.id, y);
                    if (current.beforeRunId !== before) {
                      current.beforeRunId = before;
                      setPreviewBeforeRunId(before);
                    }
                  }}
                  onEnd={(y, success) => {
                    const started = drag.current;
                    const stop = () => {
                      if (drag.current !== started) return;
                      drag.current = null;
                      setDraggedRunId(null);
                      setPreviewBeforeRunId(undefined);
                      setDragRows(null);
                      translation.setValue(0);
                    };
                    if (!success || started?.order !== order || started.runId !== run.id) {
                      stop();
                      return;
                    }
                    const before = resolveQueueDropBeforeRunId(started.rows, run.id, y);
                    if (before === undefined) {
                      stop();
                      return;
                    }
                    const source = started.rows.find((row) => row.id === run.id);
                    const tail = started.rows.at(-1);
                    const insertion =
                      before === null
                        ? tail?.y !== undefined && tail.height !== undefined
                          ? tail.y + tail.height
                          : undefined
                        : started.rows.find((row) => row.id === before)?.y;
                    if (
                      source?.y !== undefined &&
                      source.height !== undefined &&
                      insertion !== undefined
                    ) {
                      const offset =
                        insertion - source.y - (insertion > source.y ? source.height : 0);
                      if (reducedMotion) translation.setValue(offset);
                      else
                        Animated.timing(translation, {
                          toValue: offset,
                          duration: 160,
                          useNativeDriver: true,
                        }).start();
                    }
                    setPreviewBeforeRunId(before);
                    void move(run.id, before).finally(stop);
                  }}
                />
              ) : null}
              <QueueRowSwipeable
                enabled={draggedRunId === null && busyRunId === null && controls.canDismiss}
                background={theme["--color-sheet-solid"]}
                onRemove={() => void act(run.id, "remove")}
              >
                <View className="flex-1 flex-row items-stretch">
                  <View className="min-w-0 flex-1">
                    <ThreadQueueMessage
                      environmentId={target.environmentId}
                      title={title}
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
                      onPress={() => void act(run.id, "steer")}
                    />
                  ) : null}
                </View>
              </QueueRowSwipeable>
            </Animated.View>
          </QueueShiftedRow>
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

function QueueShiftedRow(props: {
  readonly offset: number;
  readonly dragging: boolean;
  readonly lifted: boolean;
  readonly onLayout: React.ComponentProps<typeof View>["onLayout"];
  readonly children: React.ReactNode;
}) {
  const { dragging, offset } = props;
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: dragging
          ? withTiming(offset, { duration: 160, reduceMotion: ReduceMotion.System })
          : offset,
      },
    ],
  }));
  return (
    <Reanimated.View
      exiting={FadeOut.duration(120)}
      onLayout={props.onLayout}
      style={[style, { zIndex: props.lifted ? 1 : 0 }]}
    >
      {props.children}
    </Reanimated.View>
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
      // The sheet's own vertical scroll and the drag handle both move up and
      // down; a swipe has to be clearly sideways before it takes the gesture.
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
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.sendsNow ? "Send queued message now" : "Steer with queued message"}
      accessibilityHint={
        props.sendsNow
          ? "Start a turn with this message"
          : "Send this queued message to the active turn"
      }
      accessibilityState={{ disabled: !props.canSend }}
      disabled={!props.canSend}
      onPress={props.onPress}
      className="min-h-16 items-center justify-center border-l border-border bg-subtle px-2 active:opacity-70"
      style={{ width: QUEUE_ACTION_WIDTH }}
    >
      <SymbolView
        name="arrow.turn.left.up"
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
        {props.sendsNow ? "Send now" : "Steer"}
      </Text>
    </Pressable>
  );
}

type QueueDragHandleProps = {
  disabled: boolean;
  title: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onStep: (action: "up" | "down") => void;
  onStart: () => void;
  onMove: (y: number) => void;
  onEnd: (y: number, success: boolean) => void;
};

function createQueueDragPan(latest: RefObject<QueueDragHandleProps>, disabled: boolean) {
  return Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .runOnJS(true)
    .onStart(() => latest.current.onStart())
    .onUpdate((event) => latest.current.onMove(event.translationY))
    .onFinalize((event, success) => latest.current.onEnd(event.translationY, success));
}

function useQueueDragPan(latest: RefObject<QueueDragHandleProps>, disabled: boolean) {
  return useMemo(() => createQueueDragPan(latest, disabled), [disabled, latest]);
}

function QueueDragHandle(props: QueueDragHandleProps) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const gesture = useQueueDragPan(latest, props.disabled);
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder ${props.title}`}
        accessibilityState={{ disabled: props.disabled }}
        accessibilityActions={[
          ...(props.canMoveUp ? [{ name: "decrement", label: "Move up" }] : []),
          ...(props.canMoveDown ? [{ name: "increment", label: "Move down" }] : []),
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (props.disabled) return;
          if (nativeEvent.actionName === "decrement" && props.canMoveUp) props.onStep("up");
          if (nativeEvent.actionName === "increment" && props.canMoveDown) props.onStep("down");
        }}
        className="min-h-11 w-11 self-stretch items-center justify-center"
      >
        <SymbolView
          name="line.3.horizontal"
          size={16}
          tintColorClassName="accent-foreground-muted"
        />
      </View>
    </GestureDetector>
  );
}
