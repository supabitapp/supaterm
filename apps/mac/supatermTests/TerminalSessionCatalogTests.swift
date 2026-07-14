import Foundation
import Testing

@testable import supaterm

struct TerminalSessionCatalogTests {
  @Test
  func decoderRejectsPreviousSchema() throws {
    let data = Data("{\"version\":5,\"windows\":[]}".utf8)
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
    }
  }

  @Test
  func pruningPreservesStableTabIDsInsideProjects() throws {
    let spaceID = TerminalSpaceID()
    let projectID = TerminalProjectID()
    let tabID = TerminalTabID()
    let removedProjectID = TerminalProjectID()
    let session = TerminalWindowSession(
      selectedSpaceID: spaceID,
      spaces: [
        TerminalWindowSpaceSession(
          id: spaceID,
          selectedTabID: tabID,
          projects: [
            TerminalWindowProjectSession(
              id: projectID,
              tabs: [
                PersistedTerminalTab(
                  id: tabID,
                  session: TerminalTabSession(
                    lockedTitle: "shell",
                    focusedPaneIndex: 0,
                    root: .leaf(TerminalPaneLeafSession(id: UUID(), workingDirectoryPath: nil))
                  )
                )
              ]
            )
          ]
        )
      ],
      collapsedProjectIDs: [projectID, removedProjectID]
    )

    let pruned = try #require(session.pruned(validSpaceIDs: [spaceID]))
    #expect(pruned.spaces[0].projects[0].tabs.map(\.id) == [tabID])
    #expect(pruned.spaces[0].selectedTabID == tabID)
    #expect(pruned.collapsedProjectIDs == [projectID])
  }

  @Test
  func catalogReportsNestedSurfaceIDs() {
    let surfaceID = UUID()
    let tab = PersistedTerminalTab(
      id: TerminalTabID(),
      session: TerminalTabSession(
        lockedTitle: nil,
        focusedPaneIndex: 0,
        root: .leaf(TerminalPaneLeafSession(id: surfaceID, workingDirectoryPath: nil))
      )
    )
    let spaceID = TerminalSpaceID()
    let catalog = TerminalSessionCatalog(
      windows: [
        TerminalWindowSession(
          selectedSpaceID: spaceID,
          spaces: [
            TerminalWindowSpaceSession(
              id: spaceID,
              selectedTabID: tab.id,
              projects: [TerminalWindowProjectSession(id: TerminalProjectID(), tabs: [tab])]
            )
          ]
        )
      ]
    )
    #expect(catalog.surfaceIDs == [surfaceID])
  }
}
