import { type EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";
import type { EnvironmentThreadStatus } from "@supaterm/client-runtime/state/threads";
import { msg } from "gt-react-native";

export type ThreadContentPresentation =
  | { readonly kind: "ready" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "unavailable";
      readonly title: string;
      readonly detail: string;
    };

export function projectThreadContentPresentation(input: {
  readonly hasDetail: boolean;
  readonly detailError: string | null;
  readonly detailDeleted: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
}): ThreadContentPresentation {
  if (input.hasDetail) {
    return { kind: "ready" };
  }
  if (input.detailDeleted) {
    return {
      kind: "unavailable",
      title: msg("Thread unavailable"),
      detail: msg("This thread was deleted or is no longer available."),
    };
  }
  if (input.detailError !== null) {
    return {
      kind: "unavailable",
      title: msg("Could not load conversation"),
      detail: input.detailError,
    };
  }
  if (
    input.connectionState === "connected" ||
    input.connectionState === "connecting" ||
    input.connectionState === "reconnecting"
  ) {
    return { kind: "loading" };
  }
  return {
    kind: "unavailable",
    title: msg("Messages not cached"),
    detail: msg("Reconnect this environment to load the conversation."),
  };
}

export function threadSyncStatusLabel(
  status: EnvironmentThreadStatus,
  presentation: ThreadContentPresentation["kind"],
  hasError: boolean,
): string | null {
  if (status !== "empty" && status !== "cached" && status !== "synchronizing") return null;
  if (presentation !== "ready") return null;
  return hasError ? msg("Could not sync messages") : msg("Syncing messages…");
}
