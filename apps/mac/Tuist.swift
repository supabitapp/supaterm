import ProjectDescription

let tuist = Tuist(
  fullHandle: "supabitapp/supaterm",
  inspectOptions: .options(
    redundantDependencies: .redundantDependencies(
      ignoreTagsMatching: [
        "tag:build-artifact:sp",
      ]
    )
  ),
  project: .tuist(
    compatibleXcodeVersions: .upToNextMajor("26.0"),
    swiftVersion: "6.2",
    generationOptions: .options(
      optionalAuthentication: true
    )
  )
)
