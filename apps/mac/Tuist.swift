import Foundation
import ProjectDescription

let cacheableTargetsURL = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()
  .appendingPathComponent("Tuist", isDirectory: true)
  .appendingPathComponent("cacheable-targets.txt", isDirectory: false)
let cacheableTargets = try! String(contentsOf: cacheableTargetsURL, encoding: .utf8)
  .split(whereSeparator: \.isNewline)
  .map(String.init)

let tuist = Tuist(
  fullHandle: "supabitapp/supaterm",
  project: .tuist(
    compatibleXcodeVersions: .upToNextMajor("26.0"),
    swiftVersion: "6.2",
    generationOptions: .options(
      optionalAuthentication: true
    ),
    cacheOptions: .options(
      profiles: .profiles(
        [
          "cacheable-targets": .profile(
            .onlyExternal,
            and: cacheableTargets.map(TargetQuery.named)
          ),
        ],
        default: .custom("cacheable-targets")
      )
    )
  )
)
