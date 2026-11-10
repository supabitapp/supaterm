import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { PREVIEW_ZOOM, stepPreviewZoom } from "@supaterm/client-runtime/preview-zoom";
import { SourceText } from "@supaterm/mobile-source-text";
import { useEffect, useState } from "react";
import { Platform, ScrollView, View } from "react-native";

import { diagramOptions, type Diagram } from "@supaterm/mermaid/diagram";
import { NativeMermaidSvg } from "../../native/NativeMermaidSvg";
import { AppBar } from "../../components/ui/AppBar";
import { CODE_FONT_FAMILY } from "../../lib/fonts";
import { renderMermaidDiagram } from "../../lib/mermaidRenderer.native";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useAppearanceCodeSurface } from "../settings/appearance/useAppearanceCodeSurface";

type MermaidDiagramRouteParams = {
  readonly source: string;
};

export function MermaidDiagramScreen(props: StaticScreenProps<MermaidDiagramRouteParams>) {
  const { source } = props.route.params;
  const navigation = useNavigation();
  const codeText = useUniwindTheme()["--color-md-code-text"];
  const { codeSurface } = useAppearanceCodeSurface();
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [result, setResult] = useState<{ source: string; diagram: Diagram | null } | null>(null);
  const diagram = result?.source === source ? result.diagram : null;

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- renders the diagram asynchronously at the measured width and drops results after source or width change
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
    <View className="flex-1 bg-md-code-bg">
      <AppBar
        title="Mermaid"
        subtitle={zoom === 1 ? null : `${Math.round(zoom * 100)}%`}
        onBack={() => navigation.goBack()}
        actions={[
          {
            accessibilityLabel: "Zoom out",
            icon: "minus.magnifyingglass",
            disabled: zoom <= PREVIEW_ZOOM.min,
            separateBackground: false,
            onPress: () => setZoom(stepPreviewZoom(zoom, -1)),
          },
          {
            accessibilityLabel: "Reset zoom",
            icon: "arrow.uturn.backward",
            disabled: zoom === 1,
            separateBackground: false,
            onPress: () => setZoom(1),
          },
          {
            accessibilityLabel: "Zoom in",
            icon: "plus.magnifyingglass",
            disabled: zoom >= PREVIEW_ZOOM.max,
            separateBackground: false,
            onPress: () => setZoom(stepPreviewZoom(zoom, 1)),
          },
        ]}
      />
      <ScrollView
        className="flex-1"
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
    </View>
  );
}
