import ComposableArchitecture
import SupatermCLIShared

struct TerminalWindowsClient: Sendable {
  var createPane: @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  var onboardingSnapshot: @MainActor @Sendable () async -> SupatermOnboardingSnapshot?
  var debugSnapshot: @MainActor @Sendable (SupatermDebugRequest) async -> SupatermAppDebugSnapshot
  var treeSnapshot: @MainActor @Sendable () async -> SupatermTreeSnapshot

  static func live(registry: TerminalWindowRegistry) -> Self {
    Self(
      createPane: { request in
        try registry.createPane(request)
      },
      onboardingSnapshot: {
        registry.onboardingSnapshot()
      },
      debugSnapshot: { request in
        registry.debugSnapshot(request)
      },
      treeSnapshot: {
        registry.treeSnapshot()
      }
    )
  }
}

extension TerminalWindowsClient: DependencyKey {
  static let liveValue = Self(
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    onboardingSnapshot: { nil },
    debugSnapshot: { _ in Self.emptyDebugSnapshot },
    treeSnapshot: { .init(windows: []) }
  )

  static let testValue = Self(
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    onboardingSnapshot: { nil },
    debugSnapshot: { _ in Self.emptyDebugSnapshot },
    treeSnapshot: { .init(windows: []) }
  )

  private static let emptyDebugSnapshot = SupatermAppDebugSnapshot(
    build: .init(
      version: "",
      buildNumber: "",
      isDevelopmentBuild: false,
      usesStubUpdateChecks: false
    ),
    update: .init(
      canCheckForUpdates: false,
      phase: "idle",
      detail: ""
    ),
    summary: .init(
      windowCount: 0,
      workspaceCount: 0,
      tabCount: 0,
      paneCount: 0,
      keyWindowIndex: nil
    ),
    currentTarget: nil,
    windows: [],
    problems: ["No active windows."]
  )
}

extension DependencyValues {
  var terminalWindowsClient: TerminalWindowsClient {
    get { self[TerminalWindowsClient.self] }
    set { self[TerminalWindowsClient.self] = newValue }
  }
}
