import type { EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";

export interface FloatingStatusAction {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

export type FloatingWorkingStatus =
  | {
      readonly kind: "child-input";
      readonly label: string;
      readonly accessibilityLabel: string;
      readonly onPress: () => void;
    }
  | {
      readonly kind: "stop";
      readonly label: string;
      readonly unresponsive: boolean;
      readonly action: FloatingStatusAction | null;
    }
  | { readonly kind: "goal"; readonly label: string; readonly accessibilityLabel: string }
  | { readonly kind: "extension"; readonly label: string; readonly onPress: () => void }
  | { readonly kind: "preparing"; readonly label: string }
  | {
      readonly kind: "connection";
      readonly label: string;
      readonly onPress: () => void;
    };

/** A connection still retrying on its own; short enough for the thread header subtitle. */
export function connectionRetryLabel(input: {
  readonly connectionError: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
}) {
  if (input.connectionState !== "connecting" && input.connectionState !== "reconnecting") {
    return null;
  }
  return input.connectionError === null ? "Reconnecting…" : "Retrying connection…";
}

export function connectionFloatingStatus(input: {
  readonly connectionError: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly environmentLabel: string | null;
  readonly onReconnect: () => void;
}) {
  const environmentLabel = input.environmentLabel ?? "Environment";
  const unavailable = (label: string) =>
    ({
      kind: "connection",
      label,
      onPress: input.onReconnect,
    }) satisfies FloatingWorkingStatus;

  switch (input.connectionState) {
    case "offline":
      return unavailable("You are offline") satisfies FloatingWorkingStatus | null;
    case "unsupported":
      return unavailable("Client not supported") satisfies FloatingWorkingStatus | null;
    case "error":
      return unavailable(
        input.connectionError
          ? `Failed to connect to ${environmentLabel}: ${input.connectionError}`
          : `Failed to connect to ${environmentLabel}`,
      ) satisfies FloatingWorkingStatus | null;
    case "available":
      return unavailable(
        `${environmentLabel} is not connected`,
      ) satisfies FloatingWorkingStatus | null;
    case "connecting":
    case "reconnecting":
    case "connected":
      return null satisfies FloatingWorkingStatus | null;
  }
}
