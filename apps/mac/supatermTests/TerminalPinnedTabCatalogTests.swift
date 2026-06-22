import Foundation
import SupatermCLIShared
import Testing

@testable import SupatermTerminalFeature
@testable import supaterm

struct TerminalPinnedTabCatalogTests {
  @Test
  func defaultURLUsesStateHomeWhenPresent() {
    #expect(
      TerminalPinnedTabCatalog.defaultURL(
        homeDirectoryPath: "/tmp/ignored",
        environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
      ).path == "/tmp/supaterm-dev/pinned-tabs.json"
    )
  }

  @Test
  func catalogDecodesLegacyLeafSessions() throws {
    let data = Data(
      #"""
      {
        "spaces": [
          {
            "id": {"rawValue": "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"},
            "tabs": [
              {
                "id": {"rawValue": "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"},
                "session": {
                  "isPinned": true,
                  "lockedTitle": "Pinned",
                  "focusedPaneIndex": 0,
                  "root": {
                    "kind": "leaf",
                    "leaf": {
                      "workingDirectoryPath": "/tmp",
                      "titleOverride": "Pane"
                    }
                  }
                }
              }
            ]
          }
        ]
      }
      """#.utf8
    )

    let catalog = try JSONDecoder().decode(TerminalPinnedTabCatalog.self, from: data)
    let decodedAgain = try JSONDecoder().decode(TerminalPinnedTabCatalog.self, from: data)
    let sanitized = TerminalPinnedTabCatalog.sanitized(
      catalog,
      validSpaceIDs: [TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)]
    )
    let sanitizedAgain = TerminalPinnedTabCatalog.sanitized(
      decodedAgain,
      validSpaceIDs: [TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)]
    )
    let root = try #require(sanitized.spaces.first?.tabs.first?.session.root)
    let rootAgain = try #require(sanitizedAgain.spaces.first?.tabs.first?.session.root)
    guard case .leaf(let leaf) = root else {
      Issue.record("Expected leaf root")
      return
    }
    guard case .leaf(let leafAgain) = rootAgain else {
      Issue.record("Expected leaf root")
      return
    }

    #expect(sanitized.spaces.first?.tabs.first?.session.lockedTitle == "Pinned")
    #expect(leaf.workingDirectoryPath == "/tmp")
    #expect(leaf.titleOverride == "Pane")
    #expect(leaf.agents.isEmpty)
    #expect(leaf.id == leafAgain.id)
    #expect(sanitized.surfaceIDs == [leaf.id])
  }

  @Test
  func sanitizedPrunesInvalidSpacesDuplicateTabsAndEmptyEntries() throws {
    let validSpaceID = TerminalSpaceID()
    let invalidSpaceID = TerminalSpaceID()
    let duplicateTabID = TerminalTabID()
    let validSession = TerminalTabSession(
      isPinned: false,
      lockedTitle: "Pinned",
      focusedPaneIndex: 0,
      root: TerminalPaneNodeSession.leaf(TerminalPaneLeafSession(workingDirectoryPath: "/tmp"))
    )
    let catalog = TerminalPinnedTabCatalog(
      spaces: [
        PersistedPinnedTerminalTabsForSpace(
          id: validSpaceID,
          tabs: [
            PersistedPinnedTerminalTab(id: duplicateTabID, session: validSession),
            PersistedPinnedTerminalTab(id: duplicateTabID, session: validSession),
          ]
        ),
        PersistedPinnedTerminalTabsForSpace(
          id: invalidSpaceID,
          tabs: [
            PersistedPinnedTerminalTab(id: TerminalTabID(), session: validSession)
          ]
        ),
        PersistedPinnedTerminalTabsForSpace(
          id: validSpaceID,
          tabs: [
            PersistedPinnedTerminalTab(id: TerminalTabID(), session: validSession)
          ]
        ),
      ]
    )

    let sanitized = TerminalPinnedTabCatalog.sanitized(
      catalog,
      validSpaceIDs: [validSpaceID]
    )

    #expect(sanitized.spaces.map(\.id) == [validSpaceID])
    #expect(sanitized.spaces[0].tabs.map(\.id) == [duplicateTabID])
    #expect(sanitized.spaces[0].tabs[0].session.isPinned)
  }
}
