import ArgumentParser
import Foundation
import SupatermCLIShared

struct SPTmuxTopology {
  typealias Window = SupatermAppDebugSnapshot.Window
  typealias Space = SupatermAppDebugSnapshot.Space
  typealias Tab = SupatermAppDebugSnapshot.Tab
  typealias Pane = SupatermAppDebugSnapshot.Pane

  struct SpaceLocation: Equatable {
    let window: Window
    let space: Space
  }

  struct TabLocation: Equatable {
    let window: Window
    let space: Space
    let tab: Tab

    var tabIndex: Int {
      space.flattenedTabs.firstIndex(where: { $0.id == tab.id }).map { $0 + 1 } ?? 1
    }

    var targetRequest: SupatermTabTargetRequest {
      .init(tabID: tab.id)
    }
  }

  struct PaneLocation: Equatable {
    let window: Window
    let space: Space
    let tab: Tab
    let pane: Pane

    var tabIndex: Int {
      space.flattenedTabs.firstIndex(where: { $0.id == tab.id }).map { $0 + 1 } ?? 1
    }

    var targetRequest: SupatermPaneTargetRequest {
      .init(paneID: pane.id)
    }
  }

  let snapshot: SupatermAppDebugSnapshot
  let current: PaneLocation

  init(
    snapshot: SupatermAppDebugSnapshot,
    contextPaneID: UUID?
  ) throws {
    self.snapshot = snapshot
    if let contextPaneID, let located = Self.locatePane(id: contextPaneID, in: snapshot) {
      self.current = located
      return
    }
    if let paneID = snapshot.currentTarget?.paneID,
      let located = Self.locatePane(id: paneID, in: snapshot)
    {
      self.current = located
      return
    }
    if let currentTarget = snapshot.currentTarget,
      let located = Self.locateTab(id: currentTarget.tabID, in: snapshot),
      let pane = located.tab.panes.first(where: \.isFocused) ?? located.tab.panes.first
    {
      self.current = .init(
        window: located.window,
        space: located.space,
        tab: located.tab,
        pane: pane
      )
      return
    }
    if let fallback = Self.firstVisiblePane(in: snapshot) {
      self.current = fallback
      return
    }
    throw ValidationError("No Supaterm pane is available.")
  }

  func resolveSpace(raw: String?) throws -> SpaceLocation {
    guard let token = trimmedNonEmpty(raw) else {
      return .init(window: current.window, space: current.space)
    }

    if token.contains(":"), sessionSelector(from: token) == nil {
      return .init(window: current.window, space: current.space)
    }
    let sessionToken = sessionSelector(from: token) ?? token
    if let location = locateSpace(
      selector: sessionToken, preferredWindowIndex: current.window.index)
    {
      return location
    }
    throw ValidationError("Space target not found: \(token).")
  }

  func resolveTab(raw: String?) throws -> TabLocation {
    guard let token = trimmedNonEmpty(raw) else {
      return .init(window: current.window, space: current.space, tab: current.tab)
    }

    if token.hasPrefix("%"),
      let id = normalizedUUIDToken(String(token.dropFirst())),
      let location = Self.locatePane(id: id, in: snapshot)
    {
      return .init(window: location.window, space: location.space, tab: location.tab)
    }

    let target = splitSpaceAndTab(token)
    let space: SpaceLocation =
      if let sessionToken = target.spaceSelector {
        try resolveSpace(raw: sessionToken)
      } else {
        .init(window: current.window, space: current.space)
      }

    guard let tabToken = target.tabSelector else {
      if current.space.id == space.space.id {
        return .init(window: current.window, space: current.space, tab: current.tab)
      }
      let tabs = space.space.flattenedTabs
      guard let tab = tabs.first(where: \.isSelected) ?? tabs.first else {
        throw ValidationError("Tab target not found.")
      }
      return .init(window: space.window, space: space.space, tab: tab)
    }

    if let location = locateTab(selector: tabToken, in: space) {
      return location
    }

    throw ValidationError("Tab target not found: \(token).")
  }

  func resolvePane(raw: String?) throws -> PaneLocation {
    guard let token = trimmedNonEmpty(raw) else {
      return current
    }

    if token.hasPrefix("%") {
      let paneToken = String(token.dropFirst())
      if let location = locatePaneGlobally(selector: paneToken) {
        return location
      }
      throw ValidationError("Pane target not found: \(token).")
    }

    let target = splitTabAndPane(token)
    let tab: TabLocation =
      if let tabSelector = target.tabSelector {
        try resolveTab(raw: tabSelector)
      } else {
        .init(window: current.window, space: current.space, tab: current.tab)
      }

    guard let paneToken = target.paneSelector else {
      if current.tab.id == tab.tab.id {
        return current
      }
      guard let pane = tab.tab.panes.first(where: \.isFocused) ?? tab.tab.panes.first else {
        throw ValidationError("Pane target not found.")
      }
      return .init(window: tab.window, space: tab.space, tab: tab.tab, pane: pane)
    }

    if let pane = locatePane(selector: paneToken, in: tab) {
      return pane
    }

    throw ValidationError("Pane target not found: \(token).")
  }

