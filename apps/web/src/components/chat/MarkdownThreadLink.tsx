import { unknownThreadLinkLabel } from "@supaterm/shared/threadLinksCopy";
import { useMessages } from "gt-react";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { resolveLinkedThreadOpen } from "@supaterm/client-runtime/linked-thread";
import type { EnvironmentId, ScopedThreadRef } from "@supaterm/contracts";
import { MessagesSquareIcon } from "@supaterm/icons";
import {
  formatThreadLink,
  guessThreadLinkRef,
  threadLinkCandidates,
  type ThreadLink,
} from "@supaterm/shared/threadLinks";

import {
  useShellOmitsThreads,
  useSubagentChildTitles,
  useThreadLinkMetadataSupported,
  useThreadRefs,
  useThreadShell,
} from "../../state/entities";
import { useRightPanelStore } from "../../rightPanelStore";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../../state/environments";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useLinkedThreadLabel } from "../../state/peerLinks";
import { useEnvironmentQuery } from "../../state/query";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { UnresolvedChip } from "../contextChipParts";
import { ThreadContextChip } from "../ThreadContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * `label` is the link's written text; an autolink has none. `threadRef` is the thread whose
 * message holds the link; a linked environment's thread opens read-only in its right panel.
 */
export function MarkdownThreadLink(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly link: ThreadLink;
  readonly label: string | null;
}) {
  const messages = useMessages();
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
  const saved = useEnvironmentIdentities().some(
    (environment) => environment.environmentId === environmentId,
  );
  const connected = useConnectedEnvironmentIds().includes(environmentId);
  // A thread on a machine this client is not connected to still reads through the one that links to it.
  const linkedLabel = useLinkedThreadLabel(
    connected || environmentId === props.environmentId ? null : props.environmentId,
    environmentId,
  );
  const panelRef = props.threadRef;
  // A shell cached from an earlier connection does not make the thread open there now. Outside a
  // thread there is no panel to read it in, so the link behaves as it does without one.
  if (
    panelRef !== null &&
    linkedLabel !== undefined &&
    resolveLinkedThreadOpen({
      environmentId,
      viaEnvironmentId: props.environmentId,
      own: saved ? { connected } : undefined,
      linked: true,
    }) === "linked"
  ) {
    const knownTitle = props.label ?? written?.title ?? null;
    const title = knownTitle ?? `Thread on ${linkedLabel}`;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <ContextChip
              kind="thread"
              render={
                <button
                  type="button"
                  onClick={() =>
                    useRightPanelStore.getState().openLinkedThread(panelRef, {
                      viaEnvironmentId: props.environmentId,
                      ...writtenRef,
                      label: linkedLabel,
                      title: knownTitle,
                    })
                  }
                />
              }
              aria-label={`Thread, ${title}`}
            >
              <MessagesSquareIcon />
              <ContextChipLabel>{title}</ContextChipLabel>
            </ContextChip>
          }
        />
        <TooltipPopup side="top">Read the thread on {linkedLabel}</TooltipPopup>
      </Tooltip>
    );
  }
  if (missing && resolved === null && childRef === null && !mayBeOmitted) {
    const unknown = unknownThreadLinkLabel(props.link, props.environmentId, messages);
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
