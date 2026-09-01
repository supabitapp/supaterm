import AppKit
import CoreImage
import GhosttyKit
import IOSurface
import QuartzCore

@MainActor
struct TerminalPaneCaptureClient {
  let capture: @MainActor (GhosttySurfaceView) -> CGImage?

  static var live: Self {
    Self { surfaceView in
      guard let surface = surfaceView.surface else { return nil }
      return preservingRendererVisibility(
        isOccluded: surfaceView.isOccluded,
        setRendererVisibility: { ghostty_surface_set_renderer_visibility(surface, $0) },
        synchronizeRenderer: { ghostty_surface_renderer_barrier(surface) },
        capture: {
          ghostty_surface_draw(surface)
          guard let ioSurface = surfaceView.layer?.contents as? IOSurface else { return nil }
          return TerminalPaneIOSurfaceCapture.image(for: ioSurface)
        }
      )
    }
  }

  static func preservingRendererVisibility<Result>(
    isOccluded: Bool,
    setRendererVisibility: (Bool) -> Void,
    synchronizeRenderer: () -> Void,
    capture: () -> Result
  ) -> Result {
    guard isOccluded else { return capture() }
    setRendererVisibility(true)
    synchronizeRenderer()
    defer { setRendererVisibility(false) }
    return capture()
  }
}

nonisolated enum TerminalPaneIOSurfaceCapture {
  private static let context = CIContext()

  static func image(for surface: IOSurface) -> CGImage? {
    let image = CIImage(ioSurface: surface)
    return context.createCGImage(image, from: image.extent)
  }
}
