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
      if shellState.isFloating {
        TerminalFloatingSidebarShell(palette: palette) {
          sidebar
        }
      } else {
        sidebar
          .background(ChromeBackgroundView(palette: palette))
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

struct TerminalSplitView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  let totalWidth: CGFloat
  let isSidebarCollapsed: Bool
  let sidebarWidth: CGFloat?
  let sidebarResizeState: TerminalSidebarResizeState?
  let onResizeInput: (TerminalSidebarResizeInput) -> Void
  let dismissReleaseAnnouncement: () -> Void
  @State private var sidebarControllerCache = TerminalSidebarControllerCache()

  var body: some View {
    let currentSidebarWidth = TerminalSidebarWidthPolicy.displayedWidth(
      preferredWidth: sidebarWidth,
      resizeState: sidebarResizeState,
      totalWidth: totalWidth
    )
    let visibleSidebarWidth = isSidebarCollapsed ? 0 : currentSidebarWidth

    ZStack(alignment: .leading) {
      HStack(spacing: 0) {
        TerminalSidebarView(
          store: store,
          updateStore: updateStore,
          releaseAnnouncement: releaseAnnouncement,
          palette: palette,
          terminal: terminal,
          isPagingActive: !isSidebarCollapsed,
          sidebarControllerCache: sidebarControllerCache,
          dismissReleaseAnnouncement: dismissReleaseAnnouncement
        )
        .frame(width: currentSidebarWidth)
        .frame(maxHeight: .infinity)
        .offset(x: isSidebarCollapsed ? -(currentSidebarWidth + 12) : 0)
        .frame(width: visibleSidebarWidth, alignment: .leading)
        .mask(alignment: .leading) {
          Rectangle()
            .padding(.trailing, -TerminalChromeMetrics.paneInset)
        }
        .allowsHitTesting(!isSidebarCollapsed)

        if let selectedTabID = terminal.selectedTabID {
          TerminalDetailView(
            store: store,
            palette: palette,
            terminal: terminal,
            selectedTabID: selectedTabID
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .zIndex(1)
        } else {
          Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }

      if !isSidebarCollapsed {
        SidebarResizeHandle(sidebarWidth: currentSidebarWidth, onInput: onResizeInput)
          .offset(x: TerminalSidebarWidthPolicy.stripOffset(for: currentSidebarWidth))
          .zIndex(2)
      }
    }
    .coordinateSpace(name: TerminalCoordinateSpace.split)
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

struct FloatingSidebarOverlay: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  let totalWidth: CGFloat
  let sidebarWidth: CGFloat?
  let sidebarResizeState: TerminalSidebarResizeState?
  @Binding var isVisible: Bool
  let onResizeInput: (TerminalSidebarResizeInput) -> Void
  let dismissReleaseAnnouncement: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var hidesAfterPaging = false

  var body: some View {
    let floatingWidth = TerminalSidebarWidthPolicy.displayedWidth(
      preferredWidth: sidebarWidth,
      resizeState: sidebarResizeState,
      totalWidth: totalWidth
    )

    ZStack(alignment: .leading) {
      if isVisible {
        FloatingSidebarView(
          store: store,
          updateStore: updateStore,
          releaseAnnouncement: releaseAnnouncement,
          palette: palette,
          terminal: terminal,
          width: floatingWidth,
          dismissReleaseAnnouncement: dismissReleaseAnnouncement
        )
        .terminalTransition(.move(edge: .leading), reduceMotion: reduceMotion)
        .zIndex(1)
      }

      HStack(spacing: 0) {
        hoverStrip(width: isVisible ? floatingWidth : 10)
        Spacer(minLength: 0)
      }

      if isVisible {
        SidebarResizeHandle(sidebarWidth: floatingWidth, onInput: onResizeInput)
          .offset(x: TerminalSidebarWidthPolicy.stripOffset(for: floatingWidth))
          .zIndex(2)
      }
    }
    .coordinateSpace(name: TerminalCoordinateSpace.floatingSidebar)
    .onChange(of: isPaging) { _, isPaging in
      guard !isPaging, hidesAfterPaging else { return }
      hidesAfterPaging = false
      isVisible = false
    }
  }

  private var isPaging: Bool {
    terminal.spacePager?.isTracking == true
  }

  private var hoverBinding: Binding<Bool> {
    Binding(
      get: { isVisible },
      set: { hovering in
        guard !hovering, isPaging else {
          isVisible = hovering
          return
        }
        hidesAfterPaging = true
      }
    )
  }

  private func hoverStrip(width: CGFloat) -> some View {
    Color.clear
      .frame(width: width)
      .overlay {
        GlobalMouseTrackingArea(
          mouseEntered: hoverBinding,
          edge: .left,
          padding: 40,
          slack: 8
        )
      }
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

private struct FloatingSidebarView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  let width: CGFloat
  let dismissReleaseAnnouncement: () -> Void
  @State private var sidebarControllerCache = TerminalSidebarControllerCache()

  var body: some View {
    TerminalFloatingSidebarShell(palette: palette) {
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
    .frame(width: width)
  }
}

private let sidebarBottomPadding: CGFloat = 8
