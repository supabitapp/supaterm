import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct GithubPullRequestRefreshCoordinatorTests {
  @Test
  func replaceRequestsRefreshesImmediatelyWhenWindowIsVisible() async {
    let recorder = GithubLookupBatchRecorder()
    var resolvedBatches: [[UUID: GithubPullRequestSnapshot?]] = []
    let request = GithubPullRequestLookupRequest(
      surfaceID: UUID(),
      workingDirectory: "/tmp/project"
    )
    let coordinator = GithubPullRequestRefreshCoordinator(
      client: .init(
        diagnostics: {
          .init(
            authenticationStatus: .authenticated("ok"),
            ghStatus: .available("ok"),
            gitStatus: .available("ok")
          )
        },
        lookupPullRequests: { requests in
          await recorder.record(requests)
          return Dictionary(
            uniqueKeysWithValues: requests.map {
              (
                $0.surfaceID,
                .resolved(
                  .init(
                    number: 1,
                    repositoryIdentity: .init(
                      branch: "feature",
                      repoRoot: "/tmp/project"
                    ),
                    url: URL(string: "https://github.com/supabitapp/supaterm/pull/1")!
                  )
                )
              )
            }
          )
        }
      ),
      clock: TestClock()
    ) { resolved in
      resolvedBatches.append(resolved)
    }

    coordinator.updateWindowActivity(.init(isKeyWindow: true, isVisible: true))
    coordinator.replaceRequests([request.surfaceID: request])
    await flushCoordinatorEffects()

    #expect(await recorder.recordedBatchSurfaceIDs() == [[request.surfaceID]])
    #expect(resolvedBatches.count == 1)
    let snapshot = resolvedBatches[0][request.surfaceID] ?? nil
    #expect(snapshot?.number == 1)
  }

  @Test
  func pollingUsesThirtySecondsForKeyWindowsAndSixtySecondsForVisibleNonKeyWindows() async {
    let clock = TestClock()
    let recorder = GithubLookupBatchRecorder()
    let request = GithubPullRequestLookupRequest(
      surfaceID: UUID(),
      workingDirectory: "/tmp/project"
    )
    let coordinator = GithubPullRequestRefreshCoordinator(
      client: .init(
        diagnostics: {
          .init(
            authenticationStatus: .authenticated("ok"),
            ghStatus: .available("ok"),
            gitStatus: .available("ok")
          )
        },
        lookupPullRequests: { requests in
          await recorder.record(requests)
          return Dictionary(
            uniqueKeysWithValues: requests.map { ($0.surfaceID, .resolved(nil)) }
          )
        }
      ),
      clock: clock
    ) { _ in }

    coordinator.updateWindowActivity(.init(isKeyWindow: true, isVisible: true))
    coordinator.replaceRequests([request.surfaceID: request])
    await flushCoordinatorEffects()

    #expect(await recorder.recordedBatchSurfaceIDs().count == 1)

    await clock.advance(by: .seconds(29))
    await flushCoordinatorEffects()
    #expect(await recorder.recordedBatchSurfaceIDs().count == 1)

    await clock.advance(by: .seconds(1))
    await flushCoordinatorEffects()
    #expect(await recorder.recordedBatchSurfaceIDs().count == 2)

    coordinator.updateWindowActivity(.init(isKeyWindow: false, isVisible: true))
    await flushCoordinatorEffects()

    await clock.advance(by: .seconds(59))
    await flushCoordinatorEffects()
    #expect(await recorder.recordedBatchSurfaceIDs().count == 2)

    await clock.advance(by: .seconds(1))
    await flushCoordinatorEffects()
    #expect(await recorder.recordedBatchSurfaceIDs().count == 3)
  }

  @Test
  func hiddenWindowsPausePollingUntilVisibleAgain() async {
    let clock = TestClock()
    let recorder = GithubLookupBatchRecorder()
    let request = GithubPullRequestLookupRequest(
      surfaceID: UUID(),
      workingDirectory: "/tmp/project"
    )
    let coordinator = GithubPullRequestRefreshCoordinator(
      client: .init(
        diagnostics: {
          .init(
            authenticationStatus: .authenticated("ok"),
            ghStatus: .available("ok"),
            gitStatus: .available("ok")
          )
        },
        lookupPullRequests: { requests in
          await recorder.record(requests)
          return Dictionary(
            uniqueKeysWithValues: requests.map { ($0.surfaceID, .resolved(nil)) }
          )
        }
      ),
      clock: clock
    ) { _ in }

    coordinator.updateWindowActivity(.init(isKeyWindow: true, isVisible: true))
    coordinator.replaceRequests([request.surfaceID: request])
    await flushCoordinatorEffects()

    coordinator.updateWindowActivity(.init(isKeyWindow: false, isVisible: false))
    await flushCoordinatorEffects()

    await clock.advance(by: .seconds(120))
    await flushCoordinatorEffects()
    #expect(await recorder.recordedBatchSurfaceIDs().count == 1)

    coordinator.updateWindowActivity(.init(isKeyWindow: false, isVisible: true))
    await flushCoordinatorEffects()

    await clock.advance(by: .seconds(59))
    await flushCoordinatorEffects()
    #expect(await recorder.recordedBatchSurfaceIDs().count == 1)

    await clock.advance(by: .seconds(1))
    await flushCoordinatorEffects()
    #expect(await recorder.recordedBatchSurfaceIDs().count == 2)
  }

  @Test
  func dirtyRequestsCoalesceIntoOneFollowUpRefreshAfterAnInFlightLookupFinishes() async {
    let controller = DelayedGithubLookupController()
    let request1 = GithubPullRequestLookupRequest(
      surfaceID: UUID(),
      workingDirectory: "/tmp/project1"
    )
    let request2 = GithubPullRequestLookupRequest(
      surfaceID: UUID(),
      workingDirectory: "/tmp/project2"
    )
    let coordinator = GithubPullRequestRefreshCoordinator(
      client: .init(
        diagnostics: {
          .init(
            authenticationStatus: .authenticated("ok"),
            ghStatus: .available("ok"),
            gitStatus: .available("ok")
          )
        },
        lookupPullRequests: { requests in
          await controller.lookup(requests)
        }
      ),
      clock: TestClock()
    ) { _ in }

    coordinator.updateWindowActivity(.init(isKeyWindow: true, isVisible: true))
    coordinator.replaceRequests([request1.surfaceID: request1])
    await flushCoordinatorEffects()
    #expect(await controller.recordedBatchSurfaceIDs().map(Set.init) == [Set([request1.surfaceID])])

    coordinator.markDirty(surfaceIDs: [request1.surfaceID])
    coordinator.replaceRequests([
      request1.surfaceID: request1,
      request2.surfaceID: request2,
    ])
    await flushCoordinatorEffects()
    #expect(await controller.recordedBatchSurfaceIDs().map(Set.init) == [Set([request1.surfaceID])])

    await controller.finishFirstLookup()
    await flushCoordinatorEffects()
    #expect(
      await controller.recordedBatchSurfaceIDs().map(Set.init) == [
        Set([request1.surfaceID]),
        Set([request1.surfaceID, request2.surfaceID]),
      ]
    )
  }
}

