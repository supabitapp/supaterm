import ProjectDescription

let tuist = Tuist(
  fullHandle: "supabitapp/supaterm",
  cache: .cache(
    upload: Environment.isCI
  ),
  project: .tuist(
    compatibleXcodeVersions: .upToNextMajor("26.0"),
    swiftVersion: "6.2",
    generationOptions: .options(
      optionalAuthentication: true,
      enableCaching: Environment.enableXcodeCache.getBoolean(default: true)
    ),
    cacheOptions: .options(
      profiles: .profiles(
        [
          "development": .profile(.onlyExternal),
        ],
        default: .custom("development")
      )
    )
  )
)
