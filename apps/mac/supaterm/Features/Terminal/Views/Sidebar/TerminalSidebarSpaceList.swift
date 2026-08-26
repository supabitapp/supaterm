import SupaTheme
import SupatermCLIShared
import SwiftUI

nonisolated struct TerminalSidebarProjectIconRequest: Hashable, Sendable {
  let rootPath: String?

  func resolve() -> URL? {
    guard let rootPath else { return nil }
    return SupatermProjectIconResolver.resolve(
      in: URL(fileURLWithPath: rootPath, isDirectory: true)
    )
  }
}

enum TerminalSidebarTabShortcutHints {
  static let maxVisibleShortcutCount = 10

  static func byTabID(
    for visibleTabs: [TerminalTabItem],
    shortcutForSlot: (Int) -> KeyboardShortcut?
  ) -> [TerminalTabID: String] {
    Dictionary(
      uniqueKeysWithValues:
        visibleTabs
        .prefix(maxVisibleShortcutCount)
        .enumerated()
        .compactMap { index, tab in
          let slot = index + 1
          guard let shortcut = shortcutForSlot(slot) else { return nil }
          return (tab.id, shortcut.display)
        }
    )
  }
}

struct TerminalSidebarSpaceList: View {
  let terminal: TerminalHostState
  let instance: TerminalSpaceInstance
  let palette: Palette
  let swipe: SpaceSwipeController
  let controllerCache: TerminalSidebarControllerCache
  let fixedHoveredProjectID: TerminalProjectID?

  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(GhosttyShortcutManager.self) private var ghosttyShortcuts
  @State private var projectIconURLs: [TerminalProjectID: URL] = [:]

  var body: some View {
    TerminalSidebarOutlineList(
      terminal: terminal,
      palette: palette,
      swipe: swipe,
      controllerCache: controllerCache,
      spaceID: instance.spaceID,
      outline: outline,
      rows: rows,
      selectedTabID: snapshot.collection.selectedTabID,
      fixedHoveredProjectID: fixedHoveredProjectID,
      reduceMotion: reduceMotion,
      actions: rowActions,
      performDrop: performDrop
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .task(id: projectIconRequests) {
      let requests = projectIconRequests
      projectIconURLs = [:]
      let icons = await Task.detached(priority: .utility) {
        requests.reduce(into: [TerminalProjectID: URL]()) { icons, request in
          icons[request.key] = request.value.resolve()
        }
      }.value
      guard !Task.isCancelled else { return }
      projectIconURLs = icons
    }
  }

  private var snapshot: TerminalTabSurfaceSnapshot {
    instance.tabSurfaceSnapshot
  }

  private var outline: TerminalSidebarOutline {
    TerminalSidebarOutline(snapshot: snapshot, projects: terminal.projects)
  }

  private var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] {
    var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] = [:]
    let shortcutHints = tabShortcutHintsByID
    for section in terminal.projectSections(in: instance.spaceID) {
      let project = section.project
      rows[.project(project.id)] = .project(
        TerminalSidebarProjectRowPresentation(
          id: project.id,
          title: project.name,
          color: project.color,
          iconURL: projectIconURLs[project.id],
          isPinned: project.isPinned,
          isCollapsed: snapshot.collapsedProjectIDs.contains(project.id),
          tabIDs: section.tabs.map(\.id),
          showsNewTabShortcutHint: commandHoldObserver.isOptionPressed
        )
      )
      for tab in section.tabs {
        rows[.tab(tab.id)] = .tab(
          tabPresentation(
            tab,
            projectID: project.id,
            rootIsPinned: tab.isPinned,
            shortcutHints: shortcutHints
          )
        )
      }
    }
    if let unassigned = terminal.unassignedSection(in: instance.spaceID) {
      rows[.unassigned] = .unassigned(
        TerminalSidebarUnassignedRowPresentation(
          isCollapsed: snapshot.isUnassignedCollapsed,
          tabCount: unassigned.tabs.count
        )
      )
      for tab in unassigned.tabs {
        rows[.tab(tab.id)] = .tab(
          tabPresentation(
            tab,
            projectID: nil,
            rootIsPinned: tab.isPinned,
            shortcutHints: shortcutHints
          )
        )
      }
    }
    rows[.newTab] = .newTab(.inline)
    return rows
  }

  private var projectIconRequests: [TerminalProjectID: TerminalSidebarProjectIconRequest] {
    Dictionary(
      uniqueKeysWithValues: terminal.projectSections(in: instance.spaceID).map { section in
        return (
          section.id,
          TerminalSidebarProjectIconRequest(rootPath: section.project.rootPath)
        )
      }
    )
  }

  private func tabPresentation(
    _ tab: TerminalTabItem,
    projectID: TerminalProjectID?,
    rootIsPinned: Bool,
    shortcutHints: [TerminalTabID: String]
  ) -> TerminalSidebarTabRowPresentation {
    let agentContext = terminal.tabAgentContext(for: tab.id)
    let details = TerminalSidebarTabDetail.resolve(
      agentWorkspaces: agentContext.workspaces,
      paneWorkingDirectories: terminal.paneWorkingDirectories(for: tab.id)
    )
    return TerminalSidebarTabRowPresentation(
      tab: tab,
      projectID: projectID,
      rootIsPinned: rootIsPinned,
      agentStatus: agentContext.presentation.status,
      details: details,
      unreadCount: terminal.unreadNotificationCount(for: tab.id),
      terminalProgress: terminal.sidebarTerminalProgress(for: tab.id),
      hasTerminalBell: terminal.tabHasBell(for: tab.id),
      shortcutHint: shortcutHints[tab.id],
      showsShortcutHint: commandHoldObserver.isPressed
    )
  }

  private var rowActions: TerminalSidebarRowActions {
    TerminalSidebarRowActions(
      toggleProjectCollapsed: { projectID in
        _ = terminal.setProjectCollapsed(
          projectID,
          isCollapsed: !terminal.isProjectCollapsed(projectID, in: instance.spaceID),
          in: instance.spaceID
        )
      },
      toggleUnassignedCollapsed: {
        _ = terminal.setUnassignedCollapsed(
          !terminal.isUnassignedCollapsed(in: instance.spaceID),
          in: instance.spaceID
        )
      },
      createTabInProject: createTab,
      renameProject: { terminal.renameProject($0, name: $1) },
      setProjectColor: { terminal.setProjectColor($0, color: $1) },
      toggleProjectPinned: { projectID in
        guard let project = terminal.projects.first(where: { $0.id == projectID }) else { return }
        _ = terminal.setProjectPinned(projectID, isPinned: !project.isPinned)
      },
      unproject: { _ = terminal.assignTabs($0, to: nil) },
      closeProject: { terminal.requestCloseProject($0) },
      newTab: newTab
    )
  }

  private var tabShortcutHintsByID: [TerminalTabID: String] {
    TerminalSidebarTabShortcutHints.byTabID(
      for: snapshot.collection.tabs(orderedProjectIDs: terminal.projects.map(\.id))
    ) { slot in
      ghosttyShortcuts.keyboardShortcut(for: .goToTab(slot))
    }
  }

  private func createTab(in projectID: TerminalProjectID) {
    AppPostHog.capture("terminal_tab_created")
    _ = terminal.createTab(
      in: projectID,
      inheritingFromSurfaceID: terminal.selectedSurfaceView?.id
    )
  }

  private func newTab() {
    TerminalMotion.animate(.easeInOut(duration: 0.2), reduceMotion: reduceMotion) {
      AppPostHog.capture("terminal_tab_created")
      _ = terminal.createTab(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
    }
  }

  private func performDrop(
    _ command: TerminalSidebarDropCommand
  ) -> TerminalSidebarDropReceipt? {
    TerminalSidebarDropTransaction.perform(command, terminal: terminal)
  }
}

