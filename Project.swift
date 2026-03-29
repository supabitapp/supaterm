import ProjectDescription

let zmxBuildScript = """
  set -eu

  (
    cd "${SRCROOT}/ThirdParty/zmx"
    mise exec -- zig build
  )
  """

let zmxBuildInputPaths: [FileListGlob] = [
  "$(SRCROOT)/ThirdParty/zmx/build.zig",
  "$(SRCROOT)/ThirdParty/zmx/build.zig.zon",
  "$(SRCROOT)/ThirdParty/zmx/src",
  "$(SRCROOT)/ThirdParty/zmx/include",
]

let zmxBuildOutputPaths: [Path] = [
  "$(SRCROOT)/ThirdParty/zmx/zig-out/bin/zmx",
  "$(SRCROOT)/ThirdParty/zmx/zig-out/include/zmx_core.h",
  "$(SRCROOT)/ThirdParty/zmx/zig-out/lib/libzmx_core.a",
  "$(SRCROOT)/ThirdParty/zmx/zig-out/lib/libzmx_core_ffi.a",
  "$(SRCROOT)/ThirdParty/zmx/zig-out/lib/libzmx_core_ffi.dylib",
]

let project = Project(
  name: "supaterm",
  settings: .settings(
    base: [
      "CLANG_ENABLE_MODULES": "YES",
      "CODE_SIGN_STYLE": "Automatic",
      "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
      "SUPATERM_DEVELOPMENT_BUILD": "NO",
      "SWIFT_APPROACHABLE_CONCURRENCY": "YES",
      "SWIFT_DEFAULT_ACTOR_ISOLATION": "MainActor",
      "SWIFT_UPCOMING_FEATURE_MEMBER_IMPORT_VISIBILITY": "YES",
      "SWIFT_VERSION": "6.2",
    ],
    configurations: [
      .debug(name: .debug, xcconfig: "Configurations/Project.xcconfig"),
      .release(name: .release, xcconfig: "Configurations/Project.xcconfig"),
    ],
    defaultSettings: .essential
  ),
  targets: [
    .target(
      name: "SupatermCLIShared",
      destinations: .macOS,
      product: .staticLibrary,
      bundleId: "app.supabit.supaterm.cli-shared",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      sources: [
        "SupatermCLIShared/**",
      ],
      settings: .settings(
        base: [
          "SWIFT_DEFAULT_ACTOR_ISOLATION": "nonisolated",
          "SWIFT_STRICT_CONCURRENCY": "complete",
        ],
        defaultSettings: .essential
      )
    ),
    .target(
      name: "sp",
      destinations: .macOS,
      product: .commandLineTool,
      bundleId: "app.supabit.sp",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      sources: [
        "sp/**",
      ],
      scripts: [
        .pre(
          script: zmxBuildScript,
          name: "Build zmx runtime",
          inputPaths: zmxBuildInputPaths,
          outputPaths: zmxBuildOutputPaths
        )
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .external(name: "ArgumentParser"),
      ],
      settings: .settings(
        base: [
          "ENABLE_USER_SCRIPT_SANDBOXING": "NO",
          "ENABLE_HARDENED_RUNTIME": "YES",
          "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/../Frameworks",
          "SKIP_INSTALL": "YES",
          "OTHER_LDFLAGS": "$(inherited) -lc++ -L$(SRCROOT)/ThirdParty/zmx/zig-out/lib -lzmx_core_ffi -Xlinker -rpath -Xlinker @executable_path/../Frameworks",
          "SWIFT_DEFAULT_ACTOR_ISOLATION": "nonisolated",
          "SWIFT_STRICT_CONCURRENCY": "complete",
        ],
        defaultSettings: .essential
      )
    ),
    .target(
      name: "supaterm",
      destinations: .macOS,
      product: .app,
      bundleId: "app.supabit.supaterm",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .extendingDefault(with: [
        "CFBundleShortVersionString": "$(MARKETING_VERSION)",
        "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
        "LSApplicationCategoryType": "public.app-category.developer-tools",
        "NSAppleEventsUsageDescription": "A program running within Supaterm would like to use AppleScript.",
        "NSBluetoothAlwaysUsageDescription": "A program running within Supaterm would like to use Bluetooth.",
        "NSCalendarsUsageDescription": "A program running within Supaterm would like to access your Calendar.",
        "NSCameraUsageDescription": "A program running within Supaterm would like to use the camera.",
        "NSContactsUsageDescription": "A program running within Supaterm would like to access your Contacts.",
        "NSLocalNetworkUsageDescription": "A program running within Supaterm would like to access the local network.",
        "NSLocationUsageDescription": "A program running within Supaterm would like to access your location information.",
        "NSMicrophoneUsageDescription": "A program running within Supaterm would like to use your microphone.",
        "NSMotionUsageDescription": "A program running within Supaterm would like to access motion data.",
        "NSPhotoLibraryUsageDescription": "A program running within Supaterm would like to access your Photo Library.",
        "NSRemindersUsageDescription": "A program running within Supaterm would like to access your reminders.",
        "NSSpeechRecognitionUsageDescription": "A program running within Supaterm would like to use speech recognition.",
        "NSSystemAdministrationUsageDescription": "A program running within Supaterm requires elevated privileges.",
        "SupatermDevelopmentBuild": "$(SUPATERM_DEVELOPMENT_BUILD)",
        "SUFeedURL": "https://github.com/supabitapp/supaterm/releases/download/tip/appcast.xml",
        "SUPublicEDKey": "$(SPARKLE_PUBLIC_ED_KEY)",
        "SUEnableAutomaticChecks": true,
        "SUAutomaticallyUpdate": true,
      ]),
      resources: [
        "supaterm/Assets.xcassets",
        .folderReference(path: "Resources/ghostty"),
        .folderReference(path: "Resources/terminfo"),
      ],
      buildableFolders: [
        "supaterm/App",
        "supaterm/Features",
      ],
      scripts: [
        .post(
          script: """
            set -eu

            destination_path="${TARGET_BUILD_DIR}/${CONTENTS_FOLDER_PATH}/MacOS/sp"
            source_candidates=(
              "${BUILT_PRODUCTS_DIR}/sp"
              "${UNINSTALLED_PRODUCTS_DIR}/${PLATFORM_NAME}/sp"
            )

            source_path=""
            for candidate in "${source_candidates[@]}"; do
              if [ -x "${candidate}" ]; then
                source_path="${candidate}"
                break
              fi
            done

            if [ -z "${source_path}" ]; then
              echo "error: missing built sp executable" >&2
              exit 1
            fi

            /bin/cp -f "${source_path}" "${destination_path}"
            """,
          name: "Embed sp CLI",
          inputPaths: [
            "$(BUILT_PRODUCTS_DIR)/sp",
            "$(UNINSTALLED_PRODUCTS_DIR)/$(PLATFORM_NAME)/sp",
          ],
          outputPaths: [
            "$(TARGET_BUILD_DIR)/$(CONTENTS_FOLDER_PATH)/MacOS/sp",
          ]
        ),
        .post(
          script: """
            set -eu

            output_dir="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"
            mkdir -p "${output_dir}"

            source_path="${SRCROOT}/ThirdParty/zmx/zig-out/lib/libzmx_core_ffi.dylib"
            destination_path="${output_dir}/libzmx_core_ffi.dylib"

            if [ ! -f "${source_path}" ]; then
              echo "error: missing zmx core dylib; run 'make build-zmx'" >&2
              exit 1
            fi

            /bin/cp -f "${source_path}" "${destination_path}"
            /bin/chmod +x "${destination_path}"
            """,
          name: "Embed zmx core dylib",
          inputPaths: [
            "$(SRCROOT)/ThirdParty/zmx/zig-out/lib/libzmx_core_ffi.dylib",
          ],
          outputPaths: [
            "$(TARGET_BUILD_DIR)/$(FRAMEWORKS_FOLDER_PATH)/libzmx_core_ffi.dylib",
          ]
        ),
        .post(
          script: """
            set -eu

            output_dir="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/web"
            rm -rf "${output_dir}"
            mkdir -p "${output_dir}"

            (
              cd "${SRCROOT}/packages/web"
              VITE_SERVER_URL="" bunx vite build
            )

            /usr/bin/rsync -a --delete "${SRCROOT}/packages/web/dist/" "${output_dir}/"
            """,
          name: "Build embedded web app",
          inputPaths: [
            "$(SRCROOT)/packages/web/src",
            "$(SRCROOT)/packages/web/index.html",
            "$(SRCROOT)/packages/web/package.json",
            "$(SRCROOT)/packages/web/vite.config.mts",
          ],
          outputPaths: [
            "$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/web/index.html",
          ]
        ),
        .post(
          script: """
            set -eu

            destination_path="${TARGET_BUILD_DIR}/${CONTENTS_FOLDER_PATH}/MacOS/zmx"
            source_path="${SRCROOT}/ThirdParty/zmx/zig-out/bin/zmx"

            if [ ! -x "${source_path}" ]; then
              echo "error: missing vendored zmx executable; run 'make build-zmx'" >&2
              exit 1
            fi

            /bin/cp -f "${source_path}" "${destination_path}"
            /bin/chmod +x "${destination_path}"
            """,
          name: "Embed zmx",
          inputPaths: [
            "$(SRCROOT)/ThirdParty/zmx/zig-out/bin/zmx",
          ],
          outputPaths: [
            "$(TARGET_BUILD_DIR)/$(CONTENTS_FOLDER_PATH)/MacOS/zmx",
          ]
        ),
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .target(name: "sp"),
        .xcframework(path: "Frameworks/GhosttyKit.xcframework"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
        .external(name: "Sparkle"),
      ],
      settings: .settings(
        base: [
          "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
          "ENABLE_USER_SCRIPT_SANDBOXING": "NO",
          "ENABLE_HARDENED_RUNTIME": "YES",
          "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/../Frameworks",
        ],
        debug: [
          "CODE_SIGN_ENTITLEMENTS": "supatermDebug.entitlements",
        ],
        release: [
          "CODE_SIGN_ENTITLEMENTS": "supaterm.entitlements",
        ],
        defaultSettings: .essential
      )
    ),
    .target(
      name: "supatermTests",
      destinations: .macOS,
      product: .unitTests,
      bundleId: "app.supabit.supatermTests",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "supatermTests",
      ],
      dependencies: [
        .target(name: "supaterm"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
      ],
      settings: .settings(
        base: [
          "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @loader_path/../Frameworks @executable_path/../Frameworks @loader_path/../../../supaterm.app/Contents/MacOS",
          "TEST_HOST": "$(BUILT_PRODUCTS_DIR)/supaterm.app/Contents/MacOS/supaterm",
        ],
        debug: [
          "BUNDLE_LOADER": "$(BUILT_PRODUCTS_DIR)/supaterm.app/Contents/MacOS/supaterm.debug.dylib",
        ],
        release: [
          "BUNDLE_LOADER": "$(TEST_HOST)",
        ],
        defaultSettings: .essential
      )
    ),
    .target(
      name: "SupatermCLISharedTests",
      destinations: .macOS,
      product: .unitTests,
      bundleId: "app.supabit.SupatermCLISharedTests",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "SupatermCLISharedTests",
      ],
      dependencies: [
        .target(name: "supaterm"),
        .target(name: "SupatermCLIShared"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
      ],
      settings: .settings(
        base: [
          "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @loader_path/../Frameworks @executable_path/../Frameworks @loader_path/../../../supaterm.app/Contents/MacOS",
          "TEST_HOST": "$(BUILT_PRODUCTS_DIR)/supaterm.app/Contents/MacOS/supaterm",
        ],
        debug: [
          "BUNDLE_LOADER": "$(BUILT_PRODUCTS_DIR)/supaterm.app/Contents/MacOS/supaterm.debug.dylib",
        ],
        release: [
          "BUNDLE_LOADER": "$(TEST_HOST)",
        ],
        defaultSettings: .essential
      )
    ),
  ],
  additionalFiles: [
    "Configurations/**",
  ],
  resourceSynthesizers: []
)
