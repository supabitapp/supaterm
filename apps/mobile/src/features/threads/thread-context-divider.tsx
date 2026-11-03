import type { ReactNode } from "react";
import { Pressable, View, type ColorValue } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { ShimmeringWorkContent } from "./thread-work-log";

export function ThreadContextDivider(props: {
  label: string;
  icon: AppSymbolName;
  iconColor: ColorValue;
  active?: boolean;
  failed?: boolean;
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const content = (
    <>
      <SymbolView name={props.icon} size={12} tintColor={props.iconColor} type="monochrome" />
      {props.active ? (
        <ShimmeringWorkContent
          className="flex-none"
          textClassName="font-supaterm-medium"
          compact
          icon="brain"
          iconSubtleColor={props.iconColor}
          label={props.label}
          showIcon={false}
        />
      ) : (
        <Text
          className={
            props.failed
              ? "font-supaterm-medium text-xs text-danger-foreground"
              : "font-supaterm-medium text-xs text-foreground-muted"
          }
        >
          {props.label}
        </Text>
      )}
      {props.children}
    </>
  );
  return (
    <View className="mb-3 flex-row items-center gap-3 px-1 py-1">
      <View className="h-px min-w-2 flex-1 bg-separator" />
      {props.onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.accessibilityLabel}
          accessibilityHint={props.accessibilityHint}
          onPress={props.onPress}
          className="shrink flex-row items-center gap-1.5 rounded-full border border-border px-2.5 py-1 active:opacity-70"
        >
          {content}
        </Pressable>
      ) : (
        <View className="shrink flex-row flex-wrap items-center justify-center gap-1.5">
          {content}
        </View>
      )}
      <View className="h-px min-w-2 flex-1 bg-separator" />
    </View>
  );
}
