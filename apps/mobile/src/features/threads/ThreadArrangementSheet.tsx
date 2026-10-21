import { SheetHeader } from "../../components/ui/SheetHeader";
import { appAtomRegistry } from "../../state/atom-registry";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { effectiveSnoozed } from "@supaterm/client-runtime/state/thread-snooze";
import { sortInboxThreadsByReturn } from "@supaterm/client-runtime/state/thread-inbox";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Haptics from "expo-haptics";
import { Animated, FlatList, Modal, Pressable, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Reanimated, { ReduceMotion, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { threadDragGapOffset } from "./threadDragGap";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { environmentServerConfigsAtom } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import {
  pendingThreadOrderAtom,
  threadDropBusyAtom,
  threadArrangementOpenAtom,
} from "../../state/thread-order";
import { queuedThreadKeysAtom } from "../../state/use-thread-outbox";
import { useThreadListActions } from "../home/useThreadListActions";
import {
  canMoveThreadToActive,
  createThreadMovePlanner,
  threadDragAction,
  type ThreadMoveDestination,
} from "./threadOrder";
import { getThreadListV2OrderedSection, threadListInboxReturns } from "./threadListV2";

const ROW_HEIGHT = 56;
const HEADER_HEIGHT = 48;
const keyOf = (thread: EnvironmentThreadShell) => scopedThreadKey(thread.environmentId, thread.id);
type Section = "pinned" | "active" | "snoozed" | "done";
type Destination = Exclude<ThreadMoveDestination, string>;
type Row = {
  key: string;
  section: Section;
  thread?: EnvironmentThreadShell;
  offset: number;
  height: number;
};
type Drag = {
  orderVersion: string;
  sourceSection: Section;
  thread: EnvironmentThreadShell;
  startY: number;
  translation: number;
  destination: Destination | null;
};

function ArrangementRow(props: {
  height: number;
  offset: number;
  lifted: boolean;
  dragging: boolean;
  children: ReactNode;
}) {
  const { dragging, offset, lifted } = props;
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: dragging
          ? withTiming(offset, { duration: 160, reduceMotion: ReduceMotion.System })
          : offset,
      },
    ],
    opacity: lifted ? 0 : 1,
  }));
  return (
    <Reanimated.View
      style={[{ height: props.height }, style]}
      className="flex-row items-center border-b border-border-subtle px-5"
    >
      {props.children}
    </Reanimated.View>
  );
}

