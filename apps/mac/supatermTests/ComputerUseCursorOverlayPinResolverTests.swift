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
        .init(id: 1, pid: 10, zIndex: 30),
        .init(id: 2, pid: 10, zIndex: 10),
      ]
    )

    #expect(
      decision
        == .init(relativeWindowID: 2, shouldOrderFront: false, shouldHide: false)
    )
  }

  @Test
  func pidFallbackUsesFrontmostVisibleNormalWindow() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    let decision = resolver.resolve(
      targetPid: 10,
      targetWindowID: 99,
      windows: [
        .init(id: 1, pid: 10, zIndex: 10),
        .init(id: 2, pid: 10, zIndex: 40),
        .init(id: 3, pid: 10, zIndex: 80, layer: 1),
        .init(id: 4, pid: 10, isOnScreen: false, zIndex: 90),
      ]
    )

    #expect(
      decision
        == .init(relativeWindowID: 2, shouldOrderFront: false, shouldHide: false)
    )
  }

  @Test
  func unrelatedWindowsAreIgnored() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    let decision = resolver.resolve(
      targetPid: 10,
      targetWindowID: 99,
      windows: [
        .init(id: 4, pid: 11, zIndex: 90)
      ]
    )

    #expect(
      decision
        == .init(relativeWindowID: nil, shouldOrderFront: false, shouldHide: false)
    )
  }

  @Test
  func secondConsecutiveMissHidesOverlay() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    let first = resolver.resolve(targetPid: 10, targetWindowID: 99, windows: [])
    let second = resolver.resolve(targetPid: 10, targetWindowID: 99, windows: [])

    #expect(first == .init(relativeWindowID: nil, shouldOrderFront: false, shouldHide: false))
    #expect(second == .init(relativeWindowID: nil, shouldOrderFront: false, shouldHide: true))
  }

  @Test
  func targetRecoveryResetsMissCount() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    _ = resolver.resolve(targetPid: 10, targetWindowID: 99, windows: [])
    let recovered = resolver.resolve(
      targetPid: 10,
      targetWindowID: 99,
      windows: [.init(id: 1, pid: 10, zIndex: 1)]
    )
    let nextMiss = resolver.resolve(targetPid: 10, targetWindowID: 99, windows: [])

    #expect(
      recovered
        == .init(relativeWindowID: 1, shouldOrderFront: false, shouldHide: false)
    )
    #expect(nextMiss == .init(relativeWindowID: nil, shouldOrderFront: false, shouldHide: false))
  }

  @Test
  func zeroTargetWindowOrdersFront() {
    var resolver = ComputerUseCursorOverlayPinResolver()

    let decision = resolver.resolve(targetPid: 10, targetWindowID: 0, windows: [])

    #expect(decision == .init(relativeWindowID: nil, shouldOrderFront: true, shouldHide: false))
  }
}
