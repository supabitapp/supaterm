import { useAtomValue } from "@effect/atom-react";
import {
  type LinkableMachine,
  linkableMachine,
  supportsPeerLinks,
} from "@supaterm/client-runtime/link-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthMcpClientAccess,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { useId, useState } from "react";

import type { LinkIntermediary } from "@supaterm/client-runtime/state/peerLinks";
import { requestConfirmDialog } from "~/confirmDialog";
import type { EnvironmentPresentation } from "~/state/environments";
import {
  linkKnownMachine,
  peerLinkEnvironment,
  useLinkIntermediaries,
  usePeerLinkHosts,
} from "~/state/peerLinks";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { useNowMinute } from "../../hooks/useNowMinute";
import { accessConfig } from "../auth/ConnectAgentSurface";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { type LinkChoice, LINK_OFF, linkPermissionRow } from "./EnvironmentLinkPermissions.logic";
import { failureToast, UNLINK_COMMAND_LABEL } from "./LinkedEnvironmentsSettings";
import { toastManager } from "../ui/toast";

/** What agents on each of the user's other connected machines may do on `target`. */
export function EnvironmentLinkPermissions({
  target,
}: {
  readonly target: EnvironmentPresentation;
}) {
  const hosts = usePeerLinkHosts();
  const sources = hosts.filter((source) => source.environmentId !== target.environmentId);
  const mayMint = useEnvironmentScope(target.environmentId, AuthAccessWriteScope);
  const nowMinute = useNowMinute();
  const shown = supportsPeerLinks(target.serverConfig) && sources.length > 0;
  // Only when this app cannot mint there itself: listing asks every linked machine whether it answers.
  const intermediaries = useLinkIntermediaries(
    target.environmentId,
    shown && (target.connection.phase !== "connected" || !mayMint),
    DateTime.makeUnsafe(nowMinute),
  );
  if (!shown) {
    return null;
  }
  const machine = linkableMachine(target);
  return (
    <div className="space-y-2 border-t border-border/50 py-3 text-xs">
      <p className="text-muted-foreground">
        Agents on your other machines can work on {target.label} at the level you pick. Each machine
        links separately, and only in this direction.
      </p>
      <ul className="space-y-2">
        {sources.map((source) => (
          <SourceLinkRow
            key={source.environmentId}
            source={source}
            target={target}
            machine={machine}
            intermediaries={intermediaries}
          />
        ))}
      </ul>
    </div>
  );
}

