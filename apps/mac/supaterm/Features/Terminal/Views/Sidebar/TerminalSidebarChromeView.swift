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
    .onChange(of: terminal.selectedProjectID) { _, selectedProjectID in
      guard let selectedProjectID else { return }
      collapsedProjectIDs.remove(selectedProjectID)
    }
  }

  private var shortcutHintsByTabID: [TerminalTabID: String] {
    TerminalSidebarTabShortcutHints.byTabID(for: terminal.visibleTabs) { slot in
      ghosttyShortcuts.keyboardShortcut(for: .goToTab(slot))
    }
  }
}

private enum TerminalSidebarSectionID: Hashable {
  case project(TerminalProjectID)
  case newProject
}

private enum TerminalSidebarItemID: Hashable {
  case project(TerminalProjectID)
  case tab(TerminalTabID)
  case newProject
}

private struct TerminalSidebarProjectList: NSViewControllerRepresentable {
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
  final class Coordinator: NSObject, NSCollectionViewDelegateFlowLayout {
    static let dragType = NSPasteboard.PasteboardType("app.supabit.supaterm.sidebar-item")

    var parent: TerminalSidebarProjectList
    weak var controller: TerminalSidebarCollectionViewController?
    var dataSource: NSCollectionViewDiffableDataSource<TerminalSidebarSectionID, TerminalSidebarItemID>?
    private var itemByID: [TerminalSidebarItemID: AnyView] = [:]
    private var measuredSizes: [TerminalSidebarItemID: NSSize] = [:]
    private var pendingExpansion: Task<Void, Never>?

    init(parent: TerminalSidebarProjectList) {
      self.parent = parent
    }

    func connect(to controller: TerminalSidebarCollectionViewController) {
      self.controller = controller
      controller.collectionView.delegate = self
      controller.collectionView.registerForDraggedTypes([Self.dragType])
      controller.collectionView.setDraggingSourceOperationMask(.move, forLocal: true)
      dataSource = NSCollectionViewDiffableDataSource(collectionView: controller.collectionView) {
        [weak self] collectionView, indexPath, itemID in
        guard let self else { return nil }
        let item = collectionView.makeItem(
          withIdentifier: TerminalSidebarCollectionItem.identifier,
          for: indexPath
        )
        guard let item = item as? TerminalSidebarCollectionItem else { return nil }
        item.host(
          self.itemByID[itemID] ?? AnyView(EmptyView()),
          dragValue: self.dragValue(for: itemID)
        )
        return item
      }
      applySnapshot()
    }

    func applySnapshot() {
      guard controller != nil, let dataSource else { return }
      itemByID.removeAll()
      measuredSizes.removeAll()
      var snapshot = NSDiffableDataSourceSnapshot<TerminalSidebarSectionID, TerminalSidebarItemID>()

      for project in parent.projects {
        let sectionID = TerminalSidebarSectionID.project(project.id)
        snapshot.appendSections([sectionID])
        let headerID = TerminalSidebarItemID.project(project.id)
        snapshot.appendItems([headerID], toSection: sectionID)
        itemByID[headerID] = AnyView(projectHeader(project))
        guard !parent.collapsedProjectIDs.contains(project.id) else { continue }
        let tabs = parent.groups.first(where: { $0.projectID == project.id })?.tabs ?? []
        let tabIDs = tabs.map { TerminalSidebarItemID.tab($0.id) }
        snapshot.appendItems(tabIDs, toSection: sectionID)
        for tab in tabs {
          itemByID[.tab(tab.id)] = AnyView(tabRow(tab))
        }
      }

      snapshot.appendSections([.newProject])
      snapshot.appendItems([.newProject], toSection: .newProject)
      itemByID[.newProject] = AnyView(newProjectRow)
      refreshVisibleItems()
      dataSource.apply(snapshot, animatingDifferences: !parent.reduceMotion) { [weak self] in
        guard let self else { return }
        self.refreshVisibleItems()
        self.controller?.invalidateLayoutMetrics()
      }
    }

