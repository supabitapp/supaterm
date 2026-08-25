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
  func catalogDecoderRejectsNoncurrentVersions() {
    for version in [1, 13, 15, 999] {
      let data = Data("{\"version\":\(version),\"windows\":[]}".utf8)
      #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
      }
    }
  }

  @Test
  func currentCatalogDoesNotMigrate() throws {
    let data = try Data(contentsOf: Self.fixtureURL(named: "session-v14.json"))

    #expect(try TerminalSessionCatalogMigration.migrate(data) == nil)
    #expect(try JSONDecoder().decode(TerminalSessionCatalog.self, from: data).version == 14)
  }

  @Test
  func version13MigrationFlattensGroupsAsUnassignedTabs() throws {
    let data = try Data(contentsOf: Self.fixtureURL(named: "group-rich-v13.json"))
    let migratedData = try #require(try TerminalSessionCatalogMigration.migrate(data))
    let catalog = try JSONDecoder().decode(TerminalSessionCatalog.self, from: migratedData)
    let space = try #require(catalog.windows.first?.spaces.first)

    #expect(catalog.version == 14)
    #expect(
      space.tabs.map(\.id.rawValue.uuidString) == [
        "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAA0001",
        "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAA0002",
        "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAA0003",
      ]
    )
    #expect(space.tabs.map(\.isPinned) == [true, true, false])
    #expect(space.tabs.allSatisfy { $0.projectID == nil })
    #expect(space.collapsedProjectIDs.isEmpty)
    #expect(!space.isUnassignedCollapsed)
    #expect(
      space.selectedTabID?.rawValue.uuidString
        == "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAA0002"
    )
  }

  @Test
  func storedCatalogMigrationWritesVersion14() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("session.json")
    try Data(contentsOf: Self.fixtureURL(named: "group-rich-v13.json")).write(to: url)

    #expect(TerminalSessionCatalogMigration.migrateStoredCatalog(at: url) == .migrated)
    let catalog = try JSONDecoder().decode(
      TerminalSessionCatalog.self,
      from: Data(contentsOf: url)
    )
    #expect(catalog.version == 14)
  }

  @Test
  func storedCatalogMigrationRejectsFutureVersionsWithoutWriting() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("session.json")
    let data = Data("{\"version\":15,\"windows\":[]}".utf8)
    try data.write(to: url)

    #expect(TerminalSessionCatalogMigration.migrateStoredCatalog(at: url) == .rejected)
    #expect(try Data(contentsOf: url) == data)
  }

  @Test
  func storedCatalogRejectionOnlyReportsUnreadableFiles() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("session.json")

    #expect(!TerminalSessionCatalog.storedCatalogWasRejected(url: url))
    try Data(#"{"version":13,"windows":[]}"#.utf8).write(to: url)
    #expect(TerminalSessionCatalog.storedCatalogWasRejected(url: url))
    try TerminalSessionCatalog.fileStorageEncoder()
      .encode(TerminalSessionCatalog.default)
      .write(to: url)
    #expect(!TerminalSessionCatalog.storedCatalogWasRejected(url: url))
  }

  @Test
  func encodingUsesVersion14FlatTabsAndProjectCollapseState() throws {
    let spaceID = TerminalSpaceID()
    let projectID = TerminalProjectID()
    let pinned = tabSession(title: "Pinned", projectID: projectID, isPinned: true)
    let regular = tabSession(title: "Regular")
    let session = TerminalWindowSession(
      displayedSpaceID: spaceID,
      spaces: [
        TerminalSpaceSession(
          spaceID: spaceID,
          selectedTabID: regular.id,
          collapsedProjectIDs: [projectID],
          isUnassignedCollapsed: true,
          tabs: [pinned, regular]
        )
      ],
      sidebarWidth: 304
    )

    let data = try TerminalSessionCatalog.fileStorageEncoder().encode(
      TerminalSessionCatalog(windows: [session])
    )
    let json = try #require(String(bytes: data, encoding: .utf8))

    #expect(try JSONDecoder().decode(TerminalSessionCatalog.self, from: data).windows == [session])
    #expect(json.contains(#""version":14"#))
    #expect(json.contains(#""projectID""#))
    #expect(json.contains(#""isPinned":true"#))
    #expect(json.contains(#""collapsedProjectIDs""#))
    #expect(json.contains(#""isUnassignedCollapsed":true"#))
    #expect(!json.contains(#""nodes""#))
    #expect(!json.contains(#""groups""#))
  }

  @Test
  func catalogPrunesSpacesAndWindowsForMissingSpaces() {
    let validSpaceID = TerminalSpaceID()
    let missingSpaceID = TerminalSpaceID()
    let catalog = TerminalSessionCatalog(
      windows: [
        windowSession(spaceIDs: [missingSpaceID]),
        windowSession(spaceIDs: [missingSpaceID, validSpaceID]),
      ]
    )

    let pruned = catalog.pruned(validSpaceIDs: [validSpaceID])

    #expect(pruned.windows.count == 1)
    #expect(pruned.windows[0].spaces.map(\.spaceID) == [validSpaceID])
    #expect(pruned.windows[0].displayedSpaceID == validSpaceID)
  }

  @Test
  func spacePruningOrdersPinLanesAndKeepsProjectMembership() {
    let projectID = TerminalProjectID()
    let regular = tabSession(title: "Regular", projectID: projectID)
    let pinned = tabSession(title: "Pinned", projectID: projectID, isPinned: true)
    let space = TerminalSpaceSession(
      spaceID: TerminalSpaceID(),
      selectedTabID: regular.id,
      collapsedProjectIDs: [projectID, projectID],
      isUnassignedCollapsed: true,
      tabs: [regular, pinned]
    )

    let pruned = space.pruned()

    #expect(pruned.tabs.map(\.id) == [pinned.id, regular.id])
    #expect(pruned.tabs.map(\.projectID) == [projectID, projectID])
    #expect(pruned.tabs.map(\.isPinned) == [true, false])
    #expect(pruned.selectedTabID == regular.id)
    #expect(pruned.collapsedProjectIDs == [projectID])
    #expect(pruned.isUnassignedCollapsed)
  }

  @Test
  func windowPruningDropsUnavailableExistingSessions() throws {
    let spaceID = TerminalSpaceID()
    let shellSurfaceID = UUID()
    let existingSurfaceID = UUID()
    let shell = tabSession(title: "Shell", surfaceID: shellSurfaceID)
    let existing = tabSession(
      title: "Existing",
      surfaceID: existingSurfaceID,
      restoreMode: .existingSession
    )
    let session = TerminalWindowSession(
      displayedSpaceID: spaceID,
      spaces: [
        TerminalSpaceSession(
          spaceID: spaceID,
          selectedTabID: existing.id,
          tabs: [shell, existing]
        )
      ]
    )

    let pruned = try #require(
      session.pruned(validSpaceIDs: [spaceID], allowsExistingSessions: false)
    )

    #expect(pruned.spaces[0].tabs.map(\.id) == [shell.id])
    #expect(pruned.spaces[0].selectedTabID == shell.id)
    #expect(pruned.surfaceIDs == [shellSurfaceID])
  }

  @Test
  func catalogPrunesDuplicateTabsAndSurfacesAcrossWindows() {
    let firstSpaceID = TerminalSpaceID()
    let secondSpaceID = TerminalSpaceID()
    let tabID = TerminalTabID()
    let surfaceID = UUID()
    let first = TerminalWindowSession(
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
    let second = TerminalWindowSession(
      displayedSpaceID: firstSpaceID,
      spaces: [
        spaceSession(
          spaceID: firstSpaceID,
          tab: tabSession(id: tabID, title: "Second", surfaceID: surfaceID)
        )
      ]
    )

    let pruned = TerminalSessionCatalog(windows: [first, second])
      .pruned(validSpaceIDs: [firstSpaceID, secondSpaceID])

    #expect(pruned.windows[0].spaces[0].tabs.map(\.id) == [tabID])
    #expect(pruned.windows[0].spaces[1].tabs.isEmpty)
    #expect(pruned.windows[1].spaces[0].tabs.isEmpty)
    #expect(pruned.surfaceIDs == [surfaceID])
  }

  @Test
  func tabSessionSanitizesFocusedPaneAndDuplicateSurfaces() throws {
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
            TerminalPaneLeafSession(id: surfaceID, workingDirectoryPath: "/tmp")
          ),
          right: .leaf(
            TerminalPaneLeafSession(id: surfaceID, workingDirectoryPath: "/var")
          )
        )
      )
    )

    let pruned = try #require(session.pruned())

    guard case .leaf = pruned.root else {
      Issue.record("Expected duplicate split to collapse to one leaf")
      return
    }
    #expect(pruned.id == id)
    #expect(pruned.focusedPaneIndex == 0)
  }

  @Test
  func agentRecordRoundTripsCanonicalState() throws {
    let record = TerminalPaneAgentRecord(
      agent: .claude,
      sessionID: "session-1",
      processes: [TerminalAgentProcessIdentity(processID: 123, startTimeMicroseconds: 456)],
      turnLifecycle: .active("turn-1"),
      phase: .needsInput,
      detail: "Approve tests",
      latestResponse: "Testing",
      progressRows: [PaneAgentProgressRow(id: "plan-1", title: "Implement", status: .running)],
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

    #expect(
      try JSONDecoder().decode(
        TerminalPaneAgentRecord.self,
        from: JSONEncoder().encode(record)
      ) == record
    )
  }

  private func windowSession(spaceIDs: [TerminalSpaceID]) -> TerminalWindowSession {
    TerminalWindowSession(
      displayedSpaceID: spaceIDs[0],
      spaces: spaceIDs.map {
        TerminalSpaceSession(spaceID: $0, selectedTabID: nil, tabs: [])
      }
    )
  }

  private func spaceSession(
    spaceID: TerminalSpaceID,
    tab: TerminalTabSession
  ) -> TerminalSpaceSession {
    TerminalSpaceSession(spaceID: spaceID, selectedTabID: tab.id, tabs: [tab])
  }

  private func tabSession(
    id: TerminalTabID = TerminalTabID(),
    title: String,
    projectID: TerminalProjectID? = nil,
    isPinned: Bool = false,
    surfaceID: UUID = UUID(),
    restoreMode: TerminalPaneRestoreMode = .shell
  ) -> TerminalTabSession {
    TerminalTabSession(
      id: id,
      projectID: projectID,
      isPinned: isPinned,
      lockedTitle: title,
      focusedPaneIndex: 0,
      root: .leaf(
        TerminalPaneLeafSession(
          id: surfaceID,
          workingDirectoryPath: nil,
          restoreMode: restoreMode
        )
      )
    )
  }

  private static let fixtureDirectory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("Fixtures/TerminalSessions", isDirectory: true)

  private static func fixtureURL(named name: String) -> URL {
    fixtureDirectory.appendingPathComponent(name)
  }
}
