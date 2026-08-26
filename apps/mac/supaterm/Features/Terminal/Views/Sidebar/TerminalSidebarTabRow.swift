import AppKit
import SupaTheme
import SwiftUI

struct TerminalSidebarTabRow: View {
  enum ContextMenuItem: Equatable {
    case newTab
    case divider
    case togglePinned(Bool)
    case moveToNewProject
    case moveToProject
    case removeFromProject
    case changeTabTitle
    case closeTabsBelow(Bool)
    case closeOtherTabs(Bool)
    case close

    var title: String? {
      switch self {
      case .newTab:
        "New Tab"
      case .divider:
        nil
      case .togglePinned(let isPinned):
        isPinned ? "Unpin Tab" : "Pin Tab"
      case .moveToNewProject:
        "Move to New Project"
      case .moveToProject:
        "Move to Project..."
      case .removeFromProject:
        "Remove from Project"
      case .changeTabTitle:
        "Change Tab Title..."
      case .closeTabsBelow:
        "Close All Below"
      case .closeOtherTabs:
        "Close Others"
      case .close:
        "Close"
      }
    }
  }

  enum CloseButtonPresentation: Equatable {
    case hidden
    case enabled
  }

  private struct AnimatedPresentation: Equatable {
    let agentStatus: TerminalHostState.TabAgentStatus?
    let details: [TerminalSidebarTabDetail]
    let hasTerminalBell: Bool
    let terminalProgress: TerminalSidebarTerminalProgress?
    let unreadCount: Int

