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
    var resolvedSource: TerminalSidebarNativeDragSession.SourceCapture?
    #expect(fixture.session.whenSourceCaptureResolved { resolvedSource = $0 })
    #expect(
      fixture.session.register(
        payload,
        source: try #require(resolvedSource),
        didTransfer: { _ in }
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
  func nativeSessionWaitsForResolvedImageBeforeRegistration() async throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let image = renderedImage()
    let payload = try #require(makePayload())
    var resolvedSource: TerminalSidebarNativeDragSession.SourceCapture?
    var resolutionCount = 0

    #expect(fixture.prepareSourceCapture())
    #expect(
      fixture.session.whenSourceCaptureResolved { source in
        resolutionCount += 1
        resolvedSource = source
      }
    )
    #expect(!fixture.session.whenSourceCaptureResolved { _ in })
    #expect(resolutionCount == 0)
    try await capture.waitForStarts(1)
    capture.complete(at: 0, with: image)
    try await fixture.waitForCaptureResolutions(1)

    #expect(resolutionCount == 1)
    let source = try #require(resolvedSource)
    #expect(fixture.session.register(payload, source: source, didTransfer: { _ in }))
    _ = fixture.session.move(to: CGPoint(x: 5_000, y: 5_000))
    #expect(fixture.presenter.showCount == 1)
    #expect(fixture.presenter.shownImage === image)
  }

  @Test
  func nativeSessionResolvesMissingImageBeforeRegistration() async throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let payload = try #require(makePayload())
    var resolvedSource: TerminalSidebarNativeDragSession.SourceCapture?

    #expect(fixture.prepareSourceCapture())
    #expect(
      fixture.session.whenSourceCaptureResolved { source in
        resolvedSource = source
      }
    )
    try await capture.waitForStarts(1)
    capture.complete(at: 0, with: nil)
    try await fixture.waitForCaptureResolutions(1)

    let source = try #require(resolvedSource)
    #expect(fixture.session.register(payload, source: source, didTransfer: { _ in }))
    _ = fixture.session.move(to: CGPoint(x: 5_000, y: 5_000))
    #expect(fixture.presenter.showCount == 1)
    #expect(fixture.presenter.shownImage == nil)
  }

  @Test
  func resolvedCaptureInvokesWaiterSynchronously() throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let payload = try #require(makePayload())
    var registered = false

    #expect(fixture.prepareResolvedSourceCapture())
    #expect(
      fixture.session.whenSourceCaptureResolved { source in
        registered = fixture.session.register(payload, source: source, didTransfer: { _ in })
      }
    )
    #expect(registered)
  }

  @Test
  func cancellingCaptureDropsItsWaiter() async throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    var resolutionCount = 0

    #expect(fixture.prepareSourceCapture())
    #expect(
      fixture.session.whenSourceCaptureResolved { _ in
        resolutionCount += 1
      }
    )
    try await capture.waitForStarts(1)
    fixture.session.cancelSourceCapture()
    capture.complete(at: 0, with: renderedImage())
    try await fixture.waitForCaptureResolutions(1)

    #expect(resolutionCount == 0)
    #expect(!fixture.session.whenSourceCaptureResolved { _ in })
  }

  @Test
  func staleCaptureCannotInvokeOldOrCurrentWaiter() async throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    var staleResolutionCount = 0
    var currentResolutionCount = 0

    #expect(fixture.prepareSourceCapture())
    #expect(
      fixture.session.whenSourceCaptureResolved { _ in
        staleResolutionCount += 1
      }
    )
    try await capture.waitForStarts(1)
    fixture.session.cancelSourceCapture()

    #expect(fixture.prepareSourceCapture())
    #expect(
      fixture.session.whenSourceCaptureResolved { _ in
        currentResolutionCount += 1
      }
    )
    try await capture.waitForStarts(2)

    capture.complete(at: 0, with: renderedImage())
    try await fixture.waitForCaptureResolutions(1)
    #expect(staleResolutionCount == 0)
    #expect(currentResolutionCount == 0)

    capture.complete(at: 1, with: nil)
    try await fixture.waitForCaptureResolutions(2)
    #expect(staleResolutionCount == 0)
    #expect(currentResolutionCount == 1)
  }

  @Test
  func staleFinishCannotCancelTheCurrentCapture() async throws {
    let capture = ControlledTabDragCapture()
    let fixture = NativeDragSessionFixture(capture: capture)
    let firstPayload = try #require(makePayload())
    var firstSource: TerminalSidebarNativeDragSession.SourceCapture?

    #expect(fixture.prepareSourceCapture())
    #expect(fixture.session.whenSourceCaptureResolved { firstSource = $0 })
    try await capture.waitForStarts(1)
    capture.complete(at: 0, with: nil)
    try await fixture.waitForCaptureResolutions(1)
    #expect(
      fixture.session.register(
        firstPayload,
        source: try #require(firstSource),
        didTransfer: { _ in }
      )
    )
    fixture.session.finish(operationID: firstPayload.moveOperationID, outcome: .cancelled)

    var currentResolutionCount = 0
    #expect(fixture.prepareSourceCapture())
    #expect(
      fixture.session.whenSourceCaptureResolved { _ in
        currentResolutionCount += 1
      }
    )
    try await capture.waitForStarts(2)

    fixture.session.finish(operationID: firstPayload.moveOperationID, outcome: .cancelled)
    capture.complete(at: 1, with: nil)
    try await fixture.waitForCaptureResolutions(2)
    #expect(currentResolutionCount == 1)
    #expect(fixture.presenter.hideCount == 1)
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

  func show(image: NSImage?, frame: CGRect) -> CGRect {
    shownImage = image
    showCount += 1
    return frame
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
