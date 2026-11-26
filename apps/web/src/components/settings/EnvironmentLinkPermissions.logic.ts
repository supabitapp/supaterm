import {
  DIRECT_LINK_PAIRING,
  type LinkIntermediary,
  type LinkPairingRoute,
  peerLinkHealth,
  peerLinkHealthText,
} from "@supaterm/client-runtime/state/peerLinks";
import type { AuthMcpClientAccess, EnvironmentId, PeerLinkSummary } from "@supaterm/contracts";
import type * as DateTime from "effect/DateTime";
import { m } from "~/i18n/messages";
import { msg } from "gt-react";

export const LINK_OFF = "off";
export type LinkChoice = AuthMcpClientAccess | typeof LINK_OFF;

/** One source machine's row in a target's Permissions: what it shows and what it allows. */
export interface LinkPermissionRow {
  /** The picker's value, or null while the source's links are not known. */
  readonly value: LinkChoice | null;
  readonly note: string | null;
  /** Where a new link's pairing code comes from, or null while this app cannot grant one. */
  readonly grant: LinkPairingRoute | null;
  readonly canForget: boolean;
  /** An unexpired link exists, so picking another level replaces it. */
  readonly linked: boolean;
  /** An expired link is still saved on the source; it reads as Off, so only Forget removes it. */
  readonly expired: boolean;
  /** The link stopped working, so linking again at the same level repairs it. */
  readonly canRelink: boolean;
}

const UNKNOWN = {
  value: null,
  grant: null,
  canForget: false,
  linked: false,
  expired: false,
  canRelink: false,
} as const;

export function linkPermissionRow(input: {
  readonly links: ReadonlyArray<PeerLinkSummary> | null;
  readonly listError: string | null;
  readonly sourceId: EnvironmentId;
  readonly targetId: EnvironmentId;
  readonly now: DateTime.Utc;
  readonly canLink: boolean;
  readonly canUnlink: boolean;
  readonly mayMint: boolean;
  readonly connected: boolean;
  readonly reachable: boolean;
  readonly sourceLabel: string;
  readonly targetLabel: string;
  /** The machines that can get a pairing code from the target for this app. */
  readonly intermediaries: ReadonlyArray<LinkIntermediary>;
}): LinkPermissionRow {
  // A stale list could hide a link, so nothing changes until the source answers.
  if (input.listError !== null) {
    return {
      ...UNKNOWN,
      note: m(
        msg("Could not read {source}'s links: {error}", {
          source: input.sourceLabel,
          error: input.listError,
        }),
      ),
    };
  }
  if (input.links === null) return { ...UNKNOWN, note: null };
  const current = input.links.find((link) => link.environmentId === input.targetId) ?? null;
  const health = current === null ? null : peerLinkHealth(current, input.now);
  const live = current !== null && health?.kind !== "expired";
  const mintBlocker = !input.connected
    ? m(msg("Connect to {target} to change this.", { target: input.targetLabel }))
    : !input.mayMint
      ? m(msg("This app may not grant access on {target}.", { target: input.targetLabel }))
      : null;
  const intermediary = input.intermediaries.find(
    ({ environmentId }) => environmentId !== input.sourceId,
  );
  const route: LinkPairingRoute | null =
    mintBlocker === null
      ? DIRECT_LINK_PAIRING
      : intermediary === undefined
        ? null
        : { _tag: "Through", intermediary };
  const blocker = !input.canLink
    ? m(msg("This app may not change links on {source}.", { source: input.sourceLabel }))
    : route === null
      ? mintBlocker
      : !input.reachable
        ? m(
            msg("No other machine can reach {target} at an address this app knows.", {
              target: input.targetLabel,
            }),
          )
        : null;
  const grant = blocker === null ? route : null;
  const healthNote =
    health === null || (health.kind === "reachable" && health.expiresInDays === null)
      ? null
      : peerLinkHealthText(health, m);
  const routeNote =
    grant?._tag === "Through"
      ? m(
          msg("{intermediary} links to {target} at full access, so it gets the pairing code.", {
            intermediary: grant.intermediary.label,
            target: input.targetLabel,
          }),
        )
      : null;
  return {
    value: live ? current.access : LINK_OFF,
    note: blocker ?? healthNote ?? routeNote,
    grant,
    canForget: current !== null && input.canUnlink,
    linked: live,
    expired: current !== null && !live,
    canRelink: grant !== null && live && health?.kind === "failing",
  };
}
