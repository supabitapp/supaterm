export interface SceneModel {
  readonly instanceId: "claudeAgent" | "codex" | "cursor" | "opencode" | "grok";
  readonly model: string;
}

interface SceneProject {
  readonly title: string;
  /** Files of the initial commit, keyed by repository-relative path. */
  readonly files: Readonly<Record<string, string>>;
}

interface SceneTurn {
  readonly prompt: string;
  readonly reply: string;
  readonly startedMinutesAgo: number;
  /** Shown as "Worked for …" above the reply. */
  readonly workedSeconds: number;
  /** Folded work log entries; only visible when the fold is expanded. */
  readonly commands: ReadonlyArray<{ readonly input: string; readonly output: string }>;
  /** Files this turn writes. The diff panel shows the change against the previous turn. */
  readonly files: Readonly<Record<string, string>>;
}

export interface ScenePullRequest {
  readonly repository: string;
  readonly number: number;
  readonly state: "open" | "merged";
}

interface SceneHeroThread {
  readonly id: string;
  readonly project: string;
  readonly title: string;
  readonly branch: string;
  readonly model: SceneModel;
  readonly pullRequest: ScenePullRequest;
  readonly turns: ReadonlyArray<SceneTurn>;
  /** Diff panel file to expand; its folder is expanded in the latest changed-files card. */
  readonly diffFile: string;
}

export interface SceneSidebarThread {
  readonly project: string;
  readonly title: string;
  readonly branch: string;
  readonly model: SceneModel;
  readonly minutesAgo: number;
  readonly pullRequest?: ScenePullRequest;
  /** A live run: "running" shows the Working spinner, "approval" a pending command approval. */
  readonly live?: { readonly state: "running" | "approval"; readonly prompt: string };
}

const CLAUDE_OPUS: SceneModel = { instanceId: "claudeAgent", model: "claude-opus-5-5" };
const CLAUDE_SONNET: SceneModel = { instanceId: "claudeAgent", model: "claude-sonnet-5" };
const CODEX_SOL: SceneModel = { instanceId: "codex", model: "gpt-6.1-sol" };
const CODEX_ASTRA: SceneModel = { instanceId: "codex", model: "gpt-6-astra" };
const CURSOR: SceneModel = { instanceId: "cursor", model: "auto" };
const OPENCODE: SceneModel = { instanceId: "opencode", model: "opencode/big-pickle" };
const GROK: SceneModel = { instanceId: "grok", model: "grok-code-fast-1" };

export const SCENE_PROJECTS: ReadonlyArray<SceneProject> = [
  {
    title: "orbit",
    files: {
      "README.md": "# orbit\n\nProject tracker for small teams.\n",
      "package.json": `{
  "name": "orbit",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx watch src/server/index.ts", "test": "vitest" },
  "dependencies": { "hono": "^4.6.0", "ioredis": "^5.4.1" },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
`,
      "src/lib/redis.ts": `import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
`,
      "src/lib/searchIndex.ts": `export interface SearchResult {
  id: string;
  title: string;
  score: number;
}

export async function searchIndex(
  query: string,
  options: { limit: number },
): Promise<SearchResult[]> {
  return [];
}
`,
      "src/server/index.ts": `import { Hono } from "hono";
import { search } from "./routes/search";
import { projects } from "./routes/projects";

const app = new Hono();

app.route("/api/search", search);
app.route("/api/projects", projects);

export default app;
`,
      "src/server/routes/projects.ts": `import { Hono } from "hono";

export const projects = new Hono();

projects.get("/", (c) => c.json({ projects: [] }));
`,
      "src/server/routes/search.ts": `import { Hono } from "hono";
import { searchIndex } from "../../lib/searchIndex";

export const search = new Hono();

search.get("/", async (c) => {
  const query = c.req.query("q")?.trim() ?? "";
  if (query.length === 0) return c.json({ results: [] });

  const results = await searchIndex(query, { limit: 20 });
  return c.json({ results });
});
`,
    },
  },
  { title: "ledger", files: { "README.md": "# ledger\n\nInvoicing and payouts.\n" } },
  {
    title: "orbit-mobile",
    files: { "README.md": "# orbit-mobile\n\nThe orbit iOS and Android app.\n" },
  },
  { title: "docs", files: { "README.md": "# docs\n\nPublic documentation site.\n" } },
];

