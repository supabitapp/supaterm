import type { StatusTone } from "../../components/StatusPill";
import type { RemoteClientConnectionState } from "../../lib/connection";

export function connectionTone(state: RemoteClientConnectionState): StatusTone;
export function connectionTone(state: RemoteClientConnectionState) {
  switch (state) {
    case "connected":
      return {
        label: "Connected",
        pillClassName: "bg-adaptive-emerald-500-a12-a16",
        textClassName: "text-adaptive-emerald-700-300",
      } satisfies StatusTone;
    case "reconnecting":
      return {
        label: "Reconnecting",
        pillClassName: "bg-warning",
        textClassName: "text-warning-foreground",
      } satisfies StatusTone;
    case "connecting":
      return {
        label: "Connecting",
        pillClassName: "bg-update",
        textClassName: "text-update-foreground",
      } satisfies StatusTone;
    case "unsupported":
      return {
        label: "Client not supported",
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-secondary",
      } satisfies StatusTone;
    case "error":
      return {
        label: "Connection failed",
        pillClassName: "bg-danger",
        textClassName: "text-danger-foreground",
      } satisfies StatusTone;
    case "offline":
      return {
        label: "Offline",
        pillClassName: "bg-danger",
        textClassName: "text-danger-foreground",
      } satisfies StatusTone;
    case "available":
      return {
        label: "Available",
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-secondary",
      } satisfies StatusTone;
  }
}
