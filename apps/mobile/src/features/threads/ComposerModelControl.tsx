import type { ModelSelection, ProviderOptionDescriptor } from "@supaterm/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@supaterm/shared/model";

import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { ProviderIcon } from "../../components/ProviderIcon";
import type { ModelOption } from "../../lib/modelOptions";
import { getReasoningOptionDescriptor } from "../../lib/providerOptions";
import { selectableChoices } from "./thread-settings-options";

export function ComposerModelControl(props: {
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly selectedModel: ModelSelection | null;
  readonly reportedModelSelection?: ModelSelection | null;
  readonly modelOption: ModelOption | null;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const descriptor = getReasoningOptionDescriptor(props.descriptors);
  const currentValue = getProviderOptionCurrentValue(
    descriptor,
    props.selectedModel,
    props.reportedModelSelection,
  );
  const reasoningLabel =
    descriptor && (descriptor.type === "boolean" || selectableChoices(descriptor).length > 0)
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

  return (
    <ComposerInlineControl
      accessibilityLabel={`Model and reasoning settings: ${props.label}${reasoningLabel ? `, ${reasoningLabel}` : ""}`}
      accessibilityHint="Choose a model and reasoning level"
      compact
      disabled={props.disabled}
      emphasized
      renderIcon={(size) => (
        <ProviderIcon
          iconUrl={props.modelOption?.providerIconUrl}
          provider={props.modelOption?.providerDriver}
          size={size}
        />
      )}
      label={props.label}
      secondaryLabel={reasoningLabel}
      maxWidth="100%"
      onPress={props.onPress}
    />
  );
}
