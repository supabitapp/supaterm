import { useAtomMount } from "@effect/atom-react";
import { createThreadVisitTracker } from "@supaterm/client-runtime/state/thread-visits";
import { type ScopedThreadRef } from "@supaterm/contracts";

import { useIsPaneInputOwner } from "../../chatPanes/paneScope";
import { environmentCatalog } from "../../connection/catalog";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";

const threadVisitTracker = createThreadVisitTracker({
  threadShellAtom: environmentThreadShells.threadShellAtom,
  sessionGenerationAtom: environmentCatalog.sessionGenerationAtom,
  visit: threadEnvironment.visit,
});

export function ThreadVisitWatermark(props: { readonly threadRef: ScopedThreadRef }) {
  const reading = useIsPaneInputOwner();
  useAtomMount(threadVisitTracker(reading ? props.threadRef : null));
  return null;
}
