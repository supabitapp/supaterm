import { getPromptControlledTraits } from "@supaterm/client-runtime/model-traits";
import { getSpeedToggle } from "@supaterm/client-runtime/provider-speed-toggle";
import type { ModelSelection, ProviderOptionDescriptor } from "@supaterm/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@supaterm/shared/model";

import { ComposerInlineControl } from "../../components/ComposerToolbar";
import {
  ProviderIcon,
  ProviderInstanceIcon,
  providerInstanceNameLabel,
} from "../../components/ProviderIcon";
import type { ModelOption } from "../../lib/modelOptions";
import { getReasoningOptionDescriptor } from "../../lib/providerOptions";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { selectableChoices } from "./thread-settings-options";

export function ComposerModelControl(props: {
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly selectedModel: ModelSelection | null;
  readonly reportedModelSelection?: ModelSelection | null;
  readonly modelOption: ModelOption | null;
  readonly label: string;
  readonly prompt: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { themeVariables } = useAppearancePreferences();
  const descriptor = getReasoningOptionDescriptor(props.descriptors);
  const promptTraits = getPromptControlledTraits(props.descriptors, props.prompt);
  const currentValue = getProviderOptionCurrentValue(
    descriptor,
    props.selectedModel,
    props.reportedModelSelection,
  );
  const reasoningLabel =
    promptTraits.ultrathinkPromptControlled &&
    descriptor !== undefined &&
    descriptor.id === promptTraits.primarySelectDescriptor?.id
      ? "Ultrathink"
      : descriptor && (descriptor.type === "boolean" || selectableChoices(descriptor).length > 0)
        ? typeof currentValue === "boolean"
          ? `${descriptor.label} ${currentValue ? "On" : "Off"}`
          : (getProviderOptionCurrentLabel(
              descriptor,
              props.selectedModel,
              props.reportedModelSelection,
            ) ?? "Default")
        : undefined;
  const speed = getSpeedToggle(props.descriptors)?.level;
  const optionLabels = [
    reasoningLabel,
    speed === "fast" ? "Fast" : speed === "ultrafast" ? "Ultrafast" : null,
  ];
  const badge = props.modelOption?.providerBadge;
  const providerNameLabel = badge
    ? providerInstanceNameLabel({
        provider: props.modelOption?.providerDriver,
        iconUrl: props.modelOption?.providerIconUrl,
        displayName: badge.displayName,
        showBadge: badge.showBadge,
      })
    : null;
  const shortLabel = props.modelOption?.shortName ?? props.label;

  return (
    <ComposerInlineControl
      accessibilityLabel={`Model settings: ${[
        props.label,
        badge?.showBadge ? badge.displayName : null,
        ...optionLabels,
      ]
        .filter(Boolean)
        .join(", ")}`}
      accessibilityHint="Choose a model and configure its options"
      compact
      disabled={props.disabled}
      emphasized
      renderIcon={(size) =>
        badge?.showBadge ? (
          <ProviderInstanceIcon
            iconUrl={props.modelOption?.providerIconUrl}
            provider={props.modelOption?.providerDriver}
            displayName={badge.displayName}
            accentColor={badge.accentColor}
            showBadge
            surfaceColor={themeVariables["--color-composer-panel"]}
            size={size}
          />
        ) : (
          <ProviderIcon
            iconUrl={props.modelOption?.providerIconUrl}
            provider={props.modelOption?.providerDriver}
            size={size}
          />
        )
      }
      label={providerNameLabel ?? shortLabel}
      ellipsizeMode={providerNameLabel ? "middle" : undefined}
      secondaryLabel={[providerNameLabel ? shortLabel : null, ...optionLabels]
        .filter(Boolean)
        .join(" · ")}
      secondaryLabelWidth={providerNameLabel ? 96 : undefined}
      maxWidth="100%"
      onPress={props.onPress}
    />
  );
}
