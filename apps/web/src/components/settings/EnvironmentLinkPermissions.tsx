import { useAtomValue } from "@effect/atom-react";
import { machineLinkInput } from "@supaterm/client-runtime/link-request";
import { peerLinkHealth } from "@supaterm/client-runtime/state/peerLinks";
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
import * as Result from "effect/Result";
import { useId, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import type { EnvironmentPresentation } from "~/state/environments";
import { mintPairingCodeOn } from "~/state/peerPairingCode";
import { peerLinkEnvironment, useLinkableMachines, usePeerLinkHosts } from "~/state/peerLinks";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNowMinute } from "../../hooks/useNowMinute";
import { accessConfig } from "../auth/ConnectAgentSurface";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";

const OFF = "off";
type LinkChoice = AuthMcpClientAccess | typeof OFF;

/** What agents on each of the user's other connected machines may do on `target`. */
export function EnvironmentLinkPermissions({
  target,
}: {
  readonly target: EnvironmentPresentation;
}) {
  const sources = usePeerLinkHosts().filter(
    (source) => source.environmentId !== target.environmentId,
  );
  if (target.serverConfig?.environment.capabilities.peerLinks !== true || sources.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2 border-t border-border/50 py-3 text-xs">
      <p className="text-muted-foreground">
        Agents on your other machines can work on {target.label} at the level you pick. Each machine
        links separately, and only in this direction.
      </p>
      <ul className="space-y-2">
        {sources.map((source) => (
          <SourceLinkRow key={source.environmentId} source={source} target={target} />
        ))}
      </ul>
    </div>
  );
}

function SourceLinkRow({
  source,
  target,
}: {
  readonly source: EnvironmentPresentation;
  readonly target: EnvironmentPresentation;
}) {
  const labelId = useId();
  const canLink = useAtomValue(peerLinkEnvironment.link.permissionAtom(source.environmentId));
  const canUnlink = useAtomValue(peerLinkEnvironment.unlink.permissionAtom(source.environmentId));
  const canList = useEnvironmentScope(source.environmentId, AuthAccessReadScope);
  const mayMint = useEnvironmentScope(target.environmentId, AuthAccessWriteScope);
  const links = useEnvironmentQuery(
    canList ? peerLinkEnvironment.list({ environmentId: source.environmentId, input: {} }) : null,
  );
  const machine =
    useLinkableMachines(source.environmentId, false).find(
      (candidate) => candidate.environmentId === target.environmentId,
    ) ?? null;
  const nowMinute = useNowMinute();
  const link = useAtomCommand(peerLinkEnvironment.link, { label: "link environment" });
  const unlink = useAtomCommand(peerLinkEnvironment.unlink, { label: "unlink environment" });
  const [busy, setBusy] = useState(false);
  const current =
    links.data?.links.find((candidate) => candidate.environmentId === target.environmentId) ?? null;
  const health = current === null ? null : peerLinkHealth(current, DateTime.makeUnsafe(nowMinute));
  const value: LinkChoice = current === null || health?.kind === "expired" ? OFF : current.access;
  const blocker = linkBlocker({
    listed: links.data !== null,
    canLink,
    mayMint,
    connected: target.connection.phase === "connected",
    reachable: machine !== null && machine.urls.length > 0,
    sourceLabel: source.label,
    targetLabel: target.label,
  });
  const choose = async (next: LinkChoice) => {
    if (next === value || busy) return;
    if (next === OFF) {
      const confirmed = await (requestConfirmDialog(
        `Stop agents on ${source.label} from working on ${target.label}? ${source.label} forgets the link. Revoke "Supaterm · ${source.label}" in ${target.label}'s Sharing & access to end the session there too.`,
        { variant: "destructive" },
      ) ?? Promise.resolve(false));
      if (!confirmed) return;
      setBusy(true);
      const result = await unlink({
        environmentId: source.environmentId,
        input: { environmentId: target.environmentId },
      });
      setBusy(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        failureToast("Could not forget the link", squashAtomCommandFailure(result));
      }
      return;
    }
    if (machine === null) return;
    setBusy(true);
    const minted = await mintPairingCodeOn(target.environmentId, next);
    const input = Result.isSuccess(minted) ? machineLinkInput(machine, minted.success, next) : null;
    const result =
      input === null ? null : await link({ environmentId: source.environmentId, input });
    setBusy(false);
    if (Result.isFailure(minted)) {
      failureToast("Could not link the environment", minted.failure);
    } else if (result !== null && result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      failureToast("Could not link the environment", squashAtomCommandFailure(result));
    }
  };
  const offDisabled = current === null || !canUnlink;
  if (!canList) return null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <span id={labelId} className="min-w-0">
        <span className="block text-foreground">Agents on {source.label}</span>
        {blocker !== null ? (
          <span className="block text-muted-foreground">{blocker}</span>
        ) : health !== null && health.kind !== "reachable" ? (
          <span className="block text-muted-foreground">{healthText(health)}</span>
        ) : null}
      </span>
      <Select
        value={value}
        disabled={busy || (blocker !== null && current === null)}
        onValueChange={(next) => {
          if (next !== null) void choose(next as LinkChoice);
        }}
      >
        <SelectTrigger size="xs" className="w-auto" aria-labelledby={labelId}>
          <SelectValue>{value === OFF ? "Off" : accessConfig[value].label}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          <SelectItem value={OFF} disabled={offDisabled}>
            Off
          </SelectItem>
          {AuthMcpClientAccess.literals.map((option) => (
            <SelectItem key={option} value={option} disabled={blocker !== null}>
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
    </li>
  );
}

/** Why this client cannot set up the link itself, or null when it can. */
function linkBlocker(input: {
  readonly listed: boolean;
  readonly canLink: boolean;
  readonly mayMint: boolean;
  readonly connected: boolean;
  readonly reachable: boolean;
  readonly sourceLabel: string;
  readonly targetLabel: string;
}): string | null {
  if (!input.listed) return null;
  if (!input.canLink) return `This app may not change links on ${input.sourceLabel}.`;
  if (!input.connected) return `Connect to ${input.targetLabel} to change this.`;
  if (!input.mayMint) return `This app may not grant access on ${input.targetLabel}.`;
  if (!input.reachable) return `${input.sourceLabel} has no address for ${input.targetLabel}.`;
  return null;
}

function healthText(health: ReturnType<typeof peerLinkHealth>): string {
  switch (health.kind) {
    case "expired":
      return "Expired. Pick a level to link again.";
    case "unreachable":
      return health.detail ?? "Not answering right now.";
    case "failing":
      return health.detail;
    case "reachable":
      return "Reachable";
  }
}

const failureToast = (title: string, failure: unknown) =>
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: failure instanceof Error ? failure.message : String(failure),
    }),
  );
