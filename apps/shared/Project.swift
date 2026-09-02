import ProjectDescription

let project = Project(
  name: "SupatermShared",
  settings: .settings(
    base: [
      "CLANG_ENABLE_MODULES": "YES",
      "SWIFT_APPROACHABLE_CONCURRENCY": "YES",
      "SWIFT_UPCOMING_FEATURE_MEMBER_IMPORT_VISIBILITY": "YES",
      "SWIFT_VERSION": "6.2",
    ],
    defaultSettings: .essential
  ),
  targets: [
    .target(
      name: "SupatermHostClient",
      destinations: [.iPhone, .iPad, .mac],
      product: .staticFramework,
      bundleId: "app.supabit.supaterm.host-client",
      deploymentTargets: .multiplatform(iOS: "26.0", macOS: "26.0"),
      infoPlist: .default,
      buildableFolders: [
        "SupatermHostClient",
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
      name: "SupatermHostClientTests",
      destinations: [.iPhone, .iPad, .mac],
      product: .unitTests,
      bundleId: "app.supabit.supaterm.host-client-tests",
      deploymentTargets: .multiplatform(iOS: "26.0", macOS: "26.0"),
      infoPlist: .default,
      buildableFolders: [
        "SupatermHostClientTests",
      ],
      dependencies: [
        .target(name: "SupatermHostClient"),
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
      name: "SupaTheme",
      destinations: [.iPhone, .iPad, .mac],
      product: .staticFramework,
      bundleId: "app.supabit.supaterm.theme",
      deploymentTargets: .multiplatform(iOS: "26.0", macOS: "26.0"),
      infoPlist: .default,
      buildableFolders: [
        "SupaTheme"
      ],
      settings: .settings(
        base: [
          "SWIFT_DEFAULT_ACTOR_ISOLATION": "nonisolated",
          "SWIFT_STRICT_CONCURRENCY": "complete",
        ],
        defaultSettings: .essential
      )
    )
  ]
)
