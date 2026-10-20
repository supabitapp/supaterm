import { useNavigation } from "@react-navigation/native";
import { CODE_FONT_FAMILY } from "../lib/fonts";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import { SymbolView } from "../components/ui/AppSymbol";
import { CopyTextButton } from "../features/threads/CopyTextButton";
import { SourceText } from "@supaterm/mobile-source-text";
import { NativeMermaidSvg } from "./NativeMermaidSvg";
import { diagramOptions, type Diagram, type DiagramOptions } from "@supaterm/mermaid/diagram";
import type { NativeMarkdownTextStyle } from "./SelectableMarkdownText.types";

export function NativeMermaidBlock({
  source,
  textStyle,
  compact,
  renderDiagram,
}: {
  readonly source: string;
  readonly textStyle: NativeMarkdownTextStyle;
  readonly compact?: boolean;
  readonly renderDiagram:
    | ((source: string, options?: DiagramOptions) => Promise<Diagram | null>)
    | null;
}) {
  const navigation = useNavigation();
  const [result, setResult] = useState<{ source: string; diagram: Diagram | null } | null>(null);
  const [sourceSelected, setSourceSelected] = useState(false);
  const diagram = renderDiagram && result?.source === source ? result.diagram : null;
  const showDiagram = diagram !== null && !sourceSelected;
  const [width, setWidth] = useState(0);
  const fontSize = Math.max(10, Math.round(textStyle.fontSize * 0.8));
  const failed = renderDiagram !== null && result?.source === source && result.diagram === null;

  useEffect(() => {
    if (!renderDiagram || !width) return;
    let active = true;
    void renderDiagram(source, { maxWidth: width }).then(
      (diagram) => {
        if (active) setResult({ source, diagram });
      },
      () => {
        if (active) setResult({ source, diagram: null });
      },
    );
    return () => {
      active = false;
    };
  }, [renderDiagram, source, width]);

  const sourceText = (
    <SourceText
      selectable
      selectionColor={textStyle.selectionColor}
      style={{
        color: textStyle.codeColor,
        fontFamily: CODE_FONT_FAMILY,
        fontSize,
        lineHeight: fontSize + 6,
      }}
    >
      {source}
    </SourceText>
  );

  return (
    <View
      onLayout={(event) =>
        setWidth(diagramOptions({ maxWidth: event.nativeEvent.layout.width - 28 }).maxWidth)
      }
      style={{
        backgroundColor: textStyle.codeBlockBackgroundColor,
        borderColor: textStyle.dividerColor,
        borderRadius: 10,
        borderWidth: 1,
        marginVertical: compact ? 7 : 0,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          minHeight: 42,
          borderBottomColor: textStyle.dividerColor,
          borderBottomWidth: 1,
          paddingLeft: 14,
          paddingRight: 6,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text style={{ flex: 1, color: textStyle.mutedColor, fontSize }}>
          {failed ? "Mermaid · diagram unavailable" : "Mermaid"}
        </Text>
        {diagram !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showDiagram ? "View Mermaid source" : "View diagram"}
            onPress={() => setSourceSelected((selected) => !selected)}
            style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.52 : 1 })}
          >
            <Text style={{ color: textStyle.linkColor, fontSize }}>
              {showDiagram ? "View Source" : "View Diagram"}
            </Text>
          </Pressable>
        ) : null}
        {diagram !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open diagram full screen"
            hitSlop={8}
            onPress={() => navigation.navigate("MermaidDiagram", { source })}
            style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.52 : 1 })}
          >
            <SymbolView
              name="arrow.up.left.and.arrow.down.right"
              size={12}
              tintColor={textStyle.mutedColor}
              type="monochrome"
            />
          </Pressable>
        ) : null}
        <CopyTextButton
          accessibilityLabel="Copy Mermaid source"
          text={source}
          tintColor={textStyle.mutedColor}
          copiedTintColor={textStyle.linkColor}
          backgroundColor={textStyle.codeBackgroundColor}
          borderColor={textStyle.dividerColor}
          buttonSize={34}
          iconSize={14}
        />
      </View>
      {showDiagram ? (
        <ScrollView style={{ maxHeight: 480 }} nestedScrollEnabled bounces={false}>
          <ScrollView horizontal nestedScrollEnabled contentContainerStyle={{ padding: 12 }}>
            <NativeMermaidSvg diagram={diagram} fallback={sourceText} />
          </ScrollView>
        </ScrollView>
      ) : (
        <ScrollView
          horizontal
          bounces={false}
          nestedScrollEnabled={Platform.OS === "android"}
          contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
        >
          {sourceText}
        </ScrollView>
      )}
    </View>
  );
}
