import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { PREVIEW_ZOOM, stepPreviewZoom } from "@supaterm/client-runtime/preview-zoom";
import { SourceText } from "@supaterm/mobile-source-text";
import { useEffect, useLayoutEffect, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { diagramOptions, type Diagram } from "@supaterm/mermaid/diagram";
import { NativeMermaidSvg } from "../../native/NativeMermaidSvg";
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
  const [width, setWidth] = useState(0);
  const [result, setResult] = useState<{ source: string; diagram: Diagram | null } | null>(null);
  const diagram = result?.source === source ? result.diagram : null;

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Keeps the native diagram renderer in sync with source and measured viewport width.
  useEffect(() => {
    if (!width) return;
    let active = true;
    void renderMermaidDiagram(source, { maxWidth: width }).then((rendered) => {
      if (active) {
        setResult((previous) =>
          rendered === null && previous?.source === source
            ? previous
            : { source, diagram: rendered },
        );
      }
    });
    return () => {
      active = false;
    };
  }, [source, width]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Updates the navigation header with the current zoom controls.
  useLayoutEffect(() => {
    const controls = <ZoomControls zoom={zoom} onZoom={setZoom} />;
    navigation.setOptions({ headerRight: () => controls });
  }, [navigation, zoom]);

  const sourceText = (
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
      {source}
    </SourceText>
  );

  return (
    <ScrollView
      className="flex-1 bg-md-code-bg"
      contentInsetAdjustmentBehavior="automatic"
      onLayout={(event) =>
        setWidth(diagramOptions({ maxWidth: event.nativeEvent.layout.width - 32 }).maxWidth)
      }
    >
      <ScrollView horizontal contentContainerStyle={{ padding: 16 }}>
        {diagram ? (
          <NativeMermaidSvg diagram={diagram} zoom={zoom} fallback={sourceText} />
        ) : (
          sourceText
        )}
      </ScrollView>
    </ScrollView>
  );
}
