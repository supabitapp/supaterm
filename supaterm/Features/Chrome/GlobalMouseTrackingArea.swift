import AppKit
import SwiftUI

enum TrackingEdge {
  case left
  case right
  case top
  case bottom
}

struct GlobalMouseTrackingArea: NSViewRepresentable {
  @Binding var mouseEntered: Bool
  let edge: TrackingEdge
  let padding: CGFloat
  let slack: CGFloat

  init(
    mouseEntered: Binding<Bool>,
    edge: TrackingEdge,
    padding: CGFloat = 40,
    slack: CGFloat = 8,
  ) {
    self._mouseEntered = mouseEntered
    self.edge = edge
    self.padding = padding
    self.slack = slack
  }

  func makeNSView(context: Context) -> NSView {
    let view = GlobalTrackingStrip(edge: edge, padding: padding, slack: slack)
    view.onHoverChange = { hovering in
      mouseEntered = hovering
    }
    return view
  }

  func updateNSView(_ nsView: NSView, context: Context) {
    guard let strip = nsView as? GlobalTrackingStrip else { return }
    strip.edge = edge
    strip.padding = padding
    strip.slack = slack
  }
}

private final class GlobalTrackingStrip: NSView {
  var edge: TrackingEdge
  var padding: CGFloat
  var slack: CGFloat
  var onHoverChange: ((Bool) -> Void)?
  private var hoverTracker: GlobalHoverTracker?

  init(edge: TrackingEdge, padding: CGFloat, slack: CGFloat) {
    self.edge = edge
    self.padding = padding
    self.slack = slack
    super.init(frame: .zero)
    hoverTracker = GlobalHoverTracker(view: self)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError()
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    if newWindow == nil {
      hoverTracker?.stop()
    }
    super.viewWillMove(toWindow: newWindow)
  }

  override func viewDidMoveToWindow() {
    if window == nil {
      hoverTracker?.stop()
    } else {
      hoverTracker?.startTracking { [weak self] inside in
        self?.onHoverChange?(inside)
      }
    }
    super.viewDidMoveToWindow()
  }
}

private final class GlobalHoverTracker {
  private var localMonitor: Any?
  private var armed = false
  private var isInside = false
  weak var view: GlobalTrackingStrip?

  init(view: GlobalTrackingStrip? = nil) {
    self.view = view
  }

  func startTracking(completion: @escaping (Bool) -> Void) {
    guard localMonitor == nil else { return }

    localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved]) { [weak self] event in
      self?.handleMouseMove(completion: completion)
      return event
    }
  }

  func stop() {
    if let localMonitor {
      NSEvent.removeMonitor(localMonitor)
    }
    localMonitor = nil
    isInside = false
  }

  private func handleMouseMove(completion: @escaping (Bool) -> Void) {
    guard let view, let window = view.window else { return }

    let mouse = NSEvent.mouseLocation
    let screenRect = window.convertToScreen(view.convert(view.bounds, to: nil))
    let basePadding = armed ? view.padding : 0
    let offset: CGFloat = -1

    let band =
      switch view.edge {
      case .left:
        NSRect(
          x: screenRect.minX - offset - basePadding,
          y: screenRect.minY - view.slack,
          width: basePadding,
          height: screenRect.height + 2 * view.slack,
        )
      case .right:
        NSRect(
          x: screenRect.maxX + offset,
          y: screenRect.minY - view.slack,
          width: basePadding,
          height: screenRect.height + 2 * view.slack,
        )
      case .top:
        NSRect(
          x: screenRect.minX - view.slack,
          y: screenRect.maxY + offset,
          width: screenRect.width + 2 * view.slack,
          height: basePadding,
        )
      case .bottom:
        NSRect(
          x: screenRect.minX - view.slack,
          y: screenRect.minY - offset - basePadding,
          width: screenRect.width + 2 * view.slack,
          height: basePadding,
        )
      }

    let insideBase = screenRect.contains(mouse)
    let inBand = band.contains(mouse)
    let effective = insideBase || inBand

    guard effective != isInside else { return }

    isInside = effective
    armed = effective

    if Thread.isMainThread {
      completion(effective)
    } else {
      DispatchQueue.main.async {
        completion(effective)
      }
    }
  }
}