@MainActor
enum TerminalSidebarDropTransaction {
  static func perform(
    _ command: TerminalSidebarDropCommand,
    terminal: TerminalHostState
  ) -> TerminalSidebarDropReceipt? {
    let orderedProjectIDs = terminal.projects.map(\.id)
    guard
      command.topologyStamp.spaceID == terminal.displayedSpaceID,
      command.topologyStamp.revision
        == terminal.spaceManager.displayedInstance.tabCollection.topologyRevision,
      command.topologyStamp.orderedProjectIDs == orderedProjectIDs
    else { return nil }
    switch command.operation {
    case .reorderProject(let destination):
      guard command.itemIDs.count == 1, case .project(let projectID) = command.itemIDs[0]
      else { return nil }
      guard
        terminal.moveProject(
          projectID,
          isPinned: destination.isPinned,
          toLaneIndex: destination.index
        )
      else { return nil }
      return TerminalSidebarDropReceipt(
        spaceID: command.topologyStamp.spaceID,
        operationID: command.operationID,
        itemIDs: command.itemIDs,
        operation: command.operation,
        topologyRevision: command.topologyStamp.revision,
        orderedProjectIDs: terminal.projects.map(\.id)
      )

    case .assign(let projectID):
      let tabIDs = commandTabIDs(command)
      guard tabIDs.count == command.itemIDs.count else { return nil }
      guard terminal.assignTabs(tabIDs, to: projectID) else { return nil }
      return TerminalSidebarDropReceipt(
        spaceID: command.topologyStamp.spaceID,
        operationID: command.operationID,
        itemIDs: command.itemIDs,
        operation: command.operation,
        topologyRevision: terminal.spaceManager.displayedInstance.tabCollection.topologyRevision,
        orderedProjectIDs: orderedProjectIDs
      )

    case .move(let destination):
      let tabIDs = commandTabIDs(command)
      guard tabIDs.count == command.itemIDs.count else { return nil }
      guard
        let result = try? terminal.move(
          TerminalTabMoveRequest(
            expectedTopologyRevision: command.topologyStamp.revision,
            orderedProjectIDs: orderedProjectIDs,
            tabIDs: tabIDs,
            destination: destination
          )
        )
      else { return nil }
      return TerminalSidebarDropReceipt(
        spaceID: command.topologyStamp.spaceID,
        operationID: command.operationID,
        itemIDs: command.itemIDs,
        operation: .move(result.location),
        topologyRevision: result.topologyRevision,
        orderedProjectIDs: orderedProjectIDs
      )
    }
  }

  private static func commandTabIDs(_ command: TerminalSidebarDropCommand) -> [TerminalTabID] {
    command.itemIDs.compactMap { itemID in
      guard case .tab(let tabID) = itemID else { return nil }
      return tabID
    }
  }
}
