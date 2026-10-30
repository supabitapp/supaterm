import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type AccessibilityActionEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { cn } from "../../lib/cn";
const ACCESSIBILITY_RESIZE_STEP = 24;
interface WorkspacePaneDividerProps {
  readonly accessibilityLabel: string;
  readonly currentWidth: number;
  readonly resizeDirection: 1 | -1;
  readonly onResizeStart?: () => void;
  readonly onResizeBy: (delta: number) => void;
  readonly onResizeEnd?: () => void;
}
function createResizeGesture(
  onResizeStart: () => void,
  onResize: (translationX: number) => void,
  onResizeEnd: () => void,
) {
  return Gesture.Pan()
    .activeOffsetX([-4, 4])
    .failOffsetY([-24, 24])
    .onStart(() => {
      runOnJS(onResizeStart)();
    })
    .onUpdate((event) => {
      runOnJS(onResize)(event.translationX);
    })
    .onFinalize(() => {
      runOnJS(onResizeEnd)();
    });
}
function ResizeGestureDetector(props: {
  readonly onResizeStart: () => void;
  readonly onResize: (translationX: number) => void;
  readonly onResizeEnd: () => void;
  readonly children: ReactNode;
}) {
  const { onResizeStart, onResize, onResizeEnd } = props;
  const resizeGesture = createResizeGesture(onResizeStart, onResize, onResizeEnd);
  return <GestureDetector gesture={resizeGesture}>{props.children}</GestureDetector>;
}
export function WorkspacePaneDivider(props: WorkspacePaneDividerProps) {
  const latestProps = useRef(props);
  useLayoutEffect(() => {
    latestProps.current = props;
  });
  const [dragging, setDragging] = useState(false);
  const handleResizeStart = () => {
    setDragging(true);
    latestProps.current.onResizeStart?.();
  };
  const handleResize = (translationX: number) => {
    latestProps.current.onResizeBy(translationX * latestProps.current.resizeDirection);
  };
  const handleResizeEnd = () => {
    setDragging(false);
    latestProps.current.onResizeEnd?.();
  };
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    props.onResizeStart?.();
    if (event.nativeEvent.actionName === "increment") {
      props.onResizeBy(ACCESSIBILITY_RESIZE_STEP);
    } else if (event.nativeEvent.actionName === "decrement") {
      props.onResizeBy(-ACCESSIBILITY_RESIZE_STEP);
    }
    props.onResizeEnd?.();
  };
  return (
    <ResizeGestureDetector
      onResizeStart={handleResizeStart}
      onResize={handleResize}
      onResizeEnd={handleResizeEnd}
    >
      <Pressable
        className="relative z-[100] -mx-[22px] w-11 self-stretch justify-center"
        accessibilityActions={[
          {
            name: "increment",
            label: "Make pane wider",
          },
          {
            name: "decrement",
            label: "Make pane narrower",
          },
        ]}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="adjustable"
        accessibilityValue={{
          now: Math.round(props.currentWidth),
          text: `${Math.round(props.currentWidth)} points wide`,
        }}
        onAccessibilityAction={handleAccessibilityAction}
      >
        <View
          className={cn(
            "h-full self-center bg-border opacity-70",
            dragging ? "w-0.5 bg-primary opacity-100" : "w-px",
            Platform.OS === "android" && !dragging && "opacity-0",
          )}
          style={[styles.line, dragging && styles.activeLine]}
        />
      </Pressable>
    </ResizeGestureDetector>
  );
}
const styles = StyleSheet.create({
  line: {
    alignSelf: "center",
    height: "100%",
    width: StyleSheet.hairlineWidth,
  },
  activeLine: {
    width: 2,
  },
});
