import * as Schema from "effect/Schema";
import {
  DEFAULT_PUBLIC_RELAY_URL,
  EnvironmentId,
  normalizeRelayServerUrl,
} from "@supaterm/contracts";
import { deriveWsBaseUrl, normalizeHttpBaseUrl } from "./advertisedEndpoint.ts";
import { parseRelayAddress } from "./relay/protocol.ts";
import { isLocalLoopbackHost, isPrivateNetworkHost, isTailnetHost } from "./hostClassification.ts";

export const DEFAULT_HOSTED_APP_URL = "https://app.supaterm.com";

const PAIRING_TOKEN_PARAM = "token";
const PAIRING_ENV_PARAM = "env";
const PAIRING_ROUTES_PARAM = "routes";
const PAIRING_RELAY_PARAM = "relay";
const MAX_PAIRING_ROUTES = 6;
const PAIRING_QR_BYTE_BUDGET = 287;
const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);
const HOSTED_PAIRING_HOST_PARAM = "host";
const HOSTED_PAIRING_LABEL_PARAM = "label";
const SUPPORTED_REMOTE_BACKEND_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

const readHashParams = (url: URL): URLSearchParams =>
  new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

export class RemoteBackendUrlMissingError extends Schema.TaggedError<RemoteBackendUrlMissingError>()(
  "RemoteBackendUrlMissingError",
  {},
) {
  override get message(): string {
    return "Enter a backend URL.";
  }
}

export class RemotePairingUrlInvalidError extends Schema.TaggedError<RemotePairingUrlInvalidError>()(
  "RemotePairingUrlInvalidError",
  {
    cause: Schema.optional(Schema.Defect()),
    protocol: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return "Pairing URL is invalid.";
  }
}

export class RemoteBackendUrlInvalidError extends Schema.TaggedError<RemoteBackendUrlInvalidError>()(
  "RemoteBackendUrlInvalidError",
  {
    source: Schema.Literals(["direct-host", "hosted-pairing-host"]),
    cause: Schema.optional(Schema.Defect()),
    protocol: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return "Backend URL is invalid.";
  }
}

export class RemotePairingTokenMissingError extends Schema.TaggedError<RemotePairingTokenMissingError>()(
  "RemotePairingTokenMissingError",
  { host: Schema.String },
) {
  override get message(): string {
    return "Pairing URL is missing its token.";
  }
}

export class RemotePairingCodeMissingError extends Schema.TaggedError<RemotePairingCodeMissingError>()(
  "RemotePairingCodeMissingError",
  { host: Schema.String },
) {
  override get message(): string {
    return "Enter a pairing code.";
  }
}

export const RemotePairingTargetError = Schema.Union([
  RemoteBackendUrlMissingError,
  RemotePairingUrlInvalidError,
  RemoteBackendUrlInvalidError,
  RemotePairingTokenMissingError,
  RemotePairingCodeMissingError,
]);
export type RemotePairingTargetError = typeof RemotePairingTargetError.Type;

const hasSupportedRemoteBackendProtocol = (url: URL): boolean =>
  SUPPORTED_REMOTE_BACKEND_PROTOCOLS.has(url.protocol);

const normalizeRemoteBaseUrl = (
  rawValue: string,
  source: RemoteBackendUrlInvalidError["source"],
): URL => {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new RemoteBackendUrlMissingError();
  }

  const withoutLeadingSlashes = trimmed.replace(/^\/+/, "");
  const normalizedInput = /^[a-zA-Z][a-zA-Z\d+-]*:\/\//.test(withoutLeadingSlashes)
    ? withoutLeadingSlashes
    : `https://${withoutLeadingSlashes}`;
  let url: URL;
  try {
    url = new URL(normalizedInput);
  } catch (cause) {
    throw new RemoteBackendUrlInvalidError({ source, cause });
  }
  if (!hasSupportedRemoteBackendProtocol(url)) {
    throw new RemoteBackendUrlInvalidError({
      source,
      protocol: url.protocol,
    });
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
};

