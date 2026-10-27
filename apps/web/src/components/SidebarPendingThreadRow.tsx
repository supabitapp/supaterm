import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { Clock3Icon } from "@supaterm/icons";
import { memo } from "react";

import { cn } from "../lib/utils";
import type { PendingThreadTurn } from "../state/threadOutbox";

export const SidebarPendingThreadRow = memo(function SidebarPendingThreadRow(props: {
  readonly entry: PendingThreadTurn;
  readonly projectTitle: string | undefined;
  readonly active: boolean;
  readonly onNavigate: (ref: ScopedThreadRef) => unknown;
}) {
  const { entry } = props;
  const creation = entry.payload.input.bootstrap?.createThread;
  if (!creation) return null;
  const status = entry.status === "failed" ? "Could not start" : "Pending";
  return (
    <li className="list-none">
      <button
        type="button"
        data-testid="sidebar-pending-thread-row"
        aria-label={`${creation.title}, ${status}`}
        aria-current={props.active ? "page" : undefined}
        className={cn(
          "flex h-12 w-full cursor-pointer flex-col justify-center gap-0.5 rounded-md px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          props.active ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
        )}
        onClick={() =>
          props.onNavigate(
            scopeThreadRef(entry.payload.environmentId, entry.payload.input.threadId),
          )
        }
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <Clock3Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{creation.title}</span>
        </span>
        <span className="w-full truncate text-xs text-secondary-label">
          {status}
          {props.projectTitle ? ` · ${props.projectTitle}` : ""}
        </span>
      </button>
    </li>
  );
});
