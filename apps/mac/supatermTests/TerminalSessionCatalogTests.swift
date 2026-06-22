import Foundation
import SupatermCLIShared
import Testing

@testable import SupatermTerminalFeature
@testable import supaterm

struct TerminalSessionCatalogTests {
  @Test
  func defaultURLUsesStateHomeWhenPresent() {
    #expect(
      TerminalSessionCatalog.defaultURL(
        homeDirectoryPath: "/tmp/ignored",
        environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
      ).path == "/tmp/supaterm-dev/session.json"
    )
  }

  @Test
  func catalogRejectsUnsupportedVersion() throws {
    let data = Data(
      """
      {"version":999,"windows":[]}
      """.utf8
    )

    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
    }
  }

  @Test
  func catalogDecodesVersion3LeafSessions() throws {
    let data = Data(
      #"""
      {
        "version": 3,
        "windows": [
          {
            "selectedSpaceID": {"rawValue": "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"},
            "spaces": [
              {
                "id": {"rawValue": "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"},
                "selectedTabIndex": 0,
                "tabs": [
                  {
                    "isPinned": false,
                    "lockedTitle": "Legacy",
                    "focusedPaneIndex": 0,
                    "root": {
                      "kind": "leaf",
                      "leaf": {
                        "workingDirectoryPath": "/tmp",
                        "titleOverride": "Pane"
                      }
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
      """#.utf8
    )

    let catalog = try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
    let decodedAgain = try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
    let root = try #require(catalog.windows.first?.spaces.first?.tabs.first?.root)
    let rootAgain = try #require(decodedAgain.windows.first?.spaces.first?.tabs.first?.root)
    guard case .leaf(let leaf) = root else {
      Issue.record("Expected leaf root")
      return
    }
    guard case .leaf(let leafAgain) = rootAgain else {
      Issue.record("Expected leaf root")
      return
    }

    #expect(catalog.version == TerminalSessionCatalog.currentVersion)
    #expect(leaf.workingDirectoryPath == "/tmp")
    #expect(leaf.titleOverride == "Pane")
    #expect(leaf.agents.isEmpty)
    #expect(leaf.id == leafAgain.id)
    #expect(catalog.surfaceIDs == [leaf.id])
  }

  @Test
  func windowSessionPrunesMissingSpacesAndFallsBackSelection() {
    let validSpace = TerminalSpaceID()
    let missingSpace = TerminalSpaceID()
    let session = TerminalWindowSession(
      selectedSpaceID: missingSpace,
      spaces: [
        TerminalWindowSpaceSession(
          id: missingSpace,
          selectedTabIndex: nil,
          tabs: []
        ),
        TerminalWindowSpaceSession(
          id: validSpace,
          selectedTabIndex: nil,
          tabs: []
        ),
      ]
    )

    let pruned = session.pruned(validSpaceIDs: [validSpace])

    #expect(pruned?.selectedSpaceID == validSpace)
    #expect(pruned?.spaces.map(\.id) == [validSpace])
  }

  @Test
  func tabSessionSanitizesSplitRatioAndFallsBackFocusedPaneIndex() throws {
    let session = TerminalTabSession(
      isPinned: false,
      lockedTitle: "  ",
      focusedPaneIndex: 99,
      root: .split(
        TerminalPaneSplitSession(
          direction: .horizontal,
          ratio: 0,
          left: .leaf(TerminalPaneLeafSession(workingDirectoryPath: "/tmp", titleOverride: "  ")),
          right: .leaf(TerminalPaneLeafSession(workingDirectoryPath: "/var"))
        )
      )
    )

    let pruned = try #require(session.pruned())
    guard case .split(let split) = pruned.root else {
      Issue.record("Expected split root")
      return
    }

    #expect(split.ratio == 0.5)
    #expect(pruned.lockedTitle == "  ")
    guard case .leaf(let left) = split.left else {
      Issue.record("Expected left leaf")
      return
    }
    #expect(left.titleOverride == "  ")
    #expect(pruned.focusedPaneIndex == 0)
  }

  @Test
  func spaceSessionFallsBackSelectedTabIndex() {
    let session = TerminalWindowSpaceSession(
      id: TerminalSpaceID(),
      selectedTabIndex: 42,
      tabs: [
        TerminalTabSession(
          isPinned: false,
          lockedTitle: nil,
          focusedPaneIndex: 0,
          root: .leaf(TerminalPaneLeafSession(workingDirectoryPath: nil, titleOverride: nil))
        ),
        TerminalTabSession(
          isPinned: true,
          lockedTitle: "Pinned",
          focusedPaneIndex: 0,
          root: .leaf(TerminalPaneLeafSession(workingDirectoryPath: nil, titleOverride: nil))
        ),
      ]
    )

    let pruned = session.pruned()

    #expect(pruned.tabs.count == 2)
    #expect(pruned.tabs[1].lockedTitle == "Pinned")
    #expect(pruned.selectedTabIndex == 0)
  }

  @Test
  func catalogEncodingKeepsPaneIDsAndOmitsDerivedTitles() throws {
    let spaceID = TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)
    let paneID = UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!
    let tabs: [TerminalTabSession] = [
      TerminalTabSession(
        isPinned: false,
        lockedTitle: nil,
        focusedPaneIndex: 0,
        root: .leaf(
          TerminalPaneLeafSession(
            id: paneID,
            workingDirectoryPath: "/tmp",
            titleOverride: "Pane",
            agents: [
              TerminalPaneAgentRecord(
                agent: .codex,
                sessionIDs: ["session-1"],
                processIDs: [123],
                activityPhase: .running
              )
            ]
          )
        )
      ),
      TerminalTabSession(
        isPinned: true,
        lockedTitle: "Pinned",
        focusedPaneIndex: 0,
        root: .leaf(TerminalPaneLeafSession(workingDirectoryPath: nil, titleOverride: nil))
      ),
    ]
    let space = TerminalWindowSpaceSession(
      id: spaceID,
      selectedTabIndex: 1,
      tabs: tabs
    )
    let window = TerminalWindowSession(
      selectedSpaceID: spaceID,
      spaces: [space]
    )
    let catalog = TerminalSessionCatalog(
      windows: [window]
    )

    let data = try TerminalSessionCatalog.fileStorageEncoder().encode(catalog)
    let json = try #require(String(bytes: data, encoding: .utf8))

    #expect(json.contains(#""selectedTabIndex":1"#))
    #expect(json.contains(#""id":"BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB""#))
    #expect(json.contains(#""agent":"codex""#))
    #expect(json.contains(#""activityPhase":"running""#))
    #expect(json.contains(#""lockedTitle":"Pinned""#))
    #expect(json.contains(#""titleOverride":"Pane""#))
    #expect(!json.contains(#""title":"#))
    #expect(!json.contains(#""isTitleLocked":"#))
    #expect(!json.contains(#""selectedTabID":"#))
    #expect(!json.contains(#""focusedPaneID":"#))
  }
}
