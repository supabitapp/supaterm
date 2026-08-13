import SupatermCLIShared

func spCommandTestDebugSnapshot() -> SupatermAppDebugSnapshot {
  SupatermAppDebugSnapshot(
    build: SupatermAppDebugSnapshot.Build(
      version: "1.0.0",
      buildNumber: "1",
      isDevelopmentBuild: true,
      usesStubUpdateChecks: false
    ),
    update: SupatermAppDebugSnapshot.Update(
      canCheckForUpdates: true,
      phase: "idle",
      detail: ""
    ),
    summary: SupatermAppDebugSnapshot.Summary(
      windowCount: 0,
      spaceCount: 0,
      tabCount: 0,
      paneCount: 0,
      keyWindowIndex: nil
    ),
    currentTarget: nil,
    windows: [],
    problems: []
  )
}
