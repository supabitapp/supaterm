# supaterm.com

This app ships as a static Vite build with a Cloudflare Worker in front of it. The Worker serves the built assets and proxies GitHub `tip` release files under `/download/tip/*`.

## Local work

Install dependencies from the repo root:

```bash
make web-install
```

Run checks and tests:

```bash
make web-check
make web-test
make web-build
```

Run the static app locally:

```bash
make web-dev
```

Run the Cloudflare Worker locally after building:

```bash
make web-worker-dev
```

## Deploy

GitHub Actions deploys this app with Wrangler. The repo requires these secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

For a manual deploy from this machine:

```bash
make web-build
make web-deploy
```

The first deploy creates the Worker and publishes a `workers.dev` URL. Attach `supaterm.com` as a custom domain in Cloudflare after that deploy succeeds.