  func locatePane(
    windowIndex: Int,
    spaceIndex: Int,
    tabIndex: Int,
    paneIndex: Int
  ) throws -> PaneLocation {
    for window in snapshot.windows where window.index == windowIndex {
      for space in window.spaces where space.index == spaceIndex {
        let tabs = space.flattenedTabs
        guard tabs.indices.contains(tabIndex - 1) else { continue }
        let tab = tabs[tabIndex - 1]
        for pane in tab.panes where pane.index == paneIndex {
          return .init(window: window, space: space, tab: tab, pane: pane)
        }
      }
    }
    throw ValidationError("Pane target not found.")
  }

  private func locateSpace(
    selector: String,
    preferredWindowIndex: Int
  ) -> SpaceLocation? {
    if let id = normalizedUUIDToken(selector),
      let space = Self.locateSpace(id: id, in: snapshot)
    {
      return space
    }

    if let index = Int(strippingSpacePrefix(selector)) {
      for window in snapshot.windows where window.index == preferredWindowIndex {
        if let space = window.spaces.first(where: { $0.index == index }) {
          return .init(window: window, space: space)
        }
      }
      for window in snapshot.windows {
        if let space = window.spaces.first(where: { $0.index == index }) {
          return .init(window: window, space: space)
        }
      }
    }

    for window in snapshot.windows where window.index == preferredWindowIndex {
      if let space = window.spaces.first(where: { $0.name == selector }) {
        return .init(window: window, space: space)
      }
    }
    for window in snapshot.windows {
      if let space = window.spaces.first(where: { $0.name == selector }) {
        return .init(window: window, space: space)
      }
    }
    return nil
  }

  private func locateTab(
    selector: String,
    in space: SpaceLocation
  ) -> TabLocation? {
    if let id = normalizedUUIDToken(selector) {
      for tab in space.space.flattenedTabs where tab.id == id {
        return .init(window: space.window, space: space.space, tab: tab)
      }
    }

    let tabs = space.space.flattenedTabs
    if let index = Int(strippingTabPrefix(selector)), index > 0, tabs.indices.contains(index - 1) {
      let tab = tabs[index - 1]
      return .init(window: space.window, space: space.space, tab: tab)
    }

    if let tab = tabs.first(where: { $0.title == selector }) {
      return .init(window: space.window, space: space.space, tab: tab)
    }

    return nil
  }

  private func locatePane(
    selector: String,
    in tab: TabLocation
  ) -> PaneLocation? {
    if let id = normalizedUUIDToken(selector) {
      for pane in tab.tab.panes where pane.id == id {
        return .init(window: tab.window, space: tab.space, tab: tab.tab, pane: pane)
      }
    }

    if let index = Int(selector),
      let pane = tab.tab.panes.first(where: { $0.index == index })
    {
      return .init(window: tab.window, space: tab.space, tab: tab.tab, pane: pane)
    }

    return nil
  }

  private func locatePaneGlobally(selector: String) -> PaneLocation? {
    if let id = normalizedUUIDToken(selector) {
      return Self.locatePane(id: id, in: snapshot)
    }

    if let index = Int(selector) {
      if let pane = current.tab.panes.first(where: { $0.index == index }) {
        return .init(window: current.window, space: current.space, tab: current.tab, pane: pane)
      }
      for window in snapshot.windows {
        for space in window.spaces {
          for tab in space.flattenedTabs {
            if let pane = tab.panes.first(where: { $0.index == index }) {
              return .init(window: window, space: space, tab: tab, pane: pane)
            }
          }
        }
      }
    }

    return nil
  }

  private func sessionSelector(from raw: String) -> String? {
    guard let colonIndex = raw.lastIndex(of: ":") else {
      return nil
    }
    let session = String(raw[..<colonIndex])
    return trimmedNonEmpty(session)
  }

