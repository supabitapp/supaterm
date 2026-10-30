import { useAtomValue } from "@effect/atom-react";

import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Alert, AlertDescription } from "../ui/alert";
import { InlineButton } from "../ui/button";

export function SidebarThreadUndoNotice() {
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  if (!notice) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "thread.undo");
  const noun = `${notice.action === "Discarded" ? "draft" : "thread"}${notice.count === 1 ? "" : "s"}`;
  const label =
    notice.action === "Done"
      ? `Marked ${notice.count} ${noun} as Done`
      : `${notice.action} ${notice.count} ${noun}`;

  return (
    <Alert role="status" variant="sidebar">
      <AlertDescription>
        {label},{" "}
        <InlineButton onClick={undoLatestThreadAction}>
          {shortcut ? `${shortcut} to undo` : "Undo"}
        </InlineButton>
      </AlertDescription>
    </Alert>
  );
}
