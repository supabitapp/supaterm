import { peerLinkHealth, peerLinkHealthText } from "@supaterm/client-runtime/state/peerLinks";
import type { AuthMcpClientAccess, EnvironmentId, PeerLinkSummary } from "@supaterm/contracts";
import type * as DateTime from "effect/DateTime";

export const LINK_OFF = "off";
export type LinkChoice = AuthMcpClientAccess | typeof LINK_OFF;

/** One source machine's row in a target's Permissions: what it shows and what it allows. */
export interface LinkPermissionRow {
  /** The picker's value, or null while the source's links are not known. */
  readonly value: LinkChoice | null;
  readonly note: string | null;
  readonly canGrant: boolean;
  readonly canForget: boolean;
  /** An unexpired link exists, so picking another level replaces it. */
  readonly linked: boolean;
  /** The link stopped working, so linking again at the same level repairs it. */
  readonly canRelink: boolean;
}

const UNKNOWN = {
  value: null,
  canGrant: false,
  canForget: false,
  linked: false,
  canRelink: false,
} as const;

export function linkPermissionRow(input: {
  readonly links: ReadonlyArray<PeerLinkSummary> | null;
  readonly listError: string | null;
  readonly targetId: EnvironmentId;
  readonly now: DateTime.Utc;
  readonly canLink: boolean;
  readonly canUnlink: boolean;
  readonly mayMint: boolean;
  readonly connected: boolean;
  readonly reachable: boolean;
  readonly sourceLabel: string;
  readonly targetLabel: string;
}): LinkPermissionRow {
  // A stale list could hide a link, so nothing changes until the source answers.
  if (input.listError !== null) {
    return { ...UNKNOWN, note: `Could not read ${input.sourceLabel}'s links: ${input.listError}` };
  }
  if (input.links === null) return { ...UNKNOWN, note: null };
  const current = input.links.find((link) => link.environmentId === input.targetId) ?? null;
  const health = current === null ? null : peerLinkHealth(current, input.now);
  const live = current !== null && health?.kind !== "expired";
  const blocker = !input.canLink
    ? `This app may not change links on ${input.sourceLabel}.`
    : !input.connected
      ? `Connect to ${input.targetLabel} to change this.`
      : !input.mayMint
        ? `This app may not grant access on ${input.targetLabel}.`
        : !input.reachable
          ? `No other machine can reach ${input.targetLabel} at an address this app knows.`
          : null;
  const healthNote =
    health === null || (health.kind === "reachable" && health.expiresInDays === null)
      ? null
      : peerLinkHealthText(health);
  return {
    value: live ? current.access : LINK_OFF,
    note: blocker ?? healthNote,
    canGrant: blocker === null,
    canForget: current !== null && input.canUnlink,
    linked: live,
    canRelink: blocker === null && live && health?.kind === "failing",
  };
}
