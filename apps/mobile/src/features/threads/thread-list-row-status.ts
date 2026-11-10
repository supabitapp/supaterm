import type { ThreadRowStatus } from "@supaterm/client-runtime/state/thread-row-status";

const STATUS_LABEL_BY_STATUS: Partial<
  Record<ThreadRowStatus, { label: string; className: string }>
> = {
  approval: { label: "Approval", className: "text-warning-foreground" },
  input: { label: "Input", className: "text-adaptive-indigo-600-300" },
  working: { label: "Working", className: "text-adaptive-sky-600-400" },
  failed: { label: "Failed", className: "text-danger-foreground" },
  limited: { label: "Limited", className: "text-warning-foreground" },
};

/** Cached work status becomes live again only after its environment connects. */
export function resolveThreadListV2RowStatusLabel(input: {
  readonly environmentConnected: boolean;
  readonly status: ThreadRowStatus;
  readonly isUnread: boolean;
  readonly goalActive: boolean;
  readonly mutedClassName: string;
}): { label: string; className: string } | undefined {
  if (!input.environmentConnected) return { label: "Connecting", className: input.mutedClassName };
  if (input.status === "waiting") return { label: "Waiting", className: input.mutedClassName };
  const label = STATUS_LABEL_BY_STATUS[input.status];
  // A native /goal keeps the agent going across turns until it is met.
  if (label && input.status === "working" && input.goalActive) return { ...label, label: "Goal" };
  if (label) return label;
  if (input.isUnread) return { label: "Ready", className: "text-adaptive-emerald-700-300" };
  return undefined;
}
