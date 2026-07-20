import Foundation
import SupatermCLIShared
import Testing

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
  func catalogRejectsUnsupportedAndPreviousVersions() {
    for version in [5, 999] {
      let data = Data("{\"version\":\(version),\"windows\":[]}".utf8)
      #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
      }
    }
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
          collapsedGroupIDs: [],
          rootItems: []
        ),
        TerminalWindowSpaceSession(
          id: validSpace,
          selectedTabIndex: nil,
          collapsedGroupIDs: [],
          rootItems: []
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
  func spaceSessionNormalizesRootLanesSelectionAndCollapsedGroups() throws {
    let validGroupID = TerminalTabGroupID()
    let missingGroupID = TerminalTabGroupID()
    let session = TerminalWindowSpaceSession(
      id: TerminalSpaceID(),
      selectedTabIndex: 42,
      collapsedGroupIDs: [validGroupID, missingGroupID, validGroupID],
      rootItems: [
        .tab(isPinned: false, tab: tabSession(title: "Regular")),
        .group(
          id: validGroupID,
          title: " Build ",
          color: .orange,
          isPinned: true,
          tabs: [tabSession(title: "Grouped")]
        ),
        .group(
          id: validGroupID,
          title: "Duplicate",
          color: .red,
          isPinned: false,
          tabs: []
        ),
      ]
    )

    let pruned = session.pruned()

    #expect(pruned.rootItems.count == 2)
    #expect(pruned.rootItems.first?.groupID == validGroupID)
    #expect(pruned.selectedTabIndex == 0)
    #expect(pruned.collapsedGroupIDs == [validGroupID])
    guard case .group(_, let title, _, _, _) = try #require(pruned.rootItems.first) else {
      Issue.record("Expected group")
      return
    }
    #expect(title == "Build")
  }

  @Test
  func spaceSessionPreservesSelectedTabAcrossRootLaneNormalization() throws {
    let selectedTab = tabSession(title: "Selected")
    let session = TerminalWindowSpaceSession(
      id: TerminalSpaceID(),
      selectedTabIndex: 0,
      collapsedGroupIDs: [],
      rootItems: [
        .tab(isPinned: false, tab: selectedTab),
        .tab(isPinned: true, tab: tabSession(title: "Pinned")),
      ]
    )

    let pruned = session.pruned()
    let selectedTabIndex = try #require(pruned.selectedTabIndex)

    #expect(selectedTabIndex == 1)
    #expect(pruned.rootItems.flatMap(\.tabs)[selectedTabIndex].surfaceIDs == selectedTab.surfaceIDs)
  }

  @Test
  func pruningRetainsEmptyGroups() {
    let groupID = TerminalTabGroupID()
    let session = TerminalWindowSpaceSession(
      id: TerminalSpaceID(),
      selectedTabIndex: 0,
      collapsedGroupIDs: [groupID],
      rootItems: [
        .group(id: groupID, title: "Group", color: .neutral, isPinned: false, tabs: [])
      ]
    )

    let pruned = session.pruned()

    #expect(pruned.rootItems.count == 1)
    #expect(pruned.rootItems[0].tabs.isEmpty)
    #expect(pruned.selectedTabIndex == nil)
    #expect(pruned.collapsedGroupIDs == [groupID])
  }

  @Test
  func catalogEncodingUsesStructuralV6ShapeAndOmitsTabPinAndIDs() throws {
    let spaceID = TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)
    let groupID = TerminalTabGroupID(rawValue: UUID(uuidString: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC")!)
    let paneID = UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!
    let tab = TerminalTabSession(
      lockedTitle: "Pinned",
      focusedPaneIndex: 0,
      root: .leaf(
        TerminalPaneLeafSession(
          id: paneID,
          workingDirectoryPath: "/tmp",
          titleOverride: "Pane"
        )
      )
    )
    let catalog = TerminalSessionCatalog(
      windows: [
        TerminalWindowSession(
          selectedSpaceID: spaceID,
          spaces: [
            TerminalWindowSpaceSession(
              id: spaceID,
              selectedTabIndex: 0,
              collapsedGroupIDs: [groupID],
              rootItems: [
                .group(
                  id: groupID,
                  title: "Build",
                  color: .blue,
                  isPinned: true,
                  tabs: [tab]
                )
              ]
            )
          ]
        )
      ]
    )

    let data = try TerminalSessionCatalog.fileStorageEncoder().encode(catalog)
    let json = try #require(String(bytes: data, encoding: .utf8))
    let decoded = try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)

    #expect(decoded == catalog)
    #expect(json.contains(#""version":6"#))
    #expect(json.contains(#""kind":"group""#))
    #expect(json.contains(#""color":"blue""#))
    #expect(json.contains(#""isPinned":true"#))
    #expect(json.contains(#""id":"CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC""#))
    #expect(json.contains(#""id":"BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB""#))
    #expect(!json.contains(#""selectedPinnedTabID""#))
    #expect(!json.contains(#""isTitleLocked""#))
  }

  @Test
  func agentRecordRoundTripsCanonicalState() throws {
    let record = TerminalPaneAgentRecord(
      agent: .codex,
      sessionID: "session-1",
      processes: [
        TerminalAgentProcessIdentity(processID: 123, startTimeMicroseconds: 456)
      ],
      transcriptPath: "/tmp/session.jsonl",
      turnLifecycle: .active("turn-1"),
      phase: .needsInput,
      detail: "Approve tests",
      hoverMessages: ["Inspecting", "Testing"],
      nativePlanRows: [
        PaneAgentProgressRow(id: "plan-1", title: "Implement", status: .running)
      ],
      transcriptRows: [
        PaneAgentProgressRow(id: "goal-1", title: "Ship", status: .running, kind: .goal)
      ],
      activeChildren: [
        TerminalAgentActiveChild(
          id: TerminalAgentActiveChild.Identity(
            subagentID: "reviewer-1",
            sessionID: "session-1",
            turnID: "turn-1"
          ),
          nickname: "Mendel",
          role: "reviewer",
          transcriptPath: "/tmp/child.jsonl",
          phase: .running,
          detail: "Reviewing"
        )
      ],
      isForeground: true,
      revision: 7
    )

    let data = try JSONEncoder().encode(record)
    let decoded = try JSONDecoder().decode(TerminalPaneAgentRecord.self, from: data)

    #expect(decoded == record)
  }

  private func tabSession(title: String) -> TerminalTabSession {
    TerminalTabSession(
      lockedTitle: title,
      focusedPaneIndex: 0,
      root: .leaf(TerminalPaneLeafSession(workingDirectoryPath: nil))
    )
  }
}
