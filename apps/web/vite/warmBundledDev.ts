import type { Plugin, ViteDevServer } from "vite-plus";

const STARTUP_LAZY_ENTRIES = [
  "src/main.tsx",
  "src/routes/_chat.tsx",
  "src/routes/_chat.index.tsx",
  "src/routes/_chat.$environmentId.$threadId.tsx",
];

const WARMUP_CLIENT_ID = "supaterm-startup-warmup";

interface BundledDevInternals {
  waitForInitialBuildFinish(): Promise<void>;
  triggerLazyBundling(
    moduleId: string,
    clientId: string,
  ): Promise<{ readonly filename: string } | undefined>;
  markPayloadDelivered(filename: string): void;
  readonly devEngine: {
    readonly moduleGraph: {
      getModuleIds(): readonly string[];
      getModuleInfo(id: string): { readonly dynamicallyImportedIds: readonly string[] } | null;
    };
    removeClient(clientId: string): Promise<void>;
  };
}

function hasBundledDevInternals(value: unknown): value is BundledDevInternals {
  return (
    typeof value === "object" &&
    value !== null &&
    "waitForInitialBuildFinish" in value &&
    typeof value.waitForInitialBuildFinish === "function" &&
    "triggerLazyBundling" in value &&
    typeof value.triggerLazyBundling === "function" &&
    "markPayloadDelivered" in value &&
    typeof value.markPayloadDelivered === "function"
  );
}

async function warmLazyEntries(server: ViteDevServer, entries: readonly string[]) {
  const bundledDev: unknown = server.environments.client.bundledDev;
  if (!hasBundledDevInternals(bundledDev)) return [];
  await bundledDev.waitForInitialBuildFinish();

  const { moduleGraph } = bundledDev.devEngine;
  const wanted = new Set(entries.map((entry) => `${server.config.root}/${entry}`));
  const warmed = new Set<string>();
  const nextLazyIds = () =>
    new Set(
      moduleGraph
        .getModuleIds()
        .flatMap((id) => moduleGraph.getModuleInfo(id)?.dynamicallyImportedIds ?? [])
        .filter(
          (id) =>
            id.includes("rolldown-lazy") && !warmed.has(id) && wanted.has(id.split("?")[0] ?? id),
        ),
    );

  try {
    for (let pending = nextLazyIds(); pending.size > 0; pending = nextLazyIds()) {
      for (const id of pending) {
        warmed.add(id);
        const result = await bundledDev.triggerLazyBundling(id, WARMUP_CLIENT_ID);
        if (result) bundledDev.markPayloadDelivered(result.filename);
      }
    }
  } finally {
    await bundledDev.devEngine.removeClient(WARMUP_CLIENT_ID);
  }
  return [...warmed];
}

export function warmBundledDevPlugin() {
  return {
    name: "supaterm:warm-bundled-dev",
    apply: "serve",
    configureServer(server) {
      if (!server.config.experimental.bundledDev) return;
      server.httpServer?.once("listening", () => {
        const startedAt = performance.now();
        warmLazyEntries(server, STARTUP_LAZY_ENTRIES).then(
          (warmed) => {
            if (warmed.length === 0) return;
            const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
            server.config.logger.info(
              `[supaterm] pre-bundled ${String(warmed.length)} startup chunks in ${seconds}s`,
              { timestamp: true },
            );
          },
          (error: unknown) => {
            server.config.logger.warn(`[supaterm] startup chunk warmup failed: ${String(error)}`, {
              timestamp: true,
            });
          },
        );
      });
    },
  } satisfies Plugin;
}
