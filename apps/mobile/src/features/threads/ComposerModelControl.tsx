import { getPromptControlledTraits } from "@supaterm/client-runtime/model-traits";
import type { ModelSelection, ProviderOptionDescriptor } from "@supaterm/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@supaterm/shared/model";

import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { ProviderIcon, ProviderInstanceIcon } from "../../components/ProviderIcon";
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
          ? currentValue
            ? "On"
            : "Off"
          : (getProviderOptionCurrentLabel(
              descriptor,
              props.selectedModel,
              props.reportedModelSelection,
            ) ?? "Default")
        : undefined;
  const badge = props.modelOption?.providerBadge;

  return (
    <ComposerInlineControl
      accessibilityLabel={`Model and reasoning settings: ${[
        props.label,
        badge?.showBadge ? badge.displayName : null,
        reasoningLabel,
      ]
        .filter(Boolean)
        .join(", ")}`}
      accessibilityHint="Choose a model and reasoning level"
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
      label={props.label}
      secondaryLabel={reasoningLabel}
      maxWidth="100%"
      onPress={props.onPress}
    />
  );
}
