import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore
import SwiftUI

extension TerminalHostState {
  func restorationSnapshot() -> TerminalWindowSession {
    let spaces = spaces.map { space in
      let tabSnapshots = spaceManager.tabs(in: space.id).compactMap {
        tab -> (TerminalTabID, TerminalTabSession)? in
        guard !tab.isPinned else { return nil }
        guard let session = restorationTabSession(for: tab) else { return nil }
        return (tab.id, session)
      }
      let tabs = tabSnapshots.map(\.1)
      let selectedTabIndex =
        spaceManager.selectedTabID(in: space.id).flatMap { selectedTabID in
          tabSnapshots.firstIndex { $0.0 == selectedTabID }
        }
        ?? (tabs.isEmpty ? nil : 0)
      return TerminalWindowSpaceSession(
        id: space.id,
        selectedTabIndex: selectedTabIndex,
        tabs: tabs
      )
    }

    let resolvedSelectedSpaceID =
      self.selectedSpaceID.flatMap { selectedSpaceID in
        spaces.contains(where: { $0.id == selectedSpaceID }) ? selectedSpaceID : nil
      }
      ?? spaces.first?.id
      ?? spaceCatalog.defaultSelectedSpaceID

    return TerminalWindowSession(
      selectedSpaceID: resolvedSelectedSpaceID,
      spaces: spaces
    )
  }

  @discardableResult
  func restore(from session: TerminalWindowSession) -> Bool {
    guard managesTerminalSurfaces else { return false }
    let validSpaceIDs = Set(spaces.map(\.id))
    guard let session = session.pruned(validSpaceIDs: validSpaceIDs) else { return false }

    return withSessionChangesSuppressed {
      clearSessionState()

      let sessionsBySpaceID = Dictionary(
        uniqueKeysWithValues: session.spaces.map { ($0.id, $0) }
      )
      var restoredTabsBySpaceID: [TerminalSpaceID: [(sourceIndex: Int, id: TerminalTabID)]] = [:]

      for space in spaces {
        let restoredTabs: [(sourceIndex: Int, tab: TerminalTabItem)] =
          sessionsBySpaceID[space.id]?.tabs.enumerated().compactMap { sourceIndex, session in
            guard !session.isPinned else { return nil }
            return (
              sourceIndex,
              restoredTabItem(
                for: session,
                id: TerminalTabID(),
                at: sourceIndex
              )
            )
          } ?? []
        restoredTabsBySpaceID[space.id] = restoredTabs.map { ($0.sourceIndex, $0.tab.id) }
        let selectedTabID =
          sessionsBySpaceID[space.id]?.selectedTabIndex.flatMap { index in
            restoredTabs.first(where: { $0.sourceIndex == index })?.tab.id
          }
        _ = spaceManager.restoreTabs(
          restoredTabs.map(\.tab),
          selectedTabID: selectedTabID,
          in: space.id
        )
      }

      reconcilePinnedTabs(with: pinnedTabCatalog)

      for spaceSession in session.spaces {
        let restoredTabs = Dictionary(
          uniqueKeysWithValues: (restoredTabsBySpaceID[spaceSession.id] ?? []).map { ($0.sourceIndex, $0.id) }
        )
        for (index, tabSession) in spaceSession.tabs.enumerated() {
          guard !tabSession.isPinned else { continue }
          guard let tabID = restoredTabs[index] else { continue }
          restoreTabSession(
            tabSession,
            tabID: tabID,
            in: spaceSession.id
          )
        }
      }

      guard spaces.contains(where: { !spaceManager.tabs(in: $0.id).isEmpty }) else {
        clearSessionState()
        return false
      }

      let selectedSpaceID =
        spaces.contains(where: { $0.id == session.selectedSpaceID })
        ? session.selectedSpaceID
        : spaces.first?.id
      guard let selectedSpaceID, applySelectedSpace(selectedSpaceID) else {
        clearSessionState()
        return false
      }

      if spaceManager.tabs(in: selectedSpaceID).isEmpty {
        _ = createTab(
          in: selectedSpaceID,
          focusing: false,
          sessionChangesEnabled: false,
          synchronizesFocus: false
        )
      }

      if let selectedTabID {
        focusSurface(in: selectedTabID)
      } else {
        lastEmittedFocusSurfaceID = nil
      }
      syncFocus(windowActivity)
      return true
    }
  }

  func restorationTabSession(for tab: TerminalTabItem) -> TerminalTabSession? {
    guard let tree = trees[tab.id], let root = tree.root.map(restorationNode(for:)) else {
      return nil
    }
    let focusedPaneIndex =
      focusedSurfaceIDByTab[tab.id].flatMap { focusedPaneID in
        tree.leaves().firstIndex(where: { $0.id == focusedPaneID })
      }
      ?? 0
    return TerminalTabSession(
      isPinned: tab.isPinned,
      lockedTitle: lockedTabTitle(for: tab.id),
      focusedPaneIndex: focusedPaneIndex,
      root: root
    )
  }

