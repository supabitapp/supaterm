import {
  getSpeedToggle,
  getSpeedToggleNextValue,
  SPEED_TOGGLE_LABELS,
} from "@supaterm/client-runtime/provider-speed-toggle";
import type { ProviderOptionDescriptor, ProviderOptionSelection } from "@supaterm/contracts";
import { getProviderOptionCurrentValue } from "@supaterm/shared/model";
import * as Haptics from "expo-haptics";
import { Pressable } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

import { applyProviderOptionSelection } from "../lib/providerOptions";
import { Menu } from "./ui/Menu";
import { useAndroidControlSizing } from "./ui/useAndroidControlSizing";

const ThemedSvg = withUniwind(Svg);

const BOLT_PATH =
  "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";

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
      className="size-[44px] shrink-0 items-center justify-center rounded-full active:opacity-70 disabled:opacity-50"
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
            <Path d="m17 2-10 12h7l-1 8 10-12h-7l1-8Z" fill="currentColor" opacity={0.4} />
            <Path d="m11 2-10 12h7l-1 8 10-12h-7l1-8Z" fill="currentColor" />
          </>
        ) : (
          <Path
            d={BOLT_PATH}
            fill={on ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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
