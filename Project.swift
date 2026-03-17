import ProjectDescription

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
      dependencies: [
        .xcframework(path: "Frameworks/GhosttyKit.xcframework"),
        .external(name: "ComposableArchitecture"),
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
        .external(name: "ComposableArchitecture"),
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
