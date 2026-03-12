// swift-tools-version: 6.0
import PackageDescription

#if TUIST
import ProjectDescription

let packageSettings = PackageSettings(
  productTypes: [
    "ComposableArchitecture": .framework,
  ]
)
#endif

let package = Package(
  name: "supaterm",
  dependencies: [
    .package(url: "https://github.com/pointfreeco/swift-composable-architecture", exact: "1.23.1"),
  ]
)
