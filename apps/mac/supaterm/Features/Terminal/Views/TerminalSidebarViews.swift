import AppKit
import ComposableArchitecture
import SwiftUI

struct TerminalSplitView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let totalWidth: CGFloat
  let isSidebarCollapsed: Bool
  @Binding var sidebarFraction: CGFloat
  let minFraction: CGFloat
  let maxFraction: CGFloat
  let onHide: () -> Void

  @State private var dragFraction: CGFloat?

  var body: some View {
    let effectiveFraction = TerminalSplitMetrics.clampedFraction(
      dragFraction ?? sidebarFraction,
      minFraction: minFraction,
      maxFraction: maxFraction
    )
    let isCollapsePreviewActive = TerminalSplitMetrics.isCollapsePreviewActive(
      dragFraction: dragFraction,
      minFraction: minFraction
    )
    let handleFraction = TerminalSplitMetrics.handleFraction(
      dragFraction: dragFraction,
      committedFraction: effectiveFraction,
      maxFraction: maxFraction
    )
    let currentSidebarWidth = TerminalSplitMetrics.sidebarWidth(
      for: totalWidth,
      fraction: effectiveFraction
    )
    let handleWidth = TerminalSplitMetrics.sidebarWidth(
      for: totalWidth,
      fraction: handleFraction
    )
    let visualSidebarCollapsed = isSidebarCollapsed || isCollapsePreviewActive
    let visibleSidebarWidth = visualSidebarCollapsed ? 0 : currentSidebarWidth

    ZStack(alignment: .leading) {
      HStack(spacing: 0) {
        TerminalSidebarView(
          store: store,
          updateStore: updateStore,
          palette: palette,
          terminal: terminal
        )
        .frame(width: currentSidebarWidth)
        .frame(maxHeight: .infinity)
        .offset(x: visualSidebarCollapsed ? -(currentSidebarWidth + 12) : 0)
        .frame(width: visibleSidebarWidth, alignment: .leading)
        .clipped()
        .allowsHitTesting(!visualSidebarCollapsed)

        if let selectedTabID = terminal.selectedTabID {
          TerminalDetailView(
            store: store,
            palette: palette,
            terminal: terminal,
            selectedTabID: selectedTabID
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }

      if !isSidebarCollapsed {
        SidebarResizeHandle(
          totalWidth: totalWidth,
          sidebarFraction: $sidebarFraction,
          dragFraction: $dragFraction,
          minFraction: minFraction,
          maxFraction: maxFraction,
          onHide: onHide
        )
        .offset(x: TerminalSplitMetrics.resizeHandleOffset(for: handleWidth))
      }
    }
    .coordinateSpace(name: TerminalCoordinateSpace.split)
  }
}

struct TerminalSidebarView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState

  var body: some View {
    ZStack(alignment: .topLeading) {
      TerminalSidebarChromeView(
        store: store,
        updateStore: updateStore,
        palette: palette,
        terminal: terminal
      )
      WindowTrafficLights()
        .padding(.top, TerminalSidebarLayout.trafficLightTopPadding)
    }
    .padding(.bottom, sidebarBottomPadding)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct FloatingSidebarOverlay: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let totalWidth: CGFloat
  @Binding var sidebarFraction: CGFloat
  @Binding var isVisible: Bool
  let minFraction: CGFloat
  let maxFraction: CGFloat

  @State private var dragFraction: CGFloat?

  var body: some View {
    let effectiveFraction = TerminalSplitMetrics.clampedFraction(
      dragFraction ?? sidebarFraction,
      minFraction: minFraction,
      maxFraction: maxFraction
    )
    let floatingWidth = TerminalSplitMetrics.sidebarWidth(
      for: totalWidth,
      fraction: effectiveFraction
    )

    ZStack(alignment: .leading) {
      if isVisible {
        FloatingSidebarView(
          store: store,
          updateStore: updateStore,
          palette: palette,
          terminal: terminal,
          width: floatingWidth
        )
        .frame(width: floatingWidth)
        .transition(.move(edge: .leading))
        .zIndex(1)
      }

      HStack(spacing: 0) {
        hoverStrip(width: isVisible ? floatingWidth : 10)
        Spacer(minLength: 0)
      }

      if isVisible {
        SidebarResizeHandle(
          totalWidth: totalWidth,
          sidebarFraction: $sidebarFraction,
          dragFraction: $dragFraction,
          minFraction: minFraction,
          maxFraction: maxFraction
        )
        .offset(x: TerminalSplitMetrics.resizeHandleOffset(for: floatingWidth))
        .zIndex(2)
      }
    }
    .coordinateSpace(name: TerminalCoordinateSpace.floatingSidebar)
  }

  private func hoverStrip(width: CGFloat) -> some View {
    Color.clear
      .frame(width: width)
      .overlay {
        GlobalMouseTrackingArea(
          mouseEntered: $isVisible,
          edge: .left,
          padding: 40,
          slack: 8
        )
      }
  }
}

private struct SidebarResizeHandle: View {
  let totalWidth: CGFloat
  @Binding var sidebarFraction: CGFloat
  @Binding var dragFraction: CGFloat?
  let minFraction: CGFloat
  let maxFraction: CGFloat
  var onHide: (() -> Void)?

  var body: some View {
    SidebarResizeInteractionView(
      onDragChanged: updateDragFraction(for:),
      onDragEnded: commitDragFraction(for:)
    )
    .frame(width: TerminalSplitMetrics.resizeHandleWidth)
    .frame(maxHeight: .infinity)
  }

  private func updateDragFraction(for locationX: CGFloat) {
    dragFraction = TerminalSplitMetrics.rawFraction(
      for: locationX,
      totalWidth: totalWidth
    )
  }

  private func commitDragFraction(for locationX: CGFloat) {
    let rawFraction = TerminalSplitMetrics.rawFraction(
      for: locationX,
      totalWidth: totalWidth
    )
    if let onHide, rawFraction < minFraction {
      onHide()
    } else {
      sidebarFraction = TerminalSplitMetrics.clampedFraction(
        rawFraction,
        minFraction: minFraction,
        maxFraction: maxFraction
      )
    }
    dragFraction = nil
  }
}

private struct SidebarResizeInteractionView: NSViewRepresentable {
  let onDragChanged: (CGFloat) -> Void
  let onDragEnded: (CGFloat) -> Void

  func makeNSView(context: Context) -> SidebarResizeInteractionNSView {
    let view = SidebarResizeInteractionNSView()
    update(view)
    return view
  }

  func updateNSView(_ nsView: SidebarResizeInteractionNSView, context: Context) {
    update(nsView)
  }

  private func update(_ view: SidebarResizeInteractionNSView) {
    view.onDragChanged = onDragChanged
    view.onDragEnded = onDragEnded
  }
}

private final class SidebarResizeInteractionNSView: NSView {
  var onDragChanged: ((CGFloat) -> Void)?
  var onDragEnded: ((CGFloat) -> Void)?
  private var trackingArea: NSTrackingArea?

  override var mouseDownCanMoveWindow: Bool {
    false
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    bounds.contains(point) ? self : nil
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

  override func mouseDown(with event: NSEvent) {
    sendDragChanged(for: event)
  }

  override func mouseDragged(with event: NSEvent) {
    sendDragChanged(for: event)
  }

  override func mouseUp(with event: NSEvent) {
    sendDragEnded(for: event)
  }

  private func sendDragChanged(for event: NSEvent) {
    guard let locationX = locationX(for: event) else { return }
    onDragChanged?(locationX)
  }

  private func sendDragEnded(for event: NSEvent) {
    guard let locationX = locationX(for: event) else { return }
    onDragEnded?(locationX)
  }

  private func locationX(for event: NSEvent) -> CGFloat? {
    guard let contentView = window?.contentView else { return nil }
    return contentView.convert(event.locationInWindow, from: nil).x
  }
}

private struct FloatingSidebarView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let width: CGFloat

  var body: some View {
    TerminalSidebarView(
      store: store,
      updateStore: updateStore,
      palette: palette,
      terminal: terminal
    )
    .frame(width: width)
    .background(palette.windowBackgroundTint)
    .background {
      BlurEffectView(material: .popover, blendingMode: .withinWindow)
    }
    .terminalPaneChrome(palette: palette)
    .shadow(color: palette.shadow, radius: 16, x: 0, y: 6)
  }
}

private let sidebarBottomPadding: CGFloat = 8
