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
  let dismissReleaseAnnouncement: () -> Void

  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @Environment(GhosttyShortcutManager.self) private var ghosttyShortcuts
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Shared(.supatermSettings) private var supatermSettings = .default
  @State private var collapsedProjectIDs: Set<TerminalProjectID> = []

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

private struct TerminalSidebarAcceptedDrop {
  let sessionID: UUID
  let drag: TerminalSidebarDragValue
  let destination: TerminalSidebarDropTarget.Destination
}

struct TerminalSidebarProjectList: NSViewControllerRepresentable {
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

  func makeNSViewController(context: Context) -> TerminalSidebarCollectionViewController {
    let controller = TerminalSidebarCollectionViewController()
    context.coordinator.connect(to: controller)
    return controller
  }

  func updateNSViewController(
    _ controller: TerminalSidebarCollectionViewController,
    context: Context
  ) {
    context.coordinator.parent = self
    context.coordinator.applySnapshot()
  }

  @MainActor
  final class Coordinator: NSObject, NSCollectionViewDelegate {
    var parent: TerminalSidebarProjectList
    weak var controller: TerminalSidebarCollectionViewController?
    var dataSource: NSCollectionViewDiffableDataSource<Int, TerminalSidebarEntryID>?
    private var itemByID: [TerminalSidebarEntryID: AnyView] = [:]
    private var measuredHeights: [TerminalSidebarEntryID: (width: CGFloat, height: CGFloat)] = [:]
    private var activeDragValue: TerminalSidebarDragValue?
    private var activeDragSessionID: UUID?
    private var acceptedDrop: TerminalSidebarAcceptedDrop?
    private var dragCleanup: Task<Void, Never>?
    private var pendingExpansion: Task<Void, Never>?
    private var pendingExpansionProjectID: TerminalProjectID?
    private var hasAppliedSnapshot = false

    init(parent: TerminalSidebarProjectList) {
      self.parent = parent
    }

    func connect(to controller: TerminalSidebarCollectionViewController) {
      self.controller = controller
      controller.collectionView.delegate = self
      controller.collectionView.registerForDraggedTypes([TerminalSidebarProjectList.dragType])
      controller.collectionView.setDraggingSourceOperationMask(.move, forLocal: true)
      controller.collectionView.onDragBegan = { [weak self] indexPath, event in
        self?.beginDragging(at: indexPath, event: event)
      }
      controller.collectionView.onDragEnded = { [weak self] sessionID, _ in
        guard let self, activeDragSessionID == sessionID else { return }
        guard acceptedDrop?.sessionID != sessionID else { return }
        dragCleanup?.cancel()
        dragCleanup = Task { @MainActor [weak self] in
          try? await Task.sleep(for: .milliseconds(100))
          guard let self, !Task.isCancelled, activeDragSessionID == sessionID else { return }
          clearDragState()
          dragCleanup = nil
        }
      }
      controller.collectionView.onDragExited = { [weak self] in
        self?.clearDropTarget()
      }
      controller.onAutoscroll = { [weak self] pointerY in
        self?.updateDropTarget(pointerY: pointerY)
      }
      controller.collectionLayout.preferredHeight = { [weak self] entryID, width in
        self?.preferredHeight(for: entryID, width: width) ?? TerminalSidebarLayout.tabRowMinHeight
      }
      dataSource = NSCollectionViewDiffableDataSource(collectionView: controller.collectionView) {
        [weak self] collectionView, indexPath, entryID in
        guard let self else { return nil }
        let item = collectionView.makeItem(
          withIdentifier: TerminalSidebarCollectionItem.identifier,
          for: indexPath
        )
        guard let item = item as? TerminalSidebarCollectionItem else { return nil }
        item.host(self.itemByID[entryID] ?? AnyView(EmptyView()))
        return item
      }
      controller.collectionLayout.itemIdentifiers = { [weak self] in
        self?.dataSource?.snapshot().itemIdentifiers ?? []
      }
      applySnapshot()
    }

