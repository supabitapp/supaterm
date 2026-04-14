// swift-tools-version: 6.0
import PackageDescription

#if TUIST
import ProjectDescription

let packageSettings = PackageSettings(
  productTypes: [
    "Sparkle": .framework,
  ]
)
#endif

let package = Package(
  name: "supaterm",
  dependencies: [
    .package(url: "https://github.com/apple/swift-argument-parser", exact: "1.6.2"),
    .package(url: "https://github.com/PostHog/posthog-ios.git", exact: "3.48.3"),
    .package(url: "https://github.com/getsentry/sentry-cocoa/", exact: "9.3.0"),
    .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    .package(url: "https://github.com/pointfreeco/swift-clocks", exact: "1.0.6"),
    .package(url: "https://github.com/pointfreeco/swift-composable-architecture", exact: "1.23.1"),
    .package(url: "https://github.com/pointfreeco/swift-sharing", exact: "2.7.4"),
    .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.9.0"),
  ]
)
