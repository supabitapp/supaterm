import AppKit

@MainActor
final class TerminalPaneDragSourceHost: NSView {
  private var panes: [GhosttySurfaceView] = []
  private var sourcesByID: [UUID: TerminalPaneDragSourceNSView] = [:]
  private var trackingArea: NSTrackingArea?

  override func hitTest(_ point: NSPoint) -> NSView? {
    TerminalPaneDragSourceHitTesting.source(
      at: point,
      in: Array(sourcesByID.values)
    )
  }

  func update(
    panes: [GhosttySurfaceView],
    client: TerminalPaneDragClient?
  ) {
    guard let client else {
      self.panes = []
      sourcesByID.values.forEach { $0.removeFromSuperview() }
      sourcesByID.removeAll()
      return
    }
    self.panes = panes
    let paneIDs = Set(panes.map(\.id))
    for id in sourcesByID.keys.filter({ !paneIDs.contains($0) }) {
      sourcesByID.removeValue(forKey: id)?.removeFromSuperview()
    }
    for pane in panes {
      let source =
        sourcesByID[pane.id]
        ?? TerminalPaneDragSourceNSView(surfaceView: pane, client: client)
      source.update(surfaceView: pane, client: client)
      if source.superview == nil {
        addSubview(source)
      }
      sourcesByID[pane.id] = source
    }
    needsLayout = true
  }

  override func layout() {
    super.layout()
    for pane in panes {
      let paneFrame = convert(pane.bounds, from: pane)
      sourcesByID[pane.id]?.frame = TerminalPaneDragSourceLayout.frame(for: paneFrame)
    }
  }

  override func updateTrackingAreas() {
    if let trackingArea {
      removeTrackingArea(trackingArea)
    }
    let trackingArea = NSTrackingArea(
      rect: bounds,
      options: [.activeInKeyWindow, .mouseEnteredAndExited, .mouseMoved],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(trackingArea)
    self.trackingArea = trackingArea
    super.updateTrackingAreas()
  }

  override func mouseEntered(with event: NSEvent) {
    updateIndicators(at: convert(event.locationInWindow, from: nil))
  }

  override func mouseMoved(with event: NSEvent) {
    updateIndicators(at: convert(event.locationInWindow, from: nil))
  }

  override func mouseExited(with event: NSEvent) {
    sourcesByID.values.forEach { $0.showsIndicator = false }
  }

  private func updateIndicators(at location: CGPoint) {
    for pane in panes {
      let paneFrame = convert(pane.bounds, from: pane)
      sourcesByID[pane.id]?.showsIndicator = paneFrame.contains(location)
    }
  }
}
