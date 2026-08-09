import AppKit
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalTabDragCaptureTests {
  @Test
  func sourceRectUsesWindowLocalTopLeftCoordinates() {
    let geometry = TerminalTabDragCaptureGeometry(
      windowFrame: CGRect(x: 100, y: 200, width: 1_200, height: 800),
      viewScreenFrame: CGRect(x: 340, y: 250, width: 960, height: 720),
      backingScaleFactor: 2
    )

    #expect(geometry.sourceRect == CGRect(x: 240, y: 30, width: 960, height: 720))
    #expect(geometry.outputPixelSize == CGSize(width: 1_920, height: 1_440))
  }

  @Test
  func outputPixelSizeRoundsEachScaledPointDimensionUp() {
    let geometry = TerminalTabDragCaptureGeometry(
      windowFrame: CGRect(x: 0, y: 0, width: 400, height: 300),
      viewScreenFrame: CGRect(x: 20, y: 40, width: 320.25, height: 200.25),
      backingScaleFactor: 1.5
    )

    #expect(geometry.outputPixelSize == CGSize(width: 481, height: 301))
  }

  @Test
  func nativeSessionReadsTheSourceSurfaceBoundsForEveryMove() throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let payload = try #require(makePayload())

    #expect(fixture.prepareResolvedSourceCapture())
    #expect(
      fixture.session.register(
        payload,
        didTransfer: { _, _ in }
      )
    )
    let initialFrame = fixture.sourceSurfaceFrame
    let point = CGPoint(x: initialFrame.midX, y: initialFrame.midY)

    #expect(fixture.session.move(to: point) == .sourceSurface)
    fixture.sourceSurfaceView.frame = fixture.sourceSurfaceView.frame.offsetBy(dx: 400, dy: 0)
    guard case .sharedPreview = fixture.session.move(to: point) else {
      Issue.record("Expected shared preview after moving the source surface")
      return
    }
    fixture.sourceSurfaceView.frame = fixture.sourceSurfaceView.frame.offsetBy(dx: -400, dy: 0)
    #expect(fixture.session.move(to: point) == .sourceSurface)
  }

  @Test
  func nativeSessionRegistersWhileCaptureIsPendingAndUpdatesTheVisiblePreview() async throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let image = renderedImage()
    let payload = try #require(makePayload())

    #expect(fixture.prepareSourceCapture())
    #expect(fixture.session.register(payload, didTransfer: { _, _ in }))
    _ = fixture.session.move(to: CGPoint(x: 5_000, y: 5_000))
    #expect(fixture.presenter.showCount == 1)
    #expect(fixture.presenter.shownImage == nil)
    try await capture.waitForStarts(1)
    capture.complete(at: 0, with: image)
    try await fixture.waitForCaptureResolutions(1)

    #expect(fixture.presenter.shownImage === image)
    #expect(fixture.presenter.updateCount == 1)
  }

  @Test
  func completedCaptureIsStoredUntilTheSharedPreviewAppears() async throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let image = renderedImage()
    let payload = try #require(makePayload())

    #expect(fixture.prepareSourceCapture())
    #expect(fixture.session.register(payload, didTransfer: { _, _ in }))
    try await capture.waitForStarts(1)
    capture.complete(at: 0, with: image)
    try await fixture.waitForCaptureResolutions(1)

    #expect(fixture.presenter.updateCount == 0)
    _ = fixture.session.move(to: CGPoint(x: 5_000, y: 5_000))
    #expect(fixture.presenter.showCount == 1)
    #expect(fixture.presenter.shownImage === image)
  }

  @Test
  func sourceWithoutACaptureRequestRegistersSynchronously() throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let payload = try #require(makePayload())

    #expect(fixture.prepareResolvedSourceCapture())
    #expect(fixture.session.register(payload, didTransfer: { _, _ in }))
  }

  @Test
  func cancelledCaptureCannotUpdateANewSession() async throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let staleImage = renderedImage()
    let currentImage = renderedImage()
    let payload = try #require(makePayload())

    #expect(fixture.prepareSourceCapture())
    try await capture.waitForStarts(1)
    fixture.session.cancelSourceCapture()

    #expect(fixture.prepareSourceCapture())
    #expect(fixture.session.register(payload, didTransfer: { _, _ in }))
    _ = fixture.session.move(to: CGPoint(x: 5_000, y: 5_000))
    try await capture.waitForStarts(2)

    capture.complete(at: 0, with: staleImage)
    try await fixture.waitForCaptureResolutions(1)
    #expect(fixture.presenter.shownImage == nil)
    #expect(fixture.presenter.updateCount == 0)

    capture.complete(at: 1, with: currentImage)
    try await fixture.waitForCaptureResolutions(2)
    #expect(fixture.presenter.shownImage === currentImage)
    #expect(fixture.presenter.updateCount == 1)
  }

  @Test
  func staleFinishCannotCancelTheCurrentCapture() async throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let firstPayload = try #require(makePayload())
    let currentPayload = try #require(makePayload())
    let currentImage = renderedImage()

    #expect(fixture.prepareSourceCapture())
    #expect(fixture.session.register(firstPayload, didTransfer: { _, _ in }))
    try await capture.waitForStarts(1)
    fixture.session.finish(operationID: firstPayload.moveOperationID, outcome: .cancelled)

    #expect(fixture.prepareSourceCapture())
    #expect(fixture.session.register(currentPayload, didTransfer: { _, _ in }))
    _ = fixture.session.move(to: CGPoint(x: 5_000, y: 5_000))
    try await capture.waitForStarts(2)

    fixture.session.finish(operationID: firstPayload.moveOperationID, outcome: .cancelled)
    capture.complete(at: 1, with: currentImage)
    try await fixture.waitForCaptureResolutions(1)
    #expect(fixture.presenter.shownImage === currentImage)
    #expect(fixture.presenter.updateCount == 1)
    #expect(fixture.presenter.hideCount == 1)
    capture.complete(at: 0, with: nil)
    try await fixture.waitForCaptureResolutions(2)
    #expect(fixture.presenter.updateCount == 1)
  }

  @Test
  func nativeDraggingItemUsesOnePointGeometry() {
    #expect(
      TerminalSidebarNativeDragSession.draggingFrame(
        for: CGRect(x: 12, y: 34, width: 220, height: 56)
      ) == CGRect(x: 12, y: 34, width: 1, height: 1)
    )
  }

  @Test
  func captureProbeTimesOutAndRemovesItsWaiter() async {
    let probe = CaptureCountProbe()
    var receivedError: CaptureProbeError?

    do {
      try await probe.wait(for: 1, timeout: .milliseconds(10))
    } catch let error as CaptureProbeError {
      receivedError = error
    } catch {}

    #expect(receivedError == .timedOut(waitingForCount: 1))
    #expect(probe.pendingWaiterCount == 0)
  }

  private func makePayload() -> TerminalTabDragPayload? {
    TerminalTabDragPayload(
      operationID: TerminalTabMoveOperationID(),
      sourceWindowID: UUID(),
      sourceSpaceID: TerminalSpaceID(),
      sourceTopologyRevision: 0,
      itemIDs: [.tab(TerminalTabID())]
    )
  }

  private func renderedImage() -> NSImage {
    let image = NSImage(size: CGSize(width: 4, height: 4))
    image.lockFocus()
    NSColor.red.setFill()
    NSBezierPath.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
    image.unlockFocus()
    return image
  }
}