    func collectionView(
      _ collectionView: NSCollectionView,
      layout collectionViewLayout: NSCollectionViewLayout,
      sizeForItemAt indexPath: IndexPath
    ) -> NSSize {
      let sectionInset =
        (collectionViewLayout as? NSCollectionViewFlowLayout)?.sectionInset ?? NSEdgeInsets()
      let width = max(
        1,
        collectionView.bounds.width - sectionInset.left - sectionInset.right - 1
      )
      guard let itemID = dataSource?.itemIdentifier(for: indexPath) else {
        return NSSize(width: width, height: 36)
      }
      if let size = measuredSizes[itemID], size.width == width {
        return size
      }
      let height: CGFloat
      switch itemID {
      case .project, .newProject:
        height = 36
      case .tab:
        let host = NSHostingView(rootView: itemByID[itemID] ?? AnyView(EmptyView()))
        host.frame.size.width = width
        height = max(TerminalSidebarLayout.tabRowMinHeight, host.fittingSize.height)
      }
      let size = NSSize(width: width, height: height)
      measuredSizes[itemID] = size
      return size
    }

    func collectionView(
      _ collectionView: NSCollectionView,
      validateDrop draggingInfo: NSDraggingInfo,
      proposedIndexPath proposedDropIndexPath: AutoreleasingUnsafeMutablePointer<NSIndexPath>,
      dropOperation proposedDropOperation: UnsafeMutablePointer<NSCollectionView.DropOperation>
    ) -> NSDragOperation {
      guard draggedValue(from: draggingInfo) != nil else { return [] }
      proposedDropOperation.pointee = .before
      let indexPath = proposedDropIndexPath.pointee as IndexPath
      if case .project(let projectID)? = dataSource?.snapshot().sectionIdentifiers[safe: indexPath.section] {
        scheduleExpansion(projectID)
      }
      return .move
    }

    func collectionView(
      _ collectionView: NSCollectionView,
      acceptDrop draggingInfo: NSDraggingInfo,
      indexPath: IndexPath,
      dropOperation: NSCollectionView.DropOperation
    ) -> Bool {
      pendingExpansion?.cancel()
      guard let dragged = draggedValue(from: draggingInfo) else { return false }
      let sections = dataSource?.snapshot().sectionIdentifiers ?? []

      switch dragged {
      case .project(let projectID):
        guard let draggedProject = parent.projects.first(where: { $0.id == projectID }) else {
          return false
        }
        let targetOffset = min(indexPath.section, parent.projects.count)
        let isPinned = parent.projects[safe: targetOffset]?.isPinned ?? draggedProject.isPinned
        let destinationIndex = parent.projects.prefix(targetOffset).count { $0.isPinned == isPinned }
        parent.terminal.moveProject(projectID, isPinned: isPinned, at: destinationIndex)

      case .tab(let tabID):
        guard case .project(let targetProjectID)? = sections[safe: indexPath.section] else {
          return false
        }
        let targetTabs = parent.groups.first(where: { $0.projectID == targetProjectID })?.tabs ?? []
        guard
          let draggedTab = parent.groups.lazy.flatMap(\.tabs).first(where: { $0.id == tabID })
        else { return false }
        let targetOffset = min(max(0, indexPath.item - 1), targetTabs.count)
        let isPinned = targetTabs[safe: targetOffset]?.isPinned ?? draggedTab.isPinned
        let destinationIndex = targetTabs.prefix(targetOffset).count { $0.isPinned == isPinned }
        parent.terminal.moveTab(
          tabID,
          to: targetProjectID,
          isPinned: isPinned,
          at: destinationIndex
        )
      case .newProject:
        return false
      }
      return true
    }

    private func draggedValue(from draggingInfo: NSDraggingInfo) -> TerminalSidebarItemID? {
      guard let value = draggingInfo.draggingPasteboard.string(forType: Self.dragType) else { return nil }
      let components = value.split(separator: ":", maxSplits: 1).map(String.init)
      guard components.count == 2, let uuid = UUID(uuidString: components[1]) else { return nil }
      return components[0] == "project"
        ? .project(TerminalProjectID(rawValue: uuid))
        : .tab(TerminalTabID(rawValue: uuid))
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
        item.host(view, dragValue: dragValue(for: itemID))
      }
    }

    private func dragValue(for itemID: TerminalSidebarItemID) -> String? {
      switch itemID {
      case .project(let projectID):
        "project:\(projectID.rawValue.uuidString)"
      case .tab(let tabID):
        "tab:\(tabID.rawValue.uuidString)"
      case .newProject:
        nil
      }
    }