export const HERO_THREAD: SceneHeroThread = {
  id: "5b2f7c1e-8a4d-4c1b-9e3f-6d0a2b7c9e41",
  project: "orbit",
  title: "Rate limit the public search API",
  branch: "feat/search-rate-limit",
  model: CLAUDE_OPUS,
  pullRequest: { repository: "orbit-labs/orbit", number: 482, state: "open" },
  diffFile: "src/server/middleware/rateLimit.ts",
  turns: [
    {
      prompt:
        "Scrapers are hammering /api/search. Add per-client rate limiting backed by Redis: a sliding window, 30 requests a minute, and a 429 with Retry-After when someone goes over.",
      reply:
        "Added a sliding-window limiter as Hono middleware in `src/server/middleware/rateLimit.ts` and mounted it on `/api/search` at 30 requests per minute.\n\nEvery response now carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`. Requests over the limit get a 429 with `Retry-After`.",
      startedMinutesAgo: 41,
      workedSeconds: 128,
      commands: [
        {
          input: 'rg -n "search" src/server',
          output: 'src/server/index.ts:6:app.route("/api/search", search);',
        },
      ],
      files: {
        "src/server/middleware/rateLimit.ts": `import type { MiddlewareHandler } from "hono";
import { redis } from "../../lib/redis";

interface RateLimitOptions {
  /** Requests allowed per client in each window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export function rateLimit({
  limit,
  windowSeconds,
}: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const client = c.req.header("x-forwarded-for") ?? "anon";
    const key = \`rl:\${c.req.path}:\${client}\`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    const results = await redis
      .multi()
      .zremrangebyscore(key, 0, windowStart)
      .zadd(key, now, \`\${now}-\${crypto.randomUUID()}\`)
      .zcard(key)
      .expire(key, windowSeconds)
      .exec();

    const count = Number(results?.[2]?.[1] ?? 0);
    const remaining = Math.max(0, limit - count);

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));

    if (count > limit) {
      c.header("Retry-After", String(windowSeconds));
      return c.json({ error: "Too many requests" }, 429);
    }

    await next();
  };
}
`,
        "src/server/routes/search.ts": `import { Hono } from "hono";
import { searchIndex } from "../../lib/searchIndex";
import { rateLimit } from "../middleware/rateLimit";

export const search = new Hono();

search.use("*", rateLimit({ limit: 30, windowSeconds: 60 }));

search.get("/", async (c) => {
  const query = c.req.query("q")?.trim() ?? "";
  if (query.length === 0) return c.json({ results: [] });

  const results = await searchIndex(query, { limit: 20 });
  return c.json({ results });
});
`,
      },
    },
    {
      prompt:
        "Nice. Key it by the signed-in user when there is one. Our whole office sits behind one IP and keeps tripping it. Add tests, then open a PR.",
      reply:
        "Opened [PR #482](https://github.com/orbit-labs/orbit/pull/482).\n\nThe limiter now keys by user ID when someone is signed in and falls back to the client IP for anonymous traffic, so one shared office IP no longer means one shared bucket.\n\nValidation passed:\n\n- 2 new middleware tests\n- Existing search route tests\n- Typecheck\n- 31 anonymous requests in a minute: the last one got a 429\n\nCI is running on the PR.",
      startedMinutesAgo: 8,
      workedSeconds: 221,
      commands: [
        {
          input: "pnpm vitest run src/server/middleware",
          output: " ✓ src/server/middleware/rateLimit.test.ts (2 tests) 41ms",
        },
      ],
      files: {
        "src/server/middleware/rateLimit.ts": `import type { Context, MiddlewareHandler } from "hono";
import { redis } from "../../lib/redis";

interface RateLimitOptions {
  /** Requests allowed per client in each window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Signed-in users get their own bucket.
 * Anonymous traffic is keyed by client IP.
 */
function clientKey(c: Context): string {
  const user = c.get("user");
  if (user) return \`user:\${user.id}\`;

  const forwarded = c.req.header("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return \`ip:\${ip || "unknown"}\`;
}

export function rateLimit({
  limit,
  windowSeconds,
}: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const key = \`rl:\${c.req.path}:\${clientKey(c)}\`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    const results = await redis
      .multi()
      .zremrangebyscore(key, 0, windowStart)
      .zadd(key, now, \`\${now}-\${crypto.randomUUID()}\`)
      .zcard(key)
      .expire(key, windowSeconds)
      .exec();

    const count = Number(results?.[2]?.[1] ?? 0);
    const remaining = Math.max(0, limit - count);

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));

    if (count > limit) {
      c.header("Retry-After", String(windowSeconds));
      return c.json(
        { error: "Too many requests", retryAfter: windowSeconds },
        429,
      );
    }

    await next();
  };
}
`,
        "src/server/middleware/rateLimit.test.ts": `import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { redis } from "../../lib/redis";
import { rateLimit } from "./rateLimit";

function createApp(userId?: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (userId) c.set("user", { id: userId });
    await next();
  });
  app.use("*", rateLimit({ limit: 2, windowSeconds: 60 }));
  app.get("/", (c) => c.text("ok"));
  return app;
}

const headers = { "x-forwarded-for": "203.0.113.7" };

describe("rateLimit", () => {
  beforeEach(() => redis.flushdb());

  it("returns 429 once a client exceeds the limit", async () => {
    const app = createApp();
    await app.request("/", { headers });
    await app.request("/", { headers });

    const res = await app.request("/", { headers });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("gives signed-in users their own bucket", async () => {
    const anonymous = createApp();
    await anonymous.request("/", { headers });
    await anonymous.request("/", { headers });

    const res = await createApp("u_42").request("/", { headers });
    expect(res.status).toBe(200);
  });
});
`,
      },
    },
  ],
};

