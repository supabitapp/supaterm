# Telemetry

Supaterm does not collect product usage data. Servers send no usage events or identifiers to us.

Earlier releases sent product usage events by default. To stop a server you have not updated, turn
off **Product usage data** in that version's **Settings > About**, run
`supaterm settings set telemetryEnabled false` on its machine, or set
`SUPATERM_TELEMETRY_ENABLED=false` in its environment and restart it.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`SUPATERM_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `SUPATERM_OTLP_*_URL`, set `SUPATERM_OTLP_HEADERS` for
receivers that need authentication and `SUPATERM_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
