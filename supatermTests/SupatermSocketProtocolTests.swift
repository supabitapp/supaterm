import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSocketProtocolTests {
  @Test
  func defaultSocketURLUsesApplicationSupportDirectory() {
    let appSupportDirectory = URL(fileURLWithPath: "/tmp/SupatermTests/Application Support", isDirectory: true)

    #expect(
      SupatermSocketPath.defaultURL(appSupportDirectory: appSupportDirectory)
        == appSupportDirectory
        .appendingPathComponent("Supaterm", isDirectory: true)
        .appendingPathComponent("supaterm.sock", isDirectory: false)
    )
  }

  @Test
  func socketPathResolutionPrefersExplicitPathThenEnvironmentThenDefault() {
    let appSupportDirectory = URL(fileURLWithPath: "/tmp/SupatermTests/Application Support", isDirectory: true)
    let environmentPath = "/tmp/supaterm.environment.sock"
    let explicitPath = "/tmp/supaterm.explicit.sock"

    #expect(
      SupatermSocketPath.resolve(
        explicitPath: explicitPath,
        environment: [SupatermCLIEnvironment.socketPathKey: environmentPath],
        appSupportDirectory: appSupportDirectory
      ) == explicitPath
    )
    #expect(
      SupatermSocketPath.resolve(
        environment: [SupatermCLIEnvironment.socketPathKey: environmentPath],
        appSupportDirectory: appSupportDirectory
      ) == environmentPath
    )
    #expect(
      SupatermSocketPath.resolve(appSupportDirectory: appSupportDirectory)
        == appSupportDirectory
        .appendingPathComponent("Supaterm", isDirectory: true)
        .appendingPathComponent("supaterm.sock", isDirectory: false)
        .path
    )
  }

  @Test
  func requestAndResponseRoundTripAsJSON() throws {
    let encoder = JSONEncoder()
    let decoder = JSONDecoder()
    let request = SupatermSocketRequest(
      id: "request-1",
      method: SupatermSocketMethod.systemPing,
      params: [
        "nested": ["pong": true],
        "null": nil,
      ]
    )
    let response = SupatermSocketResponse.ok(
      id: "request-1",
      result: ["pong": true]
    )

    #expect(
      try decoder.decode(
        SupatermSocketRequest.self,
        from: encoder.encode(request)
      ) == request
    )
    #expect(
      try decoder.decode(
        SupatermSocketResponse.self,
        from: encoder.encode(response)
      ) == response
    )
  }

  @Test
  func treeRequestAndSnapshotRoundTripThroughTypedHelpers() throws {
    let tab = SupatermTreeSnapshot.Tab(
      index: 1,
      title: "zsh",
      isSelected: true,
      panes: [
        .init(index: 1, isFocused: true),
        .init(index: 2, isFocused: false),
      ]
    )
    let workspace = SupatermTreeSnapshot.Workspace(
      index: 1,
      name: "A",
      isSelected: true,
      tabs: [tab]
    )
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: true,
      workspaces: [workspace]
    )
    let snapshot = SupatermTreeSnapshot(
      windows: [window]
    )

    let request = SupatermSocketRequest.tree(id: "tree-1")
    let response = try SupatermSocketResponse.ok(id: "tree-1", encodableResult: snapshot)

    #expect(request.method == SupatermSocketMethod.appTree)
    #expect(try response.decodeResult(SupatermTreeSnapshot.self) == snapshot)
  }

  @Test
  func onboardingRequestAndSnapshotRoundTripThroughTypedHelpers() throws {
    let snapshot = SupatermOnboardingSnapshot(
      items: [
        .init(shortcut: "⌘S", title: "Toggle sidebar"),
        .init(shortcut: "⌘T", title: "New tab"),
      ]
    )

    let request = SupatermSocketRequest.onboarding(id: "onboarding-1")
    let response = try SupatermSocketResponse.ok(id: "onboarding-1", encodableResult: snapshot)

    #expect(request.method == SupatermSocketMethod.appOnboarding)
    #expect(try response.decodeResult(SupatermOnboardingSnapshot.self) == snapshot)
  }

  @Test
  func newPaneRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let requestPayload = SupatermNewPaneRequest(
      command: "pwd",
      direction: .down,
      focus: false,
      targetPaneIndex: 2,
      targetTabIndex: 1,
      targetWindowIndex: 1
    )
    let result = SupatermNewPaneResult(
      direction: .down,
      isFocused: false,
      isSelectedTab: true,
      paneIndex: 3,
      tabIndex: 1,
      windowIndex: 1
    )

    let request = try SupatermSocketRequest.newPane(requestPayload, id: "new-pane-1")
    let response = try SupatermSocketResponse.ok(id: "new-pane-1", encodableResult: result)

    #expect(request.method == SupatermSocketMethod.terminalNewPane)
    #expect(try request.decodeParams(SupatermNewPaneRequest.self) == requestPayload)
    #expect(try response.decodeResult(SupatermNewPaneResult.self) == result)
  }
}
