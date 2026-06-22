import SwiftUI

public struct GhosttyTerminalView: NSViewRepresentable {
  public let surfaceView: GhosttySurfaceView

  public init(surfaceView: GhosttySurfaceView) {
    self.surfaceView = surfaceView
  }

  public func makeNSView(context: Context) -> NSView {
    GhosttySurfaceScrollView(surfaceView: surfaceView)
  }

  public func updateNSView(_ view: NSView, context: Context) {
    _ = view
  }
}
