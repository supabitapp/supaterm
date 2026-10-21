import { UNRESPONSIVE_HOST_HINT } from "./network.ts";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TRANSPORT_ERROR_PATTERNS = [
  /\bSocketCloseError\b/i,
  /\bSocketOpenError\b/i,
  /\bSocket is not connected\b/i,
  /Unable to connect to the Supaterm server WebSocket\./i,
  /\bis not connected\.$/i,
  /\bdisconnected\.$/i,
  /\bstopped responding\.$/i,
  /\bcould not establish a WebSocket connection\.$/i,
  new RegExp(`\\bstopped responding for \\d+s\\. ${escapeRegExp(UNRESPONSIVE_HOST_HINT)}$`, "i"),
  /\bClientProtocolError\b/i,
  /\bRpcClientError\b/i,
  /\bping timeout\b/i,
] as const;

export function isTransportConnectionErrorMessage(message: string | null | undefined): boolean {
  if (typeof message !== "string") {
    return false;
  }

  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    return false;
  }

  return TRANSPORT_ERROR_PATTERNS.some((pattern) => pattern.test(normalizedMessage));
}

export function sanitizeThreadErrorMessage(message: string | null | undefined): string | null {
  return isTransportConnectionErrorMessage(message) ? null : (message ?? null);
}