private func flushCoordinatorEffects() async {
  for _ in 0..<6 {
    await Task.yield()
  }
}

private actor GithubLookupBatchRecorder {
  private var batches: [[UUID]] = []

  func record(_ requests: [GithubPullRequestLookupRequest]) {
    batches.append(requests.map(\.surfaceID))
  }

  func recordedBatchSurfaceIDs() -> [[UUID]] {
    batches
  }
}

private actor DelayedGithubLookupController {
  private var batches: [[UUID]] = []
  private var firstLookupContinuation: CheckedContinuation<[UUID: GithubPullRequestLookupResponse], Never>?
  private var firstLookupRequests: [GithubPullRequestLookupRequest]?

  func finishFirstLookup() {
    guard let firstLookupContinuation, let firstLookupRequests else { return }
    self.firstLookupContinuation = nil
    self.firstLookupRequests = nil
    firstLookupContinuation.resume(
      returning: Dictionary(
        uniqueKeysWithValues: firstLookupRequests.map { ($0.surfaceID, .resolved(nil)) }
      )
    )
  }

  func lookup(
    _ requests: [GithubPullRequestLookupRequest]
  ) async -> [UUID: GithubPullRequestLookupResponse] {
    batches.append(requests.map(\.surfaceID))

    if firstLookupContinuation == nil {
      firstLookupRequests = requests
      return await withCheckedContinuation { continuation in
        firstLookupContinuation = continuation
      }
    }

    return Dictionary(
      uniqueKeysWithValues: requests.map { ($0.surfaceID, .resolved(nil)) }
    )
  }

  func recordedBatchSurfaceIDs() -> [[UUID]] {
    batches
  }
}
