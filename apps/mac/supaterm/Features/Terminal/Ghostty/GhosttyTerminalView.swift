import SwiftUI

struct GhosttyTerminalView: NSViewRepresentable {
  let surfaceView: GhosttySurfaceView
  let size: CGSize

  func makeNSView(context: Context) -> GhosttySurfaceScrollView {
    GhosttySurfaceScrollView(surfaceView: surfaceView)
  }

  func updateNSView(_ view: GhosttySurfaceScrollView, context: Context) {
    view.invalidateLayout(ifSizeDiffersFrom: size)
  }
}
