import Foundation
import SupatermCLIShared

public nonisolated struct PersistedPinnedTerminalTab: Equatable, Codable, Sendable {
  public let id: TerminalTabID
  public var session: TerminalTabSession

  public init(id: TerminalTabID, session: TerminalTabSession) {
    self.id = id
    self.session = session
  }
}

public nonisolated struct PersistedPinnedTerminalTabsForSpace: Equatable, Codable, Sendable {
  public let id: TerminalSpaceID
  public var tabs: [PersistedPinnedTerminalTab]

  public init(id: TerminalSpaceID, tabs: [PersistedPinnedTerminalTab]) {
    self.id = id
    self.tabs = tabs
  }
}

public nonisolated struct TerminalPinnedTabCatalog: Equatable, Codable, Sendable {
  public var spaces: [PersistedPinnedTerminalTabsForSpace]

  public static let `default` = Self(spaces: [])

  public init(spaces: [PersistedPinnedTerminalTabsForSpace]) {
    self.spaces = spaces
  }

  public static func defaultURL(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    SupatermStateRoot.fileURL(
      "pinned-tabs.json",
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
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

  public var surfaceIDs: Set<UUID> {
    spaces.reduce(into: Set<UUID>()) { result, space in
      for tab in space.tabs {
        result.formUnion(tab.session.surfaceIDs)
      }
    }
  }

  func updatingTabs(
    _ tabs: [PersistedPinnedTerminalTab],
    in spaceID: TerminalSpaceID
  ) -> Self {
    var spaces = spaces
    if let index = spaces.firstIndex(where: { $0.id == spaceID }) {
      if tabs.isEmpty {
        spaces.remove(at: index)
      } else {
        spaces[index].tabs = tabs
      }
    } else if !tabs.isEmpty {
      spaces.append(PersistedPinnedTerminalTabsForSpace(id: spaceID, tabs: tabs))
    }
    return Self(spaces: spaces)
  }
}
