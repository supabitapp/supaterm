import { useNavigation } from "@react-navigation/native";
import { CODE_FONT_FAMILY } from "../lib/fonts";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import { SymbolView } from "../components/ui/AppSymbol";
import { CopyTextButton } from "../features/threads/CopyTextButton";
import { SourceText } from "@supaterm/mobile-source-text";
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
  readonly renderDiagram: ((source: string) => Promise<string | null>) | null;
}) {
  const navigation = useNavigation();
  const [result, setResult] = useState<{ source: string; text: string | null } | null>(null);
  const [sourceSelected, setSourceSelected] = useState(false);
  const diagram = renderDiagram && result?.source === source ? result.text : null;
  const showDiagram = diagram !== null && !sourceSelected;
  const content = showDiagram ? diagram : source;
  const fontSize = Math.max(10, Math.round(textStyle.fontSize * 0.8));
  const failed = renderDiagram !== null && result?.source === source && result.text === null;

  useEffect(() => {
    if (!renderDiagram) return;
    let active = true;
    void renderDiagram(source).then(
      (text) => {
        if (active) setResult({ source, text });
      },
      () => {
        if (active) setResult({ source, text: null });
      },
    );
    return () => {
      active = false;
    };
  }, [renderDiagram, source]);

  return (
    <View
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
          accessibilityLabel={showDiagram ? "Copy diagram" : "Copy Mermaid source"}
          text={content}
          tintColor={textStyle.mutedColor}
          copiedTintColor={textStyle.linkColor}
          backgroundColor={textStyle.codeBackgroundColor}
          borderColor={textStyle.dividerColor}
          buttonSize={34}
          iconSize={14}
        />
      </View>
      <ScrollView
        key={showDiagram ? "diagram" : "source"}
        horizontal
        bounces={false}
        nestedScrollEnabled={Platform.OS === "android"}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
      >
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
          {content}
        </SourceText>
      </ScrollView>
    </View>
  );
}
