import Foundation
import Testing

@testable import supaterm

struct TerminalSessionCatalogTests {
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
  func windowSessionPrunesMissingSpacesAndFallsBackSelection() {
    let validSpace = TerminalSpaceID()
    let missingSpace = TerminalSpaceID()
    let session = TerminalWindowSession(
      selectedSpaceID: missingSpace,
      spaces: [
        .init(
          id: missingSpace,
          selectedTabID: nil,
          tabs: []
        ),
        .init(
          id: validSpace,
          selectedTabID: nil,
          tabs: []
        ),
      ]
    )

    let pruned = session.pruned(validSpaceIDs: [validSpace])

    #expect(pruned?.selectedSpaceID == validSpace)
    #expect(pruned?.spaces.map(\.id) == [validSpace])
  }

  @Test
  func tabSessionSanitizesSplitRatioAndFallsBackFocusedPane() throws {
    let leftPaneID = UUID()
    let rightPaneID = UUID()
    let session = TerminalTabSession(
      id: TerminalTabID(),
      title: "Terminal",
      isPinned: false,
      isTitleLocked: false,
      focusedPaneID: UUID(),
      root: .split(
        .init(
          direction: .horizontal,
          ratio: 0,
          left: .leaf(.init(id: leftPaneID, workingDirectoryPath: "/tmp")),
          right: .leaf(.init(id: rightPaneID, workingDirectoryPath: "/var"))
        )
      )
    )

    let pruned = try #require(session.pruned())
    guard case .split(let split) = pruned.root else {
      Issue.record("Expected split root")
      return
    }

    #expect(split.ratio == 0.5)
    #expect(pruned.focusedPaneID == leftPaneID)
  }

  @Test
  func spaceSessionDropsDuplicateTabIDs() {
    let tabID = TerminalTabID()
    let session = TerminalWindowSpaceSession(
      id: TerminalSpaceID(),
      selectedTabID: tabID,
      tabs: [
        .init(
          id: tabID,
          title: "One",
          isPinned: false,
          isTitleLocked: false,
          focusedPaneID: nil,
          root: .leaf(.init(id: UUID(), workingDirectoryPath: nil))
        ),
        .init(
          id: tabID,
          title: "Two",
          isPinned: true,
          isTitleLocked: true,
          focusedPaneID: nil,
          root: .leaf(.init(id: UUID(), workingDirectoryPath: nil))
        ),
      ]
    )

    let pruned = session.pruned()

    #expect(pruned.tabs.count == 1)
    #expect(pruned.tabs[0].title == "One")
    #expect(pruned.selectedTabID == tabID)
  }
}
