import AppKit
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSettingsFeature
import SupatermUpdateFeature
import SwiftUI

struct TerminalWindowSidebarRoot: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let terminal: TerminalHostState
  let shellState: TerminalWindowShellState
  let onResizeInput: (TerminalSidebarResizeInput) -> Void
  let sidebarControllerCache: TerminalSidebarControllerCache
  let spacePagingDidEnd: () -> Void
  let dismissReleaseAnnouncement: () -> Void

  @Shared(.supatermSettings) private var supatermSettings = .default

  private var chromeColorScheme: ColorScheme {
    supatermSettings.appearanceMode.colorScheme ?? terminal.terminalChromeColorScheme
  }

  private var palette: Palette {
    Palette(colorScheme: chromeColorScheme, tint: terminal.displayedSpace.color)
  }

  var body: some View {
    ZStack(alignment: .trailing) {
      TerminalSidebarSurfaceShell(
        palette: palette,
        isFloating: shellState.isFloating
      ) {
        sidebar
      }

      SidebarResizeHandle(
        sidebarWidth: shellState.sidebarWidth,
        onInput: onResizeInput
      )
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .coordinateSpace(
      name: shellState.isFloating
        ? TerminalCoordinateSpace.floatingSidebar
        : TerminalCoordinateSpace.split
    )
    .onChange(of: terminal.spacePager?.isTracking == true) { wasTracking, isTracking in
      guard wasTracking, !isTracking else { return }
      spacePagingDidEnd()
    }
    .environment(\.colorScheme, chromeColorScheme)
  }

  private var sidebar: some View {
    TerminalSidebarView(
      store: store,
      updateStore: updateStore,
      releaseAnnouncement: releaseAnnouncement,
      palette: palette,
      terminal: terminal,
      isPagingActive: true,
      sidebarControllerCache: sidebarControllerCache,
      dismissReleaseAnnouncement: dismissReleaseAnnouncement
    )
  }
}

struct TerminalSidebarView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  let isPagingActive: Bool
  let sidebarControllerCache: TerminalSidebarControllerCache
  let dismissReleaseAnnouncement: () -> Void

  var body: some View {
    TerminalSidebarChromeView(
      store: store,
      updateStore: updateStore,
      releaseAnnouncement: releaseAnnouncement,
      palette: palette,
      terminal: terminal,
      isPagingActive: isPagingActive,
      sidebarControllerCache: sidebarControllerCache,
      fixedHoveredGroupID: nil,
      dismissReleaseAnnouncement: dismissReleaseAnnouncement
    )
    .overlay(alignment: .topLeading) {
      TerminalWindowHeader(
        store: store,
        palette: palette,
        terminal: terminal
      )
    }
    .padding(.bottom, sidebarBottomPadding)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct SidebarResizeHandle: View {
  let sidebarWidth: CGFloat
  let onInput: (TerminalSidebarResizeInput) -> Void

  var body: some View {
    SidebarResizeInteractionView(sidebarWidth: sidebarWidth, onInput: onInput)
      .frame(width: TerminalSidebarWidthPolicy.interactionStripWidth)
      .frame(maxHeight: .infinity)
  }
}

private struct SidebarResizeInteractionView: NSViewRepresentable {
  let sidebarWidth: CGFloat
  let onInput: (TerminalSidebarResizeInput) -> Void

  func makeNSView(context: Context) -> SidebarResizeInteractionNSView {
    let view = SidebarResizeInteractionNSView()
    view.sidebarWidth = sidebarWidth
    view.onInput = onInput
    return view
  }

  func updateNSView(_ nsView: SidebarResizeInteractionNSView, context: Context) {
    nsView.sidebarWidth = sidebarWidth
    nsView.onInput = onInput
  }
}

enum SidebarResizeGestureRouting {
  static func inputs(
    for state: NSGestureRecognizer.State,
    delta: CGFloat
  ) -> [TerminalSidebarResizeInput] {
    switch state {
    case .began:
      [.began]
    case .changed:
      [.changed(delta: delta)]
    case .ended:
      [.changed(delta: delta), .ended]
    case .cancelled:
      [.ended]
    case .failed:
      [.failed]
    default:
      []
    }
  }
}

final class SidebarResizeInteractionNSView: NSView {
  var sidebarWidth: CGFloat = 0
  var onInput: ((TerminalSidebarResizeInput) -> Void)?
  private var trackingArea: NSTrackingArea?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    setAccessibilityElement(true)
    setAccessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.resizeHandle)
    setAccessibilityRole(.splitter)
    setAccessibilityLabel("Resize Sidebar")
    let pan = NSPanGestureRecognizer(target: self, action: #selector(handlePan))
    addGestureRecognizer(pan)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  override var mouseDownCanMoveWindow: Bool {
    false
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    bounds.contains(point) ? self : nil
  }

  override func accessibilityValue() -> Any? {
    NSNumber(value: Double(sidebarWidth))
  }

  override func setAccessibilityValue(_ accessibilityValue: Any?) {
    guard let value = accessibilityValue as? NSNumber else { return }
    resize(by: CGFloat(truncating: value) - sidebarWidth)
  }

  override func accessibilityPerformIncrement() -> Bool {
    resize(by: TerminalSidebarWidthPolicy.accessibilityStep)
    return true
  }

  override func accessibilityPerformDecrement() -> Bool {
    resize(by: -TerminalSidebarWidthPolicy.accessibilityStep)
    return true
  }

  override func updateTrackingAreas() {
    if let trackingArea {
      removeTrackingArea(trackingArea)
    }
    let trackingArea = NSTrackingArea(
      rect: bounds,
      options: [.activeAlways, .cursorUpdate, .inVisibleRect],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(trackingArea)
    self.trackingArea = trackingArea
    window?.invalidateCursorRects(for: self)
    super.updateTrackingAreas()
  }

  override func resetCursorRects() {
    discardCursorRects()
    addCursorRect(bounds, cursor: .resizeLeftRight)
  }

  override func cursorUpdate(with event: NSEvent) {
    NSCursor.resizeLeftRight.set()
  }

  @objc private func handlePan(_ recognizer: NSPanGestureRecognizer) {
    let inputs = SidebarResizeGestureRouting.inputs(
      for: recognizer.state,
      delta: translationX(for: recognizer)
    )
    for input in inputs {
      onInput?(input)
    }
  }

  private func resize(by delta: CGFloat) {
    onInput?(.began)
    onInput?(.changed(delta: delta))
    onInput?(.ended)
  }

  private func translationX(for recognizer: NSPanGestureRecognizer) -> CGFloat {
    recognizer.translation(in: window?.contentView).x
  }
}

private let sidebarBottomPadding: CGFloat = 8
