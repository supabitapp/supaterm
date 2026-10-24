import { ORCHESTRATION_PROTOCOL_HEADER } from "@supaterm/contracts";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

export const DESKTOP_RENDERER_ORIGINS = ["supaterm://app", "supaterm-dev://app"] as const;
// Android's device viewer page; it authenticates with tickets, so it never gets cookie trust.
export const MOBILE_WEBVIEW_ORIGIN = "https://localhost";
