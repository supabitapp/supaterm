// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodeZlib from "node:zlib";

import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import compression from "compression";
import { playwright } from "vite-plus/test/browser-playwright";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig, type Connect, type Plugin } from "vite-plus";
import * as Hash from "effect/Hash";
import pkg from "./package.json" with { type: "json" };
import pdfjsPkg from "pdfjs-dist/package.json" with { type: "json" };

import {
  DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES,
  DEV_PROXIED_PATH_PREFIXES,
} from "@supaterm/shared/devProxy";

import { loadRepoEnv } from "../../scripts/lib/public-config";
import { resolveTaggedSourceVersion } from "../../scripts/lib/tagged-source-version";
import { thirdPartyLicensesPlugin } from "../../scripts/lib/third-party-licenses";
import { tailwindPlugins } from "./vite/tailwind";
import { warmBundledDevPlugin } from "./vite/warmBundledDev";

Object.assign(process.env, loadRepoEnv());

const isSingleOriginDev = process.env.SUPATERM_SINGLE_ORIGIN_DEV === "1";

const port = Number(process.env.PORT ?? 5733);
const explicitHost = process.env.HOST?.trim();
const host = explicitHost || "localhost";
const configuredWsUrl = isSingleOriginDev ? undefined : process.env.VITE_WS_URL?.trim();
const configuredHttpUrl = isSingleOriginDev ? undefined : process.env.VITE_HTTP_URL?.trim();
const configuredHostedAppChannel = process.env.VITE_HOSTED_APP_CHANNEL?.trim() || "";
const configuredReleaseChannel =
  process.env.SUPATERM_BUILT_DEV === "1" ? "dev" : process.env.VITE_RELEASE_CHANNEL?.trim() || "";
const configuredDesktopUpdateRepository =
  process.env.SUPATERM_DESKTOP_UPDATE_REPOSITORY?.trim() ||
  process.env.GITHUB_REPOSITORY?.trim() ||
  "";
const configuredHostedAppUrl = process.env.VITE_HOSTED_APP_URL?.trim() || undefined;
const sourcemapEnv = process.env.SUPATERM_WEB_SOURCEMAP?.trim().toLowerCase();

const builtDev = process.env.SUPATERM_BUILT_DEV === "1";

const bundledDevEnv = process.env.SUPATERM_BUNDLED_DEV?.trim().toLowerCase();
const bundledDev = bundledDevEnv === "1" || bundledDevEnv === "true";

const rolldownWatchExclude = [/[\\/]node_modules[\\/]/];

const buildSourcemap: boolean | "hidden" =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.browser.test.{ts,tsx}"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    setupFiles: [
      "../../packages/shared/src/testing/longTempDir.ts",
      "../../packages/shared/src/testing/providerEnv.ts",
    ],
  },
} satisfies TestProjectInlineConfiguration;

const browserTestApiPort = 20_000 + ((Hash.string(import.meta.dirname) >>> 0) % 4_000);

const browserTestProject = {
  extends: true,
  optimizeDeps: {
    include: [
      "vite-plus/test/browser",
      "@base-ui/react/autocomplete",
      "saxes",
      "@betteroffice/docx/editor",
      "@betteroffice/docx/layout",
      "@betteroffice/docx/layout/render",
      "@betteroffice/docx/yrs",
      "@betteroffice/fonts",
      "@betteroffice/pptx",
      "@betteroffice/xlsx",
      "@betteroffice/xlsx/headless",
      "@supaterm/mermaid > pele",
      "fast-xml-parser",
      "entities",
      "dompurify",
      "heic-to/next",
      "jszip",
      "pdfjs-dist",
      "sql.js",
      "tiff",
    ],
  },
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.{ts,tsx}"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    setupFiles: ["./test/browserSetup.ts"],
    api: { port: browserTestApiPort, strictPort: false },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
      commands: {
        resetPointer: async ({ page }) => {
          await page.mouse.move(-1, -1);
        },
      },
    },
  },
} satisfies TestProjectInlineConfiguration;

const renderScenariosProject = {
  ...browserTestProject,
  test: {
    ...browserTestProject.test,
    name: "renders",
    include: ["test/*.renders.tsx"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    setupFiles: ["./test/renderCounter.ts", ...browserTestProject.test.setupFiles],
    browser: {
      ...browserTestProject.test.browser,
      instances: [{ browser: "chromium" }],
      commands: {
        ...browserTestProject.test.browser.commands,
        writeRenderReport: async (_context, scenario: string, json: string) => {
          const directory = process.env.SUPATERM_RENDER_REPORT_DIR;
          if (!directory) throw new Error("SUPATERM_RENDER_REPORT_DIR is not set");
          await NodeFSP.writeFile(`${directory}/${scenario}.json`, json);
        },
      },
    },
  },
} satisfies TestProjectInlineConfiguration;

function resolveDevProxyTarget(backendPort: string | undefined, wsUrl: string | undefined) {
  const port = Number(backendPort?.trim());
  if (Number.isInteger(port) && port > 0) {
    return `http://localhost:${port}/`;
  }

  if (!wsUrl) {
    return undefined;
  }

  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

const devProxyTarget = resolveDevProxyTarget(process.env.SUPATERM_PORT, configuredWsUrl);

function devCompressionPlugin() {
  return {
    name: "supaterm:dev-compression",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        compression({
          brotli: { params: { [NodeZlib.constants.BROTLI_PARAM_QUALITY]: 5 } },
        }) as unknown as Connect.NextHandleFunction,
      );
    },
  } satisfies Plugin;
}