    private func scheduleExpansion(_ projectID: TerminalProjectID) {
      guard parent.collapsedProjectIDs.contains(projectID) else { return }
      pendingExpansion?.cancel()
      pendingExpansion = Task { @MainActor [weak self] in
        try? await Task.sleep(for: .milliseconds(600))
        guard !Task.isCancelled else { return }
        self?.parent.collapsedProjectIDs.remove(projectID)
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

@MainActor
private final class TerminalSidebarCollectionViewController: NSViewController {
  let collectionView = NSCollectionView()
  private var lastLayoutWidth: CGFloat = 0

  override func loadView() {
    let layout = NSCollectionViewFlowLayout()
    layout.minimumLineSpacing = TerminalSidebarLayout.tabRowSpacing
    layout.sectionInset = NSEdgeInsets(top: 0, left: 8, bottom: 8, right: 8)
    let scrollView = NSScrollView()
    scrollView.drawsBackground = false
    scrollView.hasVerticalScroller = false
    scrollView.contentInsets.top = TerminalSidebarLayout.firstVisibleSectionTopInset
    collectionView.translatesAutoresizingMaskIntoConstraints = false
    scrollView.documentView = collectionView
    collectionView.widthAnchor.constraint(equalTo: scrollView.contentView.widthAnchor).isActive = true
    collectionView.collectionViewLayout = layout
    collectionView.backgroundColors = [.clear]
    collectionView.isSelectable = false
    collectionView.register(
      TerminalSidebarCollectionItem.self,
      forItemWithIdentifier: TerminalSidebarCollectionItem.identifier
    )
    view = scrollView
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    let width = collectionView.bounds.width
    guard width > 0, width != lastLayoutWidth else { return }
    lastLayoutWidth = width
    invalidateLayoutMetrics()
  }

  func invalidateLayoutMetrics() {
    guard let layout = collectionView.collectionViewLayout as? NSCollectionViewFlowLayout else { return }
    let context = NSCollectionViewFlowLayoutInvalidationContext()
    context.invalidateFlowLayoutDelegateMetrics = true
    layout.invalidateLayout(with: context)
  }
}

@MainActor
private final class TerminalSidebarCollectionItem: NSCollectionViewItem,
  NSDraggingSource,
  NSGestureRecognizerDelegate
{
  static let identifier = NSUserInterfaceItemIdentifier("TerminalSidebarCollectionItem")

  private var hostingView: NSHostingView<AnyView>?
  private var dragValue: String?

  override func loadView() {
    view = NSView()
    let recognizer = NSPanGestureRecognizer(target: self, action: #selector(handleDrag(_:)))
    recognizer.buttonMask = 1
    recognizer.delaysPrimaryMouseButtonEvents = false
    recognizer.delegate = self
    view.addGestureRecognizer(recognizer)
  }

  func host(_ view: AnyView, dragValue: String?) {
    self.dragValue = dragValue
    if let hostingView {
      hostingView.rootView = view
      return
    }
    let hostingView = NSHostingView(rootView: view)
    hostingView.translatesAutoresizingMaskIntoConstraints = false
    self.view.addSubview(hostingView)
    NSLayoutConstraint.activate([
      hostingView.leadingAnchor.constraint(equalTo: self.view.leadingAnchor),
      hostingView.trailingAnchor.constraint(equalTo: self.view.trailingAnchor),
      hostingView.topAnchor.constraint(equalTo: self.view.topAnchor),
      hostingView.bottomAnchor.constraint(equalTo: self.view.bottomAnchor),
    ])
    self.hostingView = hostingView
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    .move
  }

  func gestureRecognizer(
    _ gestureRecognizer: NSGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: NSGestureRecognizer
  ) -> Bool {
    true
  }

  @objc private func handleDrag(_ recognizer: NSPanGestureRecognizer) {
    guard
      recognizer.state == .began,
      let dragValue,
      let event = NSApp.currentEvent
    else { return }
    let pasteboardItem = NSPasteboardItem()
    pasteboardItem.setString(dragValue, forType: TerminalSidebarProjectList.Coordinator.dragType)
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(view.bounds, contents: draggingImage())
    view.beginDraggingSession(with: [draggingItem], event: event, source: self)
  }

  private func draggingImage() -> NSImage {
    let image = NSImage(size: view.bounds.size)
    guard let representation = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
      return image
    }
    view.cacheDisplay(in: view.bounds, to: representation)
    image.addRepresentation(representation)
    return image
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

extension Array {
  fileprivate subscript(safe index: Index) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
