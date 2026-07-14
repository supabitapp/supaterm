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

private struct TerminalSidebarPalettePresentation: Equatable {
  let colorScheme: ColorScheme
  let referencePalette: ReferencePalette

  init(_ palette: Palette) {
    colorScheme = palette.colorScheme
    referencePalette = palette.referencePalette
  }

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.colorScheme == rhs.colorScheme && lhs.referencePalette == rhs.referencePalette
  }
}

private struct TerminalSidebarProjectRowPresentation: Equatable {
  let project: TerminalProjectItem
  let isExpanded: Bool
  let isDirectoryAvailable: Bool
  let palette: TerminalSidebarPalettePresentation

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.project == rhs.project && lhs.isExpanded == rhs.isExpanded
      && lhs.isDirectoryAvailable == rhs.isDirectoryAvailable && lhs.palette == rhs.palette
  }
}

private struct TerminalSidebarTabRowPresentation: Equatable {
  let storeIdentity: ObjectIdentifier
  let terminalIdentity: ObjectIdentifier
  let tab: TerminalTabItem
  let notificationPresentation: TerminalHostState.SidebarNotificationPresentation?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let terminalProgress: TerminalSidebarTerminalProgress?
  let hasTerminalBell: Bool
  let agentPresentation: TerminalHostState.TabAgentPresentation
  let palette: TerminalSidebarPalettePresentation
  let showsAgentMarks: Bool
  let showsAgentSpinner: Bool
  let shortcutHint: String?
  let showsShortcutHint: Bool

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.storeIdentity == rhs.storeIdentity && lhs.terminalIdentity == rhs.terminalIdentity
      && lhs.tab == rhs.tab
      && lhs.notificationPresentation == rhs.notificationPresentation
      && lhs.paneWorkingDirectories == rhs.paneWorkingDirectories
      && lhs.unreadCount == rhs.unreadCount
      && lhs.terminalProgress == rhs.terminalProgress
      && lhs.hasTerminalBell == rhs.hasTerminalBell
      && lhs.agentPresentation == rhs.agentPresentation
      && lhs.palette == rhs.palette
      && lhs.showsAgentMarks == rhs.showsAgentMarks
      && lhs.showsAgentSpinner == rhs.showsAgentSpinner
      && lhs.shortcutHint == rhs.shortcutHint
      && lhs.showsShortcutHint == rhs.showsShortcutHint
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
      .padding(.horizontal, 4)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .onChange(of: terminal.selectedTabID) { _, _ in
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
      listView.onFolderDrop = { [weak self] folderURLs in
        self?.createProjects(for: folderURLs) ?? false
      }
      applyModel()
    }

