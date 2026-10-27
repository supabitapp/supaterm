import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { threadSupportsProviderHandoff } from "@supaterm/client-runtime/state/thread-workflows";
import type { OrchestrationV2ThreadProjection } from "@supaterm/contracts";

type ThreadStartMarkers = Pick<
  EnvironmentThreadShell,
  "latestRun" | "latestUserMessageAt" | "runtime" | "sideChat"
>;

function threadShellHasStarted(thread: ThreadStartMarkers | null | undefined): boolean {
  return Boolean(
    thread &&
    (thread.latestRun !== null || thread.latestUserMessageAt !== null || thread.runtime !== null),
  );
}

export function threadAllowsProviderSwitch(input: {
  readonly thread: ThreadStartMarkers | null | undefined;
  readonly projection: OrchestrationV2ThreadProjection | null | undefined;
}): boolean {
  // A switched side chat would lose the parent history it exists to ask about,
  // so the server keeps it on its parent's provider until it is promoted.
  if (input.thread?.sideChat === true) return false;
  return input.projection != null
    ? threadSupportsProviderHandoff(input.projection)
    : !threadShellHasStarted(input.thread);
}
