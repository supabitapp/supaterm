import type { ThreadRowStatus } from "@supaterm/client-runtime/state/thread-row-status";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../i18n/messages";

const STATUS_LABEL_BY_STATUS: Partial<
  Record<ThreadRowStatus, { label: string; className: string }>
> = {
  approval: {
    label: msg("Approval", { $context: "thread status, waiting for approval" }),
    className: "text-warning-foreground",
  },
  input: {
    label: msg("Input", { $context: "thread status, waiting for user input" }),
    className: "text-adaptive-indigo-600-300",
  },
  working: {
    label: msg("Working", { $context: "thread status" }),
    className: "text-adaptive-sky-600-400",
  },
  failed: {
    label: msg("Failed", { $context: "thread status" }),
    className: "text-danger-foreground",
  },
  limited: {
    label: msg("Limited", { $context: "thread status, usage limit reached" }),
    className: "text-warning-foreground",
  },
};

/** Cached work status becomes live again only after its environment connects. */
export function resolveThreadListV2RowStatusLabel(
  input: {
    readonly environmentConnected: boolean;
    readonly status: ThreadRowStatus;
    readonly isUnread: boolean;
    readonly goalActive: boolean;
    readonly mutedClassName: string;
  },
  resolve: MessageResolver = m,
): { label: string; className: string } | undefined {
  if (!input.environmentConnected)
    return {
      label: resolve(msg("Connecting", { $context: "thread status, environment not connected" })),
      className: input.mutedClassName,
    };
  if (input.status === "waiting")
    return {
      label: resolve(msg("Waiting", { $context: "thread status" })),
      className: input.mutedClassName,
    };
  const label = STATUS_LABEL_BY_STATUS[input.status];
  // A native /goal keeps the agent going across turns until it is met.
  if (label && input.status === "working" && input.goalActive)
    return {
      ...label,
      label: resolve(msg("Goal", { $context: "thread status, working toward a goal" })),
    };
  if (label) return { ...label, label: resolve(label.label) };
  if (input.isUnread)
    return {
      label: resolve(msg("Ready", { $context: "thread status, turn finished" })),
      className: "text-adaptive-emerald-700-300",
    };
  return undefined;
}
