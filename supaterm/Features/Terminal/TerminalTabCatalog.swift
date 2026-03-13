enum TerminalTabSection: Equatable {
  case pinned
  case regular
}

enum TerminalTabID: String, Equatable {
  case buildOutput
  case commandDeck
  case profiles
  case searchResults
  case sessions
  case windowStyling
  case workspaceNotes
}

struct TerminalTabItem: Equatable, Identifiable {
  let id: TerminalTabID
  let title: String
  let symbol: String
  let tone: TerminalTone
  let section: TerminalTabSection
  let showsClose: Bool
}

enum TerminalTabCatalog {
  static let allTabs = [
    TerminalTabItem(
      id: .commandDeck,
      title: "Command Deck",
      symbol: "command",
      tone: .coral,
      section: .pinned,
      showsClose: true,
    ),
    TerminalTabItem(
      id: .sessions,
      title: "Sessions",
      symbol: "terminal",
      tone: .slate,
      section: .pinned,
      showsClose: true,
    ),
    TerminalTabItem(
      id: .profiles,
      title: "Profiles",
      symbol: "slider.horizontal.3",
      tone: .amber,
      section: .pinned,
      showsClose: true,
    ),
    TerminalTabItem(
      id: .workspaceNotes,
      title: "Workspace Notes",
      symbol: "note.text",
      tone: .sky,
      section: .regular,
      showsClose: true,
    ),
    TerminalTabItem(
      id: .buildOutput,
      title: "Build Output",
      symbol: "bolt",
      tone: .mint,
      section: .regular,
      showsClose: true,
    ),
    TerminalTabItem(
      id: .windowStyling,
      title: "Window Styling",
      symbol: "macwindow",
      tone: .violet,
      section: .regular,
      showsClose: true,
    ),
    TerminalTabItem(
      id: .searchResults,
      title: "Search Results",
      symbol: "magnifyingglass",
      tone: .amber,
      section: .regular,
      showsClose: false,
    ),
  ]

  static let defaultSelectedTabID = allTabs[0].id

  static var pinnedTabs: [TerminalTabItem] {
    allTabs.filter { $0.section == .pinned }
  }

  static var regularTabs: [TerminalTabItem] {
    allTabs.filter { $0.section == .regular }
  }

  static func tab(id: TerminalTabID) -> TerminalTabItem {
    allTabs.first(where: { $0.id == id }) ?? allTabs[0]
  }
}

enum TerminalTone: Equatable {
  case amber
  case coral
  case mint
  case sky
  case slate
  case violet
}
