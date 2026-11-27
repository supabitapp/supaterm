import { TailnetHttpsState, TailnetOwner } from "@supaterm/contracts";
import * as Schema from "effect/Schema";

export const TAILNET_PROTOCOL_VERSION = 1;

const Version = Schema.Literal(TAILNET_PROTOCOL_VERSION);

export const SidecarStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("starting") }),
  Schema.Struct({ state: Schema.Literal("needs-login"), loginUrl: Schema.NullOr(Schema.String) }),
  Schema.Struct({ state: Schema.Literal("needs-approval") }),
  Schema.Struct({
    state: Schema.Literal("running"),
    dnsName: Schema.String,
    addresses: Schema.Array(Schema.String),
    owner: TailnetOwner,
    https: TailnetHttpsState,
    httpsError: Schema.optionalKey(Schema.String),
    keyExpiry: Schema.NullOr(Schema.String),
    health: Schema.Array(Schema.String),
  }),
  Schema.Struct({ state: Schema.Literal("stopped") }),
]);
export type SidecarStatus = typeof SidecarStatus.Type;

export const SidecarEvent = Schema.Union([
  Schema.Struct({
    version: Version,
    type: Schema.Literal("hello"),
    tailscaleVersion: Schema.String,
  }),
  Schema.Struct({ version: Version, type: Schema.Literal("status"), status: SidecarStatus }),
  Schema.Struct({
    version: Version,
    type: Schema.Literal("error"),
    code: Schema.String,
    message: Schema.String,
  }),
]);
export type SidecarEvent = typeof SidecarEvent.Type;

export const SidecarCommand = Schema.Union([
  Schema.Struct({
    version: Version,
    type: Schema.Literal("start"),
    stateDir: Schema.String,
    hostname: Schema.String,
    controlUrl: Schema.NullOr(Schema.String),
    authKey: Schema.NullOr(Schema.String),
    advertiseTags: Schema.Array(Schema.String),
    ingressAddress: Schema.String,
    ingressSecret: Schema.String,
    verbose: Schema.Boolean,
  }),
  Schema.Struct({ version: Version, type: Schema.Literal("login") }),
  Schema.Struct({ version: Version, type: Schema.Literal("logout") }),
]);
export type SidecarCommand = typeof SidecarCommand.Type;

export const TailnetCallerIdentity = Schema.Struct({ login: Schema.String });
export type TailnetCallerIdentity = typeof TailnetCallerIdentity.Type;

export const IngressPreamble = Schema.Struct({
  version: Version,
  secret: Schema.String,
  tls: Schema.Boolean,
  remoteAddress: Schema.String,
  remotePort: Schema.Number,
  identity: Schema.NullOr(TailnetCallerIdentity),
});
export type IngressPreamble = typeof IngressPreamble.Type;
