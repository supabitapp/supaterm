import { MOBILE_SHAPE } from "../../lib/designTokens";
import { useEffect } from "react";
import { AccessibilityInfo, Platform, View, useWindowDimensions } from "react-native";

import { useControlTheme } from "./useControlTheme";
import { cn } from "../../lib/cn";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { GlassSurface } from "./GlassSurface";
import { IconButton } from "./IconButton";
import { AppActivityIndicator } from "./AppActivityIndicator";
import { SymbolView, type AppSymbolName } from "./AppSymbol";

export interface ToastProps {
  readonly message: string;
  readonly singleLine?: boolean;
  readonly description?: string;
  readonly tone?: "default" | "success" | "danger";
  readonly variant?: "card" | "capsule";
  readonly icon?: AppSymbolName;
  readonly busy?: boolean;
  readonly action?: { readonly label: string; readonly onPress: () => void };
  readonly onDismiss?: () => void;
}

export function Toast(props: ToastProps) {
  const { fontScale } = useWindowDimensions();
  const { colorScheme } = useControlTheme();
  const message =
    props.singleLine && props.description
      ? `${props.message}: ${props.description}`
      : props.message;

  const inlineAction = props.singleLine || (!props.description && fontScale < 1.5);
  const action = props.action ? (
    <Button label={props.action.label} onPress={props.action.onPress} />
  ) : null;

  const capsule = props.variant === "capsule" && inlineAction;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- announces the toast through the native accessibility service
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(props.message);
  }, [props.message]);
  return (
    <GlassSurface
      chrome={Platform.OS === "ios" && colorScheme === "dark" ? "none" : undefined}
      tintColor={Platform.OS === "ios" ? null : undefined}
      className={capsule ? "self-center py-1.5 pl-4 pr-1.5" : "p-3"}
      style={{ borderRadius: MOBILE_SHAPE.toast }}
    >
      <View className="flex-row items-center gap-3">
        {props.busy ? (
          <AppActivityIndicator />
        ) : (
          <SymbolView
            name={
              props.icon ??
              (props.tone === "danger" ? "exclamationmark.triangle" : "checkmark.circle")
            }
            size={20}
            tintColorClassName={
              props.tone === "danger" ? "accent-danger-foreground" : "accent-icon"
            }
          />
        )}
        <View
          className={cn("min-w-0", capsule ? "shrink" : "flex-1")}
          accessibilityLiveRegion="polite"
        >
          <AppText
            textRole="footnote"
            className="font-supaterm-semibold"
            numberOfLines={props.singleLine ? 1 : undefined}
            accessibilityLabel={props.singleLine ? message : undefined}
          >
            {message}
          </AppText>
          {props.description && !props.singleLine ? (
            <AppText textRole="label" className="text-foreground-muted">
              {props.description}
            </AppText>
          ) : null}
        </View>
        {inlineAction && action ? <View className="self-center">{action}</View> : null}
        {props.onDismiss ? (
          <IconButton accessibilityLabel="Dismiss message" icon="xmark" onPress={props.onDismiss} />
        ) : null}
      </View>
      {action && !inlineAction ? <View className="mt-2 self-end">{action}</View> : null}
    </GlassSurface>
  );
}
