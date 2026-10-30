import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { SymbolView } from "../../../components/ui/AppSymbol";

type SettingsDragHandleProps = {
  readonly title: string;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onStart: () => void;
  readonly onMove: (translation: number) => void;
  readonly onEnd: (translation: number, cancelled: boolean) => void;
  readonly onStep: (direction: "up" | "down") => void;
};

// Gesture callbacks are separate worklets with their own copies of captured
// variables, so the drop reads its translation from the event, not a closure.
function createDragPan(latest: RefObject<SettingsDragHandleProps>) {
  return Gesture.Pan()
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .runOnJS(true)
    .onStart(() => latest.current.onStart())
    .onUpdate((event) => latest.current.onMove(event.translationY))
    .onFinalize((event, success) => latest.current.onEnd(event.translationY, !success));
}

function useDragPan(latest: RefObject<SettingsDragHandleProps>) {
  return useMemo(() => createDragPan(latest), [latest]);
}

export function SettingsDragHandle(props: SettingsDragHandleProps) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const gesture = useDragPan(latest);
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder ${props.title}`}
        accessibilityActions={[
          ...(props.canMoveUp ? [{ name: "decrement", label: "Move up" }] : []),
          ...(props.canMoveDown ? [{ name: "increment", label: "Move down" }] : []),
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "decrement" && props.canMoveUp) props.onStep("up");
          if (nativeEvent.actionName === "increment" && props.canMoveDown) props.onStep("down");
        }}
        style={{ width: 48, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}
      >
        <SymbolView
          name="line.3.horizontal"
          size={20}
          tintColorClassName="accent-foreground-muted"
        />
      </View>
    </GestureDetector>
  );
}
