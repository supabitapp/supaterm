import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { PREVIEW_ZOOM, stepPreviewZoom } from "@supaterm/client-runtime/preview-zoom";
import { SourceText } from "@supaterm/mobile-source-text";
import { useEffect, useLayoutEffect, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { CODE_FONT_FAMILY } from "../../lib/fonts";
import { renderMermaidDiagram } from "../../lib/mermaidRenderer.native";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useAppearanceCodeSurface } from "../settings/appearance/useAppearanceCodeSurface";

type MermaidDiagramRouteParams = {
  readonly source: string;
};

function ZoomControls(props: { readonly zoom: number; readonly onZoom: (zoom: number) => void }) {
  const { zoom, onZoom } = props;
  const canZoomOut = zoom > PREVIEW_ZOOM.min;
  const canZoomIn = zoom < PREVIEW_ZOOM.max;
  return (
    <View className="flex-row items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom out"
        disabled={!canZoomOut}
        hitSlop={6}
        onPress={() => onZoom(stepPreviewZoom(zoom, -1))}
        className={canZoomOut ? "px-2" : "px-2 opacity-40"}
      >
        <AppText className="text-xl text-foreground">−</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset zoom"
        hitSlop={6}
        onPress={() => onZoom(1)}
        className="px-1"
      >
        <AppText className="text-sm text-foreground tabular-nums">
          {Math.round(zoom * 100)}%
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom in"
        disabled={!canZoomIn}
        hitSlop={6}
        onPress={() => onZoom(stepPreviewZoom(zoom, 1))}
        className={canZoomIn ? "px-2" : "px-2 opacity-40"}
      >
        <AppText className="text-xl text-foreground">+</AppText>
      </Pressable>
    </View>
  );
}

export function MermaidDiagramScreen(props: StaticScreenProps<MermaidDiagramRouteParams>) {
  const { source } = props.route.params;
  const navigation = useNavigation();
  const codeText = useUniwindTheme()["--color-md-code-text"];
  const { codeSurface } = useAppearanceCodeSurface();
  const [zoom, setZoom] = useState(1);
  // The source rather than the diagram travels in the route, since route params are
  // serialized into the workspace path; rendering hits the cache the block just filled.
  const [diagram, setDiagram] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void renderMermaidDiagram(source).then((rendered) => {
      if (active) setDiagram(rendered ?? source);
    });
    return () => {
      active = false;
    };
  }, [source]);

  useLayoutEffect(() => {
    const controls = <ZoomControls zoom={zoom} onZoom={setZoom} />;
    navigation.setOptions({ headerRight: () => controls });
  }, [navigation, zoom]);

  return (
    <ScrollView className="flex-1 bg-md-code-bg" contentInsetAdjustmentBehavior="automatic">
      <ScrollView horizontal contentContainerStyle={{ padding: 16 }}>
        <SourceText
          selectable
          selectionColorClassName={Platform.OS === "android" ? "accent-focus/32" : undefined}
          style={{
            color: codeText,
            fontFamily: CODE_FONT_FAMILY,
            fontSize: codeSurface.fontSize * zoom,
            lineHeight: codeSurface.rowHeight * zoom,
          }}
        >
          {diagram}
        </SourceText>
      </ScrollView>
    </ScrollView>
  );
}
