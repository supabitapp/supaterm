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
    for version in [6, 999] {
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
        emptySpaceSession(id: missingSpace),
        emptySpaceSession(id: validSpace),
      ]
    )

    let pruned = session.pruned(validSpaceIDs: [validSpace])

    #expect(pruned?.selectedSpaceID == validSpace)
    #expect(pruned?.spaces.map(\.id) == [validSpace])
  }

  @Test
  func tabSessionSanitizesSplitRatioFocusedPaneAndDuplicateSurfaces() throws {
    let id = TerminalTabID()
    let surfaceID = UUID()
    let session = TerminalTabSession(
      id: id,
      lockedTitle: "  ",
      focusedPaneIndex: 99,
      root: .split(
        TerminalPaneSplitSession(
          direction: .horizontal,
          ratio: 0,
          left: .leaf(
            TerminalPaneLeafSession(
              id: surfaceID,
              workingDirectoryPath: "/tmp",
              titleOverride: "  "
            )
          ),
          right: .leaf(
            TerminalPaneLeafSession(
              id: surfaceID,
              workingDirectoryPath: "/var"
            )
          )
        )
      )
    )

    let pruned = try #require(session.pruned())
    guard case .leaf(let leaf) = pruned.root else {
      Issue.record("Expected duplicate split to collapse to one leaf")
      return
    }

    #expect(pruned.id == id)
    #expect(pruned.lockedTitle == "  ")
    #expect(leaf.titleOverride == "  ")
    #expect(pruned.focusedPaneIndex == 0)
  }

  @Test
  func spaceSessionNormalizesParentOrdersAndPreservesStableSelection() throws {
    let selectedTabID = TerminalTabID()
    let groupedTabID = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let session = TerminalWindowSpaceSession(
      id: TerminalSpaceID(),
      selectedTabID: selectedTabID,
      nodes: [
        tabNode(selectedTabID, parent: .root(isPinned: false), order: 8),
        tabNode(groupedTabID, parent: .group(groupID), order: 5),
        groupNode(groupID, isPinned: true, order: 3),
      ],
      groups: [
        groupSession(id: groupID, title: " Build ", lifetime: .automatic)
      ],
      collapsedGroupIDs: [groupID],
      tabs: [
        tabSession(id: selectedTabID, title: "Selected"),
        tabSession(id: groupedTabID, title: "Grouped"),
      ]
    )

    let pruned = session.pruned()
    let group = try #require(pruned.groups.first)

    #expect(
      pruned.nodes == [
        groupNode(groupID, isPinned: true, order: 0),
        tabNode(groupedTabID, parent: .group(groupID), order: 0),
        tabNode(selectedTabID, parent: .root(isPinned: false), order: 0),
      ]
    )
    #expect(pruned.tabs.map(\.id) == [groupedTabID, selectedTabID])
    #expect(pruned.selectedTabID == selectedTabID)
    #expect(pruned.collapsedGroupIDs == [groupID])
    #expect(group.title == "Build")
    #expect(group.lifetime == .automatic)
  }

  @Test
  func spaceSessionPrunesOrphansAndGloballyDuplicateNodes() throws {
    let firstTabID = TerminalTabID()
    let secondTabID = TerminalTabID()
    let orphanTabID = TerminalTabID()
    let missingTabID = TerminalTabID()
    let firstGroupID = TerminalTabGroupID()
    let secondGroupID = TerminalTabGroupID()
    let missingGroupID = TerminalTabGroupID()
    let session = TerminalWindowSpaceSession(
      id: TerminalSpaceID(),
      selectedTabID: missingTabID,
      nodes: [
        groupNode(firstGroupID, isPinned: false, order: 9),
        tabNode(firstTabID, parent: .group(firstGroupID), order: 4),
        tabNode(firstTabID, parent: .root(isPinned: false), order: 0),
        tabNode(secondTabID, parent: .group(firstGroupID), order: 2),
        tabNode(secondTabID, parent: .group(secondGroupID), order: 0),
        groupNode(secondGroupID, isPinned: false, order: 1),
        tabNode(missingTabID, parent: .root(isPinned: false), order: 2),
        tabNode(orphanTabID, parent: .group(missingGroupID), order: 0),
        groupNode(firstGroupID, isPinned: true, order: 0),
        groupNode(missingGroupID, isPinned: false, order: 0),
      ],
      groups: [
        groupSession(id: firstGroupID, title: "First", lifetime: .durable),
        groupSession(id: secondGroupID, title: "Second", lifetime: .durable),
      ],
      collapsedGroupIDs: [missingGroupID, secondGroupID, secondGroupID],
      tabs: [
        tabSession(id: firstTabID, title: "First"),
        tabSession(id: firstTabID, title: "Duplicate"),
        tabSession(id: secondTabID, title: "Second"),
        tabSession(id: orphanTabID, title: "Orphan"),
      ]
    )

    let pruned = session.pruned()

    #expect(
      pruned.nodes == [
        groupNode(secondGroupID, isPinned: false, order: 0),
        groupNode(firstGroupID, isPinned: false, order: 1),
        tabNode(secondTabID, parent: .group(firstGroupID), order: 0),
        tabNode(firstTabID, parent: .group(firstGroupID), order: 1),
      ]
    )
    #expect(pruned.groups.map(\.id) == [secondGroupID, firstGroupID])
    #expect(pruned.tabs.map(\.id) == [secondTabID, firstTabID])
    #expect(pruned.tabs.last?.lockedTitle == "First")
    #expect(pruned.selectedTabID == secondTabID)
    #expect(pruned.collapsedGroupIDs == [secondGroupID])
  }

  @Test
  func windowSessionPrunesDuplicateIDsAndSurfacesAcrossSpaces() throws {
    let firstSpaceID = TerminalSpaceID()
    let secondSpaceID = TerminalSpaceID()
    let tabID = TerminalTabID()
    let surfaceID = UUID()
    let firstSpace = spaceSession(
      id: firstSpaceID,
      tab: tabSession(id: tabID, title: "First", surfaceID: surfaceID)
    )
    let secondSpace = spaceSession(
      id: secondSpaceID,
      tab: tabSession(id: tabID, title: "Second", surfaceID: surfaceID)
    )
    let window = TerminalWindowSession(
      selectedSpaceID: firstSpaceID,
      spaces: [firstSpace, secondSpace]
    )

    let pruned = try #require(
      window.pruned(validSpaceIDs: [firstSpaceID, secondSpaceID])
    )

    #expect(pruned.spaces[0].tabs.map(\.id) == [tabID])
    #expect(pruned.spaces[1].tabs.isEmpty)
    #expect(pruned.spaces[1].nodes.isEmpty)
  }

  @Test
  func catalogPrunesDuplicateIdentitiesAndSurfacesAcrossWindows() throws {
    let spaceID = TerminalSpaceID()
    let tabID = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let surfaceID = UUID()
    let windows = ["First", "Second"].map { title in
      TerminalWindowSession(
        selectedSpaceID: spaceID,
        spaces: [
          TerminalWindowSpaceSession(
            id: spaceID,
            selectedTabID: tabID,
            nodes: [
              groupNode(groupID, isPinned: false, order: 0),
              tabNode(tabID, parent: .group(groupID), order: 0),
            ],
            groups: [groupSession(id: groupID, title: title, lifetime: .automatic)],
            collapsedGroupIDs: [],
            tabs: [tabSession(id: tabID, title: title, surfaceID: surfaceID)]
          )
        ]
      )
    }

    let catalog = TerminalSessionCatalog(windows: windows).pruned(validSpaceIDs: [spaceID])

    #expect(catalog.windows.count == 2)
    #expect(catalog.windows[0].spaces[0].groups.map(\.id) == [groupID])
    #expect(catalog.windows[0].spaces[0].tabs.map(\.id) == [tabID])
    #expect(catalog.windows[1].spaces[0].groups.isEmpty)
    #expect(catalog.windows[1].spaces[0].tabs.isEmpty)
    #expect(catalog.windows[1].spaces[0].nodes.isEmpty)
    #expect(catalog.surfaceIDs == [surfaceID])
  }

  @Test
  func pruningRetainsEmptyDurableGroupsAndRemovesEmptyAutomaticGroups() {
    let durableGroupID = TerminalTabGroupID()
    let automaticGroupID = TerminalTabGroupID()
    let session = TerminalWindowSpaceSession(
      id: TerminalSpaceID(),
      selectedTabID: nil,
      nodes: [
        groupNode(durableGroupID, isPinned: false, order: 4),
        groupNode(automaticGroupID, isPinned: false, order: 2),
      ],
      groups: [
        groupSession(id: durableGroupID, title: "Durable", lifetime: .durable),
        groupSession(id: automaticGroupID, title: "Automatic", lifetime: .automatic),
      ],
      collapsedGroupIDs: [durableGroupID, automaticGroupID],
      tabs: []
    )

    let pruned = session.pruned()

    #expect(pruned.nodes == [groupNode(durableGroupID, isPinned: false, order: 0)])
    #expect(pruned.groups.map(\.id) == [durableGroupID])
    #expect(pruned.collapsedGroupIDs == [durableGroupID])
    #expect(pruned.selectedTabID == nil)
  }

  @Test
  func pruningPreservesTheSelectedTabsCollapsedGroup() {
    let tabID = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let session = TerminalWindowSpaceSession(
      id: TerminalSpaceID(),
      selectedTabID: tabID,
      nodes: [
        groupNode(groupID, isPinned: false, order: 0),
        tabNode(tabID, parent: .group(groupID), order: 0),
      ],
      groups: [groupSession(id: groupID, title: "Group", lifetime: .automatic)],
      collapsedGroupIDs: [groupID],
      tabs: [tabSession(id: tabID, title: "Selected")]
    )

    let pruned = session.pruned()

    #expect(pruned.selectedTabID == tabID)
    #expect(pruned.collapsedGroupIDs == [groupID])
  }

  @Test
  func catalogEncodingUsesNormalizedV7ParentGraph() throws {
    let spaceID = TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)
    let tabID = TerminalTabID(rawValue: UUID(uuidString: "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD")!)
    let groupID = TerminalTabGroupID(rawValue: UUID(uuidString: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC")!)
    let paneID = UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!
    let tab = tabSession(id: tabID, title: "Pinned", surfaceID: paneID)
    let catalog = TerminalSessionCatalog(
      windows: [
        TerminalWindowSession(
          selectedSpaceID: spaceID,
          spaces: [
            TerminalWindowSpaceSession(
              id: spaceID,
              selectedTabID: tabID,
              nodes: [
                groupNode(groupID, isPinned: true, order: 0),
                tabNode(tabID, parent: .group(groupID), order: 0),
              ],
              groups: [
                groupSession(id: groupID, title: "Build", lifetime: .automatic)
              ],
              collapsedGroupIDs: [groupID],
              tabs: [tab]
            )
          ]
        )
      ]
    )

    let data = try TerminalSessionCatalog.fileStorageEncoder().encode(catalog)
    let json = try #require(String(bytes: data, encoding: .utf8))
    let decoded = try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)

    #expect(decoded == catalog)
    #expect(json.contains(#""version":7"#))
    #expect(json.contains(#""nodes""#))
    #expect(json.contains(#""parent":{"id":"CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC","kind":"group"}"#))
    #expect(json.contains(#""collapsedGroupIDs":["CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC"]"#))
    #expect(json.contains(#""lifetime":"automatic""#))
    #expect(!json.contains(#""selectedTabIndex""#))
    #expect(!json.contains(#""rootNodes""#))
    #expect(!json.contains(#""tabIDs""#))
    #expect(!json.contains(#""tab":{"#))
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

  private func emptySpaceSession(id: TerminalSpaceID) -> TerminalWindowSpaceSession {
    TerminalWindowSpaceSession(
      id: id,
      selectedTabID: nil,
      nodes: [],
      groups: [],
      collapsedGroupIDs: [],
      tabs: []
    )
  }

  private func spaceSession(
    id: TerminalSpaceID,
    tab: TerminalTabSession
  ) -> TerminalWindowSpaceSession {
    TerminalWindowSpaceSession(
      id: id,
      selectedTabID: tab.id,
      nodes: [tabNode(tab.id, parent: .root(isPinned: false), order: 0)],
      groups: [],
      collapsedGroupIDs: [],
      tabs: [tab]
    )
  }

  private func tabNode(
    _ id: TerminalTabID,
    parent: TerminalTabNodeSessionParent,
    order: Int
  ) -> TerminalTabNodeSession {
    TerminalTabNodeSession(item: .tab(id), parent: parent, order: order)
  }

  private func groupNode(
    _ id: TerminalTabGroupID,
    isPinned: Bool,
    order: Int
  ) -> TerminalTabNodeSession {
    TerminalTabNodeSession(
      item: .group(id),
      parent: .root(isPinned: isPinned),
      order: order
    )
  }

  private func groupSession(
    id: TerminalTabGroupID,
    title: String,
    lifetime: TerminalTabGroupLifetime
  ) -> TerminalTabGroupSession {
    TerminalTabGroupSession(
      id: id,
      title: title,
      color: .blue,
      lifetime: lifetime
    )
  }

  private func tabSession(
    id: TerminalTabID = TerminalTabID(),
    title: String,
    surfaceID: UUID = UUID()
  ) -> TerminalTabSession {
    TerminalTabSession(
      id: id,
      lockedTitle: title,
      focusedPaneIndex: 0,
      root: .leaf(
        TerminalPaneLeafSession(
          id: surfaceID,
          workingDirectoryPath: nil
        )
      )
    )
  }
}
