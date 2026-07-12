import Foundation
import Testing

@testable import supaterm

struct TerminalPinnedTabCatalogTests {
  @Test
  func sanitizedCatalogPrunesUnknownProjectsAndDuplicateTabs() throws {
    let spaceID = TerminalSpaceID()
    let projectID = TerminalProjectID()
    let unknownProjectID = TerminalProjectID()
    let tabID = TerminalTabID()
    let session = TerminalTabSession(
      lockedTitle: nil,
      focusedPaneIndex: 0,
      root: .leaf(TerminalPaneLeafSession(id: UUID(), workingDirectoryPath: nil))
    )
    let catalog = TerminalPinnedTabCatalog(
      spaces: [
        PersistedPinnedTerminalTabsForSpace(
          id: spaceID,
          projects: [
            PersistedPinnedTerminalTabsForProject(
              id: projectID,
              tabs: [
                PersistedTerminalTab(id: tabID, session: session),
                PersistedTerminalTab(id: tabID, session: session),
              ]
            ),
            PersistedPinnedTerminalTabsForProject(
              id: unknownProjectID,
              tabs: [PersistedTerminalTab(id: TerminalTabID(), session: session)]
            ),
          ]
        )
      ]
    )

    let sanitized = TerminalPinnedTabCatalog.sanitized(
      catalog,
      validProjectIDsBySpaceID: [spaceID: [projectID]]
    )

    #expect(sanitized.projects(in: spaceID).map(\.id) == [projectID])
    #expect(sanitized.tabs(in: projectID, spaceID: spaceID).map(\.id) == [tabID])
  }

  @Test
  func updatingProjectsRemovesEmptySpace() {
    let spaceID = TerminalSpaceID()
    let catalog = TerminalPinnedTabCatalog.default.updatingProjects([], in: spaceID)
    #expect(catalog.spaces.isEmpty)
  }
}
