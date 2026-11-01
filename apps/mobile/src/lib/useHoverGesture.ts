import { useState } from "react";
import { Gesture, PointerType } from "react-native-gesture-handler";

function createHoverGesture(disabled: boolean, setHovered: (hovered: boolean) => void) {
  return Gesture.Hover()
    .manualActivation(true)
    .enabled(!disabled)
    .cancelsTouchesInView(false)
    .runOnJS(true)
    .onBegin((event) => {
      setHovered(
        event.pointerType === PointerType.MOUSE || event.pointerType === PointerType.STYLUS,
      );
    })
    .onFinalize(() => {
      setHovered(false);
    });
}

export function useHoverGesture(disabled = false) {
  const [hovered, setHovered] = useState(false);
  const hoverGesture = createHoverGesture(disabled, setHovered);
  return { hovered: !disabled && hovered, hoverGesture };
}
