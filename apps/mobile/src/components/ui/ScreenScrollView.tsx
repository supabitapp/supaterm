import { createContext, use, type ComponentProps } from "react";
import { Platform } from "react-native";
import { cn } from "../../lib/cn";
import { NativeScrollView as ScrollView } from "../../native/NativeScrollViewMarker";

/**
 * The screen's surface class. UIKit's scroll-edge material under the header takes the scroll
 * view's own color; a clear scroll view gets the system's near-white bar over the screen's surface.
 */
export const ScreenScrollViewSurface = createContext<string | undefined>(undefined);

export function ScreenScrollView(props: ComponentProps<typeof ScrollView>) {
  const surface = use(ScreenScrollViewSurface);
  return (
    <ScrollView
      {...props}
      className={Platform.OS === "ios" && surface ? cn(surface, props.className) : props.className}
      contentContainerStyle={[
        props.contentContainerStyle,
        Platform.OS === "android" && {
          width: "100%",
          maxWidth: 720,
          alignSelf: "center",
        },
      ]}
    />
  );
}
