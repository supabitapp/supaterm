import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import * as NodeURL from "node:url";
import antiSlop from "ultracite/oxlint/anti-slop";

const DOM_TEST_ENVIRONMENT_ALLOWLIST: Array<string> = [];

const RESTRICTED_IMPORT_PATHS = [
  {
    name: "@supaterm/client-runtime",
    message:
      "Import from an explicit @supaterm/client-runtime/* subpath. The package has no root export.",
  },
  {
    name: "@pierre/diffs/react",
    importNames: ["CodeView"],
    message: "Use StyledDiffCodeView so web diff surfaces share styling and virtualized geometry.",
  },
];

const RESTRICTED_UI_VARIANT_PATTERNS = [
  {
    group: ["**/components/ui/*", "**/ui/*", "./ui/*"],
    importNames: ["buttonVariants", "toggleVariants", "badgeVariants", "selectTriggerVariants"],
    message:
      "Render the components/ui export instead of borrowing its class recipe (render={<Button …/>}, SelectButton, ToggleGroup).",
  },
];

const RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS = {
  name: "lucide-react",
  importNames: [
    "GitMerge",
    "GitMergeIcon",
    "GitPullRequest",
    "GitPullRequestIcon",
    "GitPullRequestArrow",
    "GitPullRequestArrowIcon",
    "GitPullRequestClosed",
    "GitPullRequestClosedIcon",
    "GitPullRequestDraft",
    "GitPullRequestDraftIcon",
    "GitPullRequestCreate",
    "GitPullRequestCreateIcon",
    "GitPullRequestCreateArrow",
    "GitPullRequestCreateArrowIcon",
  ],
  message:
    "Pick a glyph by meaning from PullRequestGlyph in apps/web/src/components/pullRequest/pullRequestIcons.tsx so every surface draws the same pull request the same way.",
};

