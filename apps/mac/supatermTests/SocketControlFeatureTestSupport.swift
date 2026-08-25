import ComposableArchitecture
import Foundation
import Sharing
import SupatermSocketFeature
import SupatermSupport
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

func makeStore(
  initialState: SocketControlFeature.State = SocketControlFeature.State(),
  updateDependencies: (inout DependencyValues) -> Void = { _ in },
  executeApp: (
    @MainActor @Sendable (SocketRequestExecutor.AppRequest) async throws -> SocketRequestExecutor.AppResult
  )? = nil,
  executeAgentIntegration: (
    @MainActor @Sendable (
      SocketRequestExecutor.AgentIntegrationRequest
    ) async throws -> SocketRequestExecutor.AgentIntegrationResult
  )? = nil,
  executeLicense: (
    @MainActor @Sendable (LicenseControlRequest) async throws -> LicenseControlResult
  )? = nil,
  executeTerminalPane: (
    @MainActor @Sendable (
      SocketRequestExecutor.TerminalPaneRequest
    ) async throws -> SocketRequestExecutor.TerminalPaneResult
  )? = nil
) -> TestStoreOf<SocketControlFeature> {
  TestStore(initialState: initialState) {
    SocketControlFeature()
  } withDependencies: {
    $0.socketControlClient.isPending = { _ in true }
    $0.socketRequestExecutor = .testing(
      executeApp: executeApp,
      executeAgentIntegration: executeAgentIntegration,
      executeLicense: executeLicense,
      executeTerminalPane: executeTerminalPane
    )
    updateDependencies(&$0)
  }
}

extension SocketRequestExecutor {
  static func testing(
    executeApp: (@MainActor @Sendable (AppRequest) async throws -> AppResult)? = nil,
    executeAgentIntegration: (
      @MainActor @Sendable (AgentIntegrationRequest) async throws -> AgentIntegrationResult
    )? = nil,
    executeLicense: (
      @MainActor @Sendable (LicenseControlRequest) async throws -> LicenseControlResult
    )? = nil,
    executeTerminalCreation: (
      @MainActor @Sendable (TerminalCreationRequest) async throws -> TerminalCreationResult
    )? = nil,
    executeTerminalPane: (
      @MainActor @Sendable (TerminalPaneRequest) async throws -> TerminalPaneResult
    )? = nil,
    executeTerminalTab: (
      @MainActor @Sendable (TerminalTabRequest) async throws -> TerminalTabResult
    )? = nil,
    executeTerminalProject:
      @escaping @MainActor @Sendable (
        TerminalProjectRequest
      ) async throws -> TerminalProjectResult = { _ in
        throw TerminalControlError.contextPaneNotFound
      },
    executeTerminalSpace: (
      @MainActor @Sendable (TerminalSpaceRequest) async throws -> TerminalSpaceResult
    )? = nil
  ) -> Self {
    Self(
      executeApp: {
        if let executeApp {
          return try await executeApp($0)
        }
        return try testingApp($0)
      },
      executeLicense: {
        guard let executeLicense else {
          Issue.record("Unexpected license request: \($0)")
          throw SocketControlTestError.unexpectedRequest
        }
        return try await executeLicense($0)
      },
      executeAgentIntegration: {
        if let executeAgentIntegration {
          return try await executeAgentIntegration($0)
        }
        Issue.record("Unexpected agent integration request: \($0)")
        throw SocketControlTestError.unexpectedRequest
      },
      executeTerminalCreation: {
        guard let executeTerminalCreation else {
          Issue.record("Unexpected terminal creation request: \($0)")
          throw SocketControlTestError.unexpectedRequest
        }
        return try await executeTerminalCreation($0)
      },
      executeTerminalPane: {
        if let executeTerminalPane {
          return try await executeTerminalPane($0)
        }
        Issue.record("Unexpected terminal pane request: \($0)")
        throw SocketControlTestError.unexpectedRequest
      },
      executeTerminalTab: {
        guard let executeTerminalTab else {
          Issue.record("Unexpected terminal tab request: \($0)")
          throw SocketControlTestError.unexpectedRequest
        }
        return try await executeTerminalTab($0)
      },
      executeTerminalProject: executeTerminalProject,
      executeTerminalSpace: {
        guard let executeTerminalSpace else {
          Issue.record("Unexpected terminal space request: \($0)")
          throw SocketControlTestError.unexpectedRequest
        }
        return try await executeTerminalSpace($0)
      }
    )
  }

  static func testingApp(_ request: AppRequest) throws -> AppResult {
    switch request {
    case .settingsGet(let request):
      return .settingsGet(
        try SupatermSettingsRegistry.get(
          key: request.key,
          settings: .default,
          path: SupatermStateRoot.settingsFileURL().path
        )
      )
    case .settingsList(let request):
      return .settingsList(
        SupatermSettingsRegistry.list(
          settings: .default,
          path: SupatermStateRoot.settingsFileURL().path,
          changedOnly: request.changedOnly
        )
      )
    case .settingsReset(let request):
      return .settingsReset(
        try SupatermSettingsRegistry.reset(
          request,
          settings: .default,
          path: SupatermStateRoot.settingsFileURL().path
        ).result
      )
    case .settingsSet(let request):
      return .settingsSet(
        try SupatermSettingsRegistry.set(
          request,
          settings: .default,
          path: SupatermStateRoot.settingsFileURL().path
        ).result
      )
    case .settingsValidate:
      Issue.record("Unexpected settings validation request")
      throw SocketControlTestError.unexpectedRequest
    case .quit:
      return .quit
    case .agentHook, .debugSnapshot, .notify, .onboardingSnapshot, .treeSnapshot:
      Issue.record("Unexpected app request: \(request)")
      throw SocketControlTestError.unexpectedRequest
    }
  }
}

private enum SocketControlTestError: Error {
  case unexpectedRequest
}

actor SocketReplyRecorder {
  struct Record: Equatable {
    let handle: UUID
    let response: SupatermSocketResponse
  }

  private var records: [Record] = []

  func record(
    handle: UUID,
    response: SupatermSocketResponse
  ) {
    records.append(Record(handle: handle, response: response))
  }

  func snapshot() -> [Record] {
    records
  }
}

actor StopRecorder {
  private var count = 0

  func recordStop() {
    count += 1
  }

  func stopCount() -> Int {
    count
  }
}

actor DesktopNotificationRecorder {
  private var requests: [DesktopNotificationRequest] = []

  func record(_ request: DesktopNotificationRequest) {
    requests.append(request)
  }

  func snapshot() -> [DesktopNotificationRequest] {
    requests
  }
}
