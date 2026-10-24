import type { PushEnvironmentState } from "./pushRegistrar";

export function describePushEnvironmentState(state: PushEnvironmentState | undefined): string {
  switch (state?.state) {
    case undefined:
    case "off":
      return "Off";
    case "unsupported":
      return "Not available in this build";
    case "permission-denied":
      return "Allow notifications in iOS Settings";
    case "verifying":
      return "Verifying this device…";
    case "waiting":
      return "Finishes setup when the environment connects";
    case "active":
      return state.lastDeliveryAt === null
        ? "On"
        : `On · last alert ${new Date(state.lastDeliveryAt).toLocaleString()}`;
    case "revoked":
      return "Removed on the host";
    case "origin-not-allowed":
      return `The host does not allow ${state.origin}. Add it in the host's notification settings.`;
    case "host-unsupported":
      return "Update this environment to use notifications";
    case "host-disabled":
      return "Turned off on the host";
    case "gateway-unreachable":
      return "Cannot reach the notification service";
    case "error":
      return state.message;
  }
}
