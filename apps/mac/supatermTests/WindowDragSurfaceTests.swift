import AppKit
import ComposableArchitecture
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct WindowDragSurfaceTests {
  private final class DragRecordingSurface: WindowDragSurfaceView {
    var dragEvent: NSEvent?

    override func dragWindow(with event: NSEvent) {
      dragEvent = event
    }
  }

  @Test
  func blankSurfaceStartsWindowDrag() throws {
    let surface = DragRecordingSurface(frame: NSRect(x: 0, y: 0, width: 240, height: 45))
    let window = NSWindow(
      contentRect: surface.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = surface
    let event = try #require(
      NSEvent.mouseEvent(
        with: .leftMouseDown,
        location: NSPoint(x: 120, y: 22),
        modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber,
        context: nil,
        eventNumber: 1,
        clickCount: 1,
        pressure: 1
      )
    )

    surface.mouseDown(with: event)

    #expect(surface.dragEvent === event)
  }

  @Test
  func inactiveWindowAcceptsFirstMouse() {
    #expect(WindowDragSurfaceView().acceptsFirstMouse(for: nil))
  }

  @Test
  func controlsAboveSurfaceKeepTheirHitTarget() {
    let contentView = NSView(frame: NSRect(x: 0, y: 0, width: 240, height: 45))
    let surface = WindowDragSurfaceView(frame: contentView.bounds)
    let control = NSButton(title: "Control", target: nil, action: nil)
    control.frame = NSRect(x: 16, y: 12, width: 80, height: 24)
    contentView.addSubview(surface)
    contentView.addSubview(control)

    #expect(contentView.hitTest(NSPoint(x: 180, y: 22)) === surface)
    #expect(contentView.hitTest(NSPoint(x: 56, y: 24)) === control)
    #expect(surface.hitTest(NSPoint(x: 240, y: 22)) == nil)
  }

  @Test
  func headerControlsRemainAboveTheDragSurface() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let store = Store(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    }
    let header = NSHostingView(
      rootView: TerminalWindowHeader(
        store: store,
        palette: Palette(colorScheme: .dark),
        terminal: terminal
      )
    )
    header.frame = NSRect(x: 0, y: 0, width: 240, height: TerminalSidebarLayout.scrollViewportTopInset)
    let window = NSWindow(
      contentRect: header.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = header
    header.layoutSubtreeIfNeeded()

    let blankPoint = NSPoint(x: header.bounds.maxX - 2, y: header.bounds.midY)
    let leftBlankPoint = NSPoint(x: 2, y: header.bounds.midY)
    let trafficLightCenterY =
      header.bounds.height
      - WindowTrafficLightMetrics.edgePadding
      - WindowTrafficLightMetrics.buttonSize / 2
    let trafficLightGapPoint = NSPoint(
      x: WindowTrafficLightMetrics.edgePadding
        + WindowTrafficLightMetrics.buttonSize
        + WindowTrafficLightMetrics.buttonSpacing / 2,
      y: trafficLightCenterY
    )
    let switcherGapPoint = NSPoint(
      x: WindowTrafficLightMetrics.clusterWidth + TerminalWindowHeaderMetrics.spacing / 2,
      y: header.bounds.midY
    )
    let switcherX =
      WindowTrafficLightMetrics.clusterWidth + TerminalWindowHeaderMetrics.spacing + 12
    let switcherTopPoint = NSPoint(x: switcherX, y: header.bounds.maxY - 2)
    let switcherBottomPoint = NSPoint(x: switcherX, y: 2)
    let switcherControlPoint = NSPoint(
      x: switcherX,
      y: header.bounds.maxY
        - TerminalWindowHeaderMetrics.switcherTopPadding
        - TerminalWindowHeaderMetrics.switcherHeight / 2
    )
    let trafficLightBottomPoint = NSPoint(
      x: WindowTrafficLightMetrics.edgePadding + WindowTrafficLightMetrics.buttonSize / 2,
      y: 2
    )
    let controlPoint = NSPoint(
      x: WindowTrafficLightMetrics.edgePadding + WindowTrafficLightMetrics.buttonSize / 2,
      y: trafficLightCenterY
    )
    let control = try #require(header.hitTest(controlPoint))

    #expect(header.hitTest(blankPoint) is WindowDragSurfaceView)
    #expect(header.hitTest(leftBlankPoint) is WindowDragSurfaceView)
    #expect(header.hitTest(trafficLightGapPoint) is WindowDragSurfaceView)
    #expect(header.hitTest(switcherGapPoint) is WindowDragSurfaceView)
    #expect(header.hitTest(switcherTopPoint) is WindowDragSurfaceView)
    #expect(header.hitTest(switcherBottomPoint) is WindowDragSurfaceView)
    #expect(header.hitTest(trafficLightBottomPoint) is WindowDragSurfaceView)
    #expect(!(header.hitTest(switcherControlPoint) is WindowDragSurfaceView))
    #expect(!(control is WindowDragSurfaceView))
  }
}
