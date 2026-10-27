import {
  getSpeedToggle,
  getSpeedToggleNextValue,
  SPEED_TOGGLE_LABELS,
} from "@supaterm/client-runtime/provider-speed-toggle";
import type { ProviderOptionDescriptor, ProviderOptionSelection } from "@supaterm/contracts";
import { getProviderOptionCurrentValue } from "@supaterm/shared/model";
import * as Haptics from "expo-haptics";
import { Platform, Pressable } from "react-native";
import { Zap } from "@supaterm/icons/nodes";
import Svg, { G } from "react-native-svg";
import { withUniwind } from "uniwind";

import { applyProviderOptionSelection } from "../lib/providerOptions";
import { Menu } from "./ui/Menu";
import { NodeIconElements } from "./ui/NodeIcon";
import { useAndroidControlSizing } from "./ui/useAndroidControlSizing";

const ThemedSvg = withUniwind(Svg);

const BOLT_STROKE = {
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function ComposerSpeedToggle(props: {
  readonly provider: string | null | undefined;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly disabled?: boolean;
  readonly onChange: (options: ReadonlyArray<ProviderOptionSelection>) => void;
}) {
  const { scale } = useAndroidControlSizing();
  const speedToggle = getSpeedToggle(props.provider, props.descriptors);
  if (!speedToggle) {
    return null;
  }

  const size = Math.round(18 * scale);
  const on = speedToggle.level !== "off";
  const selectValue = (value: string | boolean) => {
    const options = applyProviderOptionSelection(props.descriptors, {
      id: speedToggle.descriptorId,
      value,
    });
    if (options) {
      void Haptics.selectionAsync();
      props.onChange(options);
    }
  };

  const descriptor = props.descriptors.find(({ id }) => id === speedToggle.descriptorId);
  const offersTierChoice = descriptor?.type === "select" && !props.disabled;
  const button = (
    <Pressable
      accessibilityLabel={SPEED_TOGGLE_LABELS[speedToggle.level]}
      accessibilityHint={offersTierChoice ? "Hold to choose a service tier" : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled, selected: on }}
      className="size-[44px] shrink-0 items-center justify-center rounded-xl active:bg-subtle disabled:opacity-50"
      disabled={props.disabled}
      onPress={() => selectValue(getSpeedToggleNextValue(speedToggle))}
    >
      <ThemedSvg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        colorClassName={on ? "accent-yellow-500" : "accent-icon-muted"}
      >
        {speedToggle.level === "ultrafast" ? (
          <>
            <G
              transform="translate(4.6 1.8) scale(0.85)"
              opacity={0.4}
              fill="currentColor"
              {...BOLT_STROKE}
            >
              <NodeIconElements node={Zap} />
            </G>
            <G transform="translate(-2.4 1.8) scale(0.85)" fill="currentColor" {...BOLT_STROKE}>
              <NodeIconElements node={Zap} />
            </G>
          </>
        ) : (
          <G fill={on ? "currentColor" : "none"} {...BOLT_STROKE}>
            <NodeIconElements node={Zap} />
          </G>
        )}
      </ThemedSvg>
    </Pressable>
  );
  if (!offersTierChoice) {
    return button;
  }

  const currentValue = getProviderOptionCurrentValue(descriptor);
  return (
    <Menu
      accessibilityLabel="Choose a service tier"
      title={descriptor.label}
      shouldOpenOnLongPress
      preservesKeyboard
      style={{ borderRadius: 10.5, overflow: "hidden" }}
      onOpenMenu={() => {
        if (Platform.OS === "ios") {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        }
      }}
      actions={descriptor.options.map((option) => ({
        id: option.id,
        title: option.label,
        subtitle: option.description,
        state: option.id === currentValue ? ("on" as const) : ("off" as const),
      }))}
      onPressAction={({ nativeEvent }) => selectValue(nativeEvent.event)}
    >
      {button}
    </Menu>
  );
}