@MainActor
private final class CapturePreviewRecorder: TerminalTabDragPreviewPresenting {
  private(set) var shownImage: NSImage?
  private(set) var showCount = 0
  private(set) var hideCount = 0
  private(set) var updateCount = 0

  func show(image: NSImage?, frame: CGRect) -> CGRect {
    shownImage = image
    showCount += 1
    return frame
  }

  func update(image: NSImage?) {
    shownImage = image
    updateCount += 1
  }

  func transition(to _: TerminalTabDragPreviewType) -> Bool {
    false
  }

  func hide() {
    hideCount += 1
  }
}

@MainActor
private final class ControlledTabDragCapture {
  private var continuations: [CheckedContinuation<NSImage?, Never>?] = []
  private let starts = CaptureCountProbe()

  func client(didResolve: @escaping @MainActor () -> Void) -> TerminalTabDragCaptureClient {
    TerminalTabDragCaptureClient { [weak self] request in
      let image = await self?.capture(request)
      didResolve()
      return image
    }
  }

  func complete(at index: Int, with image: NSImage?) {
    continuations[index]?.resume(returning: image)
    continuations[index] = nil
  }

  func waitForStarts(_ count: Int) async throws {
    try await starts.wait(for: count)
  }

  private func capture(_: TerminalTabDragCaptureRequest) async -> NSImage? {
    await withCheckedContinuation { continuation in
      continuations.append(continuation)
      starts.signal()
    }
  }
}

