import ComposableArchitecture
import SupatermCLIShared

struct TerminalWindowsClient: Sendable {
  var createPane: @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  var onboardingSnapshot: @MainActor @Sendable () async -> SupatermOnboardingSnapshot?
  var treeSnapshot: @MainActor @Sendable () async -> SupatermTreeSnapshot

  static func live(registry: TerminalWindowRegistry) -> Self {
    Self(
      createPane: { request in
        try registry.createPane(request)
      },
      onboardingSnapshot: {
        registry.onboardingSnapshot()
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
    treeSnapshot: { .init(windows: []) }
  )

  static let testValue = Self(
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    onboardingSnapshot: { nil },
    treeSnapshot: { .init(windows: []) }
  )
}

extension DependencyValues {
  var terminalWindowsClient: TerminalWindowsClient {
    get { self[TerminalWindowsClient.self] }
    set { self[TerminalWindowsClient.self] = newValue }
  }
}
