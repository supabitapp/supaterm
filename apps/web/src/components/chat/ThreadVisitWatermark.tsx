import { useAtomMount } from "@effect/atom-react";
import { createThreadVisitTracker } from "@supaterm/client-runtime/state/thread-visits";
import { type ScopedThreadRef } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { useIsPaneInputOwner } from "../../chatPanes/paneScope";
import { environmentCatalog } from "../../connection/catalog";
import { getDocumentActivity, subscribeDocumentActivity } from "../../lib/documentActivity";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";

const isDocumentViewed = () => {
  const activity = getDocumentActivity();
  return activity.visible && activity.focused;
};

const documentViewedAtom = Atom.make((get) => {
  get.addFinalizer(subscribeDocumentActivity(() => get.setSelf(isDocumentViewed())));
  return isDocumentViewed();
}).pipe(Atom.withLabel("document-viewed"));

const threadVisitTracker = createThreadVisitTracker({
  threadShellAtom: environmentThreadShells.threadShellAtom,
  sessionGenerationAtom: environmentCatalog.sessionGenerationAtom,
  visit: threadEnvironment.visit,
  viewingAtom: documentViewedAtom,
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
