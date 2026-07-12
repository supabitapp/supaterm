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
    sessionChangesEnabled: Bool = true
  ) -> TerminalTabID? {
    guard let target = resolveLocalCreateTabTarget(inheritingFromSurfaceID: inheritingFromSurfaceID)
    else {
      return nil
    }
    return createTab(
      in: target.spaceID,
      projectID: target.projectID,
      focusing: focusing,
      startupCommand: startupCommand,
      workingDirectory: workingDirectoryPath.map { URL(fileURLWithPath: $0, isDirectory: true) },
      inheritingFromSurfaceID: target.inheritedSurfaceID,
      sessionChangesEnabled: sessionChangesEnabled
    )
  }

  @discardableResult
  func createTab(
    in spaceID: TerminalSpaceID,
    projectID: TerminalProjectID? = nil,
    focusing: Bool = true,
    startupCommand: String? = nil,
    workingDirectory: URL? = nil,
    inheritingFromSurfaceID: UUID? = nil,
    sessionChangesEnabled: Bool = true,
    synchronizesFocus: Bool = true
  ) -> TerminalTabID? {
    guard let projectManager = spaceManager.projectManager(for: spaceID) else { return nil }
    guard let projectID = projectID ?? resolvedProjectIDForNewTab(in: spaceID) else { return nil }
    let context: ghostty_surface_context_e =
      projectManager.tabs.isEmpty
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    guard
      let tabID = projectManager.createTab(
        title: "Terminal \(nextTabIndex(in: spaceID))",
        in: projectID,
        selecting: focusing
      )
    else { return nil }
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
    case .contextPane(let paneID):
      guard
        let tabID = tabID(containing: paneID),
        let space = spaceManager.space(for: tabID),
        let project = spaceManager.project(for: tabID)
      else {
        throw TerminalCreateTabError.contextPaneNotFound
      }

      return ResolvedCreateTabTarget(
        inheritedSurfaceID: paneID,
        project: project,
        space: space
      )

    case .project(let windowIndex, let spaceIndex, let projectIndex):
      guard windowIndex == 1 else {
        throw TerminalCreateTabError.windowNotFound(windowIndex)
      }
      guard let space = spaceManager.space(at: spaceIndex) else {
        throw TerminalCreateTabError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      }
      guard let project = spaceManager.project(at: projectIndex, in: space.id) else {
        throw TerminalCreateTabError.creationFailed
      }
      return ResolvedCreateTabTarget(
        inheritedSurfaceID: inheritedSurfaceID(in: space.id),
        project: project,
        space: space
      )
    }
  }

  func resolveLocalCreateTabTarget(
    inheritingFromSurfaceID: UUID?
  ) -> ResolvedLocalCreateTabTarget? {
    if let inheritingFromSurfaceID,
      let anchorTabID = tabID(containing: inheritingFromSurfaceID),
      let space = spaceManager.space(for: anchorTabID),
      let projectID = spaceManager.projectID(for: anchorTabID)
    {
      return ResolvedLocalCreateTabTarget(
        inheritedSurfaceID: inheritingFromSurfaceID,
        projectID: projectID,
        spaceID: space.id
      )
    }

    guard
      let spaceID = spaceManager.selectedSpaceID,
      let projectID = resolvedProjectIDForNewTab(in: spaceID)
    else {
      return nil
    }

    return ResolvedLocalCreateTabTarget(
      inheritedSurfaceID: inheritingFromSurfaceID ?? currentFocusedSurfaceID(),
      projectID: projectID,
      spaceID: spaceID
    )
  }

  func resolvedProjectIDForNewTab(in spaceID: TerminalSpaceID) -> TerminalProjectID? {
    if let selectedTabID = spaceManager.selectedTabID(in: spaceID),
      let projectID = spaceManager.projectID(for: selectedTabID)
    {
      return projectID
    }
    return spaceManager.projects(in: spaceID).first?.id
  }

  func resolveCreatePaneTarget(
    _ target: TerminalCreatePaneRequest.Target
  ) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .contextPane(let paneID):
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

    case .pane(let windowIndex, let spaceIndex, let projectIndex, let tabIndex, let paneIndex):
      let resolvedTab = try resolveTab(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        projectIndex: projectIndex,
        tabIndex: tabIndex
      )
      let panes = resolvedTab.tree.leaves()
      let paneOffset = paneIndex - 1
      guard panes.indices.contains(paneOffset) else {
        throw TerminalCreatePaneError.paneNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: panes[paneOffset],
        spaceID: resolvedTab.space.id,
        tabID: resolvedTab.tabID,
        tree: resolvedTab.tree
      )

    case .tab(let windowIndex, let spaceIndex, let projectIndex, let tabIndex):
      let resolvedTab = try resolveTab(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        projectIndex: projectIndex,
        tabIndex: tabIndex
      )
      let anchorSurface =
        focusHistoryByTab[resolvedTab.tabID].flatMap { surfaces[$0.current] }
        ?? resolvedTab.tree.root?.leftmostLeaf()
      guard let anchorSurface else {
        throw TerminalCreatePaneError.creationFailed
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: anchorSurface,
        spaceID: resolvedTab.space.id,
        tabID: resolvedTab.tabID,
        tree: resolvedTab.tree
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
