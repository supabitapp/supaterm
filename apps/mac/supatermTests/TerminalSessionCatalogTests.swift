import Foundation
import SupaTheme
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
  func catalogDecoderRejectsNoncurrentVersions() {
    let versions =
      TerminalSessionCatalogVersion.allCases
      .filter { $0 != .current }
      .map(\.rawValue) + [999]
    for version in versions {
      let data = Data("{\"version\":\(version),\"windows\":[]}".utf8)
      #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
      }
    }
  }

  @Test
  func everyStoredCatalogVersionMigratesToCurrent() throws {
    #expect(
      TerminalSessionCatalogVersion.allCases.map(\.rawValue)
        == Array(1...TerminalSessionCatalog.currentVersion)
    )
    let expectedFixtureNames = Set(
      TerminalSessionCatalogVersion.allCases.map { "session-v\($0.rawValue).json" }
    )
    let fixtureNames = try Set(
      FileManager.default.contentsOfDirectory(atPath: Self.fixtureDirectory.path)
        .filter { $0.hasPrefix("session-v") && $0.hasSuffix(".json") }
    )
    #expect(fixtureNames == expectedFixtureNames)

    for version in TerminalSessionCatalogVersion.allCases {
      let sourceData = try Data(contentsOf: Self.fixtureURL(for: version))
      let migratedData = try TerminalSessionCatalogMigration.migrate(sourceData) ?? sourceData
      let catalog = try JSONDecoder().decode(TerminalSessionCatalog.self, from: migratedData)
      let tab = try #require(catalog.windows.first?.spaces.first?.tabs.first)
      guard case .leaf(let leaf) = tab.root else {
        Issue.record("Expected one restored pane for version \(version.rawValue)")
        continue
      }

      #expect(catalog.version == TerminalSessionCatalog.currentVersion)
      #expect(catalog.windows.count == 1)
      #expect(catalog.windows.first?.spaces.count == 1)
      #expect(catalog.windows.first?.spaces.first?.tabs.count == 1)
      #expect(tab.lockedTitle == "Legacy")
      #expect(leaf.workingDirectoryPath == "/tmp/supaterm-migration")
    }
  }

  @Test
  func storedCatalogMigrationWritesPriorVersions() throws {
    for version in TerminalSessionCatalogVersion.allCases where version != .current {
      let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: directory) }
      let url = directory.appendingPathComponent("session.json")
      try Data(contentsOf: Self.fixtureURL(for: version)).write(to: url)

      #expect(TerminalSessionCatalogMigration.migrateStoredCatalog(at: url) == .migrated)
      let catalog = try JSONDecoder().decode(
        TerminalSessionCatalog.self,
        from: Data(contentsOf: url)
      )
      #expect(catalog.version == TerminalSessionCatalog.currentVersion)
    }
  }

  @Test
  func storedCatalogMigrationRejectsFutureVersionsWithoutWriting() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("session.json")
    let sourceData = Data(
      "{\"version\":\(TerminalSessionCatalog.currentVersion + 1),\"windows\":[]}".utf8
    )
    try sourceData.write(to: url)

    #expect(TerminalSessionCatalogMigration.migrateStoredCatalog(at: url) == .rejected)
    #expect(try Data(contentsOf: url) == sourceData)
  }

  @Test
  func storedCatalogRejectionOnlyReportsUnreadableFiles() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer {
      try? FileManager.default.removeItem(at: directory)
    }
    let url = directory.appendingPathComponent("session.json")

    #expect(!TerminalSessionCatalog.storedCatalogWasRejected(url: url))

    try Data(#"{"version":8,"windows":[]}"#.utf8).write(to: url)
    #expect(TerminalSessionCatalog.storedCatalogWasRejected(url: url))

    try TerminalSessionCatalog.fileStorageEncoder()
      .encode(TerminalSessionCatalog.default)
      .write(to: url)
    #expect(!TerminalSessionCatalog.storedCatalogWasRejected(url: url))
  }

  @Test
  func windowSessionCarriesEverySpaceInstance() throws {
    let displayedSpaceID = TerminalSpaceID()
    let hiddenSpaceID = TerminalSpaceID()
    let tabID = TerminalTabID()
    let session = TerminalWindowSession(
      displayedSpaceID: displayedSpaceID,
      spaces: [
        spaceSession(
          spaceID: displayedSpaceID,
          tab: tabSession(id: tabID, title: "Selected")
        ),
        spaceSession(spaceID: hiddenSpaceID, tab: tabSession(title: "Hidden")),
      ],
      sidebarWidth: 304
    )

    let data = try TerminalSessionCatalog.fileStorageEncoder().encode(
      TerminalSessionCatalog(windows: [session])
    )
    let json = try #require(String(bytes: data, encoding: .utf8))

    #expect(json.contains(#""version":13"#))
    #expect(json.contains(#""displayedSpaceID":"#))
    #expect(json.contains(#""spaces":[{"#))
    #expect(json.contains(#""sidebarWidth":304"#))
    #expect(try JSONDecoder().decode(TerminalSessionCatalog.self, from: data).windows == [session])
  }

  @Test
  func catalogPrunesSpacesAndWindowsForMissingSpaces() {
    let validSpace = TerminalSpaceID()
    let missingSpace = TerminalSpaceID()
    let catalog = TerminalSessionCatalog(
      windows: [
        windowSession(spaceIDs: [missingSpace]),
        windowSession(spaceIDs: [missingSpace, validSpace]),
      ]
    )

    let pruned = catalog.pruned(validSpaceIDs: [validSpace])

    #expect(pruned.windows.count == 1)
    #expect(pruned.windows[0].spaces.map(\.spaceID) == [validSpace])
    #expect(pruned.windows[0].displayedSpaceID == validSpace)
  }

  @Test
  func windowSessionPrunesPanesAndTabsThatRequireUnavailableSessions() throws {
    let spaceID = TerminalSpaceID()
    let shellTabID = TerminalTabID()
    let directTabID = TerminalTabID()
    let shellSurfaceID = UUID()
    let focusedShellSurfaceID = UUID()
    let splitDirectSurfaceID = UUID()
    let directSurfaceID = UUID()
    let session = TerminalWindowSession(
      displayedSpaceID: spaceID,
      spaces: [
        TerminalSpaceSession(
          spaceID: spaceID,
          selectedTabID: directTabID,
          nodes: [
            tabNode(shellTabID, parent: .root(isPinned: false), order: 0),
            tabNode(directTabID, parent: .root(isPinned: false), order: 1),
          ],
          groups: [],
          collapsedGroupIDs: [],
          tabs: [
            TerminalTabSession(
              id: shellTabID,
              lockedTitle: "Shell",
              focusedPaneIndex: 2,
              root: .split(
                TerminalPaneSplitSession(
                  direction: .horizontal,
                  ratio: 0.5,
                  left: .leaf(
                    TerminalPaneLeafSession(
                      id: splitDirectSurfaceID,
                      workingDirectoryPath: nil,
                      restoreMode: .existingSession
                    )
                  ),
                  right: .split(
                    TerminalPaneSplitSession(
                      direction: .vertical,
                      ratio: 0.5,
                      left: .leaf(
                        TerminalPaneLeafSession(
                          id: shellSurfaceID,
                          workingDirectoryPath: nil
                        )
                      ),
                      right: .leaf(
                        TerminalPaneLeafSession(
                          id: focusedShellSurfaceID,
                          workingDirectoryPath: nil
                        )
                      )
                    )
                  )
                )
              )
            ),
            tabSession(
              id: directTabID,
              title: "Direct",
              surfaceID: directSurfaceID,
              restoreMode: .existingSession
            ),
          ]
        )
      ]
    )

    #expect(session.spaces[0].containsExistingSession)

    let pruned = try #require(
      session.pruned(validSpaceIDs: [spaceID], allowsExistingSessions: false)
    )
    let space = try #require(pruned.spaces.first)

    #expect(space.tabs.map(\.id) == [shellTabID])
    #expect(space.tabs.first?.root.orderedSurfaceIDs == [shellSurfaceID, focusedShellSurfaceID])
    #expect(space.tabs.first?.focusedPaneIndex == 1)
    #expect(space.selectedTabID == shellTabID)
    #expect(pruned.surfaceIDs == [shellSurfaceID, focusedShellSurfaceID])
    #expect(!space.containsExistingSession)
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
    let session = TerminalSpaceSession(
      spaceID: TerminalSpaceID(),
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
    let session = TerminalSpaceSession(
      spaceID: TerminalSpaceID(),
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
  func catalogPrunesDuplicateIDsAndSurfacesAcrossSpacesAndWindows() throws {
    let firstSpaceID = TerminalSpaceID()
    let secondSpaceID = TerminalSpaceID()
    let tabID = TerminalTabID()
    let surfaceID = UUID()
    let firstWindow = TerminalWindowSession(
      displayedSpaceID: firstSpaceID,
      spaces: [
        spaceSession(
          spaceID: firstSpaceID,
          tab: tabSession(id: tabID, title: "First", surfaceID: surfaceID)
        ),
        spaceSession(
          spaceID: secondSpaceID,
          tab: tabSession(id: tabID, title: "Hidden", surfaceID: surfaceID)
        ),
      ]
    )
    let secondWindow = TerminalWindowSession(
      displayedSpaceID: firstSpaceID,
      spaces: [
        spaceSession(
          spaceID: firstSpaceID,
          tab: tabSession(id: tabID, title: "Second", surfaceID: surfaceID)
        )
      ]
    )

    let pruned = TerminalSessionCatalog(windows: [firstWindow, secondWindow])
      .pruned(validSpaceIDs: [firstSpaceID, secondSpaceID])

    #expect(pruned.windows[0].spaces[0].tabs.map(\.id) == [tabID])
    #expect(pruned.windows[0].spaces[1].tabs.isEmpty)
    #expect(pruned.windows[0].spaces[1].nodes.isEmpty)
    #expect(pruned.windows[1].spaces[0].tabs.isEmpty)
    #expect(pruned.surfaceIDs == [surfaceID])
  }

  @Test
  func catalogPrunesDuplicateGroupIdentitiesAcrossWindows() throws {
    let spaceID = TerminalSpaceID()
    let tabID = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let surfaceID = UUID()
    let windows = ["First", "Second"].map { title in
      TerminalWindowSession(
        displayedSpaceID: spaceID,
        spaces: [
          TerminalSpaceSession(
            spaceID: spaceID,
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
    let session = TerminalSpaceSession(
      spaceID: TerminalSpaceID(),
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
    let session = TerminalSpaceSession(
      spaceID: TerminalSpaceID(),
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
  func catalogEncodingUsesNormalizedV9ParentGraph() throws {
    let spaceID = TerminalSpaceID(
      rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)
    let tabID = TerminalTabID(rawValue: UUID(uuidString: "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD")!)
    let groupID = TerminalTabGroupID(
      rawValue: UUID(uuidString: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC")!)
    let paneID = UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!
    let tab = tabSession(id: tabID, title: "Pinned", surfaceID: paneID)
    let catalog = TerminalSessionCatalog(
      windows: [
        TerminalWindowSession(
          displayedSpaceID: spaceID,
          spaces: [
            TerminalSpaceSession(
              spaceID: spaceID,
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
    #expect(json.contains(#""version":13"#))
    #expect(json.contains(#""nodes""#))
    #expect(
      json.contains(#""parent":{"id":"CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC","kind":"group"}"#))
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
      agent: .claude,
      sessionID: "session-1",
      processes: [
        TerminalAgentProcessIdentity(processID: 123, startTimeMicroseconds: 456)
      ],
      turnLifecycle: .active("turn-1"),
      phase: .needsInput,
      detail: "Approve tests",
      latestResponse: "Testing",
      progressRows: [
        PaneAgentProgressRow(id: "plan-1", title: "Implement", status: .running)
      ],
      activeChildren: [
        TerminalAgentActiveChild(
          id: TerminalAgentActiveChild.Identity(
            subagentID: "reviewer-1",
            sessionID: "session-1",
            turnID: "turn-1"
          ),
          kind: .subagent,
          role: "reviewer",
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

  private func windowSession(spaceIDs: [TerminalSpaceID]) -> TerminalWindowSession {
    TerminalWindowSession(
      displayedSpaceID: spaceIDs[0],
      spaces: spaceIDs.map {
        TerminalSpaceSession(
          spaceID: $0,
          selectedTabID: nil,
          nodes: [],
          groups: [],
          collapsedGroupIDs: [],
          tabs: []
        )
      }
    )
  }

  private func spaceSession(
    spaceID: TerminalSpaceID,
    tab: TerminalTabSession
  ) -> TerminalSpaceSession {
    TerminalSpaceSession(
      spaceID: spaceID,
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
    surfaceID: UUID = UUID(),
    agents: [TerminalPaneAgentRecord] = [],
    restoreMode: TerminalPaneRestoreMode = .shell
  ) -> TerminalTabSession {
    TerminalTabSession(
      id: id,
      lockedTitle: title,
      focusedPaneIndex: 0,
      root: .leaf(
        TerminalPaneLeafSession(
          id: surfaceID,
          workingDirectoryPath: nil,
          agents: agents,
          restoreMode: restoreMode
        )
      )
    )
  }

  private static let fixtureDirectory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("Fixtures/TerminalSessions", isDirectory: true)

  private static func fixtureURL(for version: TerminalSessionCatalogVersion) -> URL {
    fixtureDirectory.appendingPathComponent("session-v\(version.rawValue).json")
  }

}
