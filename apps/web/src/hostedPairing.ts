import { isRelayCompanion } from "./lib/relayCompanion";
import {
  DEFAULT_HOSTED_APP_URL,
  readHostedPairingRequest as readSharedHostedPairingRequest,
} from "@supaterm/shared/remote";
import type {
  HostedPairingRequest as SharedHostedPairingRequest,
  PairingRouteHints,
} from "@supaterm/shared/remote";

import { setPairingTokenOnUrl } from "@supaterm/shared/remote";

export interface HostedPairingRequest extends SharedHostedPairingRequest {
  readonly pairingUrl: string;
}

export type HostedAppChannel = "latest" | "nightly";

export function configuredHostedAppUrl(): string {
  return import.meta.env.VITE_HOSTED_APP_URL?.trim() || DEFAULT_HOSTED_APP_URL;
}

function configuredBackendUrl(): string {
  return import.meta.env.VITE_HTTP_URL?.trim() || import.meta.env.VITE_WS_URL?.trim() || "";
}

function configuredHostedAppChannel(): HostedAppChannel | null {
  const channel = import.meta.env.VITE_HOSTED_APP_CHANNEL?.trim().toLowerCase();
  return channel === "latest" || channel === "nightly" ? channel : null;
}

function originFromUrl(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isHostedStaticApp(url?: URL): boolean {
  if (isRelayCompanion()) return true;
  if (configuredBackendUrl()) {
    return false;
  }

  if (configuredHostedAppChannel()) {
    return true;
  }

  if (url === undefined && (typeof window === "undefined" || window.location === undefined)) {
    return false;
  }

  const hostedOrigin = originFromUrl(configuredHostedAppUrl());
  return hostedOrigin !== null && (url ?? new URL(window.location.href)).origin === hostedOrigin;
}

export function readHostedPairingRequest(url: URL = new URL(window.location.href)) {
  const request = readSharedHostedPairingRequest(url);
  return request === null
    ? null
    : ({
        ...request,
        pairingUrl: url.toString(),
      } satisfies HostedPairingRequest);
}

export function hasHostedPairingRequest(url: URL = new URL(window.location.href)): boolean {
  return readHostedPairingRequest(url) !== null;
}

export function buildHostedPairingUrl(
  input: {
    readonly host: string;
    readonly token: string;
    readonly label?: string | null;
  } & PairingRouteHints,
): string {
  const url = new URL("/pair", configuredHostedAppUrl());
  url.searchParams.set("host", input.host);

  const label = input.label?.trim();
  if (label) {
    url.searchParams.set("label", label);
  }

  return setPairingTokenOnUrl(url, input.token, input).toString();
}

export function buildHostedChannelSelectionUrl(input: {
  readonly channel: HostedAppChannel;
}): string {
  const url = new URL("/__supaterm/channel", configuredHostedAppUrl());
  url.searchParams.set("channel", input.channel);
  return url.toString();
}
