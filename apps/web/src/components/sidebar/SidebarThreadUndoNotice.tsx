import { useAtomValue } from "@effect/atom-react";
import { UndoIcon } from "@supaterm/icons";
import { useState } from "react";

import {
  threadUndoLabel,
  undoLatestThreadAction,
  useThreadUndoNotice,
} from "../../hooks/showThreadUndoNotice";
import { cn } from "../../lib/utils";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { InlineButton } from "../ui/button";
import { SidebarMenuItem } from "../ui/sidebar";

/** Fills the free space in the sidebar footer's utility row, so it never moves or covers the list. */
export function SidebarThreadUndoNotice() {
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const summary = notice
    ? notice.count === 1
      ? notice.action
      : `${notice.action} ${notice.count}`
    : null;

  const [shownSummary, setShownSummary] = useState(summary);
  if (summary && summary !== shownSummary) setShownSummary(summary);
  const text = summary ?? shownSummary;
  if (!text) return null;

  return (
    <SidebarMenuItem
      className="@container flex min-w-0 flex-1"
      aria-hidden={!summary}
      inert={!summary}
    >
      <div
        onTransitionEnd={(event) => {
          if (!summary && event.target === event.currentTarget) setShownSummary(null);
        }}
        className={cn(
          "flex h-6 min-w-0 flex-1 flex-row-reverse flex-wrap gap-x-1 overflow-hidden text-2xs leading-6 whitespace-nowrap text-sidebar-muted-foreground transition-opacity duration-200 ease-out starting:opacity-0",
          !summary && "opacity-0",
        )}
      >
        <InlineButton className="min-w-0 shrink" onClick={undoLatestThreadAction}>
          <span className="flex h-6 min-w-0 flex-wrap justify-end overflow-hidden">
            <UndoIcon className="-ml-4 h-6 w-4 @max-[1rem]:invisible" />
            <span>{threadUndoLabel(keybindings)}</span>
          </span>
        </InlineButton>
        <span>{text},</span>
      </div>
    </SidebarMenuItem>
  );
}
