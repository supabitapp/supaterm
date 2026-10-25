import type { ReactNode } from "react";
import { View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";

export function WorkspaceDockFrame(props: { readonly children: ReactNode }) {
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  if (keyboardVisible) return null;
  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 bottom-0 z-[5]">
      {props.children}
    </View>
  );
}
