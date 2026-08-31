import ProjectDescription

let project = Project(
  name: "SupatermIOS",
  settings: .settings(
    base: [
      "CLANG_ENABLE_MODULES": "YES",
      "CODE_SIGN_STYLE": "Automatic",
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
      name: "SupatermIOS",
      destinations: .iOS,
      product: .app,
      productName: "Supaterm",
      bundleId: "app.supabit.supaterm",
      deploymentTargets: .iOS("26.0"),
      infoPlist: .extendingDefault(with: [
        "CFBundleDisplayName": "Supaterm",
        "CFBundleShortVersionString": "$(MARKETING_VERSION)",
        "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
        "ITSAppUsesNonExemptEncryption": false,
        "UILaunchScreen": [:],
      ]),
      resources: [
        "Resources/Assets.xcassets",
        "../shared/Resources/supaterm.icon",
      ],
      buildableFolders: [
        "Sources"
      ],
      dependencies: [
        .project(target: "SupaTheme", path: "../shared"),
        .external(name: "ComposableArchitecture"),
      ],
      settings: .settings(
        base: [
          "ASSETCATALOG_COMPILER_APPICON_NAME": "supaterm",
          "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
        ],
        defaultSettings: .essential
      )
    )
  ],
  schemes: [
    .scheme(
      name: "Supaterm iOS",
      buildAction: .buildAction(
        targets: [
          .target("SupatermIOS")
        ]
      ),
      runAction: .runAction(
        configuration: .debug,
        executable: .executable(.target("SupatermIOS")),
        expandVariableFromTarget: .target("SupatermIOS")
      ),
      archiveAction: .archiveAction(configuration: .release),
      profileAction: .profileAction(
        configuration: .release,
        executable: .target("SupatermIOS")
      ),
      analyzeAction: .analyzeAction(configuration: .debug)
    )
  ],
  additionalFiles: [
    "Configurations/**"
  ],
  resourceSynthesizers: []
)
