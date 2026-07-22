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
    startupCommand: String? = nil,
    workingDirectoryPath: String? = nil
  ) {
    guard tabs.isEmpty else { return }
    _ = createTab(
      focusing: focusing,
      startupCommand: startupCommand,
      workingDirectoryPath: workingDirectoryPath
    )
  }

  @discardableResult
  func createTab(
    focusing: Bool = true,
    startupCommand: String? = nil,
    workingDirectoryPath: String? = nil,
    inheritingFromSurfaceID: UUID? = nil,
    at placement: TerminalTabPlacement? = nil,
    sessionChangesEnabled: Bool = true
  ) -> TerminalTabID? {
    guard let target = resolveLocalCreateTabTarget(inheritingFromSurfaceID: inheritingFromSurfaceID)
    else {
      return nil
    }
    return createTab(
      in: target.spaceID,
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
    focusing: Bool = true,
    startupCommand: String? = nil,
    workingDirectory: URL? = nil,
    inheritingFromSurfaceID: UUID? = nil,
    at placement: TerminalTabPlacement? = nil,
    sessionChangesEnabled: Bool = true,
    synchronizesFocus: Bool = true
  ) -> TerminalTabID? {
    guard let tabManager = spaceManager.tabManager(for: spaceID) else { return nil }
    let context: ghostty_surface_context_e =
      tabManager.tabs.isEmpty
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let resolvedPlacement =
      placement
      ?? defaultTabPlacement(
        in: tabManager,
        inheritingFromSurfaceID: inheritingFromSurfaceID
      )
    guard
      let tabID = tabManager.createTab(
        title: "Terminal \(nextTabIndex(in: spaceID))",
        at: resolvedPlacement
      )
    else {
      return nil
    }
    if focusing, case .group(let groupID, _) = resolvedPlacement {
      collapsedTabGroupIDsBySpace[spaceID]?.remove(groupID)
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

  @discardableResult
  func createTab(
    in groupID: TerminalTabGroupID,
    focusing: Bool = true,
    inheritingFromSurfaceID: UUID? = nil
  ) -> TerminalTabID? {
    guard
      let space = spaceManager.space(for: groupID),
      let tabManager = spaceManager.tabManager(for: space.id),
      let group = tabManager.group(for: groupID)
    else {
      return nil
    }
    return createTab(
      in: space.id,
      focusing: focusing,
      inheritingFromSurfaceID: inheritingFromSurfaceID,
      at: .group(groupID, index: group.tabs.count)
    )
  }

  func defaultTabPlacement(
    in tabManager: TerminalTabManager,
    inheritingFromSurfaceID: UUID?
  ) -> TerminalTabPlacement {
    if let inheritingFromSurfaceID,
      let anchorTabID = tabID(containing: inheritingFromSurfaceID)
    {
      if let isPinned = tabManager.isPinned(anchorTabID) {
        return .root(
          TerminalRootPlacement(
            isPinned: isPinned,
            index: isPinned ? tabManager.pinnedRootItems.count : tabManager.regularRootItems.count
          )
        )
      }
    }
    return .root(
      TerminalRootPlacement(isPinned: false, index: tabManager.regularRootItems.count)
    )
  }

  func createSurface(
    tabID: TerminalTabID,
    startupCommand: String?,
    inheritingFromSurfaceID: UUID?,
    workingDirectory: URL? = nil,
    context: ghostty_surface_context_e,
    surfaceID: UUID = UUID()
  ) -> GhosttySurfaceView {
    guard let runtime else {
      preconditionFailure("TerminalHostState cannot create surfaces without a GhosttyRuntime")
    }
    let inherited = inheritedSurfaceConfig(fromSurfaceID: inheritingFromSurfaceID, context: context)
    let launchCommand = resolvedSurfaceCommand(
      startupCommand: startupCommand,
      surfaceID: surfaceID
    )
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.surface.create",
      fields: [
        "surfaceID=\(surfaceID.uuidString.lowercased())",
        "tabID=\(tabID.rawValue.uuidString.lowercased())",
        "context=\(Self.surfaceContextLabel(context))",
        "zmxSessionsEnabled=\(zmxSessionsEnabled)",
        "hasStartupCommand=\(startupCommand?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)",
        "hasResolvedCommand=\(launchCommand.command != nil)",
        "hasCommandWrapper=\(!launchCommand.commandWrapper.isEmpty)",
        "usesZmx=\(launchCommand.usesZmx)",
      ]
    )
    let view = GhosttySurfaceView(
      id: surfaceID,
      runtime: runtime,
      tabID: tabID.rawValue,
      workingDirectory: workingDirectory ?? inherited.workingDirectory,
      command: launchCommand.command,
      commandWrapper: launchCommand.commandWrapper,
      fontSize: inherited.fontSize,
      context: context,
      managesWindowAppearance: false,
      zmxSessionsEnabled: launchCommand.usesZmx
    )
    configureBridgeCallbacks(for: view, tabID: tabID)
    configureSurfaceCallbacks(for: view, tabID: tabID)
    surfaces[view.id] = view
    return view
  }

  func resolvedSurfaceCommand(
    startupCommand: String?,
    surfaceID: UUID
  ) -> SurfaceLaunchCommand {
    let command = startupCommand.map { SupatermShellCommand.ghosttyStartupCommand(for: $0) }
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
      return SurfaceLaunchCommand(command: command, commandWrapper: [], usesZmx: false)
    }
    guard let executable = zmxClient.executableURL() else {
      SupatermLog.error(
        SupatermLog.zmx,
        "zmx.attach.fallback",
        fields: [
          "surfaceID=\(surfaceID.uuidString.lowercased())",
          "sessionID=\(sessionID)",
          "hasStartupCommand=\(command != nil)",
        ]
      )
      return SurfaceLaunchCommand(command: command, commandWrapper: [], usesZmx: false)
    }
    let zmxCommand = startupCommand.map { SupatermShellCommand.ghosttyStartupCommand(for: $0) }
    let launch = ZmxAttach.resolveLaunch(
      executablePath: executable.path(percentEncoded: false),
      sessionID: sessionID,
      command: zmxCommand
    )
    SupatermLog.debug(
      SupatermLog.zmx,
      "zmx.attach.resolved",
      fields: [
        "surfaceID=\(surfaceID.uuidString.lowercased())",
        "sessionID=\(sessionID)",
        "hasStartupCommand=\(launch.command != nil)",
        "hasCommandWrapper=\(!launch.commandWrapper.isEmpty)",
      ]
    )
    return SurfaceLaunchCommand(
      command: launch.command,
      commandWrapper: launch.commandWrapper,
      usesZmx: true
    )
  }

  func inheritedSurfaceConfig(
    fromSurfaceID surfaceID: UUID?,
    context: ghostty_surface_context_e
  ) -> InheritedSurfaceConfig {
    guard let surfaceID, let view = surfaces[surfaceID], let sourceSurface = view.surface else {
      return InheritedSurfaceConfig(workingDirectory: nil, fontSize: nil)
    }

    let inherited = ghostty_surface_inherited_config(sourceSurface, context)
    let fontSize = inherited.font_size == 0 ? nil : inherited.font_size
    let workingDirectory = inherited.working_directory.flatMap { ptr -> URL? in
      let path = String(cString: ptr)
      guard !path.isEmpty else { return nil }
      return URL(fileURLWithPath: path, isDirectory: true)
    }

    return InheritedSurfaceConfig(
      workingDirectory: workingDirectory,
      fontSize: fontSize
    )
  }

  func currentFocusedSurfaceID() -> UUID? {
    guard let selectedTabID = spaceManager.selectedTabID else { return nil }
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
      guard let space = spaces.first(where: { $0.id == spaceID }) else {
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
        let space = spaces.first(where: { $0.id == spaceID }),
        let manager = spaceManager.tabManager(for: spaceID)
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
      guard
        let space = spaceManager.space(for: groupID),
        let manager = spaceManager.tabManager(for: space.id),
        let group = manager.group(for: groupID)
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
  ) -> ResolvedLocalCreateTabTarget? {
    if let inheritingFromSurfaceID,
      let anchorTabID = tabID(containing: inheritingFromSurfaceID),
      let space = spaceManager.space(for: anchorTabID)
    {
      return ResolvedLocalCreateTabTarget(
        inheritedSurfaceID: inheritingFromSurfaceID,
        spaceID: space.id
      )
    }

    guard let spaceID = spaceManager.selectedSpaceID else {
      return nil
    }

    return ResolvedLocalCreateTabTarget(
      inheritedSurfaceID: inheritingFromSurfaceID ?? currentFocusedSurfaceID(),
      spaceID: spaceID
    )
  }

  func resolveCreatePaneTarget(
    _ target: TerminalCreatePaneRequest.Target
  ) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .pane(let paneID):
      guard
        let tabID = tabID(containing: paneID),
        let space = spaceManager.space(for: tabID),
        let tree = trees[tabID],
        let anchorSurface = surfaces[paneID]
      else {
        throw TerminalCreatePaneError.contextPaneNotFound
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: anchorSurface,
        spaceID: space.id,
        tabID: tabID,
        tree: tree
      )

    case .tab(let rawTabID):
      let tabID = TerminalTabID(rawValue: rawTabID)
      guard
        let space = spaceManager.space(for: tabID),
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
        spaceID: space.id,
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
