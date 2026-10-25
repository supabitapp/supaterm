# Optional task cache

The task cache shares build outputs and fingerprinted development clients across configured machines. It is inactive while the repository `.task-cache.json` endpoint is empty. Ordinary contributor commands keep their local cache and do not require credentials.

Configure a Supaterm-owned endpoint and writer registry before running the deployment commands in this package. The stack uses Cloudflare D1 and R2 plus optional Axiom observability. Resource names use the Supaterm namespace. No upstream service credentials or endpoint are included.

Use `scripts/install.ts` to configure a local credential. `scripts/install-ci.ts` accepts `SUPATERM_TASK_CACHE_READ_TOKEN` only in this repository's GitHub Actions. `scripts/manage.ts` manages writer credentials. The installer supports `--uninstall` to remove its hook. Keep credentials outside the repository.

Task and native-client telemetry is disabled unless `SUPATERM_TASK_CACHE_TELEMETRY=on`. Offline delivery uses a bounded local queue; revoked credentials do not block ordinary commands. Native artifacts are optional and the native installer can build locally when no cached artifact is available.
