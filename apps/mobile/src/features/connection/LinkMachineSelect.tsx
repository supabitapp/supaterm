import {
  ANOTHER_ADDRESS,
  type LinkableMachine,
  linkDestination,
} from "@supaterm/client-runtime/link-request";
import { Pressable, View } from "react-native";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "../settings/components/SettingsSection";

/**
 * Shown wherever a link goes to an address this app does not already have for a
 * machine, with where that address leads.
 */
export function LinkAddressWarning(props: { readonly address: string }) {
  return (
    <View
      accessibilityRole="alert"
      className="gap-1 rounded-xl border border-warning-border bg-warning p-3"
    >
      <Text className="font-supaterm-bold text-sm text-warning-foreground">Check this address</Text>
      <Text className="font-sans text-xs leading-snug text-warning-foreground">
        This app cannot confirm it is one of your machines. The pairing code you paste is sent
        there.
      </Text>
      <Text selectable className="font-sans text-xs leading-snug text-warning-foreground">
        {linkDestination(props.address)}
      </Text>
    </View>
  );
}

export function LinkMachineSelect(props: {
  readonly machines: ReadonlyArray<LinkableMachine>;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <SettingsSection title="Machine">
      {props.machines.map((machine, index) => (
        <MachineRow
          key={machine.environmentId}
          machine={machine}
          selected={props.value === machine.environmentId}
          separated={index > 0}
          disabled={props.disabled}
          onPress={() => props.onChange(machine.environmentId)}
        />
      ))}
      <SettingsChoiceRow
        label="Another address…"
        description="Link a machine this app does not know, by its https or Tailscale address."
        selected={props.value === ANOTHER_ADDRESS}
        separated={props.machines.length > 0}
        disabled={props.disabled}
        onPress={() => props.onChange(ANOTHER_ADDRESS)}
      />
    </SettingsSection>
  );
}

function MachineRow(props: {
  readonly machine: LinkableMachine;
  readonly selected: boolean;
  readonly separated: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { machine } = props;
  const status = machine.linked ? "Linked" : machine.connected ? null : "Not connected";
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      className={
        props.separated
          ? "flex-row items-center gap-3 border-t border-border-subtle p-4 active:opacity-70"
          : "flex-row items-center gap-3 p-4 active:opacity-70"
      }
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <EnvironmentMachineSymbol
        kind={machine.machine}
        size={18}
        tintColorClassName="accent-foreground-muted"
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-lg text-foreground android:text-base" numberOfLines={1}>
          {machine.label}
        </Text>
        {status === null ? null : <Text className="text-sm text-foreground-muted">{status}</Text>}
      </View>
      {props.selected ? (
        <SymbolView
          name="checkmark"
          size={18}
          tintColorClassName="accent-icon"
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}
