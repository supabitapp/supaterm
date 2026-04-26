import ProjectDescription

let ghosttyXCFrameworkPath: Path = ".build/ghostty/GhosttyKit.xcframework"
let ghosttyFingerprintPath: Path = ".build/ghostty/fingerprint"
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
      dependencies: [
        .external(name: "TOML"),
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
      name: "SPCLI",
      destinations: .macOS,
      product: .staticFramework,
      bundleId: "app.supabit.sp-cli",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "SPCLI",
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
      )
    ),
    .target(
      name: "sp",
      destinations: .macOS,
      product: .commandLineTool,
      bundleId: "app.supabit.sp",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "sp",
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
        release: [
          "ARCHS": "arm64",
          "DEAD_CODE_STRIPPING": "YES",
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
      )
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
      )
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
      )
    ),
    .target(
      name: "SupatermComputerUseFeature",
      destinations: .macOS,
      product: .staticFramework,
      bundleId: "app.supabit.supaterm.computer-use-feature",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "supaterm/Features/ComputerUse",
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .target(name: "SupatermSupport"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
      ],
      settings: .settings(
        defaultSettings: .essential
      )
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
        .target(name: "SupatermComputerUseFeature"),
        .target(name: "SupatermSupport"),
        .target(name: "SupatermTerminalCore"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
      ],
      settings: .settings(
        defaultSettings: .essential
      )
    ),
    .target(
      name: "SupatermSettingsFeature",
      destinations: .macOS,
      product: .staticFramework,
      bundleId: "app.supabit.supaterm.settings-feature",
      deploymentTargets: .macOS("26.0"),
      infoPlist: .default,
      buildableFolders: [
        "supaterm/Features/Settings",
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .target(name: "SupatermSupport"),
        .target(name: "SupatermUpdateFeature"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
      ],
      settings: .settings(
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
            fingerprint_path="${SRCROOT}/\(ghosttyFingerprintPath.pathString)"
            stamp_path="${destination_root}/ghostty-resources.fingerprint"

            mkdir -p "${ghostty_destination}" "${terminfo_destination}"
            rsync -a --delete "${ghostty_source}/" "${ghostty_destination}/"
            rsync -a --delete "${terminfo_source}/" "${terminfo_destination}/"
            /bin/cp -f "${fingerprint_path}" "${stamp_path}"
            """,
          name: "Embed Ghostty Resources",
          inputPaths: [
            "$(SRCROOT)/\(ghosttyFingerprintPath.pathString)",
          ],
          outputPaths: [
            "$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/ghostty",
            "$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/terminfo",
            "$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/ghostty-resources.fingerprint",
          ],
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
        .target(name: "sp"),
        .target(name: "SupatermCLIShared"),
        .target(name: "SupatermSupport"),
        .target(name: "SupatermTerminalCore"),
        .target(name: "SupatermSocketFeature"),
        .target(name: "SupatermSettingsFeature"),
        .target(name: "SupatermUpdateFeature"),
        .target(name: "GhosttyKit"),
        .external(name: "ComposableArchitecture"),
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
        ],
        debug: [
          "CODE_SIGN_ENTITLEMENTS": "supatermDebug.entitlements",
        ],
        release: [
          "ARCHS": "arm64",
          "CODE_SIGN_ENTITLEMENTS": "supaterm.entitlements",
          "DEAD_CODE_STRIPPING": "YES",
        ],
        defaultSettings: .essential
      ),
      metadata: .metadata(tags: [
        "tag:build-artifact:sp",
      ])
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
        .target(name: "SPCLI"),
        .target(name: "supaterm"),
        .target(name: "SupatermCLIShared"),
        .target(name: "SupatermComputerUseFeature"),
        .target(name: "SupatermSupport"),
        .target(name: "SupatermTerminalCore"),
        .target(name: "SupatermSocketFeature"),
        .target(name: "SupatermSettingsFeature"),
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
  schemes: [
    .scheme(
      name: "supaterm",
      buildAction: .buildAction(
        targets: [
          .target("supaterm"),
        ],
        runPostActionsOnFailure: true
      ),
      testAction: .targets(
        [
          .testableTarget(target: .target("supatermTests")),
        ],
        configuration: .debug,
        expandVariableFromTarget: .target("supaterm")
      ),
      runAction: .runAction(
        configuration: .debug,
        executable: .executable(.target("supaterm")),
        expandVariableFromTarget: .target("supaterm")
      ),
      archiveAction: .archiveAction(configuration: .release),
      profileAction: .profileAction(
        configuration: .release,
        executable: .target("supaterm")
      ),
      analyzeAction: .analyzeAction(configuration: .debug)
    ),
  ],
  additionalFiles: [
    "Configurations/**",
  ],
  resourceSynthesizers: []
)
