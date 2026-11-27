import {
  type ManagedPolicySummary,
  tailnetHostname,
  type TailnetAdmission,
  type TailnetHttpsState,
  type TailnetOwner,
  type TailnetSettings,
  type TailnetStatus,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import { managedCapabilityDenial } from "../contractLabels.ts";
import { managedSettingDenial } from "../managedPolicy.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const TAILNET_KEY_EXPIRY_WARNING_MS = 14 * DAY_MS;
export const TAILSCALE_DNS_ADMIN_URL = "https://login.tailscale.com/admin/dns";

export const TAILNET_MACHINE_NAME_DESCRIPTION = msg(
  "Used for the Tailscale address. With HTTPS on, it appears in public certificate logs.",
);

export interface TailnetAccount {
  readonly title: string;
  readonly detail: string | null;
  readonly action: "sign-in" | "sign-out" | null;
  readonly warnings: ReadonlyArray<string>;
}

interface TailnetViewCommon {
  readonly hostname: string;
  readonly summary: string;
  /** Why the policy holds the Serve switch; a switch that is on stays free so it can be turned off. */
  readonly serveManaged: string | undefined;
}

export type TailnetView = TailnetViewCommon &
  (
    | { readonly kind: "unavailable" | "off"; readonly account: null }
    | {
        readonly kind: "loading" | "starting" | "needs-login" | "needs-approval";
        readonly account: TailnetAccount;
      }
    | {
        readonly kind: "running";
        readonly account: TailnetAccount;
        readonly dnsName: string;
        readonly https: TailnetHttpsState;
        readonly address: string | null;
        readonly addressNote: string | null;
        readonly ownerLogin: string | null;
      }
    | { readonly kind: "crashed"; readonly account: TailnetAccount; readonly retryAt: number }
  );

interface TailnetViewInput {
  readonly status: TailnetStatus | null;
  readonly settings: TailnetSettings;
  readonly machineHostname: string;
  readonly now: number;
  readonly managedPolicy?: ManagedPolicySummary | undefined;
  readonly resolve?: MFunctionType;
}

export function tailnetAdmissionDescription(
  admission: TailnetAdmission,
  ownerLogin: string | null,
  resolve: MFunctionType = mFallback,
): string {
  if (admission === "tailnet") {
    return resolve(msg("Any device your tailnet's access rules allow can connect."));
  }
  return ownerLogin === null
    ? resolve(msg("Only devices signed in to this machine's Tailscale account can connect."))
    : resolve(msg("Only devices signed in as {login} can connect.", { login: ownerLogin }));
}

function ownerDetail(owner: TailnetOwner, resolve: MFunctionType): string {
  return owner.type === "user"
    ? resolve(msg("Signed in as {login}", { login: owner.login }))
    : resolve(msg("Tagged {tags}", { tags: owner.tags.join(", ") }));
}

function keyExpiryWarning(
  keyExpiry: string | null,
  now: number,
  resolve: MFunctionType,
): string | null {
  const expiresAt = keyExpiry === null ? Option.none() : DateTime.make(keyExpiry);
  if (Option.isNone(expiresAt)) return null;
  const remaining = DateTime.toEpochMillis(expiresAt.value) - now;
  if (remaining > TAILNET_KEY_EXPIRY_WARNING_MS) return null;
  if (remaining <= 0) return resolve(msg("Sign-in expired. Sign in again."));
  const days = Math.ceil(remaining / DAY_MS);
  return days === 1
    ? resolve(
        msg(
          "Sign-in expires within a day. Sign in again, or turn off key expiry for this machine in Tailscale.",
        ),
      )
    : resolve(
        msg(
          "{count, plural, one {Sign-in expires in {count} day. Sign in again, or turn off key expiry for this machine in Tailscale.} other {Sign-in expires in {count} days. Sign in again, or turn off key expiry for this machine in Tailscale.}}",
          { count: days },
        ),
      );
}

function addressNote(
  https: TailnetHttpsState,
  httpsError: string | undefined,
  resolve: MFunctionType,
): string | null {
  switch (https) {
    case "ready":
      return null;
    case "provisioning":
      return resolve(msg("Getting an HTTPS certificate…"));
    case "unavailable":
      return resolve(msg("HTTPS certificates are off for this tailnet."));
    case "failed":
      return httpsError === undefined
        ? resolve(msg("Couldn't get an HTTPS certificate."))
        : resolve(msg("Couldn't get an HTTPS certificate. {error}", { error: httpsError }));
  }
}

function unavailableSummary(
  reason: Extract<TailnetStatus, { state: "unavailable" }>["reason"],
  resolve: MFunctionType,
): string {
  switch (reason) {
    case "unsupported-platform":
      return resolve(msg("Built-in Tailscale isn't supported on this system."));
    case "binary-missing":
      return resolve(msg("Built-in Tailscale isn't included in this build."));
    case "managed-policy":
      return resolve(msg("Your organization's policy does not allow built-in Tailscale."));
  }
}

function account(
  title: string,
  detail: string | null,
  action: TailnetAccount["action"] = null,
  warnings: ReadonlyArray<string> = [],
): TailnetAccount {
  return { title, detail, action, warnings };
}

export function tailnetView({
  status,
  settings,
  machineHostname,
  now,
  managedPolicy,
  resolve = mFallback,
}: TailnetViewInput): TailnetView {
  const hostname = tailnetHostname(settings, machineHostname);
  const remoteDenial = managedCapabilityDenial(managedPolicy, "remoteClients", resolve);
  const base = {
    hostname,
    summary: resolve(msg("Reach this machine from your tailnet without the Tailscale app.")),
    serveManaged:
      (settings.enabled ? undefined : remoteDenial) ??
      managedSettingDenial([managedPolicy], ["tailnet.enabled"], resolve),
  };

  const unavailable = (summary: string): TailnetView => ({
    ...base,
    kind: "unavailable",
    account: null,
    summary,
  });
  if (remoteDenial !== undefined) return unavailable(remoteDenial);
  if (status?.state === "unavailable")
    return unavailable(unavailableSummary(status.reason, resolve));
  if (!settings.enabled) return { ...base, kind: "off", account: null };
  if (status === null) {
    return {
      ...base,
      kind: "loading",
      account: account(resolve(msg("Checking Tailscale…")), null),
    };
  }
  switch (status.state) {
    case "off":
    case "starting":
      return {
        ...base,
        kind: "starting",
        account: account(
          resolve(msg("Connecting…")),
          resolve(msg("Joining your tailnet as {hostname}.", { hostname })),
        ),
      };
    case "needs-login":
      return {
        ...base,
        kind: "needs-login",
        account: account(
          resolve(msg("Not signed in")),
          resolve(msg("Sign in with the Tailscale account that should own this machine.")),
          "sign-in",
        ),
      };
    case "needs-approval":
      return {
        ...base,
        kind: "needs-approval",
        account: account(
          resolve(msg("Waiting for approval")),
          resolve(msg("A tailnet admin needs to approve this machine in Tailscale.")),
          "sign-out",
        ),
      };
    case "crashed":
      return {
        ...base,
        kind: "crashed",
        account: account(
          resolve(msg("Tailscale stopped")),
          resolve(msg("{message} Retrying shortly.", { message: status.message })),
        ),
        retryAt: status.retryAt,
      };
    case "running": {
      const dnsName = status.dnsName.replace(/\.$/, "");
      const expiry = keyExpiryWarning(status.keyExpiry, now, resolve);
      return {
        ...base,
        kind: "running",
        account: account(
          resolve(msg("Signed in to Tailscale")),
          ownerDetail(status.owner, resolve),
          "sign-out",
          [...(expiry === null ? [] : [expiry]), ...status.health],
        ),
        dnsName,
        https: status.https,
        address:
          status.https === "ready" || status.https === "provisioning" ? `https://${dnsName}` : null,
        addressNote: addressNote(status.https, status.httpsError, resolve),
        ownerLogin: status.owner.type === "user" ? status.owner.login : null,
      };
    }
  }
}
