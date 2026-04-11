import ProjectDescription

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
          "cacheable-targets": .profile(.onlyExternal, and: ["tag:cacheable"]),
        ],
        default: .custom("cacheable-targets")
      )
    )
  )
)
