import ProjectDescription

let workspace = Workspace(
  name: "supaterm",
  projects: [
    ".",
  ],
  schemes: [
    .scheme(
      name: "supaterm",
      buildAction: .buildAction(
        targets: [
          .project(path: "supaterm.xcodeproj", target: "supaterm"),
        ],
        runPostActionsOnFailure: true
      ),
      testAction: .targets(
        [
          .testableTarget(
            target: .project(path: "supaterm.xcodeproj", target: "supatermTests")
          ),
        ],
        configuration: .debug,
        expandVariableFromTarget: .project(path: "supaterm.xcodeproj", target: "supaterm")
      ),
      runAction: .runAction(
        configuration: .debug,
        executable: .executable(.project(path: "supaterm.xcodeproj", target: "supaterm")),
        expandVariableFromTarget: .project(path: "supaterm.xcodeproj", target: "supaterm")
      ),
      archiveAction: .archiveAction(configuration: .release),
      profileAction: .profileAction(
        configuration: .release,
        executable: .project(path: "supaterm.xcodeproj", target: "supaterm")
      ),
      analyzeAction: .analyzeAction(configuration: .debug)
    ),
  ]
)
