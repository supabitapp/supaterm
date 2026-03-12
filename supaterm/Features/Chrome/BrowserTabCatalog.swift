enum BrowserTabSection: Equatable {
  case pinned
  case regular
}

enum BrowserTabID: String, Equatable {
  case bookmarks
  case buildOutput
  case commandDeck
  case searchResults
  case sessions
  case windowStyling
  case workspaceNotes
}

struct BrowserTabItem: Equatable, Identifiable {
  let id: BrowserTabID
  let title: String
  let symbol: String
  let tone: ChromeTone
  let section: BrowserTabSection
  let showsClose: Bool
}

enum BrowserTabCatalog {
  static let allTabs = [
    BrowserTabItem(
      id: .commandDeck,
      title: "Command Deck",
      symbol: "command",
      tone: .coral,
      section: .pinned,
      showsClose: true,
    ),
    BrowserTabItem(
      id: .sessions,
      title: "Sessions",
      symbol: "terminal",
      tone: .slate,
      section: .pinned,
      showsClose: true,
    ),
    BrowserTabItem(
      id: .bookmarks,
      title: "Bookmarks",
      symbol: "book",
      tone: .amber,
      section: .pinned,
      showsClose: true,
    ),
    BrowserTabItem(
      id: .workspaceNotes,
      title: "Workspace Notes",
      symbol: "note.text",
      tone: .sky,
      section: .regular,
      showsClose: true,
    ),
    BrowserTabItem(
      id: .buildOutput,
      title: "Build Output",
      symbol: "bolt",
      tone: .mint,
      section: .regular,
      showsClose: true,
    ),
    BrowserTabItem(
      id: .windowStyling,
      title: "Window Styling",
      symbol: "macwindow",
      tone: .violet,
      section: .regular,
      showsClose: true,
    ),
    BrowserTabItem(
      id: .searchResults,
      title: "Search Results",
      symbol: "magnifyingglass",
      tone: .amber,
      section: .regular,
      showsClose: false,
    ),
  ]

  static let defaultSelectedTabID = allTabs[0].id

  static var pinnedTabs: [BrowserTabItem] {
    allTabs.filter { $0.section == .pinned }
  }

  static var regularTabs: [BrowserTabItem] {
    allTabs.filter { $0.section == .regular }
  }

  static func tab(id: BrowserTabID) -> BrowserTabItem {
    allTabs.first(where: { $0.id == id }) ?? allTabs[0]
  }
}

enum ChromeTone: Equatable {
  case amber
  case coral
  case mint
  case sky
  case slate
  case violet
}
