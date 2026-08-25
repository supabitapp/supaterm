import AppKit
import ComposableArchitecture
import CoreVideo
import GhosttyKit
import IOSurface
import Testing

@testable import SupatermCLIShared
@testable import SupatermTerminalCore
@testable import supaterm

@MainActor
struct TerminalCommandExecutorScreenshotTests {
  @Test
  func ioSurfaceCapturePreservesPixelSize() throws {
    let surface = try #require(
      IOSurface(
        properties: [
          .width: 7,
          .height: 5,
          .bytesPerElement: 4,
          .pixelFormat: kCVPixelFormatType_32BGRA,
        ]
      ))
    let image = try #require(TerminalPaneIOSurfaceCapture.image(for: surface))

    #expect(image.width == 7)
    #expect(image.height == 5)
  }

  @Test
  func screenshotCapturesPaneWithoutChangingSelection() throws {
    initializeGhosttyForTests()
    let image = try #require(makeCaptureImage(width: 7, height: 5))
    let capture = ScreenshotCaptureRecorder(image: image)
    let registry = TerminalWindowRegistry()
    let commandExecutor = TerminalCommandExecutor(
      registry: registry,
      paneCaptureClient: capture.client
    )
    let (host, surface) = makeScreenshotHost()
    let selectedTabID = host.selectedTabID
    let selectedSurfaceID = surface.id
    let window = registerScreenshotWindow(host: host, registry: registry)

    let result = try commandExecutor.screenshotPane(
      TerminalPaneTarget(paneID: surface.id)
    )

    let representation = try #require(NSBitmapImageRep(data: result.pngData))
    #expect(capture.surface === surface)
    #expect(result.target.paneID == surface.id)
    #expect(result.pngData.starts(with: [0x89, 0x50, 0x4E, 0x47]))
    #expect(representation.pixelsWide == 7)
    #expect(representation.pixelsHigh == 5)
    #expect(host.selectedTabID == selectedTabID)
    #expect(host.selectedSurfaceView?.id == selectedSurfaceID)

    #expect(capture.captureCount == 1)
    withExtendedLifetime(window) {}
  }

  private func registerScreenshotWindow(
    host: TerminalHostState,
    registry: TerminalWindowRegistry
  ) -> NSWindow {
    let windowControllerID = UUID()
    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: Store(initialState: AppFeature.State()) {
        AppFeature()
      },
      terminal: host,
      requestConfirmedWindowClose: {}
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)
    return window
  }

  private func makeScreenshotHost() -> (TerminalHostState, GhosttySurfaceView) {
    let runtime = GhosttyRuntime()
    let host = TerminalHostState(
      runtime: runtime,
      managesTerminalSurfaces: false,
      sessionHostClient: .noop,
      zmxSessionsEnabled: false
    )
    let tabID = host.spaceManager.tabCollection.createTab(title: "Screenshot")
    let surface = GhosttySurfaceView(
      runtime: runtime,
      tabID: tabID.rawValue,
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, _ in nil }
    )
    host.trees[tabID] = SplitTree(view: surface)
    host.surfaces[surface.id] = surface
    host.focusHistoryByTab[tabID] = TerminalHostState.FocusHistory(current: surface.id)
    host.applySelectedTab(tabID, in: host.displayedSpaceID)
    return (host, surface)
  }

}

@MainActor
private final class ScreenshotCaptureRecorder {
  private let image: CGImage
  private(set) weak var surface: GhosttySurfaceView?
  private(set) var captureCount = 0
  lazy var client = TerminalPaneCaptureClient { [weak self] surface in
    self?.surface = surface
    self?.captureCount += 1
    return self?.image
  }

  init(image: CGImage) {
    self.image = image
  }
}
