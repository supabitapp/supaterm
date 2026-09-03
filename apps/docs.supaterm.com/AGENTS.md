# Supaterm documentation

This app uses Blume 1.0.3, Vite+, pnpm, and Cloudflare Workers static assets.
The root `make docs-*` targets validate the exact Vite+ version from this project's manifest and
lockfile, using mise to bootstrap that toolchain while preserving the version required by Blume.

## Workflow

- Run `make docs-install` from the repository root after dependency changes.
- Run `make docs-dev` to start the development server.
- Run `make docs-check`, `make docs-validate`, and `make docs-build` before submitting changes.
- Keep Markdown and MDX under `docs/`.
- Use colocated `meta.ts` files for navigation order.
- Keep canonical `sp` command references in `integrations/supaterm/skill-data`; Blume imports them from the parent repository commit.
- Keep the deployment static. Do not enable Ask AI or MCP.
- Keep `.npmrc` public hoisting; Blume's generated Astro runtime resolves transitive imports from the app root.
