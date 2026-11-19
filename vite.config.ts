import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import * as NodeURL from "node:url";
import antiSlop from "ultracite/oxlint/anti-slop";
import { reactDoctorOverrides, reactDoctorSettings } from "./oxlint-react-doctor.ts";

const TEST_EXCLUDE = [
  "**/.supacode/**",
  "**/.supaterm/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/.{idea,git,cache,output,temp}/**",
];

const TEST_CONFIG_PACKAGES = [
  "apps/desktop",
  "apps/mobile",
  "apps/server",
  "apps/web",
  "packages/client-runtime",
];

const isRepoRootTestRun = process.cwd() === import.meta.dirname;

const RESTRICTED_IMPORT_PATHS = [
  {
    name: "react-native",
    importNames: ["FlatList"],
    message:
      "Use LegendList from @legendapp/list/react-native, with renderScrollComponent={NativeScrollView} in a screen. Pass whatever renderItem reads through extraData: rows only re-render when their item or extraData changes.",
  },
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
  {
    name: "react-native-screens",
    importNames: ["ScrollViewMarker"],
    message:
      "Use NativeScrollViewMarker or NativeScrollView (src/native/NativeScrollViewMarker.tsx): they carry the header's scroll-edge blur under the Duo's vertical bar.",
  },
  {
    name: "react-native",
    importNames: ["RefreshControl"],
    message:
      "Use RefreshControl from src/components/ui/RefreshControl: Android bottom sheets own the pull at the top, so it steps aside there.",
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

const TYPEAHEAD_PRIMITIVE_MESSAGE =
  "Build text fields and pickers from components/ui (Input, Combobox, Autocomplete, Command); the shared Input accepts the highlighted suggestion on Tab.";

const RESTRICTED_TYPEAHEAD_PRIMITIVE_IMPORTS = [
  ...["input", "combobox", "autocomplete"].map((primitive) => ({
    name: `@base-ui/react/${primitive}`,
    message: TYPEAHEAD_PRIMITIVE_MESSAGE,
  })),
  {
    name: "@base-ui/react",
    importNames: ["Input", "Combobox", "Autocomplete"],
    message: TYPEAHEAD_PRIMITIVE_MESSAGE,
  },
];

const RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS = {
  name: "@supaterm/icons",
  importNames: [
    "GitMergeIcon",
    "GitPullRequestIcon",
    "GitPullRequestClosedIcon",
    "GitPullRequestDraftIcon",
  ],
  message:
    "Pick a glyph by meaning from PullRequestGlyph in apps/web/src/components/pullRequest/pullRequestIcons.tsx so every surface draws the same pull request the same way.",
};

const LEGACY_UNSIGNALED_POLLS = {
  "apps/mobile/src/features/threads/NewTaskDraftRouteScreen.test.tsx": 1,
  "apps/mobile/src/features/threads/new-task-branch-checkout.test.ts": 7,
  "apps/mobile/src/features/updates/app-updates.test.ts": 1,
  "apps/mobile/src/lib/coalescedRun.test.ts": 2,
  "apps/mobile/src/lib/videoThumbnails.test.ts": 1,
  "apps/web/src/browser/ServerBrowserSurface.browser.test.tsx": 1,
  "apps/web/src/components/ChatMarkdown.browser.test.tsx": 2,
  "apps/web/src/components/ChatMarkdown.permissions.browser.test.tsx": 6,
  "apps/web/src/components/CommandPalette.browser.test.tsx": 1,
  "apps/web/src/components/DiffFilePathCopyButton.browser.test.tsx": 1,
  "apps/web/src/components/ThreadStatusIndicators.subscriptions.browser.test.tsx": 1,
  "apps/web/src/components/chat/ComposerBannerStack.browser.test.tsx": 1,
  "apps/web/src/components/chat/ExpandedImageDialog.browser.test.tsx": 1,
  "apps/web/src/components/chat/MarkdownCodeBlock.browser.test.tsx": 1,
  "apps/web/src/components/chat/MessageCopyButton.browser.test.tsx": 1,
  "apps/web/src/components/chat/MessagesTimeline.browser.test.tsx": 2,
  "apps/web/src/components/chat/MessagesTimeline.follow.browser.test.tsx": 1,
  "apps/web/src/components/chat/TextFieldVoiceInput.browser.test.tsx": 1,
  "apps/web/src/components/chat/useComposerSelection.browser.test.tsx": 3,
  "apps/web/src/components/chat/useDraftEnvironmentRouting.browser.test.tsx": 1,
  "apps/web/src/components/chat/useQueuedRunEdit.browser.test.tsx": 4,
  "apps/web/src/components/chat/useThreadLifecycle.browser.test.tsx": 1,
  "apps/web/src/components/codexMicro/CodexMicroCoordinator.browser.test.tsx": 1,
  "apps/web/src/components/desktop/DesktopWebLinkCoordinator.browser.test.tsx": 5,
  "apps/web/src/components/device/DevicePanel.browser.test.tsx": 1,
  "apps/web/src/components/device/useDeviceControls.browser.test.tsx": 1,
  "apps/web/src/components/files/AttachmentFilePreview.browser.test.tsx": 7,
  "apps/web/src/components/files/BrowserDocumentFrame.browser.test.tsx": 7,
  "apps/web/src/components/files/FileBrowserPanel.browser.test.tsx": 2,
  "apps/web/src/components/files/office/sheet-resize.browser.test.ts": 4,
  "apps/web/src/components/onboarding/WelcomeWizard.import.browser.test.tsx": 3,
  "apps/web/src/components/preview/PreviewView.browser.test.tsx": 3,
  "apps/web/src/components/pullRequest/PullRequestCodeTab.browser.test.tsx": 2,
  "apps/web/src/components/pullRequest/PullRequestTimelineTab.browser.test.tsx": 1,
  "apps/web/src/components/settings/AcpRegistrySearchStep.browser.test.tsx": 1,
  "apps/web/src/components/settings/AddCodexAccountDialog.browser.test.tsx": 1,
  "apps/web/src/components/settings/ProjectSettingsPanel.browser.test.tsx": 11,
  "apps/web/src/components/ui/sidebar.browser.test.tsx": 2,
  "apps/web/src/components/ui/tooltip.browser.test.tsx": 1,
  "apps/web/src/lib/attachmentUploadQueue.test.ts": 2,
  "apps/web/src/state/desktopCliCommand.test.ts": 1,
};

export default defineConfig({
  resolve: {
    alias: {
      "~": NodeURL.fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    exclude: TEST_EXCLUDE,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    allowOnly: !process.env.CI,
    retry: 0,
    fakeTimers: {
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
      ],
    },
    setupFiles: [
      NodeURL.fileURLToPath(
        new URL("./packages/shared/src/testing/longTempDir.ts", import.meta.url),
      ),
      NodeURL.fileURLToPath(
        new URL("./packages/shared/src/testing/providerEnv.ts", import.meta.url),
      ),
    ],
    ...(isRepoRootTestRun
      ? {
          projects: [
            ...TEST_CONFIG_PACKAGES,
            {
              extends: true,
              test: {
                name: "root",
                exclude: [
                  ...TEST_EXCLUDE,
                  ...TEST_CONFIG_PACKAGES.map((dir) => `${dir}/**`),
                  "native/kde-snap-shot/**",
                ],
              },
            },
          ],
        }
      : {}),
  },
  fmt: {
    ignorePatterns: [
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
      "apps/mobile/modules/supaterm-highlights/Vendor/**",
      "apps/mobile/modules/supaterm-highlights/cpp/generated/**",
      "apps/mobile/modules/supaterm-highlights/nitrogen/generated/**",
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
      "oxlint-plugin-react-doctor",
      { name: "landmines-testing", specifier: "@interfere/landmines/testing" },
      { name: "landmines-structure", specifier: "@interfere/landmines/structure" },
      { name: "landmines-style", specifier: "@interfere/landmines/style" },
      { name: "landmines-types", specifier: "@interfere/landmines/types" },
    ],
    settings: {
      shadcn: { ui: "~/components/ui" },
      "react-doctor": reactDoctorSettings,
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
      "landmines-structure/colocated-tests": "error",
      "landmines-structure/package-exports": "error",
      "landmines-structure/test-file-names": "error",
      "landmines-style/no-comments": "error",
      "landmines-testing/no-fixed-sleep": "error",
      "landmines-testing/no-flake-masking": "error",
      "landmines-testing/no-test-doubles": "error",
      "landmines-testing/no-unsignaled-poll": ["error", { allow: LEGACY_UNSIGNALED_POLLS }],
      "landmines-testing/strict-msw": "error",
      "landmines-types/no-explicit-return-types": "error",
      "oxc/no-accumulating-spread": "error",
      "eslint/no-control-regex": "off",
      "typescript/no-this-alias": "off",
      "unicorn/prefer-add-event-listener": "off",
      "unicorn/prefer-string-starts-ends-with": "off",
      "unicorn/prefer-set-has": "off",
      "unicorn/prefer-array-find": "off",
      "unicorn/no-new-array": "off",
      "unicorn/no-array-reverse": "off",
      "react/no-object-type-as-default-prop": "off",
      "react/jsx-no-constructed-context-values": "off",
      "react/memo-dependencies": "error",
      "react/purity": "error",
      "react/refs": "error",
      "react/exhaustive-effect-dependencies": "error",
      "react/set-state-in-effect": "error",
      "react/immutability": "error",
      "react/no-array-index-key": "error",
      "react/no-unstable-nested-components": "error",
      "react/static-components": "error",
      "react/capitalized-calls": "error",
      "typescript/no-extraneous-class": "error",
      "eslint/no-empty-pattern": "error",
      "eslint/no-new": "error",
      "unicorn/no-useless-spread": "error",
      "eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "eslint/no-unsafe-optional-chaining": "error",
      "eslint/no-unneeded-ternary": "error",
      "unicorn/no-useless-fallback-in-spread": "error",
      "unicorn/require-module-specifiers": "error",
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
      "supaterm/no-polling-loop-in-tests": "warn",
      "supaterm/no-raw-mcp-registration": "error",
      "supaterm/no-real-time-wait-in-tests": "error",
      "supaterm/no-test-in-loop": "error",
      "supaterm/no-test-timeout-or-retry": "error",
      "supaterm/no-rpc-permission-bypass": ["error", { allowRawClientAccess: true }],
      "supaterm/no-unscoped-has": "error",
      "supaterm/no-wall-clock-in-tests": "error",
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
        files: ["**/_generated/**", "**/generated/**", "**/*.generated.ts", "**/*.gen.ts"],
        rules: {
          "landmines-style/no-comments": "off",
          "landmines-types/no-explicit-return-types": "off",
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
        files: ["apps/web/src/**", "apps/mobile/src/**", "apps/desktop/src/**"],
        excludeFiles: ["apps/web/src/projectIconOptions.ts"],
        rules: { "supaterm/no-sparkles-icon": "error" },
      },
      {
        files: ["apps/web/**/*.test.{ts,tsx}"],
        rules: { "supaterm/require-disposable-render": "error" },
      },
      {
        files: ["apps/web/src/**/*.browser.test.{ts,tsx}"],
        rules: { "supaterm/no-frame-waits-in-browser-tests": "error" },
      },
      {
        files: ["apps/**/src/**", "packages/**/src/**"],
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
          "apps/web/src/components/settings/AuthorizedClientsSettings.tsx",
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
              paths: [
                ...RESTRICTED_IMPORT_PATHS,
                RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS,
                ...RESTRICTED_TYPEAHEAD_PRIMITIVE_IMPORTS,
              ],
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
        files: ["packages/source-control-*/src/shared/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [...RESTRICTED_IMPORT_PATHS, RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS],
              patterns: [
                {
                  group: [
                    "react",
                    "react/*",
                    "react-*",
                    "expo",
                    "expo-*",
                    "lucide-react",
                    "@supaterm/client-runtime",
                    "@supaterm/client-runtime/*",
                    "../client/*",
                    "../server/*",
                    "../../client/*",
                    "../../server/*",
                    "../../../client/*",
                    "../../../server/*",
                    "@supaterm/source-control-*/client/*",
                    "@supaterm/source-control-*/server/*",
                  ],
                  message:
                    "Shared forge definitions load on the server and every client; keep UI and server code out.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/server/src/**", "packages/source-control-*/src/server/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [...RESTRICTED_IMPORT_PATHS, RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS],
              patterns: [
                {
                  group: [
                    "@supaterm/source-control-*/client/*",
                    "../client/*",
                    "../../client/*",
                    "../../../client/*",
                  ],
                  message:
                    "A forge's client entry is UI-only; the server reads its `shared/definition`.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/mobile/src/**"],
        rules: {
          "supaterm/no-mobile-uniwind-theme-escape-hatches": "error",
          "supaterm/require-registered-list-scroll": "error",
        },
      },
      {
        files: ["apps/mobile/src/**"],
        excludeFiles: [
          "apps/mobile/src/components/ui/AppSymbol.tsx",
          "apps/mobile/src/components/ui/AppSymbol.android.tsx",
          "apps/mobile/src/features/pull-requests/pullRequestGlyphs.ts",
        ],
        rules: { "supaterm/no-mobile-pull-request-glyph-literals": "error" },
      },
      {
        files: ["apps/mobile/src/**"],
        excludeFiles: ["**/*.test.{ts,tsx}"],
        rules: { "supaterm/no-ambiguous-detail-navigation": "error" },
      },
      {
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
        rules: { "supaterm/max-settings-description-length": "error" },
      },
      {
        files: ["apps/*/src/**", "packages/*/src/**"],
        excludeFiles: [
          "**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
          "**/testkit/**",
          "**/_generated/**",
          "apps/marketing/src/lib/tweets.ts",
        ],
        rules: { "supaterm/no-em-dash-copy": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "shadcn/no-raw-colors": "error" },
      },
      {
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
                  pattern: "^CollapsibleTrigger$",
                  allow: ["layout", "color", "typography", "spacing", "shape", "effects", "motion"],
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/web/src/**/*.{ts,tsx}"],
        rules: {
          "react/exhaustive-effect-dependencies": "error",
          "react/globals": "error",
          "react/hooks": "error",
          "react/immutability": "error",
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
        files: ["apps/mobile/src/**/*.{ts,tsx}"],
        rules: { "supaterm/no-manual-memo": ["error", { allowMemoHooks: true }] },
      },
      {
        files: ["apps/web/src/**", "apps/mobile/src/**", "packages/*/src/**"],
        rules: { "supaterm/no-unreasoned-state-sync": "error" },
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
          "apps/mobile/src/features/layout/nested-stacks.tsx",
          "apps/mobile/src/features/review/ReviewSheet.tsx",
          "apps/mobile/src/features/review/useNativeReviewDiffBridge.ts",
          "apps/mobile/src/features/settings/SettingsEnvironmentsRouteScreen.tsx",
          "apps/mobile/src/features/threads/ThreadComposer.tsx",
          "apps/mobile/src/features/threads/ThreadFeed.tsx",
          "apps/mobile/src/features/threads/ThreadQueueControl.tsx",
          "apps/mobile/src/features/review/ReviewCommentCard.tsx",
          "apps/mobile/src/features/threads/thread-list-v2-items.tsx",
          "apps/mobile/src/components/ui/SecretTextInput.android.tsx",
          "apps/mobile/src/lib/useMobileNavigationTheme.ts",
          "apps/mobile/src/native/SupatermComposerEditor.ios.tsx",
          "apps/mobile/src/native/SupatermComposerEditor.native.tsx",
          "apps/mobile/src/native/SelectableMarkdownText.tsx",
          "apps/mobile/src/native/NativeMermaidSvg.tsx",
          "apps/mobile/src/native/useEnrichedLinkVariants.ts",
        ],
        rules: {
          "supaterm/no-mobile-uniwind-theme-escape-hatches": ["error", { allowUniwindTheme: true }],
        },
      },
      {
        files: [
          "apps/web/src/**",
          "apps/mobile/src/**",
          "packages/client-runtime/src/**",
          "packages/icons/src/**",
        ],
        excludeFiles: ["**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
        plugins: ["jsx-a11y"],
        rules: {
          "react/button-has-type": "error",
          "react/checked-requires-onchange-or-readonly": "error",
          "react/jsx-no-target-blank": "error",
          "react/rules-of-hooks": "error",
          "jsx-a11y/alt-text": "off",
          "jsx-a11y/anchor-has-content": "off",
          "jsx-a11y/click-events-have-key-events": "off",
          "jsx-a11y/heading-has-content": "off",
          "jsx-a11y/interactive-supports-focus": "off",
          "jsx-a11y/label-has-associated-control": "off",
          "jsx-a11y/media-has-caption": "off",
          "jsx-a11y/no-autofocus": "off",
          "jsx-a11y/no-noninteractive-element-interactions": "off",
          "jsx-a11y/no-noninteractive-tabindex": "off",
          "jsx-a11y/no-redundant-roles": "off",
          "jsx-a11y/no-static-element-interactions": "off",
          "jsx-a11y/role-has-required-aria-props": "off",
          "jsx-a11y/role-supports-aria-props": "off",
          "jsx-a11y/control-has-associated-label": "off",
          "jsx-a11y/prefer-tag-over-role": "off",
        },
      },
      ...reactDoctorOverrides,
    ],
    options: {
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
      typeAware: false,
      typeCheck: false,
    },
  },
});
