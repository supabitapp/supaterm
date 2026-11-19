import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { threadSupportsProviderHandoff } from "@supaterm/client-runtime/state/thread-workflows";
import type { ThreadStructure } from "@supaterm/client-runtime/state/models";

type ThreadStartMarkers = Pick<
  EnvironmentThreadShell,
  "latestRun" | "latestUserMessageAt" | "runtime"
>;

function threadShellHasStarted(thread: ThreadStartMarkers | null | undefined): boolean {
  return Boolean(
    thread &&
    (thread.latestRun !== null || thread.latestUserMessageAt !== null || thread.runtime !== null),
  );
}

export function threadAllowsProviderSwitch(input: {
  readonly thread: ThreadStartMarkers | null | undefined;
  readonly projection: ThreadStructure | null | undefined;
}): boolean {
  return input.projection != null
    ? threadSupportsProviderHandoff(input.projection)
    : !threadShellHasStarted(input.thread);
}
