import type { ThreadRowStatus } from "@supaterm/client-runtime/state/thread-row-status";

export function shouldRecedeThreadRow(input: {
  readonly status: ThreadRowStatus;
  readonly selected: boolean;
}): boolean {
  return !input.selected && (input.status === "working" || input.status === "waiting");
}