    func applySnapshot() {
      guard controller != nil, let dataSource else { return }
      itemByID.removeAll()
      measuredHeights.removeAll()
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
      let targetIdentifiers = entries.map(\.id)
      let targetIdentifierSet = Set(targetIdentifiers)
      let currentIdentifiers = dataSource.snapshot().itemIdentifiers
      let currentIdentifierSet = Set(currentIdentifiers)
      let snapshotIdentifiers =
        currentIdentifiers.filter(targetIdentifierSet.contains)
        + targetIdentifiers.filter { !currentIdentifierSet.contains($0) }
      var snapshot = NSDiffableDataSourceSnapshot<Int, TerminalSidebarEntryID>()
      snapshot.appendSections([0])
      snapshot.appendItems(snapshotIdentifiers, toSection: 0)
      controller?.configure(
        entries: entries,
        collapsedProjectIDs: parent.collapsedProjectIDs,
        animated: hasAppliedSnapshot && !parent.reduceMotion,
        animationsEnabled: !parent.reduceMotion
      )
      if let acceptedDrop,
        TerminalSidebarDropCommit.isApplied(
          drag: acceptedDrop.drag,
          destination: acceptedDrop.destination,
          entries: entries
        )
      {
        clearDragState()
      }
      refreshVisibleItems()
      guard currentIdentifiers != snapshotIdentifiers else {
        controller?.invalidateLayout()
        return
      }
      applySnapshot(snapshot, to: dataSource)
      hasAppliedSnapshot = true
    }

    private func applySnapshot(
      _ snapshot: NSDiffableDataSourceSnapshot<Int, TerminalSidebarEntryID>,
      to dataSource: NSCollectionViewDiffableDataSource<Int, TerminalSidebarEntryID>
    ) {
      dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
        guard let self else { return }
        refreshVisibleItems()
        controller?.invalidateLayout()
      }
    }

    func collectionView(
      _ collectionView: NSCollectionView,
      validateDrop draggingInfo: NSDraggingInfo,
      proposedIndexPath proposedDropIndexPath: AutoreleasingUnsafeMutablePointer<NSIndexPath>,
      dropOperation proposedDropOperation: UnsafeMutablePointer<NSCollectionView.DropOperation>
    ) -> NSDragOperation {
      guard
        let controller,
        let dragged = draggedValue(from: draggingInfo)
      else {
        clearDropTarget()
        return []
      }
      controller.invalidateLayout()
      let location = collectionView.convert(draggingInfo.draggingLocation, from: nil)
      guard
        let target = resolvedDropTarget(dragged: dragged, pointerY: location.y)
      else {
        clearDropTarget()
        return []
      }
      controller.setDropTarget(target, pointerY: location.y)
      scheduleExpansion(target.targetProjectID)
      proposedDropIndexPath.pointee =
        IndexPath(
          item: min(target.insertionEntryIndex, max(0, controller.collectionLayout.entries.count - 1)),
          section: 0
        ) as NSIndexPath
      proposedDropOperation.pointee = .before
      if case .tab = dragged {
        draggingInfo.animatesToDestination = true
      } else {
        draggingInfo.animatesToDestination = false
      }
      draggingInfo.numberOfValidItemsForDrop = 1
      return .move
    }

    func collectionView(
      _ collectionView: NSCollectionView,
      acceptDrop draggingInfo: NSDraggingInfo,
      indexPath: IndexPath,
      dropOperation: NSCollectionView.DropOperation
    ) -> Bool {
      let location = collectionView.convert(draggingInfo.draggingLocation, from: nil)
      guard
        let dragged = draggedValue(from: draggingInfo),
        let target = resolvedDropTarget(dragged: dragged, pointerY: location.y)
      else {
        clearDragState()
        return false
      }
      if case .tab = dragged,
        let controller,
        let indicatorFrame = controller.collectionLayout.plan.dropIndicatorFrame
      {
        draggingInfo.enumerateDraggingItems(
          options: [],
          for: collectionView,
          classes: [NSPasteboardItem.self],
          searchOptions: [:]
        ) { item, _, _ in
          let size = item.draggingFrame.size
          item.draggingFrame = CGRect(
            x: TerminalSidebarLayoutPlan.horizontalInset,
            y: indicatorFrame.midY - size.height / 2,
            width: max(
              1,
              collectionView.bounds.width - TerminalSidebarLayoutPlan.horizontalInset * 2
            ),
            height: size.height
          )
        }
      }
      switch (dragged, target.destination) {
      case (.project(let projectID), .project(let isPinned, let laneIndex)):
        guard let activeDragSessionID else {
          clearDragState()
          return false
        }
        acceptedDrop = TerminalSidebarAcceptedDrop(
          sessionID: activeDragSessionID,
          drag: dragged,
          destination: target.destination
        )
        parent.terminal.moveProject(projectID, isPinned: isPinned, at: laneIndex)
      case (
        .tab(let tabID),
        .tab(let projectID, let isPinned, let laneIndex)
      ):
        guard let activeDragSessionID else {
          clearDragState()
          return false
        }
        acceptedDrop = TerminalSidebarAcceptedDrop(
          sessionID: activeDragSessionID,
          drag: dragged,
          destination: target.destination
        )
        parent.terminal.moveTab(
          tabID,
          to: projectID,
          isPinned: isPinned,
          at: laneIndex
        )
      default:
        clearDragState()
        return false
      }
      return true
    }

