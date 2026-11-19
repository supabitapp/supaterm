import * as Schema from "effect/Schema";

import { PortSchema, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SERVER_EXIT_CODE_STATE_DIR_OWNED = 78;

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.Boolean,
  port: PortSchema,
  supatermHome: Schema.optional(Schema.String),
  host: Schema.String,
  desktopBootstrapToken: Schema.String,
  desktopBootstrapSecret: Schema.String,
  shellEnvironmentPrepared: Schema.optionalKey(Schema.Boolean),
  tailscaleServeEnabled: Schema.Boolean,
  tailscaleServePort: PortSchema,
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
  otlpLogsUrl: Schema.optional(Schema.String),
  desktopTelemetryFd: Schema.optionalKey(PositiveInt),
  desktopTelemetryControlFd: Schema.optionalKey(PositiveInt),
  desktopAppUpdate: Schema.optionalKey(Schema.Boolean),
  desktopBrowserFd: Schema.optionalKey(PositiveInt),
  desktopBrowserControlFd: Schema.optionalKey(PositiveInt),
  resourceMonitorPath: Schema.optionalKey(TrimmedNonEmptyString),
});

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;

export const DESKTOP_UPDATE_IN_PROGRESS_MARKER_FILE = "desktop-update-in-progress";
export const DESKTOP_UPDATE_IN_PROGRESS_TTL_MS = 60_000;
