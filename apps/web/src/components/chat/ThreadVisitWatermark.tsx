import { useAtomMount } from "@effect/atom-react";
import { createThreadVisitTracker } from "@supaterm/client-runtime/state/thread-visits";
import { type ScopedThreadRef } from "@supaterm/contracts";

import { useIsPaneInputOwner } from "../../chatPanes/paneScope";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";

const threadVisitTracker = createThreadVisitTracker({
  threadShellAtom: environmentThreadShells.threadShellAtom,
  visit: threadEnvironment.visit,
});

// The visit watermark is the one part of the chat view that follows the
// shell's updatedAt, which ticks while a run streams. The tracker subscribes to
// it outside React, so ChatView keeps reading the quiet shell.
export function ThreadVisitWatermark(props: { readonly threadRef: ScopedThreadRef }) {
  // A visit syncs read state to every device, so only the pane the user is in counts as reading.
  // A split pane opens once the user is in it.
  const reading = useIsPaneInputOwner();
  useAtomMount(threadVisitTracker(reading ? props.threadRef : null));
  return null;
}