function SourceLinkRow({
  source,
  target,
  machine,
  intermediaries,
}: {
  readonly source: EnvironmentPresentation;
  readonly target: EnvironmentPresentation;
  /** `target` as `source` would link it. */
  readonly machine: LinkableMachine;
  /** The machines that can get a pairing code from `target`, when this app cannot. */
  readonly intermediaries: ReadonlyArray<LinkIntermediary>;
}) {
  const labelId = useId();
  const canLink = useAtomValue(peerLinkEnvironment.link.permissionAtom(source.environmentId));
  const canUnlink = useAtomValue(peerLinkEnvironment.unlink.permissionAtom(source.environmentId));
  const canList = useEnvironmentScope(source.environmentId, AuthAccessReadScope);
  const mayMint = useEnvironmentScope(target.environmentId, AuthAccessWriteScope);
  const links = useEnvironmentQuery(
    canList ? peerLinkEnvironment.list({ environmentId: source.environmentId, input: {} }) : null,
  );
  // Links made from another client or the CLI bump nothing this list reads, so showing it asks again.
  useLiveRefresh(
    () => {
      if (!links.isPending) links.refresh();
    },
    { key: `link-permissions:${source.environmentId}`, intervalMs: null, refreshOnShow: true },
  );
  const nowMinute = useNowMinute();
  const unlink = useAtomCommand(peerLinkEnvironment.unlink, { label: UNLINK_COMMAND_LABEL });
  const [busy, setBusy] = useState(false);
  const row = linkPermissionRow({
    links: links.data?.links ?? null,
    listError: links.error,
    sourceId: source.environmentId,
    targetId: target.environmentId,
    now: DateTime.makeUnsafe(nowMinute),
    canLink,
    canUnlink,
    mayMint,
    connected: target.connection.phase === "connected",
    reachable: machine.urls.length > 0,
    sourceLabel: source.label,
    targetLabel: target.label,
    intermediaries,
  });
  const linkAt = async (access: AuthMcpClientAccess) => {
    if (row.grant === null) return;
    setBusy(true);
    const result = await linkKnownMachine({
      sourceId: source.environmentId,
      machine,
      access,
      route: row.grant,
    });
    setBusy(false);
    if (result._tag === "MintFailed" || result._tag === "LinkFailed") {
      failureToast("Could not link the environment", result.failure);
    }
  };
  const forget = async () => {
    setBusy(true);
    const result = await unlink({
      environmentId: source.environmentId,
      input: { environmentId: target.environmentId },
    });
    setBusy(false);
    if (result._tag === "Success") {
      if (result.value.removed && result.value.endedThere !== true) {
        toastManager.add({
          type: "warning",
          title: `${target.label} did not answer`,
          description: `Revoke "Supaterm · ${source.label}" in ${target.label}'s Sharing & access to end the session there too.`,
        });
      }
    } else if (!isAtomCommandInterrupted(result)) {
      failureToast("Could not forget the link", squashAtomCommandFailure(result));
    }
  };
  const choose = async (next: LinkChoice) => {
    if (busy || next === row.value) return;
    const confirmation =
      next === LINK_OFF
        ? `Stop agents on ${source.label} from working on ${target.label}? ${source.label} forgets the link, and its session on ${target.label} ends too if it answers.`
        : row.linked
          ? `Let agents on ${source.label} work on ${target.label} at ${accessConfig[next].label}? ${source.label} links again with a new code. Its old session stays in ${target.label}'s Sharing & access until you revoke it there, and a task starting over the old link right now may need starting again.`
          : null;
    if (
      confirmation !== null &&
      !(await (requestConfirmDialog(confirmation, {
        variant: next === LINK_OFF ? "destructive" : "default",
      }) ?? Promise.resolve(false)))
    ) {
      return;
    }
    await (next === LINK_OFF ? forget() : linkAt(next));
  };
  if (!canList) return null;
  const relinkAccess =
    row.canRelink && row.value !== null && row.value !== LINK_OFF ? row.value : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <span id={labelId} className="min-w-0">
        <span className="block text-foreground">Agents on {source.label}</span>
        {row.note === null ? null : <span className="block text-muted-foreground">{row.note}</span>}
      </span>
      <span className="flex items-center gap-2">
        {row.expired && row.canForget ? (
          <Button
            size="xs"
            variant="outline"
            disabled={busy || links.isPending}
            onClick={() => void forget()}
          >
            Forget
          </Button>
        ) : null}
        {relinkAccess === null ? null : (
          <Button
            size="xs"
            variant="outline"
            disabled={busy || links.isPending}
            onClick={() => void linkAt(relinkAccess)}
          >
            Link again
          </Button>
        )}
        <Select
          value={row.value ?? LINK_OFF}
          disabled={busy || links.isPending || row.value === null}
          onValueChange={(next) => {
            if (next !== null) void choose(next as LinkChoice);
          }}
        >
          <SelectTrigger size="xs" className="w-auto" aria-labelledby={labelId}>
            <SelectValue>
              {row.value === null
                ? "…"
                : row.value === LINK_OFF
                  ? "Off"
                  : accessConfig[row.value].label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem value={LINK_OFF} disabled={!row.canForget}>
              Off
            </SelectItem>
            {AuthMcpClientAccess.literals.map((option) => (
              <SelectItem key={option} value={option} disabled={row.grant === null}>
                <span className="grid min-w-0 gap-0.5 py-0.5">
                  <span className="font-medium text-foreground">{accessConfig[option].label}</span>
                  <span className="text-xs leading-4 text-muted-foreground">
                    {accessConfig[option].description}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </span>
    </li>
  );
}
