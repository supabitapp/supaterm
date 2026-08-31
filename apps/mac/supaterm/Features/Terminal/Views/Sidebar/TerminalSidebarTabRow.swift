import AppKit
import SupaTheme
import SwiftUI

struct TerminalSidebarTabRow: View {
  private struct AnimatedPresentation: Equatable {
    let panes: [TerminalTabPanePresentation]
    let terminalProgress: TerminalTabProgress?
  }

  let terminal: TerminalHostState
  let tab: TerminalTabItem
  let groupID: TerminalTabGroupID?
  let rootIsPinned: Bool
  let renameState: TerminalSidebarRenameState?
  let selectionState: TerminalTabSelectionState
  let visibleTabIDs: [TerminalTabID]
  let panes: [TerminalTabPanePresentation]
  let terminalProgress: TerminalTabProgress?
  let palette: Palette
  let shortcutHint: String?
  let showsShortcutHint: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isHovering = false
  @State private var isPressed = false

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

  var body: some View {
    let isGrouped = groupID != nil
    let contentInsets = TerminalSidebarLayout.tabContentHorizontalInsets(isGrouped: isGrouped)
    let surfaceInsets = TerminalSidebarLayout.tabSurfaceHorizontalInsets(isGrouped: isGrouped)
    TerminalSidebarTabSummaryView(
      tab: tab,
      palette: palette,
      isSelected: isSelected,
      isPinned: groupID == nil && rootIsPinned,
      panes: panes,
      terminalProgress: terminalProgress,
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isHovering
    )
    .help(TerminalSidebarTabSummaryView.helpText(tab: tab, panes: panes))
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
    .overlay(alignment: .trailing) {
      if isHovering {
        TerminalSidebarTabCloseButton(
          palette: palette,
          isSelected: isSelected,
          action: close
        )
      }
    }
    .onHover { isHovering = $0 }
    .contextMenu {
      let contextualTabIDs = selectionState.contextualTabIDs(
        for: tab.id,
        primaryTabID: terminal.selectedTabID,
        visibleTabIDs: visibleTabIDs
      )
      if let model = TerminalTabContextMenuModel.menu(
        for: .tab(tab.id),
        contextualTabIDs: contextualTabIDs,
        snapshot: terminal.spaceManager.displayedInstance.tabSurfaceSnapshot,
        paneCount: terminal.trees[tab.id]?.leaves().count ?? 0,
        layout: .sidebar
      ) {
        TerminalSidebarContextMenu(
          model: model,
          dispatcher: TerminalTabContextMenuDispatcher(
            terminal: terminal,
            beginGroupRename: { groupID, title in
              renameState?.begin(groupID: groupID, title: title)
            }
          ),
          newTabInGroupShortcut: nil
        )
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
      panes: panes,
      terminalProgress: terminalProgress
    )
  }

  private var accessibilityIdentifier: String {
    TerminalSidebarAccessibilityIdentifier.tab(tab.id, groupID: groupID)
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

struct TerminalSidebarTabCloseButton: View {
  let palette: Palette
  let isSelected: Bool
  let action: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      Image(systemName: "xmark")
        .font(.system(size: 12, weight: .heavy))
        .foregroundStyle(isSelected ? palette.selectedText : palette.selectableRow.title)
        .frame(
          width: TerminalSidebarLayout.tabTrailingAccessorySize,
          height: TerminalSidebarLayout.tabTrailingAccessorySize
        )
        .accessibilityHidden(true)
        .background(
          isHovering
            ? (isSelected ? palette.selectedPillFill : palette.unselectedFill)
            : .clear,
          in: RoundedRectangle(cornerRadius: 6, style: .continuous)
        )
    }
    .buttonStyle(.plain)
    .help("Close")
    .accessibilityLabel("Close")
    .padding(.trailing, TerminalSidebarLayout.tabCloseButtonOuterPadding)
    .onHover { isHovering = $0 }
  }
}

struct TerminalSidebarContextMenu: View {
  let model: TerminalTabContextMenuModel
  let dispatcher: TerminalTabContextMenuDispatcher
  let newTabInGroupShortcut: KeyboardShortcut?

  var body: some View {
    ForEach(Array(model.items.enumerated()), id: \.offset) { _, item in
      switch item {
      case .action(let action):
        TerminalSidebarContextMenuButton(
          action: action,
          dispatcher: dispatcher,
          newTabInGroupShortcut: newTabInGroupShortcut
        )
      case .submenu(let submenu):
        TerminalSidebarContextSubmenu(
          submenu: submenu,
          dispatcher: dispatcher,
          newTabInGroupShortcut: newTabInGroupShortcut
        )
      case .separator:
        Divider()
      }
    }
  }
}

private struct TerminalSidebarContextSubmenu: View {
  let submenu: TerminalTabContextSubmenu
  let dispatcher: TerminalTabContextMenuDispatcher
  let newTabInGroupShortcut: KeyboardShortcut?

  var body: some View {
    Menu {
      ForEach(Array(submenu.items.enumerated()), id: \.offset) { _, action in
        TerminalSidebarContextMenuButton(
          action: action,
          dispatcher: dispatcher,
          newTabInGroupShortcut: newTabInGroupShortcut
        )
      }
    } label: {
      Label(submenu.title, systemImage: submenu.symbol)
    }
    .disabled(!submenu.isEnabled)
  }
}

private struct TerminalSidebarContextMenuButton: View {
  let action: TerminalTabContextMenuActionItem
  let dispatcher: TerminalTabContextMenuDispatcher
  let newTabInGroupShortcut: KeyboardShortcut?

  private var role: ButtonRole? {
    action.role == .destructive ? .destructive : nil
  }

  private var keyboardShortcut: KeyboardShortcut? {
    guard case .createTabInGroup = action.action else { return nil }
    return newTabInGroupShortcut
  }

  var body: some View {
    Button(role: role) {
      dispatcher.perform(action.action)
    } label: {
      if action.symbol == nil, action.state == .on {
        Label(action.title, systemImage: "checkmark")
      } else if let symbol = action.symbol {
        Label(action.title, systemImage: symbol)
      } else {
        Text(action.title)
      }
    }
    .disabled(!action.isEnabled)
    .supatermKeyboardShortcut(keyboardShortcut)
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
