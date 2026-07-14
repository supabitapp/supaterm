# Supaterm documentation

This app uses Blume 1.0.3, Vite+, pnpm, and Cloudflare Workers static assets.

## Workflow

- Run `make docs-install` from the repository root after dependency changes.
- Run `make docs-dev` to start the development server.
- Run `make docs-check`, `make docs-validate`, and `make docs-build` before submitting changes.
- Keep Markdown and MDX under `docs/`.
- Use colocated `meta.ts` files for navigation order.
- Keep canonical `sp` command references in `integrations/supaterm-skills/skill-data`; Blume imports them at the parent repository's pinned submodule commit.
- Keep the deployment static. Do not enable Ask AI or MCP.
- Keep `.npmrc` public hoisting; Blume's generated Astro runtime resolves transitive imports from the app root.