/** Active threads around the hero thread, newest first in the sidebar. */
export const SIDEBAR_THREADS: ReadonlyArray<SceneSidebarThread> = [
  {
    project: "orbit",
    title: "Fix flaky checkout webhook test",
    branch: "fix/checkout-webhook-flake",
    model: CODEX_SOL,
    minutesAgo: 1,
    live: {
      state: "running",
      prompt: "checkout.webhook.test.ts fails about 1 in 5 runs on CI. Find out why and fix it.",
    },
  },
  {
    project: "ledger",
    title: "Migrate invoices to Postgres 17",
    branch: "chore/postgres-17",
    model: CLAUDE_SONNET,
    minutesAgo: 26,
    live: {
      state: "approval",
      prompt: "Upgrade the invoices database to Postgres 17 and update the migration scripts.",
    },
  },
  {
    project: "ledger",
    title: "Retry failed Stripe payouts",
    branch: "fix/payout-retries",
    model: CODEX_ASTRA,
    minutesAgo: 200,
  },
  {
    project: "orbit-mobile",
    title: "Dark mode for the settings screen",
    branch: "feat/dark-settings",
    model: CURSOR,
    minutesAgo: 300,
  },
  {
    project: "docs",
    title: "Write the self-hosting guide",
    branch: "docs/self-hosting",
    model: OPENCODE,
    minutesAgo: 26 * 60,
  },
  {
    project: "orbit",
    title: "Profile the slow project list query",
    branch: "perf/project-list",
    model: GROK,
    minutesAgo: 31 * 60,
  },
];

const DONE_TITLES: ReadonlyArray<readonly [project: string, title: string]> = [
  ["orbit", "Paginate the activity feed"],
  ["orbit", "Drop the legacy avatar endpoint"],
  ["ledger", "Fix rounding in tax totals"],
  ["docs", "Document the webhook retries"],
  ["orbit-mobile", "Haptics on pull-to-refresh"],
  ["orbit", "Cache project counts in Redis"],
  ["ledger", "Backfill missing invoice numbers"],
  ["orbit", "Upgrade to Hono 4.6"],
  ["docs", "Split the API reference by resource"],
  ["orbit-mobile", "Offline queue for comments"],
  ["orbit", "Trace slow search queries"],
  ["ledger", "Stripe webhook signature check"],
];
const DONE_MODELS = [CLAUDE_OPUS, CODEX_SOL, CLAUDE_SONNET, CODEX_ASTRA, CURSOR, GROK] as const;

/** Done threads only show up as the "Done (n)" count below the active list. */
export const DONE_THREADS: ReadonlyArray<SceneSidebarThread> = [0, 1, 2].flatMap((round) =>
  DONE_TITLES.map(([project, title], index) => ({
    project,
    title: round === 0 ? title : `${title} (follow-up ${round})`,
    branch: "main",
    model: DONE_MODELS[index % DONE_MODELS.length] ?? CLAUDE_OPUS,
    minutesAgo: (2 + index + round * 12) * 24 * 60,
  })),
);
