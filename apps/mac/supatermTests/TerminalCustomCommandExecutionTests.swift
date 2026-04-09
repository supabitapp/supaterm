import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalCustomCommandExecutionTests {
  @Test
  func workspaceFocusExistingSelectsMatchingSpaceCaseInsensitively() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      _ = try host.createSpace(
        .init(
          name: "DEV WORKSPACE",
          target: .init(contextPaneID: nil, windowIndex: 1)
        )
      )

      let workspaceSpaceID = try #require(host.selectedSpaceID)
      _ = try host.createTab(
        .init(
          command: nil,
          cwd: nil,
          focus: false,
          target: .space(windowIndex: 1, spaceIndex: 2)
        )
      )
      let originalTabIDs = host.spaceManager.tabs(in: workspaceSpaceID).map(\.id)

      let result = try host.executeCustomCommand(
        .init(command: makeWorkspaceCommandSnapshot(restartBehavior: .focusExisting))
      )

      switch result {
      case .executed:
        break
      case .confirmationRequired:
        Issue.record("Expected executed result")
      }
      #expect(host.selectedSpaceID == workspaceSpaceID)
      #expect(host.spaceManager.tabs(in: workspaceSpaceID).map(\.id) == originalTabIDs)
    }
  }

  @Test
  func workspaceRecreateRebuildsSingleMatchingSpaceWithoutDummyReplacement() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      _ = try host.renameSpace(
        .init(
          name: "Dev Workspace",
          target: .space(windowIndex: 1, spaceIndex: 1)
        )
      )

      let result = try host.executeCustomCommand(
        .init(command: makeWorkspaceCommandSnapshot(restartBehavior: .recreate))
      )

      switch result {
      case .executed:
        break
      case .confirmationRequired:
        Issue.record("Expected executed result")
      }
      #expect(host.spaces.count == 1)
      #expect(host.selectedSpaceID == host.spaces[0].id)

      let debug = host.debugWindowSnapshot(index: 1)
      let space = try #require(debug.spaces.first)
      let tab = try #require(space.tabs.first)

      #expect(space.name == "Dev Workspace")
      #expect(debug.spaces.count == 1)
      #expect(space.tabs.count == 1)
      #expect(tab.title == "App")
      #expect(tab.panes.map(\.displayTitle) == ["Server", "Logs"])
      #expect(tab.panes.filter(\.isFocused).count == 1)
      #expect(tab.panes.first(where: \.isFocused)?.displayTitle == "Server")
    }
  }

  @Test
  func workspaceConfirmRecreateRequestsConfirmationWhenMatchingSpaceExists() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      _ = try host.renameSpace(
        .init(
          name: "Dev Workspace",
          target: .space(windowIndex: 1, spaceIndex: 1)
        )
      )

      let result = try host.executeCustomCommand(
        .init(command: makeWorkspaceCommandSnapshot(restartBehavior: .confirmRecreate))
      )

      switch result {
      case .confirmationRequired:
        break
      case .executed:
        Issue.record("Expected confirmation result")
      }
      #expect(host.spaces.count == 1)
      #expect(host.spaceManager.tabs(in: host.spaces[0].id).count == 1)
    }
  }
}

private func makeWorkspaceCommandSnapshot(
  restartBehavior: SupatermWorkspaceRestartBehavior
) -> TerminalCustomCommandSnapshot {
  .init(
    id: "dev-workspace",
    title: "Dev Workspace",
    subtitle: "Workspace",
    keywords: ["workspace"],
    kind: .workspace(
      .init(
        restartBehavior: restartBehavior,
        spaceName: "Dev Workspace",
        tabs: [
          .init(
            title: "App",
            rootPane: .split(
              .init(
                direction: .right,
                ratio: 0.5,
                first: .leaf(
                  .init(
                    title: "Server",
                    workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false),
                    command: "pwd",
                    environmentVariables: [.init(key: "APP_ENV", value: "dev")]
                  )
                ),
                second: .leaf(
                  .init(
                    title: "Logs",
                    workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false),
                    command: "pwd",
                    environmentVariables: []
                  )
                )
              )
            ),
            focusedLeafIndex: 0,
          ),
        ],
        selectedTabIndex: 0
      )
    )
  )
}
