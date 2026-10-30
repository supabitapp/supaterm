import { createContext, use, type ComponentProps } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { ListSection } from "../../../components/ui/ListSection";

export const SettingsSidebarContext = createContext<{ readonly selected: string | null } | null>(
  null,
);

export function SettingsSection(props: ComponentProps<typeof ListSection>) {
  if (!use(SettingsSidebarContext)) return <ListSection {...props} />;
  return (
    <View className="gap-1">
      {props.title ? (
        <View className="flex-row items-center justify-between gap-3 px-2">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            {props.titleIcon}
            <Text textRole="footnote" className="shrink font-supaterm-medium text-foreground-muted">
              {props.title}
            </Text>
          </View>
          {props.trailing}
        </View>
      ) : null}
      <View>{props.children}</View>
      {props.footer ? (
        <Text textRole="footnote" className="px-2 text-foreground-muted">
          {props.footer}
        </Text>
      ) : null}
    </View>
  );
}