export default defineConfig({
  resolve: {
    alias: {
      "~": NodeURL.fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    exclude: [
      "**/.supacode/**",
      "**/.supaterm/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    setupFiles: [
      NodeURL.fileURLToPath(
        new URL("./packages/shared/src/testing/longTempDir.ts", import.meta.url),
      ),
    ],
  },
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: [
      // Macroscope's glob-per-line ignore grammar, not Markdown: formatting
      // it rewrites `*` as `_` and joins lines.
      ".macroscope/ignore.md",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      ".mise/locks/**",
      "**/routeTree.gen.ts",
      "**/*.graphql.ts",
      "packages/source-control-github/schema/**",
      "apps/server/schema/**",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "apps/mobile/uniwind-types.d.ts",
      "*.icon/**",
    ],
    sortPackageJson: {},
    overrides: [
      {
        files: [".devcontainer/devcontainer.json"],
        options: {
          trailingComma: "none",
        },
      },
    ],
  },
  lint: {
    extends: [antiSlop],
    ignorePatterns: [
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "**/*.graphql.ts",
      "packages/source-control-github/schema/**",
      "apps/server/schema/**",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "apps/mobile/uniwind-types.d.ts",
      "oxlint-plugin-supaterm/**",
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: [
      "./oxlint-plugin-supaterm/index.ts",
      "./oxlint-plugin-supaterm/array-guardrails.ts",
      "./oxlint-plugin-supaterm/test-waits.ts",
      "@shadcn/lint",
    ],
    settings: {
      shadcn: { ui: "~/components/ui" },
    },
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    rules: {
      "anti-slop/no-chained-type-assertions": "off",
      "anti-slop/no-conditional-empty-object-spread": "off",
      "anti-slop/no-known-value-widening": "off",
      "anti-slop/no-object-parameters": "off",
      "anti-slop/no-reflect-get": "off",
      "anti-slop/no-runtime-typeof": "off",
      "anti-slop/no-shape-in-symbol-names": "off",
      "anti-slop/no-unknown-parameters": "off",
      "anti-slop/no-unknown-returns": "off",
      "anti-slop/no-unsafe-dictionary-type": "off",
      "anti-slop/require-safety-comment-for-type-assertion": "off",
      "array-guardrails/no-array-filter-map": "error",
      "array-guardrails/no-reduce-accumulator-copy": "error",
      "oxc/no-accumulating-spread": "error",
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "typescript/consistent-return": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-implied-eval": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-unnecessary-boolean-literal-compare": "off",
      "typescript/no-unnecessary-type-conversion": "off",
      "typescript/no-unnecessary-type-arguments": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/await-thenable": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off",
      "eslint/no-restricted-imports": [
        "error",
        { paths: [...RESTRICTED_IMPORT_PATHS, RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS] },
      ],
      "supaterm/no-global-process-runtime": "error",
      "supaterm/no-inline-schema-compile": "error",
      "supaterm/no-low-value-comments": "error",
      "supaterm/no-manual-effect-runtime-in-tests": "error",
      "supaterm/no-native-title-tooltip": "error",
      "supaterm/no-raw-mcp-registration": "error",
      "supaterm/no-test-in-loop": "error",
      "supaterm/no-rpc-permission-bypass": ["error", { allowRawClientAccess: true }],
      "supaterm/no-unscoped-has": "error",
      "supaterm/namespace-node-imports": "error",
      "supaterm/prefer-catch-tags": "error",
      "supaterm/prefer-effect-fn": "error",
      "supaterm/require-centered-scroll-gutter": "error",
      "supaterm/require-suppression-reason": "error",
    },
    overrides: [
      {
        files: [
          "**/*.{test,spec,test-d,spec-d}.{ts,tsx,js,jsx}",
          "**/__tests__/**/*.{ts,tsx,js,jsx}",
        ],
        plugins: ["vitest"],
        rules: {
          "test-waits/no-long-waits": "error",
          "vitest/expect-expect": "off",
          "vitest/no-conditional-expect": "off",
          "vitest/no-conditional-tests": "error",
          "vitest/no-disabled-tests": "error",
          "vitest/no-duplicate-hooks": "error",
          "vitest/no-focused-tests": "error",
          "vitest/no-identical-title": "error",
          "vitest/no-standalone-expect": "off",
          "vitest/no-test-return-statement": "error",
          "vitest/require-mock-type-parameters": "off",
          "vitest/require-to-throw-message": "off",
          "vitest/valid-expect": "off",
        },
      },
      {
        files: ["**/*.live.test.ts"],
        rules: { "test-waits/no-long-waits": "off" },
      },
      {
        files: [
          "**/*.{test,spec,testkit}.{ts,tsx}",
          "**/{test,tests,testkit,testing,fixtures,integration}/**",
          "packages/provider-testing/**",
        ],
        rules: { "supaterm/prefer-effect-fn": "off" },
      },
      {
        files: ["apps/web/**/*.test.{ts,tsx}"],
        rules: { "supaterm/require-disposable-render": "error" },
      },
      {
        files: ["apps/**/src/**", "packages/**/src/**"],
        excludeFiles: DOM_TEST_ENVIRONMENT_ALLOWLIST,
        rules: { "supaterm/no-dom-test-environment": "error" },
      },
      {
        files: ["packages/client-runtime/src/state/**", "apps/{web,mobile,desktop}/src/**"],
        rules: { "supaterm/no-rpc-permission-bypass": ["error", { allowRawClientAccess: false }] },
      },
      {
        files: [
          "packages/client-runtime/src/state/runtime.ts",
          "packages/client-runtime/src/state/vcsAction.ts",
        ],
        rules: {
          "supaterm/no-rpc-permission-bypass": [
            "error",
            { allowGuardInstallation: true, allowRawClientAccess: false },
          ],
        },
      },
      {
        files: [
          "apps/web/src/components/settings/ConnectionsSettings.tsx",
          "apps/mobile/src/features/updates/app-updates.ts",
          "apps/web/src/components/device/DevicePhoneViewport.tsx",
          "apps/web/src/components/device/DeviceDuoViewport.tsx",
        ],
        rules: { "supaterm/no-rpc-permission-bypass": ["error", { allowRawClientAccess: true }] },
      },
      {
        files: ["packages/client-runtime/src/connection/outdatedHostUpdate.ts"],
        rules: { "supaterm/no-rpc-permission-bypass": "off" },
      },
      {
        files: [
          "packages/client-runtime/src/rpc/**",
          "**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
        ],
        rules: { "supaterm/no-rpc-permission-bypass": "off" },
      },
      {
        files: ["packages/shared/src/HostProcess.ts"],
        rules: { "supaterm/no-global-process-runtime": "off" },
      },
      {
        // The `supaterm` npm launcher is published as plain, dependency-free Node.
        files: ["scripts/npm-launcher/**"],
        rules: {
          "supaterm/no-global-process-runtime": "off",
          "supaterm/namespace-node-imports": "off",
        },
      },
      {
        files: ["apps/server/src/mcp/McpHttpServer.ts"],
        rules: { "supaterm/no-raw-mcp-registration": "off" },
      },
      {
        files: ["apps/web/src/**"],
        excludeFiles: ["apps/web/src/components/ui/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [...RESTRICTED_IMPORT_PATHS, RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS],
              patterns: RESTRICTED_UI_VARIANT_PATTERNS,
            },
          ],
        },
      },
      {
        files: ["apps/web/src/components/pullRequest/pullRequestIcons.tsx"],
        rules: { "eslint/no-restricted-imports": ["error", { paths: RESTRICTED_IMPORT_PATHS }] },
      },
      {
        files: ["apps/mobile/src/**"],
        rules: { "supaterm/no-mobile-uniwind-theme-escape-hatches": "error" },
      },
      {
        files: ["apps/mobile/src/**"],
        excludeFiles: [
          "apps/mobile/src/components/ui/AppSymbol.tsx",
          "apps/mobile/src/components/ui/AppSymbol.ios.tsx",
          "apps/mobile/src/features/pull-requests/pullRequestGlyphs.ts",
        ],
        rules: { "supaterm/no-mobile-pull-request-glyph-literals": "error" },
      },
      {
        // React commits state set in a raw ResizeObserver callback after the paint, so derived
        // layout lands a frame late. observeResize flushes every observed resize in one render.
        files: ["apps/web/src/**"],
        excludeFiles: [
          "apps/web/src/lib/observeResize.ts",
          "**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
        ],
        rules: { "supaterm/no-raw-resize-observer": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "shadcn/no-unknown-classes": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "supaterm/no-outset-state-indicators": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "shadcn/no-raw-colors": "error" },
      },
      {
        // Third-party marks (brand logos, the macOS permission panes, Codex's Computer Use
        // mark) must keep their exact colors, so the files that hold them are exempt.
        files: ["apps/web/src/components/Icons.tsx", "apps/web/src/components/JetBrainsIcons.tsx"],
        rules: { "shadcn/no-raw-colors": "off" },
      },
      {
        files: ["apps/web/src/**"],
        excludeFiles: ["apps/web/src/components/ui/**"],
        rules: {
          "shadcn/require-static-classes": "error",
          "shadcn/no-arbitrary-values": [
            "error",
            {
              allow: [
                "layout",
                "transition",
                "rounded-[inherit]",
                "gap-[0.33em]",
                "px-[0.5em]",
                "rounded-[0.5em]",
                "text-[0.86em]",
                "rounded-[25%]",
                "text-[length:80cqh]",
                "bg-[Highlight]",
                "fill-[#26251E]",
                "fill-[#EDECEC]",
                "fill-[#0F0F0F]",
                "fill-[#F5F5F5]",
                "fill-[#d97757]",
                "text-[#d97757]",
              ],
            },
          ],
          "shadcn/no-restyle": [
            "error",
            {
              allow: ["layout"],
              contracts: [
                {
                  // CollapsibleTrigger is a bare button with no styled counterpart
                  // (a disclosure row is not a Button), so its className is the API.
                  // Every other trigger has one: style them with render={<Button …/>}.
                  pattern: "^CollapsibleTrigger$",
                  allow: ["layout", "color", "typography", "spacing", "shape", "effects", "motion"],
                },
              ],
            },
          ],
        },
      },
      {
        // Every web file must compile under the React Compiler. Its bailout rules are errors here,
        // and manual memoization is redundant. No built-in oxlint rule bans useMemo/useCallback,
        // hence supaterm/no-manual-memo.
        files: ["apps/web/src/**/*.{ts,tsx}"],
        rules: {
          "react/exhaustive-effect-dependencies": "error",
          "react/globals": "error",
          "react/hooks": "error",
          "react/immutability": "error",
          // The compiler memoizes context values; this rule would ask for useMemo.
          "react/jsx-no-constructed-context-values": "off",
          "react/memo-dependencies": "error",
          "react/preserve-manual-memoization": "error",
          "react/purity": "error",
          "react/refs": "error",
          "react/set-state-in-effect": "error",
          "react/set-state-in-render": "error",
          "react/static-components": "error",
          "react/unsupported-syntax": "error",
          "supaterm/no-manual-memo": "error",
        },
      },
      {
        // Shared client code must not call APIs missing from Hermes. Our ESNext
        // TypeScript target accepts them even when they would crash mobile at launch.
        // Tests run on Node and are exempt.
        files: [
          "apps/mobile/src/**",
          "packages/client-runtime/src/**",
          "packages/contracts/src/**",
          "packages/shared/src/**",
        ],
        excludeFiles: ["**/*.test.ts", "**/*.test.tsx"],
        rules: { "supaterm/no-hermes-unsupported-apis": "error" },
      },
      {
        // Mobile is ratcheting toward full React Compiler coverage
        // (apps/mobile/src/reactCompilerCoverage.test.ts). Directives would hide bailouts from it;
        // the manual memo hooks go once the allowlist there is empty.
        files: ["apps/mobile/src/**/*.{ts,tsx}"],
        rules: {
          "supaterm/no-manual-memo": ["error", { allowMemoHooks: true }],
          "react/jsx-no-constructed-context-values": "off",
        },
      },
      {
        files: ["apps/web/src/**/*.{ts,tsx}", "apps/mobile/src/**/*.{ts,tsx}"],
        excludeFiles: ["**/*.test.ts", "**/*.test.tsx"],
        rules: { "supaterm/no-hookless-use-function": "error" },
      },
      {
        files: [
          "apps/mobile/src/features/archive/ArchivedThreadsScreen.tsx",
          "apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx",
          "apps/mobile/src/features/diagrams/MermaidDiagramScreen.tsx",
          "apps/mobile/src/features/files/FileMarkdownPreview.tsx",
          "apps/mobile/src/features/files/SourceFileSurface.tsx",
          "apps/mobile/src/features/files/AttachmentFileScreen.tsx",
          "apps/mobile/src/features/files/ThreadFilesRouteScreen.tsx",
          "apps/mobile/src/features/files/thread-file-navigator-pane.tsx",
          "apps/mobile/src/features/home/HomeHeader.tsx",
          "apps/mobile/src/features/review/ReviewSheet.tsx",
          "apps/mobile/src/features/review/useNativeReviewDiffBridge.ts",
          "apps/mobile/src/features/settings/SettingsEnvironmentsRouteScreen.tsx",
          "apps/mobile/src/features/threads/GitActionProgressOverlay.tsx",
          "apps/mobile/src/features/threads/NewTaskDraftScreen.tsx",
          "apps/mobile/src/features/threads/ThreadComposer.tsx",
          "apps/mobile/src/features/threads/ThreadFeed.tsx",
          "apps/mobile/src/features/settings/appearance/components/FontSizeSliderRow.tsx",
          "apps/mobile/src/features/threads/NewTaskContextPickerScreens.tsx",
          "apps/mobile/src/features/threads/ThreadQueueControl.tsx",
          "apps/mobile/src/features/review/ReviewCommentCard.tsx",
          "apps/mobile/src/features/threads/ThreadSettingsSheet.tsx",
          "apps/mobile/src/features/threads/thread-list-items.tsx",
          "apps/mobile/src/features/threads/thread-list-v2-items.tsx",
          "apps/mobile/src/lib/useMobileNavigationTheme.ts",
          "apps/mobile/src/native/SupatermComposerEditor.ios.tsx",
          "apps/mobile/src/native/SupatermComposerEditor.native.tsx",
          "apps/mobile/src/native/SelectableMarkdownText.tsx",
          "apps/mobile/src/native/NativeMermaidSvg.tsx",
        ],
        rules: {
          "supaterm/no-mobile-uniwind-theme-escape-hatches": ["error", { allowUniwindTheme: true }],
        },
      },
    ],
    options: {
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
      typeAware: false,
      typeCheck: false,
    },
  },
});