export interface ResolvedRemotePairingTarget extends PairingRouteHints {
  readonly credential: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export interface PairingRouteHints {
  readonly environmentId?: EnvironmentId | undefined;
  readonly routes?: ReadonlyArray<string> | undefined;
  readonly relayUrl?: string | undefined;
}

export const readPairingEnvironmentId = (url: URL): EnvironmentId | undefined => {
  const values = readHashParams(url).getAll(PAIRING_ENV_PARAM);
  if (values.length === 0) return undefined;
  if (values.length !== 1) throw new RemotePairingUrlInvalidError({});
  const decoded = decodeEnvironmentId(values[0]);
  if (decoded._tag === "None") throw new RemotePairingUrlInvalidError({});
  return decoded.value;
};

const pairingRouteOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (
      isLocalLoopbackHost(url.hostname) ||
      url.hostname.endsWith(".localhost") ||
      url.hostname === "0.0.0.0" ||
      url.hostname === "[::]" ||
      url.hostname.startsWith("169.254.") ||
      !/^[a-z\d.:[\]-]+$/iu.test(url.hostname)
    )
      return null;
    if (url.protocol === "https:") return url.origin;
    if (url.protocol !== "http:" || !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
    if (url.hostname.startsWith("0.")) return null;
    return isPrivateNetworkHost(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
};

const readPairingRelayUrl = (url: URL): string | undefined => {
  const values = readHashParams(url).getAll(PAIRING_RELAY_PARAM);
  if (values.length === 0) return undefined;
  const relayUrl = values.length === 1 ? normalizeRelayServerUrl(values[0]!) : null;
  if (relayUrl === null) throw new RemotePairingUrlInvalidError({});
  return relayUrl;
};

const readPairingRouteHints = (url: URL): PairingRouteHints => {
  const relayUrl = readPairingRelayUrl(url);
  const environmentId = readPairingEnvironmentId(url);
  if (environmentId === undefined) return { relayUrl };
  const raw = readHashParams(url).get(PAIRING_ROUTES_PARAM) ?? "";
  const routes = [
    ...new Set(
      raw.split(",", MAX_PAIRING_ROUTES).flatMap((value) => {
        const origin = pairingRouteOrigin(value);
        return origin === null ? [] : [`${origin}/`];
      }),
    ),
  ];
  return { environmentId, routes, relayUrl };
};

const pairingRoutePriority = (origin: string): number => {
  if (origin.startsWith("https:")) return 0;
  return isTailnetHost(new URL(origin).hostname) ? 1 : 2;
};

export interface HostedPairingRequest {
  readonly host: string;
  readonly token: string;
  readonly label: string;
}

export const getPairingTokenFromUrl = (url: URL): string | null => {
  const hashToken = readHashParams(url).get(PAIRING_TOKEN_PARAM)?.trim() ?? "";
  return hashToken.length > 0 ? hashToken : null;
};

export const stripPairingTokenFromUrl = (url: URL): URL => {
  const next = new URL(url.toString());
  const hashParams = readHashParams(next);
  if (
    [PAIRING_TOKEN_PARAM, PAIRING_ENV_PARAM, PAIRING_ROUTES_PARAM, PAIRING_RELAY_PARAM].some(
      (key) => hashParams.has(key),
    )
  ) {
    hashParams.delete(PAIRING_TOKEN_PARAM);
    hashParams.delete(PAIRING_ENV_PARAM);
    hashParams.delete(PAIRING_ROUTES_PARAM);
    hashParams.delete(PAIRING_RELAY_PARAM);
    next.hash = hashParams.toString();
  }
  return next;
};

export const setPairingTokenOnUrl = (
  url: URL,
  credential: string,
  hints: PairingRouteHints = {},
): URL => {
  const next = new URL(url.toString());
  next.hash = new URLSearchParams([[PAIRING_TOKEN_PARAM, credential]]).toString();
  const mainOrigin = new URL(next.searchParams.get(HOSTED_PAIRING_HOST_PARAM) ?? next.href).origin;
  if (
    hints.relayUrl !== undefined &&
    hints.relayUrl !== DEFAULT_PUBLIC_RELAY_URL &&
    parseRelayAddress(mainOrigin)
  )
    next.hash += `&${PAIRING_RELAY_PARAM}=${encodeURIComponent(hints.relayUrl)}`;
  if (hints.environmentId !== undefined) {
    next.hash += `&env=${encodeURIComponent(hints.environmentId)}`;
    const origins = [
      ...new Set(
        (hints.routes ?? []).flatMap((value) => {
          const origin = pairingRouteOrigin(value);
          return origin === null || origin === mainOrigin ? [] : [origin];
        }),
      ),
    ].sort((a, b) => {
      return pairingRoutePriority(a) - pairingRoutePriority(b);
    });
    const selected: Array<string> = [];
    for (const origin of origins) {
      if (selected.length === MAX_PAIRING_ROUTES) break;
      const suffix = `&routes=${[...selected, origin].join(",")}`;
      if (new TextEncoder().encode(next.href + suffix).length <= PAIRING_QR_BYTE_BUDGET)
        selected.push(origin);
    }
    if (selected.length > 0) next.hash += `&routes=${selected.join(",")}`;
  }
  return next;
};

export const buildPairingUrl = (
  baseUrl: string,
  credential: string,
  hints: PairingRouteHints = {},
): string => {
  const url = new URL(baseUrl);
  url.pathname = "/pair";
  return setPairingTokenOnUrl(url, credential, hints).toString();
};

export const readHostedPairingRequest = (url: URL): HostedPairingRequest | null => {
  const host = url.searchParams.get(HOSTED_PAIRING_HOST_PARAM)?.trim() ?? "";
  const token = getPairingTokenFromUrl(url)?.trim() ?? "";
  const label = url.searchParams.get(HOSTED_PAIRING_LABEL_PARAM)?.trim() ?? "";

  if (!host || !token) {
    return null;
  }

  return {
    host,
    token,
    label,
  };
};

export const resolveRemotePairingTarget = (input: {
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
}): ResolvedRemotePairingTarget => {
  const pairingUrl = input.pairingUrl?.trim() ?? "";
  if (pairingUrl.length > 0) {
    let url: URL;
    try {
      url = new URL(pairingUrl);
    } catch (cause) {
      throw new RemotePairingUrlInvalidError({ cause });
    }
    if (!hasSupportedRemoteBackendProtocol(url)) {
      throw new RemotePairingUrlInvalidError({
        protocol: url.protocol,
      });
    }
    const hostedPairingRequest = readHostedPairingRequest(url);
    const hints = readPairingRouteHints(url);
    if (hostedPairingRequest) {
      const hostedBackendUrl = normalizeRemoteBaseUrl(
        hostedPairingRequest.host,
        "hosted-pairing-host",
      );
      return {
        credential: hostedPairingRequest.token,
        httpBaseUrl: normalizeHttpBaseUrl(hostedBackendUrl.href),
        wsBaseUrl: deriveWsBaseUrl(hostedBackendUrl.href),
        ...hints,
      };
    }

    const credential = getPairingTokenFromUrl(url) ?? "";
    if (!credential) {
      throw new RemotePairingTokenMissingError({ host: url.host });
    }
    return {
      credential,
      httpBaseUrl: normalizeHttpBaseUrl(url.href),
      wsBaseUrl: deriveWsBaseUrl(url.href),
      ...hints,
    };
  }

  const host = input.host?.trim() ?? "";
  const pairingCode = input.pairingCode?.trim() ?? "";
  if (!host) {
    throw new RemoteBackendUrlMissingError();
  }
  const normalizedHost = normalizeRemoteBaseUrl(host, "direct-host");
  if (!pairingCode) {
    throw new RemotePairingCodeMissingError({ host: normalizedHost.host });
  }

  return {
    credential: pairingCode,
    httpBaseUrl: normalizeHttpBaseUrl(normalizedHost.href),
    wsBaseUrl: deriveWsBaseUrl(normalizedHost.href),
  };
};
