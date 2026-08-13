import AppKit
import ScreenCaptureKit

nonisolated struct TerminalWindowCaptureGeometry: Equatable, Sendable {
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

nonisolated struct TerminalWindowCaptureRequest: Equatable, Sendable {
  let windowID: CGWindowID
  let geometry: TerminalWindowCaptureGeometry

  init?(windowID: CGWindowID, geometry: TerminalWindowCaptureGeometry) {
    guard windowID != 0, geometry.isValid else { return nil }
    self.windowID = windowID
    self.geometry = geometry
  }
}

nonisolated enum TerminalWindowCompositorCapture {
  static func image(for request: TerminalWindowCaptureRequest) async -> CGImage? {
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
struct TerminalWindowCaptureClient {
  let capture: @MainActor (TerminalWindowCaptureRequest) async -> CGImage?

  init(
    capture: @escaping @MainActor (TerminalWindowCaptureRequest) async -> CGImage?
  ) {
    self.capture = capture
  }

  static var live: Self {
    Self { request in
      await TerminalWindowCompositorCapture.image(for: request)
    }
  }
}

nonisolated enum TerminalPNGEncoder {
  static func data(for image: CGImage) -> Data? {
    NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
  }
}