  func restorationNode(
    for node: SplitTree<GhosttySurfaceView>.Node
  ) -> TerminalPaneNodeSession {
    switch node {
    case .leaf(let surface):
      return .leaf(
        TerminalPaneLeafSession(
          workingDirectoryPath: workingDirectoryPath(for: surface),
          titleOverride: surface.bridge.state.titleOverride
        )
      )
    case .split(let split):
      return .split(
        TerminalPaneSplitSession(
          direction: mapSessionSplitDirection(split.direction),
          ratio: split.ratio,
          left: restorationNode(for: split.left),
          right: restorationNode(for: split.right)
        )
      )
    }
  }

  func restoredTabItem(
    for session: TerminalTabSession,
    id: TerminalTabID = TerminalTabID(),
    at index: Int
  ) -> TerminalTabItem {
    TerminalTabItem(
      id: id,
      title: session.lockedTitle ?? restoredTabTitle(at: index),
      icon: "terminal",
      isPinned: session.isPinned,
      isTitleLocked: session.lockedTitle != nil
    )
  }

  func restoredTabTitle(at index: Int) -> String {
    index == 0 ? "Terminal" : "Terminal \(index + 1)"
  }

  func restoreTabSession(
    _ session: TerminalTabSession,
    tabID: TerminalTabID,
    in spaceID: TerminalSpaceID
  ) {
    let context: ghostty_surface_context_e =
      spaceManager.tabs(in: spaceID).first?.id == tabID
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let restoredRoot = restoreNode(
      session.root,
      in: tabID,
      context: context
    )
    trees[tabID] = SplitTree(root: restoredRoot, zoomed: nil)
    let leaves = restoredRoot.leaves()
    let focusedPaneIndex =
      leaves.indices.contains(session.focusedPaneIndex)
      ? session.focusedPaneIndex
      : 0
    applyFocusedSurface(leaves[focusedPaneIndex].id, in: tabID)
    updateRunningState(for: tabID)
    updateTabTitle(for: tabID)
  }

  func restoreNode(
    _ node: TerminalPaneNodeSession,
    in tabID: TerminalTabID,
    context: ghostty_surface_context_e
  ) -> SplitTree<GhosttySurfaceView>.Node {
    switch node {
    case .leaf(let leaf):
      let surface = createSurface(
        tabID: tabID,
        initialInput: nil,
        inheritingFromSurfaceID: nil,
        workingDirectory: existingWorkingDirectoryURL(for: leaf.workingDirectoryPath),
        context: context
      )
      surface.bridge.state.titleOverride = leaf.titleOverride
      return .leaf(view: surface)

    case .split(let split):
      let left = restoreNode(split.left, in: tabID, context: GHOSTTY_SURFACE_CONTEXT_SPLIT)
      let right = restoreNode(split.right, in: tabID, context: GHOSTTY_SURFACE_CONTEXT_SPLIT)
      return .split(
        .init(
          direction: mapSplitDirection(split.direction),
          ratio: split.ratio,
          left: left,
          right: right
        )
      )
    }
  }

  func clearSessionState() {
    let existingTabIDs = spaces.flatMap { spaceManager.tabs(in: $0.id).map(\.id) }
    removeTrees(for: existingTabIDs)
    for space in spaces {
      _ = spaceManager.restoreTabs([], selectedTabID: nil, in: space.id)
    }
    previousFocusedSurfaceIDByTab.removeAll()
    previousSelectedTabIDBySpace.removeAll()
    previousSelectedSpaceID = nil
    lastEmittedFocusSurfaceID = nil
  }

  func sessionDidChange() {
    guard suppressesSessionChanges == 0 else { return }
    onSessionChange()
  }

  func withSessionChangesSuppressed<Result>(
    _ body: () -> Result
  ) -> Result {
    suppressesSessionChanges += 1
    defer {
      suppressesSessionChanges -= 1
    }
    return body()
  }

  func workingDirectoryPath(for surface: GhosttySurfaceView) -> String? {
    guard let path = Self.trimmedNonEmpty(surface.bridge.state.pwd) else { return nil }
    return GhosttySurfaceView.normalizedWorkingDirectoryPath(path)
  }

  func existingWorkingDirectoryURL(for path: String?) -> URL? {
    guard let path = Self.trimmedNonEmpty(path) else { return nil }
    let normalizedPath = GhosttySurfaceView.normalizedWorkingDirectoryPath(path)
    var isDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: normalizedPath, isDirectory: &isDirectory) else {
      return nil
    }
    guard isDirectory.boolValue else { return nil }
    return URL(fileURLWithPath: normalizedPath, isDirectory: true)
  }
}
