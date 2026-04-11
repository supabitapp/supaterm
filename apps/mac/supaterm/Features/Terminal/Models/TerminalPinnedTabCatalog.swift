import Foundation

nonisolated struct PersistedPinnedTerminalTab: Equatable, Codable, Sendable {
  let id: TerminalTabID
  var session: TerminalTabSession
}

nonisolated struct PersistedPinnedTerminalTabsForSpace: Equatable, Codable, Sendable {
  let id: TerminalSpaceID
  var tabs: [PersistedPinnedTerminalTab]
}

nonisolated struct TerminalPinnedTabCatalog: Equatable, Codable, Sendable {
  var spaces: [PersistedPinnedTerminalTabsForSpace]

  static let `default` = Self(spaces: [])

  static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("pinned-tabs.json", isDirectory: false)
  }

  static func sanitized(
    _ catalog: Self?,
    validSpaceIDs: Set<TerminalSpaceID>? = nil
  ) -> Self {
    guard let catalog else { return .default }

    var seenSpaceIDs: Set<TerminalSpaceID> = []
    let spaces = catalog.spaces.compactMap { space -> PersistedPinnedTerminalTabsForSpace? in
      guard seenSpaceIDs.insert(space.id).inserted else { return nil }
      if let validSpaceIDs, !validSpaceIDs.contains(space.id) {
        return nil
      }

      var seenTabIDs: Set<TerminalTabID> = []
      let tabs = space.tabs.compactMap { tab -> PersistedPinnedTerminalTab? in
        guard seenTabIDs.insert(tab.id).inserted else { return nil }
        guard let session = tab.session.pruned() else { return nil }
        return PersistedPinnedTerminalTab(
          id: tab.id,
          session: TerminalTabSession(
            isPinned: true,
            lockedTitle: session.lockedTitle,
            focusedPaneIndex: session.focusedPaneIndex,
            root: session.root
          )
        )
      }
      guard !tabs.isEmpty else { return nil }
      return PersistedPinnedTerminalTabsForSpace(id: space.id, tabs: tabs)
    }

    return Self(spaces: spaces)
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  func tabs(in spaceID: TerminalSpaceID) -> [PersistedPinnedTerminalTab] {
    spaces.first(where: { $0.id == spaceID })?.tabs ?? []
  }
}
