import Foundation
import Testing

@testable import SupatermComputerUseFeature

@MainActor
struct ComputerUseFocusStealPreventerTests {
  @Test
  func activeTargetDoesNotStartSuppression() {
    var observerInstalled = false
    let preventer = ComputerUseSystemFocusStealPreventer(
      frontmostApplication: {
        .init(processIdentifier: 2) {}
      },
      observeActivations: { _ in
        observerInstalled = true
        return NSObject()
      },
      removeObserver: { _ in }
    )

    let handle = preventer.begin(targetPid: 2)

    #expect(handle == nil)
    #expect(!observerInstalled)
  }

  @Test
  func targetActivationRestoresPreviousFrontmostApp() {
    var activatedPid: pid_t?
    var handler: (@MainActor (pid_t) -> Void)?
    let preventer = ComputerUseSystemFocusStealPreventer(
      frontmostApplication: {
        .init(processIdentifier: 1) {
          activatedPid = 1
        }
      },
      observeActivations: { onActivate in
        handler = onActivate
        return NSObject()
      },
      removeObserver: { _ in }
    )

    let handle = preventer.begin(targetPid: 2)
    #expect(handle != nil)
    handler?(2)

    #expect(activatedPid == 1)
  }

  @Test
  func explicitRestoreTargetCanSuppressWhenTargetIsAlreadyFrontmost() {
    var activatedPid: pid_t?
    var handler: (@MainActor (pid_t) -> Void)?
    let preventer = ComputerUseSystemFocusStealPreventer(
      frontmostApplication: {
        .init(processIdentifier: 2) {}
      },
      observeActivations: { onActivate in
        handler = onActivate
        return NSObject()
      },
      removeObserver: { _ in }
    )

    let handle = preventer.begin(
      targetPid: 2,
      restoreTo: .init(processIdentifier: 1) {
        activatedPid = 1
      }
    )
    #expect(handle != nil)
    handler?(2)

    #expect(activatedPid == 1)
  }

  @Test
  func endDoesNotRestoreWithoutActivation() throws {
    var activatedPid: pid_t?
    let preventer = ComputerUseSystemFocusStealPreventer(
      frontmostApplication: {
        .init(processIdentifier: 1) {
          activatedPid = 1
        }
      },
      observeActivations: { _ in NSObject() },
      removeObserver: { _ in }
    )
    let handle = try #require(preventer.begin(targetPid: 2))

    preventer.end(handle)

    #expect(activatedPid == nil)
  }

  @Test
  func drainingEndCatchesDeferredActivation() throws {
    var activatedPid: pid_t?
    var handler: (@MainActor (pid_t) -> Void)?
    let preventer = ComputerUseSystemFocusStealPreventer(
      frontmostApplication: {
        .init(processIdentifier: 1) {
          activatedPid = 1
        }
      },
      observeActivations: { onActivate in
        handler = onActivate
        return NSObject()
      },
      removeObserver: { _ in }
    )
    let handle = try #require(preventer.begin(targetPid: 2))

    Timer.scheduledTimer(withTimeInterval: 0.001, repeats: false) { _ in
      MainActor.assumeIsolated {
        handler?(2)
      }
    }
    preventer.end(handle, afterDrainingFor: 0.05)

    #expect(activatedPid == 1)
  }

  @Test
  func endRemovesObserverWhenLastSuppressionEnds() throws {
    var removedObserver = false
    let observer = NSObject()
    let preventer = ComputerUseSystemFocusStealPreventer(
      frontmostApplication: {
        .init(processIdentifier: 1) {}
      },
      observeActivations: { _ in observer },
      removeObserver: { removed in
        removedObserver = removed === observer
      }
    )
    let handle = try #require(preventer.begin(targetPid: 2))

    preventer.end(handle)

    #expect(removedObserver)
  }

  @Test
  func missingFrontmostAppDoesNotStartSuppression() {
    let preventer = ComputerUseSystemFocusStealPreventer(
      frontmostApplication: { nil },
      observeActivations: { _ in NSObject() },
      removeObserver: { _ in }
    )

    #expect(preventer.begin(targetPid: 2) == nil)
  }
}