  private func splitSpaceAndTab(_ raw: String) -> (
    raw: String, spaceSelector: String?, tabSelector: String?
  ) {
    let withoutPane: String =
      if let dotIndex = raw.lastIndex(of: ".") {
        String(raw[..<dotIndex])
      } else {
        raw
      }

    if let colonIndex = withoutPane.lastIndex(of: ":") {
      return (
        raw,
        trimmedNonEmpty(String(withoutPane[..<colonIndex])),
        trimmedNonEmpty(String(withoutPane[withoutPane.index(after: colonIndex)...]))
      )
    }

    return (raw, nil, trimmedNonEmpty(withoutPane))
  }

  private func splitTabAndPane(_ raw: String) -> (tabSelector: String?, paneSelector: String?) {
    guard let dotIndex = raw.lastIndex(of: ".") else {
      return (trimmedNonEmpty(raw), nil)
    }
    return (
      trimmedNonEmpty(String(raw[..<dotIndex])),
      trimmedNonEmpty(String(raw[raw.index(after: dotIndex)...]))
    )
  }

  private static func locateSpace(
    id: UUID,
    in snapshot: SupatermAppDebugSnapshot
  ) -> SpaceLocation? {
    for window in snapshot.windows {
      for space in window.spaces where space.id == id {
        return .init(window: window, space: space)
      }
    }
    return nil
  }

  private static func locateTab(
    id: UUID,
    in snapshot: SupatermAppDebugSnapshot
  ) -> TabLocation? {
    for window in snapshot.windows {
      for space in window.spaces {
        for tab in space.flattenedTabs where tab.id == id {
          return .init(window: window, space: space, tab: tab)
        }
      }
    }
    return nil
  }

  private static func locatePane(
    id: UUID,
    in snapshot: SupatermAppDebugSnapshot
  ) -> PaneLocation? {
    for window in snapshot.windows {
      for space in window.spaces {
        for tab in space.flattenedTabs {
          for pane in tab.panes where pane.id == id {
            return .init(window: window, space: space, tab: tab, pane: pane)
          }
        }
      }
    }
    return nil
  }

  private static func firstVisiblePane(
    in snapshot: SupatermAppDebugSnapshot
  ) -> PaneLocation? {
    let orderedWindows =
      snapshot.windows.sorted { lhs, rhs in
        if lhs.isKey != rhs.isKey {
          return lhs.isKey && !rhs.isKey
        }
        if lhs.isVisible != rhs.isVisible {
          return lhs.isVisible && !rhs.isVisible
        }
        return lhs.index < rhs.index
      }

    for window in orderedWindows {
      guard let space = window.spaces.first(where: \.isSelected) ?? window.spaces.first else {
        continue
      }
      let tabs = space.flattenedTabs
      guard let tab = tabs.first(where: \.isSelected) ?? tabs.first else {
        continue
      }
      guard let pane = tab.panes.first(where: \.isFocused) ?? tab.panes.first else {
        continue
      }
      return .init(window: window, space: space, tab: tab, pane: pane)
    }
    return nil
  }
}

struct SPTmuxCompatStore: Codable, Equatable {
  var buffers: [String: String] = [:]
  var hooks: [String: String] = [:]
}

func loadTmuxCompatStore(
  homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
) -> SPTmuxCompatStore {
  let url = tmuxCompatStoreURL(homeDirectoryURL: homeDirectoryURL)
  guard
    let data = try? Data(contentsOf: url),
    let store = try? JSONDecoder().decode(SPTmuxCompatStore.self, from: data)
  else {
    return .init()
  }
  return store
}

func saveTmuxCompatStore(
  _ store: SPTmuxCompatStore,
  homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
) throws {
  let directoryURL = spPrivateDirectory(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
  let data = try JSONEncoder().encode(store)
  try data.write(to: tmuxCompatStoreURL(homeDirectoryURL: homeDirectoryURL), options: .atomic)
}

func tmuxCompatStoreURL(homeDirectoryURL: URL) -> URL {
  spPrivateDirectory(homeDirectoryURL: homeDirectoryURL)
    .appendingPathComponent("tmux-compat-store.json", isDirectory: false)
}

func tmuxWaitForSignalURL(
  name: String,
  homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
) -> URL {
  let encoded = Data(name.utf8)
    .base64EncodedString()
    .replacingOccurrences(of: "/", with: "_")
  return spPrivateDirectory(homeDirectoryURL: homeDirectoryURL)
    .appendingPathComponent("wait-for", isDirectory: true)
    .appendingPathComponent(encoded, isDirectory: false)
}

func spPrivateDirectory(homeDirectoryURL: URL) -> URL {
  homeDirectoryURL
    .appendingPathComponent(".supaterm", isDirectory: true)
    .appendingPathComponent("tmux", isDirectory: true)
}
