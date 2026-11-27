import {
  tailnetHostname,
  type TailnetAdmission,
  type TailnetHttpsState,
  type TailnetOwner,
  type TailnetSettings,
  type TailnetStatus,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const DAY_MS = 24 * 60 * 60 * 1000;
const TAILNET_KEY_EXPIRY_WARNING_MS = 14 * DAY_MS;
export const TAILSCALE_DNS_ADMIN_URL = "https://login.tailscale.com/admin/dns";

const TAILNET_SUMMARY = "Reach this machine from your tailnet without the Tailscale app.";
export const TAILNET_MACHINE_NAME_DESCRIPTION =
  "Used for the Tailscale address. With HTTPS on, it appears in public certificate logs.";

export interface TailnetAccount {
  readonly title: string;
  readonly detail: string | null;
  readonly action: "sign-in" | "sign-out" | null;
  readonly warnings: ReadonlyArray<string>;
}

interface TailnetViewCommon {
  readonly hostname: string;
  readonly summary: string;
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
}

export function tailnetAdmissionDescription(
  admission: TailnetAdmission,
  ownerLogin: string | null,
): string {
  if (admission === "tailnet") return "Any device your tailnet's access rules allow can connect.";
  return ownerLogin === null
    ? "Only devices signed in to this machine's Tailscale account can connect."
    : `Only devices signed in as ${ownerLogin} can connect.`;
}

function ownerDetail(owner: TailnetOwner): string {
  return owner.type === "user" ? `Signed in as ${owner.login}` : `Tagged ${owner.tags.join(", ")}`;
}

function keyExpiryWarning(keyExpiry: string | null, now: number): string | null {
  const expiresAt = keyExpiry === null ? Option.none() : DateTime.make(keyExpiry);
  if (Option.isNone(expiresAt)) return null;
  const remaining = DateTime.toEpochMillis(expiresAt.value) - now;
  if (remaining > TAILNET_KEY_EXPIRY_WARNING_MS) return null;
  if (remaining <= 0) return "Sign-in expired. Sign in again.";
  const days = Math.ceil(remaining / DAY_MS);
  const when = days === 1 ? "within a day" : `in ${days} days`;
  return `Sign-in expires ${when}. Sign in again, or turn off key expiry for this machine in Tailscale.`;
}

function addressNote(https: TailnetHttpsState, httpsError: string | undefined): string | null {
  switch (https) {
    case "ready":
      return null;
    case "provisioning":
      return "Getting an HTTPS certificate…";
    case "unavailable":
      return "HTTPS certificates are off for this tailnet.";
    case "failed":
      return httpsError === undefined
        ? "Couldn't get an HTTPS certificate."
        : `Couldn't get an HTTPS certificate. ${httpsError}`;
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
}: TailnetViewInput): TailnetView {
  const hostname = tailnetHostname(settings, machineHostname);
  const base = { hostname, summary: TAILNET_SUMMARY };

  if (status?.state === "unavailable") {
    return {
      ...base,
      kind: "unavailable",
      account: null,
      summary:
        status.reason === "unsupported-platform"
          ? "Built-in Tailscale isn't supported on this system."
          : "Built-in Tailscale isn't included in this build.",
    };
  }
  if (!settings.enabled) return { ...base, kind: "off", account: null };
  if (status === null) {
    return { ...base, kind: "loading", account: account("Checking Tailscale…", null) };
  }
  switch (status.state) {
    case "off":
    case "starting":
      return {
        ...base,
        kind: "starting",
        account: account("Connecting…", `Joining your tailnet as ${hostname}.`),
      };
    case "needs-login":
      return {
        ...base,
        kind: "needs-login",
        account: account(
          "Not signed in",
          "Sign in with the Tailscale account that should own this machine.",
          "sign-in",
        ),
      };
    case "needs-approval":
      return {
        ...base,
        kind: "needs-approval",
        account: account(
          "Waiting for approval",
          "A tailnet admin needs to approve this machine in Tailscale.",
          "sign-out",
        ),
      };
    case "crashed":
      return {
        ...base,
        kind: "crashed",
        account: account("Tailscale stopped", `${status.message} Retrying shortly.`),
        retryAt: status.retryAt,
      };
    case "running": {
      const dnsName = status.dnsName.replace(/\.$/, "");
      const expiry = keyExpiryWarning(status.keyExpiry, now);
      return {
        ...base,
        kind: "running",
        account: account("Signed in to Tailscale", ownerDetail(status.owner), "sign-out", [
          ...(expiry === null ? [] : [expiry]),
          ...status.health,
        ]),
        dnsName,
        https: status.https,
        address:
          status.https === "ready" || status.https === "provisioning" ? `https://${dnsName}` : null,
        addressNote: addressNote(status.https, status.httpsError),
        ownerLogin: status.owner.type === "user" ? status.owner.login : null,
      };
    }
  }
}
