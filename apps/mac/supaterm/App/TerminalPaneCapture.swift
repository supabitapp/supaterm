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
      return preservingOcclusion(
        isOccluded: surfaceView.isOccluded,
        setOcclusion: { surfaceView.setOcclusion($0) },
        capture: {
          ghostty_surface_draw(surface)
          guard let ioSurface = surfaceView.layer?.contents as? IOSurface else { return nil }
          return TerminalPaneIOSurfaceCapture.image(for: ioSurface)
        }
      )
    }
  }

  static func preservingOcclusion<Result>(
    isOccluded: Bool,
    setOcclusion: (Bool) -> Void,
    capture: () -> Result
  ) -> Result {
    guard isOccluded else { return capture() }
    setOcclusion(true)
    defer { setOcclusion(false) }
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
