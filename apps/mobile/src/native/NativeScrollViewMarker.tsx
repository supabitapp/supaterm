import { requireNativeView, requireOptionalNativeModule } from "expo";
import { createContext, use, type ComponentProps } from "react";
import { Platform, ScrollView, type ViewProps } from "react-native";
// oxlint-disable-next-line eslint/no-restricted-imports -- The wrapper every screen must use.
import { ScrollViewMarker } from "react-native-screens";
import { nativeHeaderScrollEdgeEffects } from "./scrollEdgeEffects";

type ScrollEdgeEffects = ComponentProps<typeof ScrollViewMarker>["scrollEdgeEffects"];

const DEFAULT_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

export const NativeScrollEdgeEffectsContext = createContext<ScrollEdgeEffects>(undefined);

function resolveScrollEdgeBleed() {
  try {
    const module = requireOptionalNativeModule<{
      readonly ViewPrototypes?: { readonly SupatermNativeControls_ScrollEdgeBleed?: unknown };
    }>("SupatermNativeControls");
    if (!module?.ViewPrototypes?.SupatermNativeControls_ScrollEdgeBleed) return null;
    return requireNativeView<ViewProps>("SupatermNativeControls", "ScrollEdgeBleed");
  } catch {
    return null;
  }
}

const ScrollEdgeBleed = Platform.OS === "ios" ? resolveScrollEdgeBleed() : null;

export function NativeScrollViewMarker(props: ComponentProps<typeof ScrollViewMarker>) {
  const effects = use(NativeScrollEdgeEffectsContext);
  const marker = (
    <ScrollViewMarker
      {...props}
      {...(ScrollEdgeBleed ? { style: { flex: 1 } } : {})}
      scrollEdgeEffects={props.scrollEdgeEffects ?? effects ?? DEFAULT_SCROLL_EDGE_EFFECTS}
    />
  );
  return ScrollEdgeBleed ? <ScrollEdgeBleed style={props.style}>{marker}</ScrollEdgeBleed> : marker;
}

export function NativeScrollView(props: ComponentProps<typeof ScrollView>) {
  const scrollView = <ScrollView {...props} />;
  return Platform.OS === "ios" ? (
    <NativeScrollViewMarker style={{ flex: 1 }}>{scrollView}</NativeScrollViewMarker>
  ) : (
    scrollView
  );
}
