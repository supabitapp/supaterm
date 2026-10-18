import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { SourceText } from "@supaterm/mobile-source-text";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { CODE_FONT_FAMILY } from "../../lib/fonts";
import { renderMermaidDiagram } from "../../lib/mermaidRenderer.native";
import { useUniwindTheme } from "../../lib/useUniwindTheme";

type MermaidDiagramRouteParams = {
  readonly source: string;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.25;

function ZoomControls(props: { readonly zoom: number; readonly onZoom: (zoom: number) => void }) {
  const { zoom, onZoom } = props;
  return (
    <View className="flex-row items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom out"
        disabled={zoom === MIN_ZOOM}
        hitSlop={6}
        onPress={() => onZoom(zoom - ZOOM_STEP)}
        className={zoom === MIN_ZOOM ? "px-2 opacity-40" : "px-2"}
      >
        <Text className="text-xl text-foreground">−</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset zoom"
        hitSlop={6}
        onPress={() => onZoom(1)}
        className="px-1"
      >
        <Text className="text-sm text-foreground tabular-nums">{Math.round(zoom * 100)}%</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom in"
        disabled={zoom === MAX_ZOOM}
        hitSlop={6}
        onPress={() => onZoom(zoom + ZOOM_STEP)}
        className={zoom === MAX_ZOOM ? "px-2 opacity-40" : "px-2"}
      >
        <Text className="text-xl text-foreground">+</Text>
      </Pressable>
    </View>
  );
}

export function MermaidDiagramScreen(props: StaticScreenProps<MermaidDiagramRouteParams>) {
  const { source } = props.route.params;
  const navigation = useNavigation();
  const codeText = useUniwindTheme()["--color-md-code-text"];
  const [zoom, setZoom] = useState(1);
  const [result, setResult] = useState<{ source: string; diagram: string | null } | null>(null);
  const diagram = result?.source === source ? result.diagram : undefined;

  useEffect(() => {
    let active = true;
    void renderMermaidDiagram(source).then((rendered) => {
      if (active) setResult({ source, diagram: rendered });
    });
    return () => {
      active = false;
    };
  }, [source]);

  useEffect(() => {
    const controls = <ZoomControls zoom={zoom} onZoom={setZoom} />;
    navigation.setOptions({ headerRight: () => controls });
  }, [navigation, zoom]);

  return (
    <ScrollView className="flex-1 bg-md-code-bg" contentInsetAdjustmentBehavior="automatic">
      <ScrollView horizontal contentContainerStyle={{ padding: 16 }}>
        <SourceText
          selectable
          style={{
            color: codeText,
            fontFamily: CODE_FONT_FAMILY,
            fontSize: 13 * zoom,
            lineHeight: 19 * zoom,
          }}
        >
          {diagram === undefined ? "" : (diagram ?? source)}
        </SourceText>
      </ScrollView>
    </ScrollView>
  );
}
