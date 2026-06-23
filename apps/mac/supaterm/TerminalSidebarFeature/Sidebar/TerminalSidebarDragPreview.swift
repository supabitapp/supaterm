@preconcurrency import AppKit
import Combine
import SupatermTerminalFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SwiftUI

@MainActor
final class TerminalSidebarDragPreviewWindow: NSWindow {
  static let previewSize = NSSize(width: 320, height: 160)

  private weak var manager: TerminalSidebarDragSession?
  private var cancellables = Set<AnyCancellable>()

  init(manager: TerminalSidebarDragSession) {
    self.manager = manager

    super.init(
      contentRect: NSRect(origin: .zero, size: Self.previewSize),
      styleMask: [.borderless],
      backing: .buffered,
      defer: true
    )

    isOpaque = false
    backgroundColor = .clear
    level = .floating
    ignoresMouseEvents = true
    hasShadow = false
    isReleasedWhenClosed = false
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    contentView = NSHostingView(
      rootView: AnyView(TerminalSidebarDragPreviewContent(manager: manager))
    )

    manager.$draggedItem
      .map { $0 != nil }
      .removeDuplicates()
      .receive(on: RunLoop.main)
      .sink { [weak self] isVisible in
        guard let self else { return }
        if isVisible {
          self.orderFront(nil)
        } else {
          self.orderOut(nil)
        }
      }
      .store(in: &cancellables)

    manager.$cursorScreenLocation
      .receive(on: RunLoop.main)
      .sink { [weak self] screenPoint in
        self?.updatePosition(screenPoint: screenPoint)
      }
      .store(in: &cancellables)

    manager.$activeZone
      .receive(on: RunLoop.main)
      .sink { [weak self] _ in
        guard let self, let manager = self.manager else { return }
        self.updatePosition(screenPoint: manager.cursorScreenLocation)
      }
      .store(in: &cancellables)

    manager.$sidebarScreenFrame
      .receive(on: RunLoop.main)
      .sink { [weak self] _ in
        guard let self, let manager = self.manager else { return }
        self.updatePosition(screenPoint: manager.cursorScreenLocation)
      }
      .store(in: &cancellables)
  }

  private func updatePosition(
    screenPoint: NSPoint
  ) {
    guard let manager, manager.isDragging else { return }
    let size = Self.previewSize

    if manager.isSidebarReorder {
      let origin = NSPoint(
        x: manager.sidebarScreenFrame.midX - (size.width / 2),
        y: screenPoint.y - (size.height / 2)
      )
      setFrame(NSRect(origin: origin, size: size), display: true)
      return
    }

    let origin = NSPoint(
      x: screenPoint.x - (size.width / 2),
      y: screenPoint.y - (size.height / 2)
    )
    setFrame(NSRect(origin: origin, size: size), display: true)
  }
}

private struct TerminalSidebarDragPreviewContent: View {
  @ObservedObject var manager: TerminalSidebarDragSession

  var body: some View {
    Group {
      if let preview = manager.draggedPreview {
        let palette = TerminalPalette(colorScheme: manager.colorScheme)
        TerminalSidebarMorphingPreview(
          tab: preview.tab,
          notificationPreviewMarkdown: preview.notificationPreviewMarkdown,
          paneWorkingDirectories: preview.paneWorkingDirectories,
          unreadCount: preview.unreadCount,
          badgeActivities: preview.badgeActivities,
          badgeActivity: preview.badgeActivity,
          badgeActivityIsFocused: preview.badgeActivityIsFocused,
          terminalProgress: preview.terminalProgress,
          hasTerminalBell: preview.hasTerminalBell,
          showsAgentMarks: preview.showsAgentMarks,
          showsAgentSpinner: preview.showsAgentSpinner,
          rowWidth: manager.previewRowWidth,
          palette: palette
        )
      } else {
        Color.clear
      }
    }
    .frame(
      width: TerminalSidebarDragPreviewWindow.previewSize.width,
      height: TerminalSidebarDragPreviewWindow.previewSize.height
    )
  }
}

private struct TerminalSidebarMorphingPreview: View {
  let tab: TerminalTabItem
  let notificationPreviewMarkdown: String?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let badgeActivities: [TerminalHostState.AgentActivity]
  let badgeActivity: TerminalHostState.AgentActivity?
  let badgeActivityIsFocused: Bool
  let terminalProgress: TerminalSidebarTerminalProgress?
  let hasTerminalBell: Bool
  let showsAgentMarks: Bool
  let showsAgentSpinner: Bool
  let rowWidth: CGFloat
  let palette: TerminalPalette

  var body: some View {
    TerminalSidebarTabSummaryView(
      tab: tab,
      palette: palette,
      isSelected: false,
      notificationPreviewMarkdown: notificationPreviewMarkdown,
      paneWorkingDirectories: paneWorkingDirectories,
      unreadCount: unreadCount,
      badgeActivities: badgeActivities,
      badgeActivity: badgeActivity,
      badgeActivityIsFocused: badgeActivityIsFocused,
      hasTerminalBell: hasTerminalBell,
      terminalProgress: terminalProgress,
      showsAgentMarks: showsAgentMarks,
      showsAgentSpinner: showsAgentSpinner,
      shortcutHint: nil,
      showsShortcutHint: false,
      isRowHovering: false
    )
    .lineLimit(10)
    .padding(.horizontal, TerminalSidebarLayout.tabRowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(width: rowWidth)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .background(Color(nsColor: .controlBackgroundColor).opacity(0.95))
    .clipShape(
      RoundedRectangle(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius, style: .continuous)
        .stroke(Color.primary.opacity(0.08), lineWidth: 1)
    }
    .shadow(
      color: .black.opacity(0.25),
      radius: 8,
      y: 2
    )
  }
}
