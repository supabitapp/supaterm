import AppKit
import Foundation
import SupatermGhosttyFeature
import SupatermSupport
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SupatermTerminalStateFeature

extension TerminalHostState {
  public func updateWindowActivity(_ activity: WindowActivityState) {
    let selectedTabID = selectedTabID
    let focusedSurfaceID = selectedTabID.flatMap { focusHistoryByTab[$0]?.current }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.windowActivity.update",
      fields: [
        "isKeyWindow=\(activity.isKeyWindow)",
        "isVisible=\(activity.isVisible)",
        "selectedSpaceID=\(SupatermLog.uuid(selectedSpaceID?.rawValue))",
        "selectedTabID=\(SupatermLog.uuid(selectedTabID?.rawValue))",
        "focusedSurfaceID=\(SupatermLog.uuid(focusedSurfaceID))",
      ]
    )
    windowActivity = activity
    syncFocus(activity)
    clearUnreadOnFocusedSurfaceIfNeeded()
  }

  func syncFocus(_ activity: WindowActivityState) {
    let selectedTabID = spaceManager.selectedTabID
    var surfaceToFocus: GhosttySurfaceView?

    for (tabID, tree) in trees {
      let focusedSurfaceID = focusHistoryByTab[tabID]?.current
      let isSelectedTab = tabID == selectedTabID
      for surface in tree.leaves() {
        let activity = Self.surfaceActivity(
          isSelectedTab: isSelectedTab,
          windowIsVisible: activity.isVisible,
          windowIsKey: activity.isKeyWindow,
          focusedSurfaceID: focusedSurfaceID,
          surfaceID: surface.id
        )
        surface.setOcclusion(activity.isVisible)
        surface.focusDidChange(activity.isFocused)
        if activity.isFocused {
          surfaceToFocus = surface
        }
      }
    }

    if let surfaceToFocus,
      let window = surfaceToFocus.window,
      Self.shouldRestoreSurfaceFirstResponder(window.firstResponder, to: surfaceToFocus)
    {
      window.makeFirstResponder(surfaceToFocus)
    }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.focus.sync",
      fields: [
        "isKeyWindow=\(activity.isKeyWindow)",
        "isVisible=\(activity.isVisible)",
        "selectedTabID=\(SupatermLog.uuid(selectedTabID?.rawValue))",
        "focusedSurfaceID=\(SupatermLog.uuid(surfaceToFocus?.id))",
      ]
    )
  }

  static func shouldRestoreSurfaceFirstResponder(
    _ responder: NSResponder?,
    to surface: GhosttySurfaceView
  ) -> Bool {
    guard let responder else { return true }
    if responder === surface { return true }
    if responder is GhosttySurfaceView { return true }
    if responder is NSText { return false }
    if responder is NSControl { return false }
    guard let view = responder as? NSView else { return false }
    return view.window === surface.window
  }

  static func surfaceActivity(
    isSelectedTab: Bool,
    windowIsVisible: Bool,
    windowIsKey: Bool,
    focusedSurfaceID: UUID?,
    surfaceID: UUID
  ) -> SurfaceActivity {
    let isVisible = isSelectedTab && windowIsVisible
    let isFocused = isVisible && windowIsKey && focusedSurfaceID == surfaceID
    return SurfaceActivity(isVisible: isVisible, isFocused: isFocused)
  }

  func focusSurface(in tabID: TerminalTabID) {
    restorePinnedTabSessionIfNeeded(for: tabID)
    if let unreadSurfaceID = latestUnreadNotifiedSurfaceID(in: tabID),
      let surface = surfaces[unreadSurfaceID]
    {
      focusSurface(surface, in: tabID)
      return
    }
    if let focusedSurfaceID = focusHistoryByTab[tabID]?.current, let surface = surfaces[focusedSurfaceID] {
      focusSurface(surface, in: tabID)
      return
    }
    let tree = splitTree(for: tabID)
    if let surface = tree.root?.leftmostLeaf() {
      focusSurface(surface, in: tabID)
    }
  }

  func applyFocusedSurface(
    _ surfaceID: UUID,
    in tabID: TerminalTabID
  ) {
    focusHistoryByTab[tabID, default: FocusHistory(current: surfaceID)].updateCurrent(surfaceID)
  }

  func focusSurface(_ surface: GhosttySurfaceView, in tabID: TerminalTabID) {
    let previousSurface = focusHistoryByTab[tabID].flatMap { surfaces[$0.current] }
    applyFocusedSurface(surface.id, in: tabID)
    updateTabTitle(for: tabID)
    clearNotificationAttention(for: surface.id)
    guard tabID == spaceManager.selectedTabID else { return }
    let fromSurface = previousSurface === surface ? nil : previousSurface
    GhosttySurfaceView.moveFocus(to: surface, from: fromSurface)
    emitFocusChangedIfNeeded(surface.id)
  }

  static func selectedTabID(
    afterCreatingTabIn targetSpaceID: TerminalSpaceID,
    targetTabID: TerminalTabID,
    focusRequested: Bool,
    currentSelectedSpaceID: TerminalSpaceID?,
    currentSelectedTabID: TerminalTabID?
  ) -> TerminalTabID {
    guard !focusRequested else { return targetTabID }
    guard currentSelectedSpaceID == targetSpaceID, let currentSelectedTabID else {
      return targetTabID
    }
    return currentSelectedTabID
  }

  static func shouldSyncFocusDuringTabCreation(
    targetSpaceID: TerminalSpaceID,
    focusRequested: Bool,
    currentSelectedSpaceID: TerminalSpaceID?
  ) -> Bool {
    focusRequested || currentSelectedSpaceID != targetSpaceID
  }

  static func selectedTabID(
    afterCreatingPaneIn targetTabID: TerminalTabID,
    focusRequested: Bool,
    currentSelectedTabID: TerminalTabID?
  ) -> TerminalTabID? {
    guard focusRequested else { return currentSelectedTabID }
    return targetTabID
  }

  static func newPaneSelectionState(
    selectedTabID: TerminalTabID?,
    targetTabID: TerminalTabID,
    windowActivity: WindowActivityState,
    focusedSurfaceID: UUID?,
    surfaceID: UUID
  ) -> NewPaneSelectionState {
    let isSelectedTab = targetTabID == selectedTabID
    let activity = surfaceActivity(
      isSelectedTab: isSelectedTab,
      windowIsVisible: windowActivity.isVisible,
      windowIsKey: windowActivity.isKeyWindow,
      focusedSurfaceID: focusedSurfaceID,
      surfaceID: surfaceID
    )
    return NewPaneSelectionState(isFocused: activity.isFocused, isSelectedTab: isSelectedTab)
  }

  static func newTabSelectionState(_ input: NewTabSelectionInput) -> NewTabSelectionState {
    let isSelectedSpace = input.targetSpaceID == input.selectedSpaceID
    let isSelectedTab = isSelectedSpace && input.targetTabID == input.selectedTabID
    let activity = surfaceActivity(
      isSelectedTab: isSelectedTab,
      windowIsVisible: input.windowActivity.isVisible,
      windowIsKey: input.windowActivity.isKeyWindow,
      focusedSurfaceID: input.focusedSurfaceID,
      surfaceID: input.surfaceID
    )
    return NewTabSelectionState(
      isFocused: activity.isFocused,
      isSelectedSpace: isSelectedSpace,
      isSelectedTab: isSelectedTab
    )
  }

  func emitFocusChangedIfNeeded(_ surfaceID: UUID) {
    guard surfaceID != lastEmittedFocusSurfaceID else { return }
    lastEmittedFocusSurfaceID = surfaceID
  }
}