    static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.agentStatus == rhs.agentStatus
        && lhs.details == rhs.details
        && lhs.hasTerminalBell == rhs.hasTerminalBell
        && lhs.terminalProgress == rhs.terminalProgress
        && lhs.unreadCount == rhs.unreadCount
    }
  }

  let terminal: TerminalHostState
  let tab: TerminalTabItem
  let projectID: TerminalProjectID?
  let rootIsPinned: Bool
  let renameState: TerminalSidebarRenameState?
  let selectionState: TerminalSidebarTabSelectionState
  let outline: TerminalSidebarOutline
  let agentStatus: TerminalHostState.TabAgentStatus?
  let details: [TerminalSidebarTabDetail]
  let unreadCount: Int
  let terminalProgress: TerminalSidebarTerminalProgress?
  let hasTerminalBell: Bool
  let palette: Palette
  let shortcutHint: String?
  let showsShortcutHint: Bool

  static func contextMenuItems(
    isPinned: Bool,
    hasTabsBelow: Bool,
    hasOtherTabs: Bool,
    isProjected: Bool = false
  ) -> [ContextMenuItem] {
    var items: [ContextMenuItem] = [
      .newTab,
      .divider,
    ]
    items.append(contentsOf: [
      .togglePinned(isPinned),
      .moveToNewProject,
      .moveToProject,
    ])
    if isProjected {
      items.append(.removeFromProject)
    }
    items.append(.changeTabTitle)
    items.append(contentsOf: [
      .divider,
      .closeTabsBelow(hasTabsBelow),
      .closeOtherTabs(hasOtherTabs),
      .divider,
      .close,
    ])
    return items
  }

  static func closeButtonPresentation(
    isHovering: Bool,
    showsShortcutHint: Bool
  ) -> CloseButtonPresentation {
    guard isHovering, !showsShortcutHint else { return .hidden }
    return .enabled
  }

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isHovering = false
  @State private var isPressed = false
  @State private var isCloseHovering = false

  private var selectionStyle: SelectableRowSelection {
    selectionState.style(for: tab.id, primaryTabID: terminal.selectedTabID)
  }

  private var isSelected: Bool {
    selectionStyle != .none
  }

  private var rowFill: Color {
    guard selectionStyle != .primary else { return .clear }
    return rowAppearance.fill(
      selection: selectionStyle,
      isPressed: isPressed,
      isHovering: isHovering
    )
  }

  private var contextSurfaceID: UUID? {
    terminal.contextSurfaceID(for: tab.id)
  }

  private var hasTabsBelow: Bool {
    guard let index = terminal.tabs.firstIndex(where: { $0.id == tab.id }) else { return false }
    return terminal.tabs.index(after: index) < terminal.tabs.endIndex
  }

  private var hasOtherTabs: Bool {
    terminal.tabs.contains { $0.id != tab.id }
  }

  var body: some View {
    let isProjected = projectID != nil
    let contentInsets = TerminalSidebarLayout.tabContentHorizontalInsets(isProjected: isProjected)
    let surfaceInsets = TerminalSidebarLayout.tabSurfaceHorizontalInsets(isProjected: isProjected)
    let summary = TerminalSidebarTabSummaryView(
      tab: tab,
      palette: palette,
      isSelected: isSelected,
      isPinned: rootIsPinned,
      details: details,
      unreadCount: unreadCount,
      agentStatus: agentStatus,
      hasTerminalBell: hasTerminalBell,
      terminalProgress: terminalProgress,
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isHovering
    )
    .lineLimit(8)

    Group {
      if let helpText = TerminalSidebarTabSummaryView.helpText(
        details: details
      ) {
        summary.help(helpText)
      } else {
        summary
      }
    }
    .padding(.leading, contentInsets.leading)
    .padding(.trailing, contentInsets.trailing)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .frame(maxWidth: .infinity)
    .background {
      rowFill
        .modifier(
          SelectableRowChrome(
            selection: selectionStyle,
            cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
            appearance: rowAppearance,
            showsSelectionEdge: false,
            showsSelectionShadow: false
          )
        )
        .padding(.leading, surfaceInsets.leading)
        .padding(.trailing, surfaceInsets.trailing)
    }
    .terminalAnimation(
      .spring(response: 0.24, dampingFraction: 0.88),
      value: animatedPresentation,
      reduceMotion: reduceMotion
    )
    .overlay {
      TerminalSidebarRowPointerView(entryID: .tab(tab.id), isPressed: $isPressed)
    }
    .overlay(
      TerminalSidebarMiddleClickActionView(action: close)
    )
    .overlay(alignment: .topTrailing) {
      let closeButtonPresentation = Self.closeButtonPresentation(
        isHovering: isHovering,
        showsShortcutHint: showsShortcutHint
      )
      if closeButtonPresentation != .hidden {
        Button(action: close) {
          Image(systemName: "xmark")
            .font(.system(size: 12, weight: .heavy))
            .foregroundStyle(isSelected ? palette.selectedText : palette.selectableRow.title)
            .frame(
              width: TerminalSidebarLayout.tabTrailingAccessorySize,
              height: TerminalSidebarLayout.tabTrailingAccessorySize
            )
            .accessibilityHidden(true)
            .background(
              isCloseHovering
                ? (isSelected ? palette.selectedPillFill : palette.unselectedFill)
                : .clear,
              in: RoundedRectangle(cornerRadius: 6, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .help("Close")
        .accessibilityLabel("Close")
        .padding(.top, TerminalSidebarLayout.tabRowVerticalPadding)
        .padding(.trailing, TerminalSidebarLayout.rowHorizontalPadding)
        .onHover { isCloseHovering = $0 }
      }
    }
    .onHover { isHovering in
      self.isHovering = isHovering
      if !isHovering {
        isCloseHovering = false
      }
    }
    .contextMenu {
      let contextualTabIDs = selectionState.contextualTabIDs(
        for: tab.id,
        primaryTabID: terminal.selectedTabID,
        outline: outline
      )
      if contextualTabIDs.count > 1 {
        TerminalSidebarBatchTabMenu(
          terminal: terminal,
          tabIDs: contextualTabIDs,
          contextualTabID: tab.id,
          renameState: renameState
        )
      } else {
        ForEach(
          Array(
            Self.contextMenuItems(
              isPinned: rootIsPinned,
              hasTabsBelow: hasTabsBelow,
              hasOtherTabs: hasOtherTabs,
              isProjected: projectID != nil
            ).enumerated()
          ),
          id: \.offset
        ) { _, item in
          switch item {
          case .newTab:
            Button {
              AppPostHog.capture("terminal_tab_created")
              _ = terminal.createTab(inheritingFromSurfaceID: contextSurfaceID)
            } label: {
              Label("New Tab", systemImage: "plus")
            }

          case .divider:
            Divider()

          case .togglePinned(let isPinned):
            Button {
              terminal.togglePinned(tab.id)
            } label: {
              Label(isPinned ? "Unpin Tab" : "Pin Tab", systemImage: isPinned ? "pin.slash" : "pin")
            }

          case .moveToNewProject:
            Button {
              createSidebarProject(
                terminal: terminal,
                tabIDs: [tab.id],
                renameState: renameState
              )
            } label: {
              Label("Move to New Project", systemImage: "rectangle.3.project")
            }

          case .moveToProject:
            Menu {
              ForEach(availableProjects) { section in
                Button(section.project.name) {
                  _ = terminal.assignTabs([tab.id], to: section.id)
                }
              }
            } label: {
              Label("Move to Project...", systemImage: "arrow.right")
            }
            .disabled(availableProjects.isEmpty)

          case .removeFromProject:
            Button {
              terminal.removeTabFromProject(tab.id)
            } label: {
              Label("Remove from Project", systemImage: "arrow.up.backward")
            }

          case .changeTabTitle:
            Button {
              terminal.promptTabTitle(tab.id)
            } label: {
              Label("Change Tab Title...", systemImage: "pencil")
            }

          case .closeTabsBelow(let isEnabled):
            Button {
              terminal.requestCloseTabsBelow(tab.id)
            } label: {
              Label("Close All Below", systemImage: "arrow.down.to.line")
            }
            .disabled(!isEnabled)

          case .closeOtherTabs(let isEnabled):
            Button {
              terminal.requestCloseOtherTabs(keeping: [tab.id])
            } label: {
              Label("Close Others", systemImage: "xmark.circle")
            }
            .disabled(!isEnabled)

          case .close:
            Button(role: .destructive) {
              terminal.requestCloseTab(tab.id)
            } label: {
              Label("Close", systemImage: "xmark")
            }
          }
        }
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
    .accessibilityAddTraits(isSelected ? .isSelected : [])
    .accessibilityAction { select() }
    .accessibilityAction(named: "Close") { close() }
    .accessibilityIdentifier(accessibilityIdentifier)
  }

  private var rowAppearance: SelectableRowStyle.ResolvedAppearance {
    SelectableRowStyle.Appearance.sidebar.resolve(palette: palette)
  }

  private var animatedPresentation: AnimatedPresentation {
    AnimatedPresentation(
      agentStatus: agentStatus,
      details: details,
      hasTerminalBell: hasTerminalBell,
      terminalProgress: terminalProgress,
      unreadCount: unreadCount
    )
  }

  private var availableProjects: [TerminalProjectSectionItem] {
    terminal.projectSections().filter { $0.id != projectID }
  }

  private var accessibilityIdentifier: String {
    TerminalSidebarAccessibilityIdentifier.tab(tab.id, projectID: projectID)
  }

  private func select() {
    selectionState.clear()
    terminal.selectTab(tab.id)
  }

  private func close() {
    TerminalMotion.animate(.easeInOut(duration: 0.15), reduceMotion: reduceMotion) {
      terminal.requestCloseTab(tab.id)
    }
  }
}

func createSidebarProject(
  terminal: TerminalHostState,
  tabIDs: [TerminalTabID],
  renameState: TerminalSidebarRenameState?
) {
  guard let title = terminal.suggestedProjectName(containing: tabIDs) else { return }
  let result = terminal.createProject(
    name: title,
    rootPath: terminal.suggestedProjectRoot(containing: tabIDs),
    color: .neutral,
    containing: tabIDs
  )
  if let result {
    renameState?.begin(projectID: result.projectID, title: title)
  }
}

struct TerminalSidebarBatchTabMenu: View {
  enum PinAction: Equatable {
    case pin
    case unpin
    case disabled
  }

  let terminal: TerminalHostState
  let tabIDs: [TerminalTabID]
  let contextualTabID: TerminalTabID
  let renameState: TerminalSidebarRenameState?

  var body: some View {
    Button(pinTitle, systemImage: pinAction == .unpin ? "pin.slash" : "pin") {
      togglePinned()
    }
    .disabled(pinAction == .disabled)

    Button("New Project with \(tabIDs.count) Tabs", systemImage: "rectangle.3.project") {
      createProject()
    }

    Menu("Move to Project", systemImage: "arrow.right") {
      ForEach(projects) { section in
        Button(section.project.name) {
          moveToProject(section)
        }
        .disabled(moveToProjectIsNoOp(section))
      }
    }
    .disabled(projects.isEmpty)

    if sharedProject != nil {
      Button("Remove from Project", systemImage: "arrow.up.backward") {
        removeFromProject()
      }
    }

    Divider()

    Button(role: .destructive) {
      terminal.requestCloseTabs(tabIDs)
    } label: {
      Label("Close \(tabIDs.count) Tabs", systemImage: "xmark")
    }

    Button("Close Other Tabs", systemImage: "xmark.circle") {
      terminal.requestCloseOtherTabs(keeping: tabIDs)
    }
    .disabled(!hasOtherTabs)

    Button("Close Tabs Below", systemImage: "arrow.down.to.line") {
      terminal.requestCloseTabsBelow(contextualTabID)
    }
    .disabled(!hasTabsBelow)
  }

  var pinAction: PinAction {
    let pinStates = Set(tabIDs.map { terminal.isPinned($0) })
    guard pinStates.count == 1, let isPinned = pinStates.first else { return .disabled }
    return isPinned ? .unpin : .pin
  }

  private var pinTitle: String {
    "\(pinAction == .unpin ? "Unpin" : "Pin") \(tabIDs.count) Tabs"
  }

  private var projects: [TerminalProjectSectionItem] {
    terminal.projectSections()
  }

  private var sharedProject: TerminalProjectSectionItem? {
    let selected = Set(tabIDs)
    return projects.first { section in
      selected.isSubset(of: Set(section.tabs.map(\.id))) && selected.count == tabIDs.count
    }
  }

  private var hasOtherTabs: Bool {
    let selected = Set(tabIDs)
    return terminal.tabs.contains { !selected.contains($0.id) }
  }

  private var hasTabsBelow: Bool {
    guard let index = terminal.tabs.firstIndex(where: { $0.id == contextualTabID }) else {
      return false
    }
    return terminal.tabs.index(after: index) < terminal.tabs.endIndex
  }

  private func togglePinned() {
    guard pinAction != .disabled else { return }
    let isPinned = pinAction == .pin
    for tabID in tabIDs {
      _ = terminal.setTabPinned(tabID, isPinned: isPinned)
    }
  }

  private func createProject() {
    createSidebarProject(
      terminal: terminal,
      tabIDs: tabIDs,
      renameState: renameState
    )
  }

  private func moveToProject(_ section: TerminalProjectSectionItem) {
    _ = terminal.assignTabs(tabIDs, to: section.id)
  }

  private func moveToProjectIsNoOp(_ section: TerminalProjectSectionItem) -> Bool {
    let selected = Set(tabIDs)
    return section.tabs.map(\.id).filter { !selected.contains($0) } + tabIDs
      == section.tabs.map(\.id)
  }

  private func removeFromProject() {
    _ = terminal.assignTabs(tabIDs, to: nil)
  }
}

private struct TerminalSidebarMiddleClickActionView: NSViewRepresentable {
  let action: () -> Void

  func makeNSView(context: Context) -> TerminalSidebarMiddleClickNSView {
    TerminalSidebarMiddleClickNSView(action: action)
  }

  func updateNSView(_ nsView: TerminalSidebarMiddleClickNSView, context: Context) {
    nsView.action = action
  }
}

private final class TerminalSidebarMiddleClickNSView: NSView {
  var action: () -> Void

  init(action: @escaping () -> Void) {
    self.action = action
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard let event = NSApp.currentEvent,
      event.type == .otherMouseDown || event.type == .otherMouseUp
    else { return nil }
    return super.hitTest(point)
  }

  override func otherMouseUp(with event: NSEvent) {
    if event.buttonNumber == 2 {
      action()
    } else {
      super.otherMouseUp(with: event)
    }
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