function chunkCycleGuardPlugin() {
  return {
    name: "supaterm:chunk-cycle-guard",
    apply: "build",
    generateBundle(_options, bundle) {
      const done = new Set<string>();
      const visit = (fileName: string, path: string[]) => {
        if (done.has(fileName)) return;
        const start = path.indexOf(fileName);
        if (start !== -1) {
          this.error(`Chunk import cycle: ${[...path.slice(start), fileName].join(" -> ")}`);
        }
        const chunk = bundle[fileName];
        if (chunk?.type !== "chunk") return;
        for (const imported of chunk.imports) visit(imported, [...path, fileName]);
        done.add(fileName);
      };
      for (const fileName of Object.keys(bundle)) visit(fileName, []);
    },
  } satisfies Plugin;
}

function bundledDevStableNamesPlugin() {
  return {
    name: "supaterm:bundled-dev-stable-names",
    apply: "serve",
    outputOptions: (options) => ({
      ...options,
      chunkFileNames: "assets/[name].js",
      assetFileNames: "assets/[name][extname]",
    }),
  } satisfies Plugin;
}

const configuredAllowedHosts = (process.env.SUPATERM_DEV_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const allowedHosts = [".ts.net", ...configuredAllowedHosts];

export default defineConfig(({ command }) => {
  const configuredAppVersion =
    process.env.APP_VERSION?.trim() ||
    (command === "build" && !builtDev
      ? resolveTaggedSourceVersion(`${import.meta.dirname}/../..`, pkg.version)
      : pkg.version);
  return {
    run: {
      tasks: {
        typecheck: {
          command: "tsc --noEmit",
          cache: { input: [{ auto: true }, "!*.tsbuildinfo"] },
        },
      },
    },
    assetsInclude: ["**/*.wasm"],
    plugins: [
      devCompressionPlugin(),
      chunkCycleGuardPlugin(),
      builtDev
        ? undefined
        : thirdPartyLicensesPlugin({
            bundleName: "web",
            configFile: new URL("../../third-party-licenses.config.json", import.meta.url),
            packageManifests: [
              { bundle: "web", path: new URL("./package.json", import.meta.url) },
              { bundle: "server", path: new URL("../server/package.json", import.meta.url) },
              { bundle: "desktop", path: new URL("../desktop/package.json", import.meta.url) },
            ],
          }),
      tanstackRouter({ autoCodeSplitting: true }),
      react({ compiler: true }),
      tailwindPlugins(bundledDev),
      warmBundledDevPlugin(),
      bundledDev ? bundledDevStableNamesPlugin() : undefined,
    ],
    optimizeDeps: {
      include: [
        "@pierre/diffs",
        "@pierre/diffs/edit",
        "@pierre/diffs/react",
        "@pierre/diffs/ssr",
        "@pierre/diffs/worker/worker.js",
        "effect/Array",
        "effect/Order",
        "react-dom/client",
      ],
    },
    define: {
      "import.meta.env.VITE_WS_URL": JSON.stringify(configuredWsUrl ?? ""),
      "import.meta.env.VITE_HTTP_URL": JSON.stringify(configuredHttpUrl ?? ""),
      "import.meta.env.VITE_HOSTED_APP_URL": JSON.stringify(configuredHostedAppUrl ?? ""),
      "import.meta.env.VITE_HOSTED_APP_CHANNEL": JSON.stringify(configuredHostedAppChannel),
      "import.meta.env.SUPATERM_DESKTOP_UPDATE_REPOSITORY": JSON.stringify(
        configuredDesktopUpdateRepository,
      ),
      "import.meta.env.VITE_RELEASE_CHANNEL": JSON.stringify(configuredReleaseChannel),
      "import.meta.env.APP_VERSION": JSON.stringify(configuredAppVersion),
    },
    resolve: {
      tsconfigPaths: true,
      alias: {
        "@betteroffice/fonts-cjk": new URL(
          "./src/components/files/office/fonts-cjk.ts",
          import.meta.url,
        ).pathname,
      },
      dedupe: ["react", "react-dom"],
    },
    experimental: {
      bundledDev,
    },
    server: {
      host,
      port,
      strictPort: true,
      allowedHosts,
      warmup: {
        clientFiles: ["./src/main.tsx"],
      },
      watch: { exclude: rolldownWatchExclude },
      ...(devProxyTarget
        ? {
            proxy: Object.fromEntries(
              DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
                prefix,
                {
                  target: devProxyTarget,
                  changeOrigin: !DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES.has(prefix),
                  ...(prefix === "/ws" || prefix === "/api" ? { ws: true } : {}),
                },
              ]),
            ),
          }
        : {}),
      ...(explicitHost
        ? {
            hmr: {
              protocol: "ws",
              host: explicitHost,
              clientPort: port,
            },
          }
        : {}),
    },
    css: {
      devSourcemap: buildSourcemap !== false,
    },
    worker: { format: "es" },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      manifest: true,
      sourcemap: buildSourcemap,
      ...(builtDev ? { watch: { exclude: rolldownWatchExclude } } : {}),
      rolldownOptions: {
        output: {
          assetFileNames: (asset) =>
            asset.originalFileNames.some((path) => /[/\\]pdfjs-dist[/\\]wasm[/\\]/.test(path))
              ? `assets/pdfjs-${pdfjsPkg.version}/[name][extname]`
              : "assets/[name]-[hash][extname]",
        },
      },
    },
    test: {
      projects: [
        defineProject(unitTestProject),
        defineProject(browserTestProject),
        defineProject(renderScenariosProject),
      ],
    },
  };
});
