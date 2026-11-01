# Product usage data

The Supaterm server sends product usage events to PostHog through `https://ingest.supaterm.com`,
associated with a hashed account or installation identifier. To count how many installations one person
uses, the server also sends hashed identifiers for your OpenAI and Claude accounts when you are signed
in, and a random identifier for each device that connects. Events include the provider, the model
for built-in Codex, Claude, Cursor, Grok, and Antigravity models (custom model names are never sent),
reasoning effort, permission mode, turn result, duration, release channel, and main-agent token totals when available.
They also record which features and MCP tools are used, client operation outcomes, and delegated-task
results, durations, and provider/model choices.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, or child-agent output. Child-agent token use is excluded from the totals.

To stop collection for an environment, turn off **Product usage data** in **Settings > About**, or
under **Settings > Maintenance > Privacy** in the mobile app. On the server's machine, you can also
run `supaterm settings set telemetryEnabled false`. Events stop at once, and events not yet sent
are discarded. If the settings file cannot be read, Supaterm treats the setting as off until the
file is fixed.

`SUPATERM_TELEMETRY_ENABLED` in the server's environment overrides the setting: `false` turns
collection off and `true` turns it on, whatever the setting says. Settings shows when the variable
decides. The desktop app reads the variable from your shell profile (for example `~/.zshrc`) on
macOS and Linux. On Windows, set it as a user environment variable. Restart the app after changing
it.

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
