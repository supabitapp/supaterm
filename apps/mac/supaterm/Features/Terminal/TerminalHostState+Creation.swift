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
  func ensureInitialTab(
    focusing: Bool,
    startupCommand: SupatermTerminalStartup? = nil,
    workingDirectoryPath: String? = nil,
    reason: LicenseTabGate.CreationReason = .user
  ) {
    guard tabs.isEmpty else { return }
    _ = createTab(
      reason: reason,
      focusing: focusing,
      startupCommand: startupCommand,
      workingDirectoryPath: workingDirectoryPath
    )
  }

  func ensureRestoredTab(in spaceID: TerminalSpaceID) {
    guard spaceManager.tabs(in: spaceID).isEmpty else { return }
    _ = try? createTab(
      in: spaceID,
      reason: .restore,
      focusing: false,
      sessionChangesEnabled: false,
      synchronizesFocus: false
    )
  }

  func dismissLicenseTabLimitRefusal() {
    showsLicenseTabLimitRefusal = false
  }

  func performLicenseTabLimitAction(_ action: LicenseTabLimitAction) {
    dismissLicenseTabLimitRefusal()
    onLicenseTabLimitAction(action)
  }

  @discardableResult
  func createTab(
    reason: LicenseTabGate.CreationReason = .user,
    focusing: Bool = true,
    startupCommand: SupatermTerminalStartup? = nil,
    workingDirectoryPath: String? = nil,
    inheritingFromSurfaceID: UUID? = nil,
    at placement: TerminalTabPlacement? = nil,
    sessionChangesEnabled: Bool = true
  ) -> TerminalTabID? {
    let target = resolveLocalCreateTabTarget(inheritingFromSurfaceID: inheritingFromSurfaceID)
    return try? createTab(
      in: target.spaceID,
      reason: reason,
      focusing: focusing,
      startupCommand: startupCommand,
      workingDirectory: workingDirectoryPath.map { URL(fileURLWithPath: $0, isDirectory: true) },
      inheritingFromSurfaceID: target.inheritedSurfaceID,
      at: placement,
      sessionChangesEnabled: sessionChangesEnabled
    )
  }

  @discardableResult
  func createTab(
    in spaceID: TerminalSpaceID,
    reason: LicenseTabGate.CreationReason,
    focusing: Bool = true,
    startupCommand: SupatermTerminalStartup? = nil,
    workingDirectory: URL? = nil,
    inheritingFromSurfaceID: UUID? = nil,
    at placement: TerminalTabPlacement? = nil,
    sessionChangesEnabled: Bool = true,
    synchronizesFocus: Bool = true
  ) throws -> TerminalTabID? {
    warmInstance(for: spaceID)
    if let refusal = licenseTabGate.refusal(
      for: reason,
      openTabs: licenseOpenTabCount()
    ) {
      showsLicenseTabLimitRefusal = true
      throw TerminalCreateTabError.tabLimitReached(
        limit: refusal.limit,
        openTabs: refusal.openTabs
      )
    }
    if reason == .user {
      showsLicenseTabLimitRefusal = false
    }
    guard let tabCollection = spaceManager.tabCollection(for: spaceID) else { return nil }
    let context: ghostty_surface_context_e =
      tabCollection.tabs.isEmpty
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let resolvedPlacement =
      placement
      ?? defaultTabPlacement(
        in: tabCollection,
        inheritingFromSurfaceID: inheritingFromSurfaceID
      )
    guard
      let tabID = tabCollection.createTab(
        title: "Terminal \(nextTabIndex(in: spaceID))",
        at: resolvedPlacement
      )
    else {
      return nil
    }
    if focusing, case .group(let groupID, _) = resolvedPlacement {
      spaceManager.instance(for: spaceID)?.collapsedTabGroupIDs.remove(groupID)
    }
    let tree = splitTree(
      for: tabID,
      inheritingFromSurfaceID: inheritingFromSurfaceID,
      startupCommand: startupCommand,
      workingDirectory: workingDirectory,
      context: context
    )
    updateRunningState(for: tabID)
    updateTabTitle(for: tabID)
    if focusing, let surface = tree.root?.leftmostLeaf() {
      focusSurface(surface, in: tabID)
    }
    if synchronizesFocus {
      syncFocus(windowActivity)
    }
    if sessionChangesEnabled {
      sessionDidChange()
    }
    return tabID
  }

  func createTabInSpace(_ spaceID: TerminalSpaceID) {
    _ = try? createTab(in: spaceID, reason: .user)
    selectSpace(spaceID)
  }

  @discardableResult
  func createTab(
    in groupID: TerminalTabGroupID,
    focusing: Bool = true,
    inheritingFromSurfaceID: UUID? = nil
  ) -> TerminalTabID? {
    guard
      let instance = spaceManager.instance(for: groupID),
      let group = instance.tabCollection.group(for: groupID)
    else {
      return nil
    }
    return try? createTab(
      in: instance.spaceID,
      reason: .user,
      focusing: focusing,
      inheritingFromSurfaceID: inheritingFromSurfaceID,
      at: .group(groupID, index: group.tabs.count)
    )
  }

  func defaultTabPlacement(
    in tabCollection: TerminalTabCollection,
    inheritingFromSurfaceID: UUID?
  ) -> TerminalTabPlacement {
    if let inheritingFromSurfaceID,
      let anchorTabID = tabID(containing: inheritingFromSurfaceID)
    {
      if let isPinned = tabCollection.isPinned(anchorTabID) {
        return .root(
          TerminalRootPlacement(
            isPinned: isPinned,
            index: isPinned ? tabCollection.pinnedRootItems.count : tabCollection.regularRootItems.count
          )
        )
      }
    }
    return .root(
      TerminalRootPlacement(isPinned: false, index: tabCollection.regularRootItems.count)
    )
  }

  func createSurface(
    tabID: TerminalTabID,
    startupCommand: SupatermTerminalStartup?,
    inheritingFromSurfaceID: UUID?,
    workingDirectory: URL? = nil,
    context: ghostty_surface_context_e,
    surfaceID: UUID = UUID(),
    restoreMode: TerminalPaneRestoreMode? = nil,
    zmxAttachMode: ZmxAttach.Mode = .createIfNeeded
  ) -> GhosttySurfaceView {
    guard let runtime else {
      preconditionFailure("TerminalHostState cannot create surfaces without a GhosttyRuntime")
    }
    let inherited = inheritedSurfaceConfig(fromSurfaceID: inheritingFromSurfaceID, context: context)
    let commandWrapper = resolvedCommandWrapper(surfaceID: surfaceID, mode: zmxAttachMode)
    let usesZmx = !commandWrapper.isEmpty
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.surface.create",
      fields: [
        "surfaceID=\(surfaceID.uuidString.lowercased())",
        "tabID=\(tabID.rawValue.uuidString.lowercased())",
        "context=\(Self.surfaceContextLabel(context))",
        "zmxSessionsEnabled=\(zmxSessionsEnabled)",
        "hasStartupCommand=\(startupCommand != nil)",
        "hasCommandWrapper=\(!commandWrapper.isEmpty)",
        "usesZmx=\(usesZmx)",
      ]
    )
    let view = GhosttySurfaceView(
      id: surfaceID,
      runtime: runtime,
      tabID: tabID.rawValue,
      workingDirectory: workingDirectory ?? inherited.workingDirectory,
      startupCommand: startupCommand,
      restoreMode: restoreMode,
      commandWrapper: commandWrapper,
      fontSize: inherited.fontSize,
      context: context,
      managesWindowAppearance: false,
      zmxSessionsEnabled: usesZmx
    )
    configureBridgeCallbacks(for: view, tabID: tabID)
    configureSurfaceCallbacks(for: view, tabID: tabID)
    surfaces[view.id] = view
    agentDetectionController?.surfaceDidAttach(view.id)
    return view
  }

  func resolvedCommandWrapper(
    surfaceID: UUID,
    mode: ZmxAttach.Mode
  ) -> [String] {
    let sessionID = ZmxSessionID.make(surfaceID: surfaceID)
    guard zmxSessionsEnabled else {
      SupatermLog.debug(
        SupatermLog.zmx,
        "zmx.attach.skipped",
        fields: [
          "surfaceID=\(surfaceID.uuidString.lowercased())",
          "sessionID=\(sessionID)",
          "reason=disabled",
        ]
      )
      return []
    }
    guard let executable = zmxClient.executableURL() else {
      SupatermLog.error(
        SupatermLog.zmx,
        "zmx.attach.fallback",
        fields: [
          "surfaceID=\(surfaceID.uuidString.lowercased())",
          "sessionID=\(sessionID)",
        ]
      )
      return []
    }
    let commandWrapper = ZmxAttach.buildWrapperArgv(
      executablePath: executable.path(percentEncoded: false),
      sessionID: sessionID,
      mode: mode
    )
    SupatermLog.debug(
      SupatermLog.zmx,
      "zmx.attach.resolved",
      fields: [
        "surfaceID=\(surfaceID.uuidString.lowercased())",
        "sessionID=\(sessionID)",
      ]
    )
    return commandWrapper
  }

  func inheritedSurfaceConfig(
    fromSurfaceID surfaceID: UUID?,
    context: ghostty_surface_context_e
  ) -> InheritedSurfaceConfig {
    guard let surfaceID, let view = surfaces[surfaceID], let sourceSurface = view.surface else {
      return InheritedSurfaceConfig(workingDirectory: nil, fontSize: nil)
    }

    var inherited = ghostty_surface_inherited_config(sourceSurface, context)
    defer { ghostty_surface_inherited_config_free(sourceSurface, &inherited) }
    let fontSize = inherited.font_size == 0 ? nil : inherited.font_size
    let inheritedWorkingDirectory = inherited.working_directory.flatMap { ptr -> URL? in
      let path = String(cString: ptr)
      guard !path.isEmpty else { return nil }
      return URL(fileURLWithPath: path, isDirectory: true)
    }
    let workingDirectory =
      agentPanelPresentation(for: surfaceID)?.workingDirectoryPath.map {
        URL(fileURLWithPath: $0, isDirectory: true)
      } ?? inheritedWorkingDirectory

    return InheritedSurfaceConfig(
      workingDirectory: workingDirectory,
      fontSize: fontSize
    )
  }

  func currentFocusedSurfaceID() -> UUID? {
    guard let selectedTabID else { return nil }
    return focusHistoryByTab[selectedTabID]?.current
  }

  func inheritedSurfaceID(in spaceID: TerminalSpaceID) -> UUID? {
    if let selectedTabID = spaceManager.selectedTabID(in: spaceID) {
      if let focusedSurfaceID = focusHistoryByTab[selectedTabID]?.current,
        surfaces[focusedSurfaceID] != nil
      {
        return focusedSurfaceID
      }
      if let surfaceID = trees[selectedTabID]?.root?.leftmostLeaf().id {
        return surfaceID
      }
    }

    for tab in spaceManager.tabs(in: spaceID) {
      if let focusedSurfaceID = focusHistoryByTab[tab.id]?.current, surfaces[focusedSurfaceID] != nil {
        return focusedSurfaceID
      }
      if let surfaceID = trees[tab.id]?.root?.leftmostLeaf().id {
        return surfaceID
      }
    }

    return nil
  }

  func resolveCreateTabTarget(
    _ target: TerminalCreateTabRequest.Target
  ) throws -> ResolvedCreateTabTarget {
    switch target {
    case .pane(let paneID):
      warmInstance(containingSurface: paneID)
      guard
        let tabID = tabID(containing: paneID),
        let space = spaceManager.space(for: tabID)
      else {
        throw TerminalCreateTabError.contextPaneNotFound
      }

      return ResolvedCreateTabTarget(
        inheritedSurfaceID: paneID,
        placement: nil,
        space: space
      )

    case .space(let rawSpaceID):
      let spaceID = TerminalSpaceID(rawValue: rawSpaceID)
      guard let space = space(warming: spaceID) else {
        throw TerminalCreateTabError.contextPaneNotFound
      }
      return ResolvedCreateTabTarget(
        inheritedSurfaceID: inheritedSurfaceID(in: space.id),
        placement: nil,
        space: space
      )

    case .root(let rawSpaceID):
      let spaceID = TerminalSpaceID(rawValue: rawSpaceID)
      guard
        let space = space(warming: spaceID),
        let manager = spaceManager.tabCollection(for: spaceID)
      else {
        throw TerminalCreateTabError.contextPaneNotFound
      }
      return ResolvedCreateTabTarget(
        inheritedSurfaceID: inheritedSurfaceID(in: spaceID),
        placement: .root(
          TerminalRootPlacement(isPinned: false, index: manager.regularRootItems.count)
        ),
        space: space
      )

    case .group(let rawGroupID):
      let groupID = TerminalTabGroupID(rawValue: rawGroupID)
      warmInstance(containingGroup: groupID)
      guard
        let instance = spaceManager.instance(for: groupID),
        let space = spaceManager.space(for: instance.spaceID),
        let group = instance.tabCollection.group(for: groupID)
      else {
        throw TerminalCreateTabError.contextPaneNotFound
      }
      return ResolvedCreateTabTarget(
        inheritedSurfaceID: inheritedSurfaceID(in: space.id),
        placement: .group(groupID, index: group.tabs.count),
        space: space
      )
    }
  }

  func resolveLocalCreateTabTarget(
    inheritingFromSurfaceID: UUID?
  ) -> ResolvedLocalCreateTabTarget {
    if let inheritingFromSurfaceID,
      let anchorTabID = tabID(containing: inheritingFromSurfaceID),
      let instance = spaceManager.instance(for: anchorTabID)
    {
      return ResolvedLocalCreateTabTarget(
        inheritedSurfaceID: inheritingFromSurfaceID,
        spaceID: instance.spaceID
      )
    }

    return ResolvedLocalCreateTabTarget(
      inheritedSurfaceID: inheritingFromSurfaceID ?? currentFocusedSurfaceID(),
      spaceID: displayedSpaceID
    )
  }

  func resolveCreatePaneTarget(
    _ target: TerminalCreatePaneRequest.Target
  ) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .pane(let paneID):
      warmInstance(containingSurface: paneID)
      guard
        let tabID = tabID(containing: paneID),
        let instance = spaceManager.instance(for: tabID),
        let tree = trees[tabID],
        let anchorSurface = surfaces[paneID]
      else {
        throw TerminalCreatePaneError.contextPaneNotFound
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: anchorSurface,
        spaceID: instance.spaceID,
        tabID: tabID,
        tree: tree
      )

    case .tab(let rawTabID):
      let tabID = TerminalTabID(rawValue: rawTabID)
      warmInstance(containingTab: tabID)
      guard
        let instance = spaceManager.instance(for: tabID),
        let tree = trees[tabID]
      else {
        throw TerminalCreatePaneError.contextPaneNotFound
      }
      let anchorSurface =
        focusHistoryByTab[tabID].flatMap { surfaces[$0.current] }
        ?? tree.root?.leftmostLeaf()
      guard let anchorSurface else {
        throw TerminalCreatePaneError.creationFailed
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: anchorSurface,
        spaceID: instance.spaceID,
        tabID: tabID,
        tree: tree
      )
    }
  }

  func nextTabIndex(in spaceID: TerminalSpaceID) -> Int {
    var maxIndex = 0
    for tab in spaceManager.tabs(in: spaceID) {
      guard tab.title.hasPrefix("Terminal ") else { continue }
      let suffix = tab.title.dropFirst("Terminal ".count)
      guard let value = Int(suffix) else { continue }
      maxIndex = max(maxIndex, value)
    }
    return maxIndex + 1
  }
}
