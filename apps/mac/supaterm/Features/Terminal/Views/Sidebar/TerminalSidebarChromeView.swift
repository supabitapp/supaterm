import AppKit
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

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

struct TerminalSidebarChromeView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  @Binding var collapsedProjectIDs: Set<TerminalProjectID>
  let dismissReleaseAnnouncement: () -> Void

  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @Environment(GhosttyShortcutManager.self) private var ghosttyShortcuts
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Shared(.supatermSettings) private var supatermSettings = .default
  var body: some View {
    VStack(spacing: 10) {
      GeometryReader { geometry in
        TerminalSidebarProjectList(
          store: store,
          terminal: terminal,
          palette: palette,
          projects: terminal.projects,
          groups: terminal.projectGroups,
          collapsedProjectIDs: $collapsedProjectIDs,
          shortcutHintsByTabID: shortcutHintsByTabID,
          showsShortcutHints: commandHoldObserver.isPressed,
          showsAgentMarks: supatermSettings.codingAgentsShowIcons,
          showsAgentSpinner: supatermSettings.codingAgentsShowSpinner,
          reduceMotion: reduceMotion
        )
        .frame(width: geometry.size.width, height: geometry.size.height)
      }
      .frame(minHeight: 0, maxHeight: .infinity)
      .layoutPriority(-1)

      VStack(spacing: 10) {
        if updateStore.phase.showsSidebarSection {
          TerminalSidebarUpdateSection(store: updateStore, palette: palette)
        }
        if let releaseAnnouncement {
          ReleaseAnnouncementCardView(
            announcement: releaseAnnouncement,
            palette: palette,
            dismiss: dismissReleaseAnnouncement
          )
        }
        TerminalSidebarSpaceBar(store: store, palette: palette, terminal: terminal)
      }
      .padding(.horizontal, 8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .onChange(of: terminal.selectedProjectID) { _, _ in
      guard let selectedProjectID = terminal.selectedProjectID else { return }
      collapsedProjectIDs.remove(selectedProjectID)
    }
  }

  private var shortcutHintsByTabID: [TerminalTabID: String] {
    TerminalSidebarTabShortcutHints.byTabID(for: terminal.visibleTabs) { slot in
      ghosttyShortcuts.keyboardShortcut(for: .goToTab(slot))
    }
  }
}

struct TerminalSidebarProjectList: NSViewRepresentable {
  static let dragType = NSPasteboard.PasteboardType("app.supabit.supaterm.sidebar-item")

  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let palette: Palette
  let projects: [TerminalProjectItem]
  let groups: [TerminalProjectTabs]
  @Binding var collapsedProjectIDs: Set<TerminalProjectID>
  let shortcutHintsByTabID: [TerminalTabID: String]
  let showsShortcutHints: Bool
  let showsAgentMarks: Bool
  let showsAgentSpinner: Bool
  let reduceMotion: Bool

  func makeCoordinator() -> Coordinator {
    Coordinator(parent: self)
  }

  func makeNSView(context: Context) -> TerminalSidebarListView {
    let listView = TerminalSidebarListView()
    context.coordinator.connect(to: listView)
    return listView
  }

  func updateNSView(
    _ listView: TerminalSidebarListView,
    context: Context
  ) {
    context.coordinator.parent = self
    context.coordinator.applyModel()
  }

  @MainActor
  final class Coordinator {
    var parent: TerminalSidebarProjectList
    weak var listView: TerminalSidebarListView?

    init(parent: TerminalSidebarProjectList) {
      self.parent = parent
    }

    func connect(to listView: TerminalSidebarListView) {
      self.listView = listView
      listView.onDrop = { [weak self] drag, destination in
        self?.commit(drag: drag, destination: destination)
      }
      applyModel()
    }

    func applyModel() {
      guard let listView else { return }
      var itemByID: [TerminalSidebarEntryID: AnyView] = [:]
      var entries: [TerminalSidebarEntry] = []

      for project in parent.projects {
        let headerID = TerminalSidebarEntryID.project(project.id)
        entries.append(
          TerminalSidebarEntry(
            kind: .project(id: project.id, isPinned: project.isPinned)
          )
        )
        itemByID[headerID] = AnyView(projectHeader(project))
        let tabs = parent.groups.first(where: { $0.projectID == project.id })?.tabs ?? []
        for tab in tabs {
          let tabID = TerminalSidebarEntryID.tab(tab.id)
          entries.append(
            TerminalSidebarEntry(
              kind: .tab(id: tab.id, projectID: project.id, isPinned: tab.isPinned)
            )
          )
          itemByID[tabID] = AnyView(tabRow(tab))
        }
      }

      entries.append(TerminalSidebarEntry(kind: .newProject))
      itemByID[.newProject] = AnyView(newProjectRow)
      listView.apply(
        model: TerminalSidebarPresentationModel(
          entries: entries,
          collapsedProjectIDs: parent.collapsedProjectIDs
        ),
        itemByID: itemByID,
        reduceMotion: parent.reduceMotion
      )
    }

    private func commit(
      drag: TerminalSidebarDragValue,
      destination: TerminalSidebarDropTarget.Destination
    ) {
      switch (drag, destination) {
      case (.project(let projectID), .project(let isPinned, let laneIndex)):
        parent.terminal.moveProject(projectID, isPinned: isPinned, at: laneIndex)
      case (
        .tab(let tabID),
        .tab(let projectID, let isPinned, let laneIndex)
      ):
        parent.terminal.moveTab(
          tabID,
          to: projectID,
          isPinned: isPinned,
          at: laneIndex
        )
      default:
        return
      }
    }

    private func projectHeader(_ project: TerminalProjectItem) -> some View {
      TerminalSidebarProjectHeader(
        project: project,
        palette: parent.palette,
        isExpanded: !parent.collapsedProjectIDs.contains(project.id),
        canDelete: parent.projects.count > 1,
        toggleExpanded: { [weak self] in
          guard let self else { return }
          if parent.collapsedProjectIDs.contains(project.id) {
            parent.collapsedProjectIDs.remove(project.id)
          } else {
            parent.collapsedProjectIDs.insert(project.id)
          }
        },
        newTab: { [weak self] in
          guard let self, let spaceID = parent.terminal.selectedSpaceID else { return }
          _ = parent.terminal.createTab(in: spaceID, projectID: project.id)
        },
        rename: { [weak self] in self?.promptRename(project) },
        togglePinned: { [weak self] in
          self?.parent.terminal.setProjectPinned(project.id, isPinned: !project.isPinned)
        },
        delete: { [weak self] in self?.confirmDelete(project) }
      )
    }

    private func tabRow(_ tab: TerminalTabItem) -> some View {
      TerminalSidebarTabRow(
        store: parent.store,
        terminal: parent.terminal,
        tab: tab,
        notificationPresentation: parent.terminal.latestSidebarNotificationPresentation(for: tab.id),
        paneWorkingDirectories: parent.terminal.paneWorkingDirectories(for: tab.id),
        unreadCount: parent.terminal.unreadNotificationCount(for: tab.id),
        terminalProgress: parent.terminal.sidebarTerminalProgress(for: tab.id),
        hasTerminalBell: parent.terminal.tabHasBell(for: tab.id),
        palette: parent.palette,
        showsAgentMarks: parent.showsAgentMarks,
        showsAgentSpinner: parent.showsAgentSpinner,
        shortcutHint: parent.shortcutHintsByTabID[tab.id],
        showsShortcutHint: parent.showsShortcutHints
      )
      .padding(.leading, 12)
    }

    private var newProjectRow: some View {
      Button(
        action: { [weak self] in self?.promptNewProject() },
        label: {
          HStack(spacing: 8) {
            Image(systemName: "plus")
              .font(.system(size: 12, weight: .semibold))
              .frame(width: 18, height: 18)
              .foregroundStyle(parent.palette.secondaryText)
              .accessibilityHidden(true)
            Text("New Project")
              .font(.system(size: 13, weight: .medium))
              .foregroundStyle(parent.palette.primaryText)
            Spacer(minLength: 0)
          }
          .padding(.horizontal, 10)
          .frame(height: 36)
        }
      )
      .buttonStyle(TerminalSidebarButtonStyle(layout: .rect))
    }

    private func promptNewProject() {
      guard let spaceID = parent.terminal.selectedSpaceID else { return }
      promptName(title: "Create Project", confirmTitle: "Create", initialValue: "") { [weak self] name in
        guard let self else { return false }
        guard parent.terminal.isProjectNameAvailable(name, in: spaceID) else { return false }
        return (try? parent.terminal.createProject(named: name, in: spaceID)) != nil
      }
    }

    private func promptRename(_ project: TerminalProjectItem) {
      guard let spaceID = parent.terminal.selectedSpaceID else { return }
      promptName(title: "Rename Project", confirmTitle: "Save", initialValue: project.name) {
        [weak self] name in
        guard let self else { return false }
        guard parent.terminal.isProjectNameAvailable(name, in: spaceID, excluding: project.id) else {
          return false
        }
        parent.terminal.renameProject(project.id, to: name)
        return true
      }
    }

    private func promptName(
      title: String,
      confirmTitle: String,
      initialValue: String,
      save: (String) -> Bool
    ) {
      while true {
        let alert = NSAlert()
        alert.messageText = title
        alert.addButton(withTitle: confirmTitle)
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(string: initialValue)
        field.frame = NSRect(x: 0, y: 0, width: 280, height: 24)
        alert.accessoryView = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        if save(field.stringValue) { return }
        NSSound.beep()
      }
    }

    private func confirmDelete(_ project: TerminalProjectItem) {
      let tabCount = parent.groups.first(where: { $0.projectID == project.id })?.tabs.count ?? 0
      let alert = NSAlert()
      alert.messageText = "Delete \(project.name)?"
      alert.informativeText =
        tabCount == 0
        ? "This project will be removed from every window."
        : "This closes its \(tabCount) tab\(tabCount == 1 ? "" : "s") and removes the project from every window."
      alert.addButton(withTitle: "Delete")
      alert.addButton(withTitle: "Cancel")
      alert.buttons.first?.hasDestructiveAction = true
      guard alert.runModal() == .alertFirstButtonReturn else { return }
      parent.terminal.deleteProject(project.id)
    }
  }
}

private struct TerminalSidebarProjectHeader: View {
  let project: TerminalProjectItem
  let palette: Palette
  let isExpanded: Bool
  let canDelete: Bool
  let toggleExpanded: () -> Void
  let newTab: () -> Void
  let rename: () -> Void
  let togglePinned: () -> Void
  let delete: () -> Void

  var body: some View {
    HStack(spacing: 5) {
      Button(action: toggleExpanded) {
        HStack(spacing: 6) {
          Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
            .font(.system(size: 10, weight: .semibold))
            .frame(width: 12)
            .accessibilityHidden(true)
          Image(systemName: project.isPinned ? "folder.fill.badge.minus" : "folder")
            .font(.system(size: 13, weight: .medium))
            .accessibilityHidden(true)
          Text(project.name)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
          Spacer(minLength: 0)
        }
        .foregroundStyle(palette.secondaryText)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)

      Button(action: newTab) {
        Image(systemName: "plus")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 24, height: 24)
          .accessibilityHidden(true)
      }
      .buttonStyle(.plain)
      .help("New Tab")
    }
    .padding(.leading, 2)
    .frame(height: 36)
    .contextMenu {
      Button("New Tab", action: newTab)
      Divider()
      Button("Rename Project…", action: rename)
      Button(project.isPinned ? "Unpin Project" : "Pin Project", action: togglePinned)
      Divider()
      Button("Delete Project", role: .destructive, action: delete)
        .disabled(!canDelete)
    }
  }
}
