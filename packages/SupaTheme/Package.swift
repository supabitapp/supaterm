// swift-tools-version: 6.2
import PackageDescription

let swiftSettings: [SwiftSetting] = [
  .defaultIsolation(MainActor.self),
  .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
  .enableUpcomingFeature("InferIsolatedConformances"),
  .enableUpcomingFeature("MemberImportVisibility"),
]

let package = Package(
  name: "SupaTheme",
  platforms: [.macOS("26.0")],
  products: [
    .library(name: "SupaTheme", targets: ["SupaTheme"])
  ],
  targets: [
    .target(name: "SupaTheme", swiftSettings: swiftSettings),
    .testTarget(name: "SupaThemeTests", dependencies: ["SupaTheme"], swiftSettings: swiftSettings),
  ]
)
