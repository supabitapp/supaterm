import Testing

@testable import SupatermComputerUseFeature

struct ComputerUseCursorOverlayPinResolverTests {
  @Test
  func exactVisibleTargetWindowWins() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    let decision = resolver.resolve(
      targetPid: 10,
      targetWindowID: 2,
      windows: [
        ComputerUseCursorOverlayWindowSnapshot(id: 1, pid: 10, zIndex: 30),
        ComputerUseCursorOverlayWindowSnapshot(id: 2, pid: 10, zIndex: 10),
      ]
    )

    #expect(
      decision
        == ComputerUseCursorOverlayPinDecision(relativeWindowID: 2, shouldOrderFront: false, shouldHide: false)
    )
  }

  @Test
  func pidFallbackUsesFrontmostVisibleNormalWindow() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    let decision = resolver.resolve(
      targetPid: 10,
      targetWindowID: 99,
      windows: [
        ComputerUseCursorOverlayWindowSnapshot(id: 1, pid: 10, zIndex: 10),
        ComputerUseCursorOverlayWindowSnapshot(id: 2, pid: 10, zIndex: 40),
        ComputerUseCursorOverlayWindowSnapshot(id: 3, pid: 10, zIndex: 80, layer: 1),
        ComputerUseCursorOverlayWindowSnapshot(id: 4, pid: 10, isOnScreen: false, zIndex: 90),
      ]
    )

    #expect(
      decision
        == ComputerUseCursorOverlayPinDecision(relativeWindowID: 2, shouldOrderFront: false, shouldHide: false)
    )
  }

  @Test
  func unrelatedWindowsAreIgnored() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    let decision = resolver.resolve(
      targetPid: 10,
      targetWindowID: 99,
      windows: [
        ComputerUseCursorOverlayWindowSnapshot(id: 4, pid: 11, zIndex: 90)
      ]
    )

    #expect(
      decision
        == ComputerUseCursorOverlayPinDecision(relativeWindowID: nil, shouldOrderFront: false, shouldHide: false)
    )
  }

  @Test
  func secondConsecutiveMissHidesOverlay() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    let first = resolver.resolve(targetPid: 10, targetWindowID: 99, windows: [])
    let second = resolver.resolve(targetPid: 10, targetWindowID: 99, windows: [])

    #expect(first == ComputerUseCursorOverlayPinDecision(relativeWindowID: nil, shouldOrderFront: false, shouldHide: false))
    #expect(second == ComputerUseCursorOverlayPinDecision(relativeWindowID: nil, shouldOrderFront: false, shouldHide: true))
  }

  @Test
  func targetRecoveryResetsMissCount() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    _ = resolver.resolve(targetPid: 10, targetWindowID: 99, windows: [])
    let recovered = resolver.resolve(
      targetPid: 10,
      targetWindowID: 99,
      windows: [ComputerUseCursorOverlayWindowSnapshot(id: 1, pid: 10, zIndex: 1)]
    )
    let nextMiss = resolver.resolve(targetPid: 10, targetWindowID: 99, windows: [])

    #expect(
      recovered
        == ComputerUseCursorOverlayPinDecision(relativeWindowID: 1, shouldOrderFront: false, shouldHide: false)
    )
    #expect(nextMiss == ComputerUseCursorOverlayPinDecision(relativeWindowID: nil, shouldOrderFront: false, shouldHide: false))
  }

  @Test
  func zeroTargetWindowOrdersFront() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    let decision = resolver.resolve(targetPid: 10, targetWindowID: 0, windows: [])

    #expect(decision == ComputerUseCursorOverlayPinDecision(relativeWindowID: nil, shouldOrderFront: true, shouldHide: false))
  }
}