    func applyModel() {
      guard let listView else { return }
      var itemByID: [TerminalSidebarEntryID: AnyView] = [:]
      var presentationKeyByID: [TerminalSidebarEntryID: TerminalSidebarRowPresentationKey] = [:]
      var entries: [TerminalSidebarEntry] = []

      for project in parent.projects {
        let headerID = TerminalSidebarEntryID.project(project.id)
        let projectPresentation = projectRowPresentation(project)
        entries.append(
          TerminalSidebarEntry(
            kind: .project(id: project.id, isPinned: project.isPinned)
          )
        )
        itemByID[headerID] = AnyView(projectHeader(projectPresentation))
        presentationKeyByID[headerID] = TerminalSidebarRowPresentationKey(projectPresentation)
        let tabs = parent.groups.first(where: { $0.projectID == project.id })?.tabs ?? []
        for tab in tabs {
          let tabID = TerminalSidebarEntryID.tab(tab.id)
          let tabPresentation = tabRowPresentation(tab)
          entries.append(
            TerminalSidebarEntry(
              kind: .tab(id: tab.id, projectID: project.id, isPinned: tab.isPinned)
            )
          )
          itemByID[tabID] = AnyView(tabRow(tabPresentation))
          presentationKeyByID[tabID] = TerminalSidebarRowPresentationKey(tabPresentation)
        }
      }

      entries.append(TerminalSidebarEntry(kind: .newProject))
      itemByID[.newProject] = AnyView(newProjectRow)
      presentationKeyByID[.newProject] = TerminalSidebarRowPresentationKey(
        TerminalSidebarPalettePresentation(parent.palette)
      )
      listView.apply(
        model: TerminalSidebarPresentationModel(
          entries: entries,
          collapsedProjectIDs: parent.collapsedProjectIDs
        ),
        itemByID: itemByID,
        presentationKeyByID: presentationKeyByID,
        selectedTabID: parent.terminal.selectedTabID,
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

    private func projectRowPresentation(
      _ project: TerminalProjectItem
    ) -> TerminalSidebarProjectRowPresentation {
      TerminalSidebarProjectRowPresentation(
        project: project,
        isExpanded: !parent.collapsedProjectIDs.contains(project.id),
        isDirectoryAvailable: parent.terminal.projectDirectoryMonitor.isAvailable(
          project.directoryURL
        ),
        palette: TerminalSidebarPalettePresentation(parent.palette)
      )
    }

    private func projectHeader(
      _ presentation: TerminalSidebarProjectRowPresentation
    ) -> some View {
      let project = presentation.project
      return TerminalSidebarProjectHeader(
        project: project,
        palette: parent.palette,
        isExpanded: presentation.isExpanded,
        isDirectoryAvailable: presentation.isDirectoryAvailable,
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
          guard parent.terminal.createTab(in: spaceID, projectID: project.id) != nil else {
            NSSound.beep()
            return
          }
        },
        togglePinned: { [weak self] in
          self?.parent.terminal.setProjectPinned(project.id, isPinned: !project.isPinned)
        },
        delete: { [weak self] in self?.confirmDelete(project) }
      )
    }

    private func createProjects(for folderURLs: [URL]) -> Bool {
      guard let spaceID = parent.terminal.selectedSpaceID else { return false }
      do {
        return try !parent.terminal.createProjects(
          directoryURLs: folderURLs,
          in: spaceID
        ).isEmpty
      } catch {
        TerminalProjectDirectoryPicker.present(error, for: listView?.window)
        return false
      }
    }

    private func tabRowPresentation(
      _ tab: TerminalTabItem
    ) -> TerminalSidebarTabRowPresentation {
      TerminalSidebarTabRowPresentation(
        storeIdentity: ObjectIdentifier(parent.store),
        terminalIdentity: ObjectIdentifier(parent.terminal),
        tab: tab,
        notificationPresentation: parent.terminal.latestSidebarNotificationPresentation(
          for: tab.id
        ),
        paneWorkingDirectories: parent.terminal.paneWorkingDirectories(for: tab.id),
        unreadCount: parent.terminal.unreadNotificationCount(for: tab.id),
        terminalProgress: parent.terminal.sidebarTerminalProgress(for: tab.id),
        hasTerminalBell: parent.terminal.tabHasBell(for: tab.id),
        agentPresentation: parent.terminal.tabAgentPresentation(for: tab.id),
        palette: TerminalSidebarPalettePresentation(parent.palette),
        showsAgentMarks: parent.showsAgentMarks,
        showsAgentSpinner: parent.showsAgentSpinner,
        shortcutHint: parent.shortcutHintsByTabID[tab.id],
        showsShortcutHint: parent.showsShortcutHints
      )
    }

    private func tabRow(_ presentation: TerminalSidebarTabRowPresentation) -> some View {
      TerminalSidebarTabRow(
        store: parent.store,
        terminal: parent.terminal,
        tab: presentation.tab,
        notificationPresentation: presentation.notificationPresentation,
        paneWorkingDirectories: presentation.paneWorkingDirectories,
        unreadCount: presentation.unreadCount,
        terminalProgress: presentation.terminalProgress,
        hasTerminalBell: presentation.hasTerminalBell,
        palette: parent.palette,
        showsAgentMarks: presentation.showsAgentMarks,
        showsAgentSpinner: presentation.showsAgentSpinner,
        shortcutHint: presentation.shortcutHint,
        showsShortcutHint: presentation.showsShortcutHint
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
              .foregroundStyle(parent.palette.secondaryText)
            Spacer(minLength: 0)
          }
          .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
          .frame(height: TerminalSidebarLayout.tabRowMinHeight)
        }
      )
      .buttonStyle(TerminalSidebarButtonStyle(palette: parent.palette, layout: .rect))
    }

    private func promptNewProject() {
      TerminalProjectDirectoryPicker.chooseDirectories(for: listView?.window) { [weak self] urls in
        guard let self, !urls.isEmpty else { return }
        _ = createProjects(for: urls)
      }
    }

    private func confirmDelete(_ project: TerminalProjectItem) {
      let tabCount = parent.groups.first(where: { $0.projectID == project.id })?.tabs.count ?? 0
      let alert = NSAlert()
      alert.messageText = "Remove \(project.displayName)?"
      let path = project.directoryURL.path(percentEncoded: false)
      let tabDescription = "\(tabCount) tab\(tabCount == 1 ? "" : "s")"
      alert.informativeText =
        tabCount == 0
        ? "\(path) will be removed from Supaterm. The folder will stay on disk."
        : "This closes its \(tabDescription) in every window and removes \(path) from Supaterm. "
          + "The folder will stay on disk."
      alert.addButton(withTitle: "Remove")
      alert.addButton(withTitle: "Cancel")
      alert.buttons.first?.hasDestructiveAction = true
      if let window = listView?.window {
        alert.beginSheetModal(for: window) { [weak self] response in
          guard response == .alertFirstButtonReturn else { return }
          self?.parent.terminal.deleteProject(project.id)
        }
      } else if alert.runModal() == .alertFirstButtonReturn {
        parent.terminal.deleteProject(project.id)
      }
    }
  }
}

private struct TerminalSidebarProjectHeader: View {
  let project: TerminalProjectItem
  let palette: Palette
  let isExpanded: Bool
  let isDirectoryAvailable: Bool
  let toggleExpanded: () -> Void
  let newTab: () -> Void
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
          Text(project.displayName)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
          Spacer(minLength: 0)
        }
        .foregroundStyle(palette.secondaryText)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .help(project.directoryURL.path(percentEncoded: false))

      if !isDirectoryAvailable {
        Button(action: delete) {
          Image(systemName: "exclamationmark.triangle.fill")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.yellow)
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)
        }
        .buttonStyle(.plain)
        .help("Folder unavailable. Remove project…")
        .accessibilityLabel("Folder unavailable. Remove project")
      }

      Button(action: newTab) {
        Image(systemName: "plus")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 24, height: 24)
          .accessibilityHidden(true)
      }
      .buttonStyle(.plain)
      .disabled(!isDirectoryAvailable)
      .help("New Tab")
    }
    .padding(.leading, 2)
    .frame(height: 36)
    .contextMenu {
      Button("New Tab", action: newTab)
        .disabled(!isDirectoryAvailable)
      Divider()
      Button(project.isPinned ? "Unpin Project" : "Pin Project", action: togglePinned)
      Divider()
      Button("Remove Project", role: .destructive, action: delete)
    }
  }
}
