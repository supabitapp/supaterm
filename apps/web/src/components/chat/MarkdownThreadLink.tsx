import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@supaterm/contracts";
import {
  formatThreadLink,
  guessThreadLinkRef,
  threadLinkCandidates,
  type ThreadLink,
  unknownThreadLinkLabel,
} from "@supaterm/shared/threadLinks";

import {
  useShellOmitsThreads,
  useSubagentChildTitles,
  useThreadLinkMetadataSupported,
  useThreadRefs,
  useThreadShell,
} from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
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
  const candidates = threadLinkCandidates(props.link, props.environmentId);
  const writtenRef = candidates[0]!;
  const environmentId = writtenRef.environmentId;
  const written = useThreadShell(writtenRef);
  const decoded = useThreadShell(written === null ? (candidates[1] ?? null) : null);
  const local = written ?? decoded;
  const canLookUp = useThreadLinkMetadataSupported(environmentId);
  const lookup = useEnvironmentQuery(
    local === null && canLookUp
      ? orchestrationEnvironment.threadLinkMetadata({
          environmentId,
          input: { threadIds: candidates.map((ref) => ref.threadId) },
        })
      : null,
  );
  const target =
    local !== null
      ? { ref: scopeThreadRef(local.environmentId, local.id), metadata: local }
      : (candidates.flatMap((ref) => {
          const metadata = lookup.data?.[ref.threadId];
          return metadata ? [{ ref, metadata }] : [];
        })[0] ?? null);
  const missing = target === null && (!canLookUp || (lookup.isSuccess && !lookup.isPending));
  const guess = missing && props.link.environmentId === null;
  const refs = useThreadRefs(guess);
  const remoteRef = guess
    ? guessThreadLinkRef(
        props.link,
        refs.filter((ref) => ref.environmentId !== environmentId),
      )
    : null;
  const remote = useThreadShell(remoteRef);
  const resolved = target ?? (remoteRef && remote ? { ref: remoteRef, metadata: remote } : null);
  const childTitles = useSubagentChildTitles(
    missing && resolved === null && props.threadRef?.environmentId === environmentId
      ? props.threadRef
      : null,
  );
  const childRef = candidates.find((ref) => childTitles.has(ref.threadId)) ?? null;
  // Reading the family to settle an absence would hold the server's database reader for seconds.
  const mayBeOmitted = useShellOmitsThreads(environmentId) && !canLookUp;
  if (missing && resolved === null && childRef === null && !mayBeOmitted) {
    const unknown = unknownThreadLinkLabel(props.link, props.environmentId);
    return <UnresolvedChip label={props.label ?? unknown} tooltip={unknown} />;
  }
  const ref = resolved?.ref ?? childRef ?? writtenRef;
  const childTitle = childRef === null ? undefined : childTitles.get(childRef.threadId);
  const fallbackTitle = resolved === null && childRef === null ? "Thread" : "Untitled thread";
  const title = resolved?.metadata.title.trim() || childTitle || props.label || fallbackTitle;
  return (
    <ThreadContextChip
      record={{ ...ref, title }}
      projectId={resolved?.metadata.projectId ?? null}
      copyMarkdown={formatThreadLink(ref, title)}
    />
  );
}