    private func resolvedDropTarget(
      dragged: TerminalSidebarDragValue,
      pointerY: CGFloat
    ) -> TerminalSidebarDropTarget? {
      guard let controller else { return nil }
      return TerminalSidebarDropTargetResolver.resolve(
        drag: dragged,
        pointerY: pointerY,
        entries: controller.collectionLayout.entries,
        frames: controller.framesByEntryID()
      )
    }

    private func updateDropTarget(pointerY: CGFloat) {
      guard
        let dragged = activeDragValue,
        let target = resolvedDropTarget(dragged: dragged, pointerY: pointerY)
      else {
        clearDropTarget()
        return
      }
      controller?.setDropTarget(target, pointerY: pointerY)
      scheduleExpansion(target.targetProjectID)
    }

    private func beginDragging(at indexPath: IndexPath, event: NSEvent) {
      guard
        let controller,
        let entryID = dataSource?.itemIdentifier(for: indexPath)
      else { return }
      let value: TerminalSidebarDragValue
      switch entryID {
      case .project(let projectID):
        value = .project(projectID)
      case .tab(let tabID):
        value = .tab(tabID)
      case .newProject:
        return
      }
      activeDragValue = value
      dragCleanup?.cancel()
      dragCleanup = nil
      let sessionID = UUID()
      activeDragSessionID = sessionID
      if !controller.beginDragging(value: value, event: event, sessionID: sessionID) {
        clearDragState()
      }
    }

    private func draggedValue(from draggingInfo: NSDraggingInfo) -> TerminalSidebarDragValue? {
      guard
        let value = draggingInfo.draggingPasteboard.string(forType: TerminalSidebarProjectList.dragType),
        let dragged = TerminalSidebarDragValue(pasteboardValue: value),
        dragged == activeDragValue
      else { return nil }
      return dragged
    }

    private func refreshVisibleItems() {
      guard let controller, let dataSource else { return }
      for item in controller.collectionView.visibleItems() {
        guard
          let item = item as? TerminalSidebarCollectionItem,
          let indexPath = controller.collectionView.indexPath(for: item),
          let itemID = dataSource.itemIdentifier(for: indexPath),
          let view = itemByID[itemID]
        else { continue }
        item.host(view)
      }
    }

    private func preferredHeight(for entryID: TerminalSidebarEntryID, width: CGFloat) -> CGFloat {
      switch entryID {
      case .project, .newProject:
        return TerminalSidebarLayout.tabRowMinHeight
      case .tab:
        if let measurement = measuredHeights[entryID], measurement.width == width {
          return measurement.height
        }
        let host = NSHostingView(rootView: itemByID[entryID] ?? AnyView(EmptyView()))
        host.frame.size.width = width
        let height = max(TerminalSidebarLayout.tabRowMinHeight, host.fittingSize.height)
        measuredHeights[entryID] = (width, height)
        return height
      }
    }

    private func scheduleExpansion(_ projectID: TerminalProjectID?) {
      guard
        let projectID,
        parent.collapsedProjectIDs.contains(projectID)
      else {
        cancelPendingExpansion()
        return
      }
      guard pendingExpansionProjectID != projectID else { return }
      cancelPendingExpansion()
      pendingExpansionProjectID = projectID
      pendingExpansion?.cancel()
      pendingExpansion = Task { @MainActor [weak self] in
        try? await Task.sleep(for: .milliseconds(600))
        guard let self, !Task.isCancelled else { return }
        parent.collapsedProjectIDs.remove(projectID)
        pendingExpansion = nil
        pendingExpansionProjectID = nil
      }
    }

    private func cancelPendingExpansion() {
      pendingExpansion?.cancel()
      pendingExpansion = nil
      pendingExpansionProjectID = nil
    }

    private func clearDropTarget() {
      cancelPendingExpansion()
      controller?.setDropTarget(nil, pointerY: nil)
    }

    private func clearDragState() {
      dragCleanup?.cancel()
      dragCleanup = nil
      clearDropTarget()
      activeDragValue = nil
      activeDragSessionID = nil
      acceptedDrop = nil
      controller?.finishDragging()
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
