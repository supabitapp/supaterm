import { Pressable } from "react-native";
import type { EnvironmentMachineKind } from "@supaterm/contracts";
import type { EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";

import { ConnectionStatusDot } from "../connection/ConnectionStatusDot";

export function DraftEnvironmentControl(props: {
  readonly label: string;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly machineKind: EnvironmentMachineKind;
  readonly disabled: boolean;
  /** Omitted when the draft cannot move to another environment. */
  readonly onChooseEnvironment?: () => void;
}) {
  const disconnected = props.connectionState !== "connected";
  const pickable = props.onChooseEnvironment !== undefined;
  return (
    <Pressable
      accessibilityRole={pickable ? "button" : undefined}
      accessibilityLabel={`${pickable ? "Choose environment, " : "Environment, "}${props.label}, ${disconnected ? "Offline" : "Connected"}`}
      disabled={props.disabled || !pickable}
      onPress={props.onChooseEnvironment}
      className="flex-row items-center gap-1.5 rounded-xl px-3 py-2 active:opacity-65"
    >
      <EnvironmentMachineSymbol
        kind={props.machineKind}
        size={13}
        tintColorClassName="accent-icon-muted"
      />
      <Text className="shrink text-sm text-foreground-muted" numberOfLines={1}>
        on {props.label}
      </Text>
      {pickable ? (
        <SymbolView name="chevron.right" size={11} tintColorClassName="accent-icon-muted" />
      ) : null}
      {disconnected ? <ConnectionStatusDot state="error" pulse={false} size={6} /> : null}
    </Pressable>
  );
}
