import type { ReactNode } from "react";
import { View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";

export function WorkspaceDockFrame(props: {
  readonly floating?: boolean;
  readonly children: ReactNode;
}) {
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  if (keyboardVisible) return null;
  return (
    <View
      pointerEvents="box-none"
      className="w-full"
      style={
        props.floating
          ? { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 5 }
          : undefined
      }
    >
      {props.children}
    </View>
  );
}
