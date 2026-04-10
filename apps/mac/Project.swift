import ProjectDescription

let ghosttyBuildRootPath: Path = ".build/ghostty"
let ghosttyXCFrameworkPath: Path = ".build/ghostty/GhosttyKit.xcframework"
let ghosttyResourcesPath: Path = ".build/ghostty/share/ghostty"
let ghosttyTerminfoPath: Path = ".build/ghostty/share/terminfo"
let ghosttyBuildScriptPath: Path = "scripts/build-ghostty.sh"
let ghosttyFingerprintInputScript = """
"${SRCROOT}/\(ghosttyBuildScriptPath.pathString)" --print-fingerprint
"""

let project = Project(
  name: "supaterm",
  settings: .settings(
    base: [
      "CLANG_ENABLE_MODULES": "YES",
      "CODE_SIGN_STYLE": "Automatic",
      "ENABLE_USER_SCRIPT_SANDBOXING": "NO",
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
      product: .staticFramework,
      bundleId: "app.supabit.supaterm.cli-shared",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "SupatermCLIShared",
      ],
      settings: .settings(
        base: [
          "SWIFT_DEFAULT_ACTOR_ISOLATION": "nonisolated",
          "SWIFT_STRICT_CONCURRENCY": "complete",
        ],
        defaultSettings: .essential
      ),
      metadata: .metadata(tags: ["cacheable"])
    ),
    .target(
      name: "SPCLI",
      destinations: .macOS,
      product: .staticFramework,
      bundleId: "app.supabit.sp-cli",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      sources: [
        "sp/SPAgentCommands.swift",
        "sp/SPCommand.swift",
        "sp/SPCommandRuntime.swift",
        "sp/SPDiagnosticCommands.swift",
        "sp/SPEntrypoint.swift",
        "sp/SPHelp.swift",
        "sp/SPInternalCommands.swift",
        "sp/SPSocketClient.swift",
        "sp/SPTerminalCreateCommands.swift",
        "sp/SPTerminalControlCommands.swift",
        "sp/SPTargetResolver.swift",
        "sp/SPTmuxCompat.swift",
        "sp/SPTreeRenderer.swift",
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .external(name: "ArgumentParser"),
      ],
      settings: .settings(
        base: [
          "SWIFT_DEFAULT_ACTOR_ISOLATION": "nonisolated",
          "SWIFT_STRICT_CONCURRENCY": "complete",
        ],
        defaultSettings: .essential
      ),
      metadata: .metadata(tags: ["cacheable"])
    ),
    .target(
      name: "sp",
      destinations: .macOS,
      product: .commandLineTool,
      bundleId: "app.supabit.sp",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      sources: [
        "sp/main.swift",
      ],
      dependencies: [
        .external(name: "ArgumentParser"),
        .target(name: "SPCLI"),
      ],
      settings: .settings(
        base: [
          "ENABLE_HARDENED_RUNTIME": "YES",
          "SKIP_INSTALL": "YES",
          "SWIFT_DEFAULT_ACTOR_ISOLATION": "nonisolated",
          "SWIFT_STRICT_CONCURRENCY": "complete",
        ],
        defaultSettings: .essential
      )
    ),
    .foreignBuild(
      name: "GhosttyKit",
      destinations: .macOS,
      script: """
        "${SRCROOT}/\(ghosttyBuildScriptPath.pathString)"
        """,
      inputs: [
        .file("../../mise.toml"),
        .file(ghosttyBuildScriptPath),
        .script(ghosttyFingerprintInputScript),
      ],
      output: .xcframework(path: ghosttyXCFrameworkPath, linking: .static)
    ),
    .target(
      name: "SupatermSupport",
      destinations: .macOS,
      product: .staticFramework,
      bundleId: "app.supabit.supaterm.support",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "supaterm/Support",
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
      ],
      settings: .settings(
        defaultSettings: .essential
      ),
      metadata: .metadata(tags: ["cacheable"])
    ),
    .target(
      name: "SupatermUpdateFeature",
      destinations: .macOS,
      product: .staticFramework,
      bundleId: "app.supabit.supaterm.update-feature",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "supaterm/Features/Update",
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .target(name: "SupatermSupport"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
        .external(name: "Sparkle"),
      ],
      settings: .settings(
        defaultSettings: .essential
      ),
      metadata: .metadata(tags: ["cacheable"])
    ),
    .target(
      name: "SupatermTerminalCore",
      destinations: .macOS,
      product: .staticFramework,
      bundleId: "app.supabit.supaterm.terminal-core",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "supaterm/TerminalCore",
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .target(name: "SupatermSupport"),
        .external(name: "ComposableArchitecture"),
      ],
      settings: .settings(
        defaultSettings: .essential
      ),
      metadata: .metadata(tags: ["cacheable"])
    ),
    .target(
      name: "SupatermSocketFeature",
      destinations: .macOS,
      product: .staticFramework,
      bundleId: "app.supabit.supaterm.socket-feature",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "supaterm/SocketFeature",
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .target(name: "SupatermSupport"),
        .target(name: "SupatermTerminalCore"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
      ],
      settings: .settings(
        defaultSettings: .essential
      ),
      metadata: .metadata(tags: ["cacheable"])
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
        "NSAudioCaptureUsageDescription": "A program running within Supaterm would like to access your system's audio.",
        "NSBluetoothAlwaysUsageDescription": "A program running within Supaterm would like to use Bluetooth.",
        "NSCalendarsUsageDescription": "A program running within Supaterm would like to access your Calendar.",
        "NSCameraUsageDescription": "A program running within Supaterm would like to use the camera.",
        "NSContactsUsageDescription": "A program running within Supaterm would like to access your Contacts.",
        "NSLocalNetworkUsageDescription": "A program running within Supaterm would like to access the local network.",
        "NSLocationUsageDescription": "A program running within Supaterm would like to access your location information.",
        "NSLocationTemporaryUsageDescriptionDictionary": [
          "TemporaryLocationAccess": "A program running within Supaterm would like to use your location temporarily."
        ],
        "NSMicrophoneUsageDescription": "A program running within Supaterm would like to use your microphone.",
        "NSMotionUsageDescription": "A program running within Supaterm would like to access motion data.",
        "NSPhotoLibraryUsageDescription": "A program running within Supaterm would like to access your Photo Library.",
        "NSRemindersUsageDescription": "A program running within Supaterm would like to access your reminders.",
        "NSSpeechRecognitionUsageDescription": "A program running within Supaterm would like to use speech recognition.",
        "NSSystemAdministrationUsageDescription": "A program running within Supaterm requires elevated privileges.",
        "PostHogAPIKey": "$(POSTHOG_API_KEY)",
        "PostHogHost": "$(POSTHOG_HOST)",
        "PostHogPersonProfiles": "$(POSTHOG_PERSON_PROFILES)",
        "SentryDSN": "$(SENTRY_DSN)",
        "SupatermDevelopmentBuild": "$(SUPATERM_DEVELOPMENT_BUILD)",
        "SUFeedURL": "https://supaterm.com/download/latest/appcast.xml",
        "SUPublicEDKey": "$(SPARKLE_PUBLIC_ED_KEY)",
        "SUEnableAutomaticChecks": true,
        "SUAutomaticallyUpdate": true,
      ]),
      resources: [
        "supaterm/Assets.xcassets",
      ],
      buildableFolders: [
        "supaterm/App",
        "supaterm/Features/Chrome",
        "supaterm/Features/Settings",
        "supaterm/Features/Terminal",
      ],
      scripts: [
        .post(
          script: """
            set -euo pipefail

            destination_root="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"
            ghostty_source="${SRCROOT}/\(ghosttyResourcesPath.pathString)"
            terminfo_source="${SRCROOT}/\(ghosttyTerminfoPath.pathString)"
            ghostty_destination="${destination_root}/ghostty"
            terminfo_destination="${destination_root}/terminfo"

            rm -rf "${ghostty_destination}" "${terminfo_destination}"
            mkdir -p "${ghostty_destination}" "${terminfo_destination}"
            rsync -a --delete "${ghostty_source}/" "${ghostty_destination}/"
            rsync -a --delete "${terminfo_source}/" "${terminfo_destination}/"
            """,
          name: "Embed Ghostty Resources",
          inputPaths: [
            "$(SRCROOT)/\(ghosttyResourcesPath.pathString)",
            "$(SRCROOT)/\(ghosttyTerminfoPath.pathString)",
          ],
          outputPaths: [
            "$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/ghostty",
            "$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/terminfo",
          ],
          basedOnDependencyAnalysis: false
        ),
        .post(
          script: """
            set -eu

            destination_dir="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/bin"
            destination_path="${destination_dir}/sp"
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

            mkdir -p "${destination_dir}"
            /bin/cp -f "${source_path}" "${destination_path}"
            """,
          name: "Embed sp CLI",
          inputPaths: [
            "$(BUILT_PRODUCTS_DIR)/sp",
            "$(UNINSTALLED_PRODUCTS_DIR)/$(PLATFORM_NAME)/sp",
          ],
          outputPaths: [
            "$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/bin/sp",
          ]
        ),
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .target(name: "SupatermSupport"),
        .target(name: "SupatermTerminalCore"),
        .target(name: "SupatermSocketFeature"),
        .target(name: "SupatermUpdateFeature"),
        .target(name: "GhosttyKit"),
        .target(name: "sp"),
        .external(name: "ComposableArchitecture"),
        .external(name: "FuzzyMatch"),
        .external(name: "PostHog"),
        .external(name: "Sentry"),
        .external(name: "Sharing"),
        .external(name: "Textual"),
      ],
      settings: .settings(
        base: [
          "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
          "ENABLE_HARDENED_RUNTIME": "YES",
          "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/../Frameworks",
          "OTHER_LDFLAGS": "$(inherited) -lc++",
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
        .external(name: "ArgumentParser"),
        .external(name: "Clocks"),
        .external(name: "FuzzyMatch"),
        .target(name: "SPCLI"),
        .target(name: "supaterm"),
        .target(name: "SupatermCLIShared"),
        .target(name: "SupatermSupport"),
        .target(name: "SupatermTerminalCore"),
        .target(name: "SupatermSocketFeature"),
        .target(name: "SupatermUpdateFeature"),
        .target(name: "GhosttyKit"),
        .external(name: "ComposableArchitecture"),
        .external(name: "PostHog"),
        .external(name: "Sharing"),
        .external(name: "Textual"),
      ],
      settings: .settings(
        base: [
          "TEST_HOST": "",
          "BUNDLE_LOADER": "$(BUILT_PRODUCTS_DIR)/supaterm.app/Contents/MacOS/supaterm.debug.dylib",
          "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @loader_path/../Frameworks @executable_path/../Frameworks @loader_path/../../../supaterm.app/Contents/MacOS",
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
