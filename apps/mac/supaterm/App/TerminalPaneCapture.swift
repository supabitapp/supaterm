import AppKit
import CoreImage
import GhosttyKit
import IOSurface
import QuartzCore

@MainActor
struct TerminalPaneCaptureClient {
  let capture: @MainActor (GhosttySurfaceView) async -> CGImage?

  static var live: Self {
    Self { surfaceView in
      if let request = surfaceView.screenshotCaptureRequest() {
        return await TerminalWindowCompositorCapture.image(for: request)
      }
      guard let surface = surfaceView.surface else { return nil }
      ghostty_surface_draw(surface)
      guard let ioSurface = surfaceView.layer?.contents as? IOSurface else { return nil }
      return TerminalPaneIOSurfaceCapture.image(for: ioSurface)
    }
  }
}

nonisolated enum TerminalPaneIOSurfaceCapture {
  private static let context = CIContext()

  static func image(for surface: IOSurface) -> CGImage? {
    let image = CIImage(ioSurface: surface)
    return context.createCGImage(image, from: image.extent)
  }
}
