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
          selectedTabIndex: nil,
          tabs: []
        ),
        .init(
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
        .init(
          direction: .horizontal,
          ratio: 0,
          left: .leaf(.init(workingDirectoryPath: "/tmp", titleOverride: "  ")),
          right: .leaf(.init(workingDirectoryPath: "/var"))
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
        .init(
          isPinned: false,
          lockedTitle: nil,
          focusedPaneIndex: 0,
          root: .leaf(.init(workingDirectoryPath: nil, titleOverride: nil))
        ),
        .init(
          isPinned: true,
          lockedTitle: "Pinned",
          focusedPaneIndex: 0,
          root: .leaf(.init(workingDirectoryPath: nil, titleOverride: nil))
        ),
      ]
    )

    let pruned = session.pruned()

    #expect(pruned.tabs.count == 2)
    #expect(pruned.tabs[1].lockedTitle == "Pinned")
    #expect(pruned.selectedTabIndex == 0)
  }

  @Test
  func catalogEncodingOmitsDerivedTitlesAndPaneIDs() throws {
    let spaceID = TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)
    let tabs: [TerminalTabSession] = [
      .init(
        isPinned: false,
        lockedTitle: nil,
        focusedPaneIndex: 0,
        root: .leaf(.init(workingDirectoryPath: "/tmp", titleOverride: "Pane"))
      ),
      .init(
        isPinned: true,
        lockedTitle: "Pinned",
        focusedPaneIndex: 0,
        root: .leaf(.init(workingDirectoryPath: nil, titleOverride: nil))
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
    #expect(json.contains(#""lockedTitle":"Pinned""#))
    #expect(json.contains(#""titleOverride":"Pane""#))
    #expect(!json.contains(#""title":"#))
    #expect(!json.contains(#""isTitleLocked":"#))
    #expect(!json.contains(#""selectedTabID":"#))
    #expect(!json.contains(#""focusedPaneID":"#))
  }
}
