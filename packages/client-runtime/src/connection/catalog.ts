import { DesktopSshEnvironmentTargetSchema, EnvironmentId } from "@supaterm/contracts";
import { upgradeRelayAddresses } from "@supaterm/shared/relay/protocol";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  SshConnectionTarget,
  type ConnectionTarget,
} from "./model.ts";

const BaseUrl = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: upgradeRelayAddresses,
      encode: (value) => value,
    }),
  ),
);

const ConnectionProfileBase = {
  connectionId: Schema.String,
  environmentId: EnvironmentId,
  label: Schema.String,
};

export class BearerConnectionProfile extends Schema.TaggedClass<BearerConnectionProfile>()(
  "BearerConnectionProfile",
  {
    ...ConnectionProfileBase,
    httpBaseUrl: BaseUrl,
    wsBaseUrl: BaseUrl,
    /** Learned from the server's direct endpoint advertisement. */
    learned: Schema.optionalKey(Schema.Literal(true)),
    network: Schema.optionalKey(Schema.Literal("tailscale")),
    relayUrl: Schema.optionalKey(Schema.String),
  },
) {}

export class SshConnectionProfile extends Schema.TaggedClass<SshConnectionProfile>()(
  "SshConnectionProfile",
  {
    ...ConnectionProfileBase,
    target: DesktopSshEnvironmentTargetSchema,
  },
) {}

export const ConnectionProfile = Schema.Union([BearerConnectionProfile, SshConnectionProfile]);
export type ConnectionProfile = typeof ConnectionProfile.Type;

export interface ConnectionRoute {
  readonly target: ConnectionTarget;
  readonly profile: Option.Option<ConnectionProfile>;
}

export interface ConnectionCatalogEntry {
  readonly target: ConnectionTarget;
  readonly defaultLabel?: string;
  readonly profile: Option.Option<ConnectionProfile>;
  /** Additional direct or SSH routes, in fallback order. */
  readonly alternateRoutes?: ReadonlyArray<ConnectionRoute>;
  readonly enabled: boolean;
  /** Protocol rejection stays visible while the saved connection is switched off. */
  readonly unsupportedReason?: string;
  readonly serverUpdateRequired?: boolean;
}

export class BearerConnectionCredential extends Schema.TaggedClass<BearerConnectionCredential>()(
  "BearerConnectionCredential",
  {
    token: Schema.String,
  },
) {}

export const ConnectionCredential = Schema.Union([BearerConnectionCredential]);
export type ConnectionCredential = typeof ConnectionCredential.Type;

export class PrimaryConnectionRegistration extends Schema.TaggedClass<PrimaryConnectionRegistration>()(
  "PrimaryConnectionRegistration",
  {
    target: PrimaryConnectionTarget,
  },
) {}

export class BearerConnectionRegistration extends Schema.TaggedClass<BearerConnectionRegistration>()(
  "BearerConnectionRegistration",
  {
    target: BearerConnectionTarget,
    profile: BearerConnectionProfile,
    credential: BearerConnectionCredential,
  },
) {}

export class SshConnectionRegistration extends Schema.TaggedClass<SshConnectionRegistration>()(
  "SshConnectionRegistration",
  {
    target: SshConnectionTarget,
    profile: SshConnectionProfile,
    /** The token from pairing over SSH, which later connects reuse. */
    credential: BearerConnectionCredential,
  },
) {}

export const ConnectionRegistration = Schema.Union([
  BearerConnectionRegistration,
  SshConnectionRegistration,
]);
export type ConnectionRegistration = typeof ConnectionRegistration.Type;

/**
 * The primary stays on same-origin cookie auth
 * (`PrimaryConnectionRegistration`); secondary local backends live on a
 * separate loopback origin and authenticate with a bearer token minted from
 * their bootstrap credential (`BearerConnectionRegistration`).
 */
export const PlatformConnectionRegistration = Schema.Union([
  PrimaryConnectionRegistration,
  BearerConnectionRegistration,
]);
export type PlatformConnectionRegistration = typeof PlatformConnectionRegistration.Type;

export function connectionRegistrationCatalogEntry(
  registration: ConnectionRegistration | PrimaryConnectionRegistration,
): ConnectionCatalogEntry {
  switch (registration._tag) {
    case "PrimaryConnectionRegistration":
      return {
        target: registration.target,
        profile: Option.none(),
        enabled: true,
      };
    case "BearerConnectionRegistration":
    case "SshConnectionRegistration":
      return {
        target: registration.target,
        profile: Option.some(registration.profile),
        enabled: true,
      };
  }
}
