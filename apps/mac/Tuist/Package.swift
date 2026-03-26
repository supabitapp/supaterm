// swift-tools-version: 6.0
import PackageDescription

#if TUIST
import ProjectDescription

let packageSettings = PackageSettings(
  productTypes: [
    "ComposableArchitecture": .staticFramework,
    "Sharing": .staticFramework,
    "Sparkle": .framework,
  ]
)
#endif

let package = Package(
  name: "supaterm",
  dependencies: [
    .package(url: "https://github.com/apple/swift-argument-parser", exact: "1.6.2"),
    .package(url: "https://github.com/pointfreeco/swift-composable-architecture", exact: "1.23.1"),
    .package(url: "https://github.com/pointfreeco/swift-sharing", exact: "2.7.4"),
    .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.9.0"),
  ]
)
