import Foundation
import SupatermCLIShared
import Testing

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