type DragHandleProps = {
  title: string;
  disabled: boolean;
  row: Row;
  onStart: (row: Row) => void;
  onMove: (translation: number) => void;
  onEnd: (cancelled: boolean) => void;
  onStep: (direction: "up" | "down") => void;
  sectionActions: readonly { name: "pinned" | "active" | "done"; label: string }[];
  onSectionMove: (section: "pinned" | "active" | "done") => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

function createDragHandlePan(latest: RefObject<DragHandleProps>, disabled: boolean) {
  return Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .runOnJS(true)
    .onStart(() => latest.current.onStart(latest.current.row))
    .onUpdate((event) => latest.current.onMove(event.translationY))
    .onEnd((event) => latest.current.onMove(event.translationY))
    .onFinalize((_, success) => latest.current.onEnd(!success));
}

function useDragHandlePan(latest: RefObject<DragHandleProps>, disabled: boolean) {
  return useMemo(() => createDragHandlePan(latest, disabled), [disabled, latest]);
}

function DragHandle(props: DragHandleProps) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const gesture = useDragHandlePan(latest, props.disabled);
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder ${props.title}`}
        accessibilityHint="Move up and Move down reorder within this section. Other actions move between sections."
        accessibilityState={{ disabled: props.disabled }}
        accessibilityActions={[
          ...props.sectionActions,
          ...(props.canMoveUp ? [{ name: "decrement", label: "Move up" }] : []),
          ...(props.canMoveDown ? [{ name: "increment", label: "Move down" }] : []),
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (props.disabled) return;
          const sectionAction = props.sectionActions.find(
            (action) => action.name === nativeEvent.actionName,
          );
          if (sectionAction) props.onSectionMove(sectionAction.name);
          if (nativeEvent.actionName === "decrement" && props.canMoveUp) props.onStep("up");
          if (nativeEvent.actionName === "increment" && props.canMoveDown) props.onStep("down");
        }}
        style={{
          width: 48,
          height: 48,
          alignItems: "center",
          justifyContent: "center",
          opacity: props.disabled ? 0.3 : 1,
        }}
      >
        <SymbolView
          name="line.3.horizontal"
          size={22}
          tintColorClassName="accent-foreground-muted"
        />
      </View>
    </GestureDetector>
  );
}

export function ThreadArrangementSheet(props: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const queuedThreadKeys = useAtomValue(queuedThreadKeysAtom);
  const pendingOrder = useAtomValue(pendingThreadOrderAtom);
  const dropBusy = useAtomValue(threadDropBusyAtom);
  const { moveThread } = useThreadListActions();
  const [now, setNow] = useState(() => new Date().toISOString());
  const [expanded, setExpanded] = useState({ snoozed: false, done: false });
  useEffect(() => {
    const wakeAt = Math.min(
      ...threads.flatMap((thread) => {
        const at = Date.parse(thread.snoozedUntil ?? "");
        return at > Date.parse(now) ? [at] : [];
      }),
    );
    if (!Number.isFinite(wakeAt)) return;
    const timer = setTimeout(
      () => setNow(new Date().toISOString()),
      Math.min(Math.max(0, wakeAt - Date.now()) + 1, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [threads, now]);
  const sections = useMemo(() => {
    const shared = {
      threads,
      now,
      queuedThreadKeys,
      pendingOrder,
    };
    const pinned = getThreadListV2OrderedSection({ ...shared, section: "pinned" });
    const active = getThreadListV2OrderedSection({ ...shared, section: "active" });
    const visible = new Set([...pinned, ...active].map(keyOf));
    const parked = threads.filter(
      (thread) => thread.archivedAt === null && !visible.has(keyOf(thread)),
    );
    return {
      pinned,
      // The inbox is ordered by time; show that order here too.
      active: sortInboxThreadsByReturn(active, threadListInboxReturns.returnedAt),
      snoozed: parked.filter((thread) => effectiveSnoozed(thread, { now })),
      done: parked.filter((thread) => !effectiveSnoozed(thread, { now })),
    };
  }, [threads, now, queuedThreadKeys, pendingOrder]);
  // Only Pinned has slots. The inbox is time-ordered, so a drop into Active
  // only changes lifecycle (see canMoveThreadToActive).
  const pinnedPlanner = useMemo(
    () =>
      createThreadMovePlanner({
        ordered: sections.pinned,
        allThreads: threads,
        section: "pinned",
        reorderableEnvironmentIds: new Set(configs.keys()),
      }),
    [sections, threads, configs],
  );
  const rows = useMemo(() => {
    const result: Row[] = [];
    let offset = 0;
    for (const section of ["pinned", "active", "snoozed", "done"] as const) {
      if (section === "snoozed" && sections[section].length === 0) continue;
      result.push({ key: section, section, offset, height: HEADER_HEIGHT });
      offset += HEADER_HEIGHT;
      if ((section === "snoozed" || section === "done") && !expanded[section]) continue;
      for (const thread of sections[section]) {
        result.push({ key: keyOf(thread), section, thread, offset, height: ROW_HEIGHT });
        offset += ROW_HEIGHT;
      }
    }
    return result;
  }, [sections, expanded]);
  const list = useRef<FlatList<Row>>(null);
  const geometry = useRef({ height: 0, offset: 0 });
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const [preview, setPreview] = useState<Drag | null>(null);
  const [translateY] = useState(() => new Animated.Value(0));
  const latest = useRef({ rows, pinnedPlanner, moveThread });
  useLayoutEffect(() => {
    latest.current = { rows, pinnedPlanner, moveThread };
  });

  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    drag.current = null;
    setPreview(null);
  }
  const orderVersion = rows.map((row) => `${row.key}:${row.thread?.pinOrderKey}`).join("|");
  const [stoppedOrderVersion, setStoppedOrderVersion] = useState(orderVersion);
  if (stoppedOrderVersion !== orderVersion) {
    setStoppedOrderVersion(orderVersion);
    setPreview(null);
  }
  useEffect(() => {
    if (drag.current?.orderVersion === orderVersion) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    drag.current = null;
  }, [orderVersion]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  function update(translation: number) {
    const current = drag.current;
    if (current === null) return;
    current.translation = translation;
    const { height, offset } = geometry.current;
    const y = current.startY + translation;
    translateY.setValue(Math.max(0, Math.min(height - ROW_HEIGHT, y - ROW_HEIGHT / 2)));
    const contentY = Math.max(0, y + offset);
    const target =
      latest.current.rows.find((row) => contentY < row.offset + row.height) ??
      latest.current.rows.at(-1);
    let destination: Destination | null = null;
    if (
      target &&
      y >= 0 &&
      y <= height &&
      (target.section === "pinned" || target.section === "active" || target.section === "done")
    ) {
      const loaded = configs.has(current.thread.environmentId);
      const candidate: Destination = {
        section: target.section,
        targetId: target.thread ? target.key : null,
        placement:
          !target.thread || contentY < target.offset + target.height / 2 ? "before" : "after",
      };
      if (target.section === "done") {
        if (current.sourceSection !== "done" && loaded)
          destination = { section: "done", targetId: null, placement: "before" };
      } else if (target.section === "active") {
        if (canMoveThreadToActive(current.sourceSection, loaded))
          destination = { section: "active", targetId: null, placement: "before" };
      } else if (latest.current.pinnedPlanner(keyOf(current.thread), candidate) !== null)
        destination = candidate;
    }
    if (
      current.destination?.targetId !== destination?.targetId ||
      current.destination?.section !== destination?.section ||
      current.destination?.placement !== destination?.placement
    ) {
      current.destination = destination;
      setPreview({ ...current });
    }
  }
  function start(row: Row) {
    if (!row.thread || preview !== null) return;
    drag.current = {
      orderVersion,
      sourceSection: row.section,
      thread: row.thread,
      startY: row.offset + ROW_HEIGHT / 2 - geometry.current.offset,
      translation: 0,
      destination: null,
    };
    setPreview({ ...drag.current });
    void Haptics.selectionAsync();
    update(0);
    let last = performance.now();
    const tick = () => {
      const current = drag.current;
      if (!current) return;
      const timestamp = performance.now();
      const dt = Math.min(timestamp - last, 32);
      last = timestamp;
      const bounds = geometry.current;
      const y = current.startY + current.translation;
      const speed =
        y < 48
          ? -Math.min(1, (48 - y) / 48)
          : y > bounds.height - 48
            ? Math.min(1, (y - bounds.height + 48) / 48)
            : 0;
      const tail = latest.current.rows.at(-1);
      const maximum = Math.max(0, (tail ? tail.offset + tail.height : 0) - bounds.height);
      const offset = Math.max(0, Math.min(maximum, bounds.offset + speed * dt * 0.5));
      if (offset !== bounds.offset) {
        bounds.offset = offset;
        list.current?.scrollToOffset({ offset, animated: false });
        update(current.translation);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  const visiblePreview = preview?.orderVersion === orderVersion ? preview : null;
  const sourceRow = visiblePreview
    ? rows.find((row) => row.key === keyOf(visiblePreview.thread))
    : undefined;
  const destination = visiblePreview?.destination;
  const targetRow = destination
    ? rows.find(
        (row) =>
          row.section === destination.section &&
          row.key === (destination.targetId ?? destination.section),
      )
    : undefined;
  const insertionOffset = targetRow
    ? targetRow.offset +
      (!targetRow.thread || destination?.placement === "after" ? targetRow.height : 0)
    : sourceRow?.offset;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={props.onClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View
          className="flex-1 bg-screen"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <SheetHeader
            presentation="inline"
            title="Arrange threads"
            onClose={props.onClose}
            accessibilityLabel="Close arrange threads"
          />
          <Text className="px-5 pb-3 text-sm text-foreground-muted">
            Drag to reorder, pin, or mark as Done. Changes save when you drop.
          </Text>
          <View
            onLayout={(event) => {
              geometry.current.height = event.nativeEvent.layout.height;
            }}
            className="flex-1"
            style={{ overflow: "hidden" }}
          >
            <FlatList
              ref={list}
              data={rows}
              keyExtractor={(row) => row.key}
              scrollEnabled={visiblePreview === null}
              removeClippedSubviews={false}
              onScroll={(event) => {
                geometry.current.offset = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
              getItemLayout={(_, index) => ({
                length: rows[index]!.height,
                offset: rows[index]!.offset,
                index,
              })}
              renderItem={({ item }) => {
                const thread = item.thread;
                const planner = item.section === "pinned" ? pinnedPlanner : null;
                const loaded = thread != null && configs.has(thread.environmentId);
                const sectionActions = thread
                  ? (["pinned", "active", "done"] as const).flatMap<{
                      name: "pinned" | "active" | "done";
                      label: string;
                    }>((section) => {
                      if (section === item.section) return [];
                      const label = threadDragAction(item.section, section);
                      if (!label) return [];
                      if (section === "done") return loaded ? [{ name: section, label }] : [];
                      if (section === "active")
                        return canMoveThreadToActive(item.section, loaded)
                          ? [{ name: section, label }]
                          : [];
                      if (!loaded) return [];
                      return pinnedPlanner(item.key, {
                        section,
                        targetId: null,
                        placement: "before",
                      })
                        ? [{ name: section, label }]
                        : [];
                    })
                  : [];
                return (
                  <ArrangementRow
                    height={item.height}
                    dragging={visiblePreview !== null}
                    lifted={item.key === sourceRow?.key}
                    offset={
                      sourceRow && insertionOffset !== undefined
                        ? threadDragGapOffset(
                            item.offset,
                            sourceRow.offset,
                            sourceRow.height,
                            insertionOffset,
                          )
                        : 0
                    }
                  >
                    {thread ? (
                      <>
                        <Text numberOfLines={2} className="flex-1 text-base">
                          {thread.title}
                        </Text>
                        <DragHandle
                          title={thread.title}
                          disabled={dropBusy || pendingOrder !== null || !loaded}
                          sectionActions={sectionActions}
                          onSectionMove={(section) => {
                            void moveThread(thread, {
                              section,
                              targetId: null,
                              placement: "before",
                            });
                          }}
                          canMoveUp={planner?.(item.key, "up") != null}
                          canMoveDown={planner?.(item.key, "down") != null}
                          onStep={(direction) => {
                            void moveThread(thread, direction);
                          }}
                          row={item}
                          onStart={start}
                          onMove={update}
                          onEnd={(cancelled) => {
                            const current = drag.current;
                            if (cancelled || !current?.destination) {
                              stop();
                              return;
                            }
                            if (frame.current !== null) cancelAnimationFrame(frame.current);
                            frame.current = null;
                            drag.current = null;
                            void moveThread(current.thread, current.destination).finally(stop);
                          }}
                        />
                      </>
                    ) : (
                      <Pressable
                        disabled={item.section === "pinned" || item.section === "active"}
                        className="flex-1 justify-center self-stretch"
                        onPress={() => {
                          const section = item.section;
                          if (section === "snoozed" || section === "done")
                            setExpanded((value) => ({ ...value, [section]: !value[section] }));
                        }}
                      >
                        <Text className="text-sm font-supaterm-semibold text-foreground-muted">
                          {item.section[0]!.toUpperCase() + item.section.slice(1)} (
                          {sections[item.section].length})
                        </Text>
                      </Pressable>
                    )}
                  </ArrangementRow>
                );
              }}
            />
            {visiblePreview ? (
              <Animated.View
                pointerEvents="none"
                className="absolute left-5 right-5 justify-center rounded-xl border border-border bg-screen px-4"
                style={{ top: 0, height: ROW_HEIGHT, transform: [{ translateY }] }}
              >
                <Text
                  numberOfLines={visiblePreview.destination?.section ? 1 : 2}
                  className="text-base font-supaterm-medium"
                >
                  {visiblePreview.thread.title}
                </Text>
                {visiblePreview.destination?.section ? (
                  <Text className="text-xs text-foreground-muted">
                    {threadDragAction(
                      visiblePreview.sourceSection,
                      visiblePreview.destination.section,
                    )}
                  </Text>
                ) : null}
              </Animated.View>
            ) : null}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export function ThreadArrangementHost() {
  const open = useAtomValue(threadArrangementOpenAtom);
  return open ? (
    <ThreadArrangementSheet onClose={() => appAtomRegistry.set(threadArrangementOpenAtom, false)} />
  ) : null;
}
