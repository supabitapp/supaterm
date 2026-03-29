import ComposableArchitecture
import Foundation
import Sharing
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateZMXTests {
  @Test
  func paneSessionNameUsesTabAndPaneIdentity() {
    let tabID = TerminalTabID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)
    let paneID = UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!

    let sessionName = TerminalHostState.paneSessionName(tabID: tabID, paneID: paneID)

    #expect(
      sessionName
        == "sp.aaaaaaaaaaaa.bbbbbbbbbbbb"
    )
  }

  @Test
  func bootstrapCommandRunsInternalAttachWhenNoCommandIsRequested() {
    let command = TerminalHostState.zmxBootstrapCommand(sessionName: "supaterm.session")

    #expect(command.hasPrefix("exec '"))
    #expect(command.contains("/Contents/MacOS/zmx' attach 'supaterm.session'"))
    #expect(!command.contains("||"))
    #expect(!command.contains("__attach-session"))
  }

  @Test
  func zmxEnvironmentVariablesIncludePaneSession() {
    let variables = TerminalHostState.zmxEnvironmentVariables(sessionName: "supaterm.session")

    let keyValuePairs = variables.compactMap { variable -> (String, String)? in
      let children = Mirror(reflecting: variable).children
      var key: String?
      var value: String?
      for child in children {
        switch child.label {
        case "key":
          key = child.value as? String
        case "value":
          value = child.value as? String
        default:
          continue
        }
      }
      guard let key, let value else { return nil }
      return (key, value)
    }

    #expect(keyValuePairs.contains(where: { $0 == ("SUPATERM_PANE_SESSION", "supaterm.session") }))
    #expect(variables.count == 1)
  }

  @Test
  func prepareForTerminationClearsRestorableSessionCatalog() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let workspaceID = TerminalWorkspaceID(
        rawValue: UUID(uuidString: "10101010-1010-1010-1010-101010101010")!
      )
      let tabID = TerminalTabID(
        rawValue: UUID(uuidString: "20202020-2020-2020-2020-202020202020")!
      )
      let paneID = UUID(uuidString: "30303030-3030-3030-3030-303030303030")!

      @Shared(.terminalSessionCatalog) var sharedSessionCatalog = .default
      $sharedSessionCatalog.withLock {
        $0 = PersistedTerminalSessionCatalog(
          defaultSelectedWorkspaceID: workspaceID,
          selectionUpdatedAt: 1,
          workspaces: [
            PersistedTerminalWorkspaceState(
              id: workspaceID,
              name: "A",
              tabs: [
                PersistedTerminalTab(
                  id: tabID,
                  title: "Build",
                  selectedPaneID: paneID,
                  panes: [
                    PersistedTerminalPane(
                      id: paneID,
                      sessionName: "supaterm.session.cleanup"
                    )
                  ],
                  splitTree: PersistedTerminalSplitTree(root: .leaf(paneID))
                )
              ],
              selectedTabID: tabID
            )
          ]
        )
      }

      let host = TerminalHostState(
        managesTerminalSurfaces: false,
        zmxClient: .noop
      )

      host.prepareForTermination(killSessions: true)

      #expect(sharedSessionCatalog.workspaces.allSatisfy { $0.tabs.isEmpty })
    }
  }
}
