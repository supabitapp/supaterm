// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "HoloKit",
  platforms: [
    .macOS(.v15),
  ],
  products: [
    .library(
      name: "HoloKit",
      targets: ["HoloKit"]
    ),
  ],
  targets: [
    .target(
      name: "HoloKit"
    ),
    .testTarget(
      name: "HoloKitTests",
      dependencies: ["HoloKit"]
    ),
  ]
)
