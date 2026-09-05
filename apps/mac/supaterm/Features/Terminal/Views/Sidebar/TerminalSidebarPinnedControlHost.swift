import AppKit
import SupaTheme
import SwiftUI

@MainActor
final class TerminalSidebarPinnedControlHost {
  let view = TerminalSidebarPinnedControlView(frame: .zero)

  var height: CGFloat {
    view.isHidden ? 0 : TerminalSidebarLayout.pinnedControlHeight
  }

  var isPinned: Bool { !view.isHidden }

  init(
    draggingUpdated: @escaping (any NSDraggingInfo) -> NSDragOperation,
    draggingExited: @escaping () -> Void,
    draggingEnded: @escaping () -> Void,
    prepareForDragOperation: @escaping (any NSDraggingInfo) -> Bool,
    performDragOperation: @escaping (any NSDraggingInfo) -> Bool
  ) {
    view.isHidden = true
    view.onDraggingUpdated = draggingUpdated
    view.onDraggingExited = draggingExited
    view.onDraggingEnded = draggingEnded
    view.onPrepareForDragOperation = prepareForDragOperation
    view.onPerformDragOperation = performDragOperation
  }

  func update(context: TerminalSidebarRowContext) {
    view.host(
      entryID: .newTab,
      TerminalSidebarHostedRow(presentation: .newTab(.pinned), context: context)
    )
  }

  func setPinned(_ isPinned: Bool) -> Bool {
    guard self.isPinned != isPinned else { return false }
    view.isHidden = !isPinned
    return true
  }

  func layout(in frame: CGRect) {
    var resolvedFrame = frame
    if view.isHidden {
      resolvedFrame.size.height = view.frame.height
    }
    guard view.frame != resolvedFrame else { return }
    view.frame = resolvedFrame
  }
}

@MainActor
final class TerminalSidebarPinnedTabsBackgroundView: NSView {
  static let zPosition: CGFloat = 20

  private let chromeBackground = ChromeBackgroundNSView()
  private var appliedColorScheme: ColorScheme?
  private var appliedTint: ThemeTint?
  private var appliedSurfaceStyle: TerminalSidebarSurfaceStyle?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.masksToBounds = true
    layer?.zPosition = Self.zPosition
    isHidden = true
    setAccessibilityElement(false)
    addSubview(chromeBackground)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { nil }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func update(
    frame: CGRect?,
    palette: Palette,
    chromeContainer: NSView,
    surfaceStyle: TerminalSidebarSurfaceStyle
  ) {
    guard let frame, !frame.isEmpty else {
      isHidden = true
      return
    }
    self.frame = frame
    chromeBackground.frame = convert(chromeContainer.bounds, from: chromeContainer)
    if appliedSurfaceStyle != surfaceStyle {
      switch surfaceStyle {
      case .docked:
        chromeBackground.configureBackdrop(
          material: .underWindowBackground,
          blendingMode: .behindWindow
        )
      case .floating:
        chromeBackground.configureBackdrop(
          material: .popover,
          blendingMode: .withinWindow
        )
      }
      appliedSurfaceStyle = surfaceStyle
    }
    if appliedColorScheme != palette.colorScheme || appliedTint != palette.tint {
      chromeBackground.apply(palette)
      appliedColorScheme = palette.colorScheme
      appliedTint = palette.tint
    }
    isHidden = false
  }
}
