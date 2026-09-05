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
  weak var collectionView: TerminalSidebarCollectionView?
  weak var scrollView: NSScrollView?
  private var parkedItems: [TerminalSidebarEntryID: TerminalSidebarCollectionItem] = [:]
  private var parkedRows: [TerminalSidebarEntryID: NSView] = [:]
  private var pointerTrackingArea: NSTrackingArea?

  override var isFlipped: Bool { true }

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
    registerForDraggedTypes([.terminalTabDrag])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { nil }

  func park(
    items: [(TerminalSidebarCollectionItem, CGRect)],
    active: Set<TerminalSidebarEntryID>,
    retained: Set<TerminalSidebarEntryID>
  ) {
    for (id, previousItem) in parkedItems where !active.contains(id) {
      let item = items.first { $0.0.entryID == id }?.0 ?? previousItem
      if item.entryID == id {
        if let row = parkedRows[id], row.superview === self {
          if item !== previousItem { previousItem.releaseHostedView(row) }
          item.adoptParkedView(row)
        }
        item.parkHostedView(in: nil, frame: .zero)
      } else {
        parkedRows[id]?.removeFromSuperview()
      }
      if !retained.contains(id) {
        parkedItems[id] = nil
        parkedRows[id] = nil
      }
    }
    for (item, frame) in items {
      guard let id = item.entryID, active.contains(id) || parkedRows[id] != nil else { continue }
      if let row = parkedRows[id] {
        // A drag preview temporarily owns lifted content until its handoff ends.
        if row.superview !== self, item.hostedView == nil, active.contains(id) { continue }
        if let previousItem = parkedItems[id], previousItem !== item {
          previousItem.releaseHostedView(row)
        }
        item.adoptParkedView(row)
      }
      parkedRows[id] = item.hostedView
      parkedItems[id] = item
      item.parkHostedView(in: active.contains(id) ? self : nil, frame: frame)
    }
  }

  override func scrollWheel(with event: NSEvent) {
    scrollView?.scrollWheel(with: event)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let pointerTrackingArea { removeTrackingArea(pointerTrackingArea) }
    let area = NSTrackingArea(
      rect: .zero,
      options: [.activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited, .mouseMoved],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(area)
    pointerTrackingArea = area
  }

  override func mouseEntered(with event: NSEvent) {
    collectionView?.onPointerMoved?(collectionView?.pointerLocation)
  }

  override func mouseMoved(with event: NSEvent) {
    collectionView?.onPointerMoved?(collectionView?.pointerLocation)
  }

  override func mouseExited(with event: NSEvent) {
    collectionView?.onPointerExited?()
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    collectionView?.draggingEntered(sender) ?? []
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    collectionView?.draggingUpdated(sender) ?? []
  }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    collectionView?.draggingExited(sender)
  }

  override func draggingEnded(_ sender: any NSDraggingInfo) {
    collectionView?.draggingEnded(sender)
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    collectionView?.prepareForDragOperation(sender) == true
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    collectionView?.performDragOperation(sender) == true
  }

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
    if self.frame != frame { self.frame = frame }
    let backgroundFrame = convert(chromeContainer.bounds, from: chromeContainer)
    if chromeBackground.frame != backgroundFrame { chromeBackground.frame = backgroundFrame }
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
