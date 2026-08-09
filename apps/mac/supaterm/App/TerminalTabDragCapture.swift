import AppKit
import ScreenCaptureKit

nonisolated struct TerminalTabDragCaptureGeometry: Equatable, Sendable {
  let sourceRect: CGRect
  let backingScaleFactor: CGFloat

  init(
    windowFrame: CGRect,
    viewScreenFrame: CGRect,
    backingScaleFactor: CGFloat
  ) {
    sourceRect = Self.sourceRect(
      windowFrame: windowFrame,
      viewScreenFrame: viewScreenFrame
    )
    self.backingScaleFactor = backingScaleFactor
  }

  var outputPixelSize: CGSize {
    CGSize(
      width: ceil(sourceRect.width * backingScaleFactor),
      height: ceil(sourceRect.height * backingScaleFactor)
    )
  }

  var isValid: Bool {
    !sourceRect.isEmpty
      && sourceRect.origin.x.isFinite
      && sourceRect.origin.y.isFinite
      && sourceRect.size.width.isFinite
      && sourceRect.size.height.isFinite
      && backingScaleFactor.isFinite
      && backingScaleFactor > 0
  }

  static func sourceRect(windowFrame: CGRect, viewScreenFrame: CGRect) -> CGRect {
    CGRect(
      x: viewScreenFrame.minX - windowFrame.minX,
      y: windowFrame.maxY - viewScreenFrame.maxY,
      width: viewScreenFrame.width,
      height: viewScreenFrame.height
    )
  }
}

nonisolated struct TerminalTabDragCaptureRequest: Equatable, Sendable {
  let windowID: CGWindowID
  let geometry: TerminalTabDragCaptureGeometry

  init?(windowID: CGWindowID, geometry: TerminalTabDragCaptureGeometry) {
    guard windowID != 0, geometry.isValid else { return nil }
    self.windowID = windowID
    self.geometry = geometry
  }
}

nonisolated enum TerminalTabDragCompositorCapture {
  static func image(for request: TerminalTabDragCaptureRequest) async -> CGImage? {
    await withCheckedContinuation { continuation in
      SCShareableContent.getCurrentProcessShareableContent { content, _ in
        guard
          let window = content?.windows.first(where: { $0.windowID == request.windowID })
        else {
          continuation.resume(returning: nil)
          return
        }
        let configuration = SCStreamConfiguration()
        configuration.sourceRect = request.geometry.sourceRect
        configuration.width = Int(request.geometry.outputPixelSize.width)
        configuration.height = Int(request.geometry.outputPixelSize.height)
        configuration.ignoreShadowsSingleWindow = true
        configuration.showsCursor = false
        SCScreenshotManager.captureImage(
          contentFilter: SCContentFilter(desktopIndependentWindow: window),
          configuration: configuration
        ) { image, _ in
          continuation.resume(returning: image)
        }
      }
    }
  }
}

@MainActor
struct TerminalTabDragCaptureClient {
  let capture: @MainActor (TerminalTabDragCaptureRequest) async -> NSImage?

  static var live: Self {
    Self { request in
      guard let image = await TerminalTabDragCompositorCapture.image(for: request) else { return nil }
      return NSImage(cgImage: image, size: request.geometry.sourceRect.size)
    }
  }
}
