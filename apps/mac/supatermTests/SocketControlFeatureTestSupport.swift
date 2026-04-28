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
  updateDependencies: (inout DependencyValues) -> Void = { _ in }
) -> TestStoreOf<SocketControlFeature> {
  TestStore(initialState: SocketControlFeature.State()) {
    SocketControlFeature()
  } withDependencies: {
    updateDependencies(&$0)
    $0.socketRequestExecutor = .testing(terminalWindowsClient: $0.terminalWindowsClient)
  }
}

extension SocketRequestExecutor {
  static func testing(terminalWindowsClient: TerminalWindowsClient) -> Self {
    Self(
      executeApp: { try await testingApp($0, terminalWindowsClient: terminalWindowsClient) },
      executeTerminalCreation: {
        try await testingCreation($0, terminalWindowsClient: terminalWindowsClient)
      },
      executeTerminalPane: { try await testingPane($0, terminalWindowsClient: terminalWindowsClient) },
      executeTerminalTab: { try await testingTab($0, terminalWindowsClient: terminalWindowsClient) },
      executeTerminalSpace: {
        try await testingSpace($0, terminalWindowsClient: terminalWindowsClient)
      }
    )
  }

  static func testingApp(
    _ request: AppRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> AppResult {
    switch request {
    case .onboardingSnapshot:
      return .onboardingSnapshot(await terminalWindowsClient.onboardingSnapshot())
    case .debugSnapshot(let debugRequest):
      return .debugSnapshot(await terminalWindowsClient.debugSnapshot(debugRequest))
    case .treeSnapshot:
      return .treeSnapshot(await terminalWindowsClient.treeSnapshot())
    case .notify(let notifyRequest):
      return .notify(try await terminalWindowsClient.notify(notifyRequest))
    case .agentHook(let hookRequest):
      return .agentHook(try await terminalWindowsClient.agentHook(hookRequest))
    }
  }

  static func testingCreation(
    _ request: TerminalCreationRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> TerminalCreationResult {
    switch request {
    case .createTab(let createTabRequest):
      return .createTab(try await terminalWindowsClient.createTab(createTabRequest))
    case .createPane(let createPaneRequest):
      return .createPane(try await terminalWindowsClient.createPane(createPaneRequest))
    }
  }

  static func testingPane(
    _ request: TerminalPaneRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> TerminalPaneResult {
    switch request {
    case .focusPane(let target):
      return .focusPane(try await terminalWindowsClient.focusPane(target))
    case .lastPane(let target):
      return .lastPane(try await terminalWindowsClient.lastPane(target))
    case .closePane(let target):
      return .closePane(try await terminalWindowsClient.closePane(target))
    case .sendText(let sendTextRequest):
      return .sendText(try await terminalWindowsClient.sendText(sendTextRequest))
    case .sendKey(let sendKeyRequest):
      return .sendKey(try await terminalWindowsClient.sendKey(sendKeyRequest))
    case .capturePane(let capturePaneRequest):
      return .capturePane(try await terminalWindowsClient.capturePane(capturePaneRequest))
    case .resizePane(let resizePaneRequest):
      return .resizePane(try await terminalWindowsClient.resizePane(resizePaneRequest))
    case .setPaneSize(let setPaneSizeRequest):
      return .setPaneSize(try await terminalWindowsClient.setPaneSize(setPaneSizeRequest))
    }
  }

  static func testingTab(
    _ request: TerminalTabRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> TerminalTabResult {
    switch request {
    case .tilePanes(let tilePanesRequest):
      return .tilePanes(try await terminalWindowsClient.tilePanes(tilePanesRequest))
    case .equalizePanes(let equalizePanesRequest):
      return .equalizePanes(try await terminalWindowsClient.equalizePanes(equalizePanesRequest))
    case .mainVerticalPanes(let mainVerticalPanesRequest):
      return .mainVerticalPanes(try await terminalWindowsClient.mainVerticalPanes(mainVerticalPanesRequest))
    case .selectTab(let target):
      return .selectTab(try await terminalWindowsClient.selectTab(target))
    case .pinTab(let target):
      return .pinTab(try await terminalWindowsClient.pinTab(target))
    case .unpinTab(let target):
      return .unpinTab(try await terminalWindowsClient.unpinTab(target))
    case .closeTab(let target):
      return .closeTab(try await terminalWindowsClient.closeTab(target))
    case .renameTab(let renameTabRequest):
      return .renameTab(try await terminalWindowsClient.renameTab(renameTabRequest))
    case .nextTab(let navigationRequest):
      return .nextTab(try await terminalWindowsClient.nextTab(navigationRequest))
    case .previousTab(let navigationRequest):
      return .previousTab(try await terminalWindowsClient.previousTab(navigationRequest))
    case .lastTab(let navigationRequest):
      return .lastTab(try await terminalWindowsClient.lastTab(navigationRequest))
    }
  }

  static func testingSpace(
    _ request: TerminalSpaceRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> TerminalSpaceResult {
    switch request {
    case .createSpace(let createSpaceRequest):
      return .createSpace(try await terminalWindowsClient.createSpace(createSpaceRequest))
    case .selectSpace(let target):
      return .selectSpace(try await terminalWindowsClient.selectSpace(target))
    case .closeSpace(let target):
      return .closeSpace(try await terminalWindowsClient.closeSpace(target))
    case .renameSpace(let renameSpaceRequest):
      return .renameSpace(try await terminalWindowsClient.renameSpace(renameSpaceRequest))
    case .nextSpace(let navigationRequest):
      return .nextSpace(try await terminalWindowsClient.nextSpace(navigationRequest))
    case .previousSpace(let navigationRequest):
      return .previousSpace(try await terminalWindowsClient.previousSpace(navigationRequest))
    case .lastSpace(let navigationRequest):
      return .lastSpace(try await terminalWindowsClient.lastSpace(navigationRequest))
    }
  }
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
