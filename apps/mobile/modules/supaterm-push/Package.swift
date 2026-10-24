// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "SupatermPush",
  platforms: [.macOS(.v14), .iOS(.v17)],
  products: [.library(name: "SupatermPushCore", targets: ["SupatermPushCore"])],
  targets: [
    .target(name: "SupatermPushCore"),
    .testTarget(name: "SupatermPushCoreTests", dependencies: ["SupatermPushCore"])
  ]
)
