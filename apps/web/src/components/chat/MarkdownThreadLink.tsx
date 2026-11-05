import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import {
  formatThreadLink,
  guessThreadLinkRef,
  percentDecodedThreadLinkId,
  type ThreadLink,
  unknownThreadLinkLabel,
} from "@supaterm/shared/threadLinks";

import {
  useShellOmitsThreads,
  useSubagentChildTitles,
  useThreadRefs,
  useThreadShell,
} from "../../state/entities";
import { UnresolvedChip } from "../contextChipParts";
import { ThreadContextChip } from "../ThreadContextChip";

/**
 * `label` is the link's written text; an autolink has none. `threadRef` is the thread whose
 * message holds the link.
 */
export function MarkdownThreadLink(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly link: ThreadLink;
  readonly label: string | null;
}) {
  const environmentId = props.link.environmentId ?? props.environmentId;
  const decodedId = percentDecodedThreadLinkId(props.link.threadId);
  const written = useThreadShell(scopeThreadRef(environmentId, props.link.threadId));
  const decoded = useThreadShell(
    written === null && decodedId !== null ? scopeThreadRef(environmentId, decodedId) : null,
  );
  const local = written ?? decoded;
  const guess = local === null && props.link.environmentId === null;
  const refs = useThreadRefs(guess);
  const remote = useThreadShell(guess ? guessThreadLinkRef(props.link, refs) : null);
  const thread = local ?? remote;
  const childTitles = useSubagentChildTitles(
    thread === null && props.threadRef?.environmentId === environmentId ? props.threadRef : null,
  );
  const childId =
    [props.link.threadId, decodedId].find(
      (id): id is ThreadId => id !== null && childTitles.has(id),
    ) ?? null;
  // Reading the family to settle an absence would hold the server's database reader for seconds.
  const mayBeOmitted = useShellOmitsThreads(environmentId);
  if (thread === null && childId === null && !mayBeOmitted) {
    const unknown = unknownThreadLinkLabel(props.link, props.environmentId);
    return <UnresolvedChip label={props.label ?? unknown} tooltip={unknown} />;
  }
  const ref = scopeThreadRef(
    thread?.environmentId ?? environmentId,
    thread?.id ?? childId ?? props.link.threadId,
  );
  const childTitle = childId === null ? undefined : childTitles.get(childId);
  const fallbackTitle = thread === null && childId === null ? "Thread" : "Untitled thread";
  const title = thread?.title.trim() || childTitle || props.label || fallbackTitle;
  return (
    <ThreadContextChip record={{ ...ref, title }} copyMarkdown={formatThreadLink(ref, title)} />
  );
}
