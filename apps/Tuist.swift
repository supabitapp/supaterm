import ProjectDescription

let tuist = Tuist(
  fullHandle: "supabitapp/supaterm",
  inspectOptions: .options(
    redundantDependencies: .redundantDependencies(
      ignoreTagsMatching: [
        "tag:build-artifact:sp"
      ]
    )
  ),
  xcodeCache: .xcodeCache(
    upload: false
  ),
  project: .tuist(
    compatibleXcodeVersions: .upToNextMajor("26.0"),
    swiftVersion: "6.2",
    generationOptions: .options(
      optionalAuthentication: true,
      enableCaching: Environment.xcodeCache.getBoolean(default: false)
    ),
    cacheOptions: .options(
      keepSourceTargets: false,
      profiles: .profiles(
        default: Environment.isCI ? .allPossible : .onlyExternal
      )
    )
  )
)
