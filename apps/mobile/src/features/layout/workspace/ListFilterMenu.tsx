import { Pressable, View } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { Menu } from "../../../components/ui/Menu";
import type { MenuProps } from "../../../components/ui/Menu.types";
import { ThemedGlassView } from "../../../components/ui/GlassSurface";
import { cn } from "../../../lib/cn";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../../native/native-glass";
import { useAppearancePreferences } from "../../settings/appearance/AppearancePreferencesProvider";

const PILL = "h-8 flex-row items-center gap-1.5 rounded-full px-3";

/** A visible filter with a native menu containing only that filter's choices. */
export function ListFilterMenu(props: {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly active: boolean;
  readonly actions: MenuProps["actions"];
  readonly onSelect: (id: string) => void;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const iconColor = props.active ? "accent-primary-foreground" : "accent-icon-muted";
  const content = (
    <>
      <Text
        numberOfLines={1}
        className={cn(
          "max-w-[180px] text-sm font-supaterm-medium",
          props.active ? "text-primary-foreground" : "text-foreground-muted",
        )}
      >
        {props.label}
      </Text>
      <SymbolView name="chevron.down" size={11} tintColorClassName={iconColor} />
    </>
  );
  return (
    <Menu
      title={props.accessibilityLabel}
      actions={props.actions}
      onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        accessibilityValue={{ text: props.label }}
        accessibilityState={{ selected: props.active }}
        hitSlop={6}
      >
        {NATIVE_LIQUID_GLASS_SUPPORTED ? (
          <ThemedGlassView
            isInteractive
            colorScheme={themeAppearance}
            tintColorClassName={props.active ? "accent-primary" : undefined}
            className={PILL}
          >
            {content}
          </ThemedGlassView>
        ) : (
          <View className={cn(PILL, props.active ? "bg-primary" : "bg-subtle")}>{content}</View>
        )}
      </Pressable>
    </Menu>
  );
}
