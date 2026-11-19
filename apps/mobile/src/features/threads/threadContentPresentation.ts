import { type EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";
import type { EnvironmentThreadStatus } from "@supaterm/client-runtime/state/threads";

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
}) {
  if (input.hasDetail) {
    return { kind: "ready" } satisfies ThreadContentPresentation;
  }
  if (input.detailDeleted) {
    return {
      kind: "unavailable",
      title: "Thread unavailable",
      detail: "This thread was deleted or is no longer available.",
    } satisfies ThreadContentPresentation;
  }
  if (input.detailError !== null) {
    return {
      kind: "unavailable",
      title: "Could not load conversation",
      detail: input.detailError,
    } satisfies ThreadContentPresentation;
  }
  if (
    input.connectionState === "connected" ||
    input.connectionState === "connecting" ||
    input.connectionState === "reconnecting"
  ) {
    return { kind: "loading" } satisfies ThreadContentPresentation;
  }
  return {
    kind: "unavailable",
    title: "Messages not cached",
    detail: "Reconnect this environment to load the conversation.",
  } satisfies ThreadContentPresentation;
}

export function threadSyncStatusLabel(
  status: EnvironmentThreadStatus,
  presentation: ThreadContentPresentation["kind"],
) {
  if (status !== "empty" && status !== "cached" && status !== "synchronizing") return null;
  return presentation === "ready" ? "Syncing messages…" : null;
}
