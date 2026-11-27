import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const TailnetAdmission = Schema.Literals(["owner", "tailnet"]);
export type TailnetAdmission = typeof TailnetAdmission.Type;

export const TailnetHostname = TrimmedString.check(
  Schema.isMaxLength(63),
  Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)?$/),
);

const isControlUrl = Schema.makeFilter(
  (value: string) => {
    if (value === "") return true;
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  },
  { expected: "an http(s) control server URL without credentials, or an empty string" },
);
export const TailnetControlUrl = TrimmedString.check(isControlUrl);

export const TailnetSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  hostname: TailnetHostname.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  admission: TailnetAdmission.pipe(Schema.withDecodingDefault(Effect.succeed("owner"))),
  allowedLogins: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  controlUrl: TailnetControlUrl.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type TailnetSettings = typeof TailnetSettings.Type;

export const TailnetSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  hostname: Schema.optionalKey(TailnetHostname),
  admission: Schema.optionalKey(TailnetAdmission),
  allowedLogins: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  controlUrl: Schema.optionalKey(TailnetControlUrl),
});
export type TailnetSettingsPatch = typeof TailnetSettingsPatch.Type;

export const TailnetOwner = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("user"),
    login: Schema.String,
    displayName: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("tagged"),
    tags: Schema.Array(Schema.String),
  }),
]);
export type TailnetOwner = typeof TailnetOwner.Type;

export const TailnetHttpsState = Schema.Literals([
  "ready",
  "provisioning",
  "unavailable",
  "failed",
]);
export type TailnetHttpsState = typeof TailnetHttpsState.Type;

export const TailnetRunning = Schema.Struct({
  state: Schema.Literal("running"),
  dnsName: Schema.String,
  addresses: Schema.Array(Schema.String),
  owner: TailnetOwner,
  https: TailnetHttpsState,
  httpsError: Schema.optionalKey(Schema.String),
  keyExpiry: Schema.NullOr(Schema.String),
  health: Schema.Array(Schema.String),
});
export type TailnetRunning = typeof TailnetRunning.Type;

export const TailnetUnavailableReason = Schema.Literals([
  "binary-missing",
  "unsupported-platform",
  "managed-policy",
]);

export const TailnetStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("off") }),
  Schema.Struct({ state: Schema.Literal("unavailable"), reason: TailnetUnavailableReason }),
  Schema.Struct({ state: Schema.Literal("starting") }),
  Schema.Struct({ state: Schema.Literal("needs-login"), loginReady: Schema.Boolean }),
  Schema.Struct({ state: Schema.Literal("needs-approval") }),
  TailnetRunning,
  Schema.Struct({
    state: Schema.Literal("crashed"),
    message: Schema.String,
    retryAt: Schema.Number,
  }),
]);
export type TailnetStatus = typeof TailnetStatus.Type;

export const TailnetLoginResult = Schema.Struct({ loginUrl: Schema.String });
export type TailnetLoginResult = typeof TailnetLoginResult.Type;

export class TailnetActionError extends Schema.TaggedError<TailnetActionError>()(
  "TailnetActionError",
  {
    reason: Schema.Literals([
      "off",
      "unavailable",
      "managed-policy",
      "signed-in",
      "timeout",
      "failed",
    ]),
    /** For `managed-policy`: the refusal naming the administrator's organization. */
    detail: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Defect()),
  },
  { httpApiStatus: 503 },
) {
  override get message(): string {
    switch (this.reason) {
      case "off":
        return "Built-in Tailscale is turned off.";
      case "unavailable":
        return "Built-in Tailscale is not available in this build.";
      case "managed-policy":
        return this.detail ?? "Your organization's policy does not allow built-in Tailscale.";
      case "signed-in":
        return "Built-in Tailscale is already signed in.";
      case "timeout":
        return "Tailscale did not respond in time.";
      case "failed":
        return "Tailscale could not complete the request.";
    }
  }
}

export const TAILNET_REFUSED_ERROR = "tailnet_identity_refused";

function defaultTailnetHostname(machineHostname: string): string {
  const label = machineHostname
    .toLowerCase()
    .split(".")[0]!
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54)
    .replace(/-+$/g, "");
  return label === "" ? "supaterm" : `supaterm-${label}`;
}

export function tailnetHostname(settings: TailnetSettings, machineHostname: string): string {
  return settings.hostname === "" ? defaultTailnetHostname(machineHostname) : settings.hostname;
}

export function isTailnetCallerAdmitted(input: {
  readonly settings: Pick<TailnetSettings, "admission" | "allowedLogins">;
  readonly owner: TailnetOwner | null;
  readonly callerLogin: string | null;
}): boolean {
  if (input.callerLogin === null) return false;
  if (input.settings.admission === "tailnet") return true;
  const caller = input.callerLogin.toLowerCase();
  if (input.owner?.type === "user" && input.owner.login.toLowerCase() === caller) return true;
  return input.settings.allowedLogins.some((login) => login.toLowerCase() === caller);
}
