import ProjectDescription

let ghosttyBuildRootPath: Path = ".build/ghostty"
let ghosttyXCFrameworkPath: Path = ".build/ghostty/GhosttyKit.xcframework"
let ghosttyResourcesPath: Path = ".build/ghostty/share/ghostty"
let ghosttyTerminfoPath: Path = ".build/ghostty/share/terminfo"
let ghosttyFingerprintPath: Path = ".build/ghostty/fingerprint"
let ghosttyFingerprintScript = """
cd "${SRCROOT}/ThirdParty/ghostty"
{
  git rev-parse HEAD
  git diff --no-ext-diff --no-color HEAD -- . | shasum -a 256
  git ls-files --others --exclude-standard | LC_ALL=C sort | shasum -a 256
  shasum -a 256 "${SRCROOT}/scripts/prepare-ghostty-xcframework.sh"
  shasum -a 256 "${SRCROOT}/../../mise.toml"
} | shasum -a 256 | awk '{print $1}'
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
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .external(name: "ArgumentParser"),
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
        set -euo pipefail

        ghostty_dir="${SRCROOT}/ThirdParty/ghostty"
        ghostty_build_root="${SRCROOT}/\(ghosttyBuildRootPath.pathString)"
        ghostty_local_cache_dir="${ghostty_build_root}/.zig-cache"
        ghostty_global_cache_dir="${ghostty_build_root}/.zig-global-cache"
        ghostty_fingerprint_path="${SRCROOT}/\(ghosttyFingerprintPath.pathString)"
        xcframework_path="${SRCROOT}/\(ghosttyXCFrameworkPath.pathString)"
        ghostty_resources_path="${SRCROOT}/\(ghosttyResourcesPath.pathString)"
        ghostty_terminfo_path="${SRCROOT}/\(ghosttyTerminfoPath.pathString)"

        if [ ! -f "${ghostty_dir}/build.zig" ]; then
          echo "error: Missing ${ghostty_dir}. Run: git submodule sync --recursive && git submodule update --init --recursive" >&2
          exit 1
        fi

        fingerprint="$(
        \(ghosttyFingerprintScript)
        )"

        if [ -f "${ghostty_fingerprint_path}" ] &&
          [ -d "${xcframework_path}" ] &&
          [ -d "${ghostty_resources_path}" ] &&
          [ -d "${ghostty_terminfo_path}" ] &&
          [ "$(cat "${ghostty_fingerprint_path}")" = "${fingerprint}" ]; then
          exit 0
        fi

        mkdir -p "${ghostty_build_root}"
        cd "${ghostty_dir}"
        mise exec -- zig build -Doptimize=ReleaseFast -Demit-xcframework=true -Dsentry=false --prefix "${ghostty_build_root}" --cache-dir "${ghostty_local_cache_dir}" --global-cache-dir "${ghostty_global_cache_dir}"
        rsync -a --delete "${ghostty_dir}/macos/GhosttyKit.xcframework/" "${xcframework_path}/"
        "${SRCROOT}/scripts/prepare-ghostty-xcframework.sh" "${xcframework_path}"
        printf '%s\n' "${fingerprint}" > "${ghostty_fingerprint_path}"
        """,
      inputs: [
        .file("../../mise.toml"),
        .file("scripts/prepare-ghostty-xcframework.sh"),
        .script(ghosttyFingerprintScript),
      ],
      output: .xcframework(path: ghosttyXCFrameworkPath, linking: .static)
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
        "SUFeedURL": "https://supaterm.com/download/tip/appcast.xml",
        "SUPublicEDKey": "$(SPARKLE_PUBLIC_ED_KEY)",
        "SUEnableAutomaticChecks": true,
        "SUAutomaticallyUpdate": true,
      ]),
      resources: [
        "supaterm/Assets.xcassets",
      ],
      buildableFolders: [
        "supaterm/App",
        "supaterm/Features",
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
      ],
      dependencies: [
        .target(name: "SupatermCLIShared"),
        .target(name: "GhosttyKit"),
        .target(name: "sp"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
        .external(name: "Sparkle"),
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
        .target(name: "supaterm"),
        .target(name: "SupatermCLIShared"),
        .external(name: "ComposableArchitecture"),
        .external(name: "Sharing"),
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
