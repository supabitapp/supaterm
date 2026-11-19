import * as Schema from "effect/Schema";

export const DEFAULT_PUBLIC_RELAY_URL = "wss://relay.supaterm.com";

export function normalizeRelayServerUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password) return null;
  if (url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export const RelayServerUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter((value: string) => normalizeRelayServerUrl(value) === value, {
    expected: "a ws: or wss: relay URL without credentials, query, or fragment",
  }),
);

export const RelayHostState = Schema.Literals([
  "off",
  "idle",
  "connecting",
  "registered",
  "superseded",
  "invalid-url",
]);
export type RelayHostState = typeof RelayHostState.Type;

export const RelayHostStatus = Schema.Struct({
  state: RelayHostState,
  relayEndpoint: Schema.optionalKey(Schema.String),
  relayUrl: Schema.optionalKey(Schema.String),
});
export type RelayHostStatus = typeof RelayHostStatus.Type;

export const RelayConnectionInfo = Schema.Struct({
  relayEndpoint: Schema.String,
  relayUrl: Schema.String,
});
export type RelayConnectionInfo = typeof RelayConnectionInfo.Type;

export function relayAdvertisementFrom(value: {
  readonly relayEndpoint?: string;
  readonly relayUrl?: string;
}): RelayConnectionInfo | null {
  return value.relayEndpoint === undefined || value.relayUrl === undefined
    ? null
    : { relayEndpoint: value.relayEndpoint, relayUrl: value.relayUrl };
}

export function withRelayAdvertisement<
  T extends { readonly relayEndpoint?: string; readonly relayUrl?: string },
>(value: T, advertisement: RelayConnectionInfo | null) {
  const { relayEndpoint: _endpoint, relayUrl: _url, ...rest } = value;
  return { ...rest, ...advertisement };
}

export class RelayPreparationError extends Schema.TaggedError<RelayPreparationError>()(
  "RelayPreparationError",
  {
    reason: Schema.Literals(["off", "invalid-url", "superseded", "timeout", "unavailable"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
  { httpApiStatus: 503 },
) {
  override get message(): string {
    switch (this.reason) {
      case "off":
        return "Enable Encrypted Relay before creating a relay pairing link.";
      case "invalid-url":
        return "The relay server URL is invalid.";
      case "superseded":
        return "Another host is using this relay identity. Turn Encrypted Relay off and on to reconnect here.";
      case "timeout":
        return "The relay did not connect in time. Try creating the link again.";
      case "unavailable":
        return "The relay could not be prepared. Try creating the link again.";
    }
  }
}

export const MAX_DIRECT_TUNNEL_URLS = 8;

export const DirectTunnelUrls = Schema.Array(RelayServerUrl).check(
  Schema.isMaxLength(MAX_DIRECT_TUNNEL_URLS),
);

export const RelayCompanionRequest = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(64)),
  action: Schema.Literals(["open", "close"]),
  address: Schema.String.check(Schema.isMaxLength(256)),
  relayUrl: Schema.optionalKey(RelayServerUrl),
  directUrls: Schema.optionalKey(DirectTunnelUrls),
});

export const RelayCompanionReply = Schema.Struct({
  id: Schema.String,
  origin: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
});
