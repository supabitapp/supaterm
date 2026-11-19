import type { APIRoute } from "astro";

import { buildSupatermProjectFileJsonSchema } from "@supaterm/shared/supatermProjectFile";

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildSupatermProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
