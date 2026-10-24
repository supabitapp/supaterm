import {
  MAX_PUSH_GATEWAY_ORIGINS,
  normalizePushGatewayOrigin,
  type PushRegistrationSummary,
} from "@supaterm/contracts";

export function addPushGatewayOrigin(
  origins: ReadonlyArray<string>,
  draft: string,
): { readonly origins: ReadonlyArray<string> } | { readonly error: string } {
  const origin = normalizePushGatewayOrigin(draft);
  if (origin === null) {
    return { error: "Enter an https origin, or an http origin on localhost or 127.0.0.1." };
  }
  if (origins.includes(origin)) return { error: `${origin} is already allowed.` };
  if (origins.length >= MAX_PUSH_GATEWAY_ORIGINS) {
    return { error: `Allow at most ${MAX_PUSH_GATEWAY_ORIGINS} gateways.` };
  }
  return { origins: [...origins, origin] };
}

export function activePushSessionIds(
  registrations: ReadonlyArray<PushRegistrationSummary> | null | undefined,
): ReadonlySet<string> {
  return new Set(
    (registrations ?? []).flatMap((registration) =>
      registration.status === "active" ? [registration.sessionId] : [],
    ),
  );
}