private enum CaptureProbeError: Equatable, Error {
  case timedOut(waitingForCount: Int)
}

@MainActor
private final class CaptureCountProbe {
  private struct Waiter {
    let count: Int
    let continuation: CheckedContinuation<Void, any Error>
    let timeoutTask: Task<Void, Never>
  }

  private var count = 0
  private var waiters: [UUID: Waiter] = [:]

  var pendingWaiterCount: Int {
    waiters.count
  }

  func signal() {
    count += 1
    let readyIDs = waiters.compactMap { id, waiter in
      waiter.count <= count ? id : nil
    }
    for id in readyIDs {
      guard let waiter = waiters.removeValue(forKey: id) else { continue }
      waiter.timeoutTask.cancel()
      waiter.continuation.resume()
    }
  }

  func wait(
    for expectedCount: Int,
    timeout: Duration = .seconds(5)
  ) async throws {
    guard count < expectedCount else { return }
    let id = UUID()
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<Void, any Error>) in
        guard !Task.isCancelled else {
          continuation.resume(throwing: CancellationError())
          return
        }
        let timeoutTask = Task { @MainActor [weak self] in
          do {
            try await Task.sleep(for: timeout)
          } catch {
            return
          }
          self?.timeoutWaiter(id, expectedCount: expectedCount)
        }
        waiters[id] = Waiter(
          count: expectedCount,
          continuation: continuation,
          timeoutTask: timeoutTask
        )
      }
    } onCancel: { [weak self] in
      Task { @MainActor in
        self?.cancelWaiter(id)
      }
    }
  }

  private func cancelWaiter(_ id: UUID) {
    guard let waiter = waiters.removeValue(forKey: id) else { return }
    waiter.timeoutTask.cancel()
    waiter.continuation.resume(throwing: CancellationError())
  }

  private func timeoutWaiter(_ id: UUID, expectedCount: Int) {
    guard let waiter = waiters.removeValue(forKey: id) else { return }
    waiter.continuation.resume(
      throwing: CaptureProbeError.timedOut(waitingForCount: expectedCount)
    )
  }
}

@MainActor
private final class NativeDragSessionFixture {
  let presenter = CapturePreviewRecorder()
  let session: TerminalSidebarNativeDragSession
  let sourceSurfaceView: NSView
  private let window: NSWindow
  private let captureResolution = CaptureCountProbe()

  init(capture: ControlledTabDragCapture) {
    let registry = TerminalTabDragRegistry(previewPresenter: presenter)
    let window = NSWindow(
      contentRect: CGRect(x: 100, y: 100, width: 1_000, height: 700),
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    let contentView = NSView(frame: CGRect(origin: .zero, size: window.frame.size))
    let collectionView = TerminalSidebarCollectionView(frame: contentView.bounds)
    let sourceSurfaceView = NSView(frame: CGRect(x: 0, y: 0, width: 240, height: 700))
    contentView.addSubview(collectionView)
    contentView.addSubview(sourceSurfaceView)
    window.contentView = contentView
    self.window = window
    self.sourceSurfaceView = sourceSurfaceView
    session = TerminalSidebarNativeDragSession(
      collectionView: collectionView,
      sourceSurfaceView: sourceSurfaceView,
      registry: registry,
      captureClient: capture.client { [captureResolution] in captureResolution.signal() },
      captureRequest: { nil }
    )
  }

  var sourceSurfaceFrame: CGRect {
    window.convertToScreen(sourceSurfaceView.convert(sourceSurfaceView.bounds, to: nil))
  }

  func waitForCaptureResolutions(_ count: Int) async throws {
    try await captureResolution.wait(for: count)
  }

  func prepareSourceCapture() -> Bool {
    session.prepareSourceCapture(
      previewContentSize: CGSize(width: 1_000, height: 620),
      request: TerminalTabDragCaptureRequest(
        windowID: 1,
        geometry: TerminalTabDragCaptureGeometry(
          windowFrame: CGRect(x: 0, y: 0, width: 1_000, height: 700),
          viewScreenFrame: CGRect(x: 240, y: 0, width: 760, height: 700),
          backingScaleFactor: 2
        )
      )
    )
  }

  func prepareResolvedSourceCapture() -> Bool {
    session.prepareSourceCapture(
      previewContentSize: CGSize(width: 1_000, height: 620),
      request: nil
    )
  }
}
