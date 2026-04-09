import Foundation

@MainActor
final class GithubPullRequestRefreshCoordinator {
  private let client: GithubClient
  private let onResolvedPullRequests: @MainActor ([UUID: GithubPullRequestSnapshot?]) -> Void
  private let sleep: @Sendable (Duration) async throws -> Void

  private var isEnabled = true
  private var isRefreshing = false
  private var pendingDirtySurfaceIDs: Set<UUID> = []
  private var requestsBySurfaceID: [UUID: GithubPullRequestLookupRequest] = [:]
  private var scheduledRefreshTask: Task<Void, Never>?
  private var windowActivity = WindowActivityState.inactive

  init<C: Clock<Duration>>(
    client: GithubClient,
    clock: C = ContinuousClock(),
    onResolvedPullRequests: @escaping @MainActor ([UUID: GithubPullRequestSnapshot?]) -> Void
  ) {
    self.client = client
    self.onResolvedPullRequests = onResolvedPullRequests
    sleep = { duration in
      try await clock.sleep(for: duration)
    }
  }

  init(
    client: GithubClient,
    sleep: @escaping @Sendable (Duration) async throws -> Void,
    onResolvedPullRequests: @escaping @MainActor ([UUID: GithubPullRequestSnapshot?]) -> Void
  ) {
    self.client = client
    self.sleep = sleep
    self.onResolvedPullRequests = onResolvedPullRequests
  }

  func markDirty(surfaceIDs: some Sequence<UUID>) {
    for surfaceID in surfaceIDs {
      guard requestsBySurfaceID[surfaceID] != nil else { continue }
      pendingDirtySurfaceIDs.insert(surfaceID)
    }
    scheduleImmediateRefreshIfPossible()
  }

  func replaceRequests(
    _ requestsBySurfaceID: [UUID: GithubPullRequestLookupRequest]
  ) {
    let previousRequests = self.requestsBySurfaceID
    self.requestsBySurfaceID = requestsBySurfaceID

    let removedSurfaceIDs = Set(previousRequests.keys).subtracting(requestsBySurfaceID.keys)
    pendingDirtySurfaceIDs.subtract(removedSurfaceIDs)

    let changedSurfaceIDs = requestsBySurfaceID.compactMap { surfaceID, request in
      previousRequests[surfaceID] == request ? nil : surfaceID
    }
    for surfaceID in changedSurfaceIDs {
      pendingDirtySurfaceIDs.insert(surfaceID)
    }

    if requestsBySurfaceID.isEmpty {
      cancelScheduledRefresh()
      return
    }

    scheduleImmediateRefreshIfPossible()
  }

  func setEnabled(
    _ isEnabled: Bool
  ) {
    self.isEnabled = isEnabled
    if !isEnabled {
      pendingDirtySurfaceIDs.removeAll()
      cancelScheduledRefresh()
      return
    }
    scheduleImmediateRefreshIfPossible()
  }

  func updateWindowActivity(
    _ windowActivity: WindowActivityState
  ) {
    self.windowActivity = windowActivity
    cancelScheduledRefresh()
    scheduleRefreshIfNeeded()
  }

  private func scheduleImmediateRefreshIfPossible() {
    guard !pendingDirtySurfaceIDs.isEmpty else {
      scheduleRefreshIfNeeded()
      return
    }
    guard isActive else {
      cancelScheduledRefresh()
      return
    }
    guard !isRefreshing else {
      cancelScheduledRefresh()
      return
    }

    cancelScheduledRefresh()
    refresh(surfaceIDs: pendingDirtySurfaceIDs)
  }

  private func scheduleRefreshIfNeeded() {
    guard isEnabled else {
      cancelScheduledRefresh()
      return
    }
    guard !requestsBySurfaceID.isEmpty else {
      cancelScheduledRefresh()
      return
    }
    guard isActive else {
      cancelScheduledRefresh()
      return
    }
    guard !isRefreshing else {
      cancelScheduledRefresh()
      return
    }
    if pendingDirtySurfaceIDs.isEmpty {
      scheduleTimedRefreshIfNeeded()
    } else {
      scheduleImmediateRefreshIfPossible()
    }
  }

  private func scheduleTimedRefreshIfNeeded() {
    guard scheduledRefreshTask == nil else { return }

    let interval = refreshInterval
    scheduledRefreshTask = Task { [weak self] in
      guard let self else { return }
      do {
        try await self.sleep(interval)
      } catch {
        return
      }
      await MainActor.run {
        self.scheduledRefreshTask = nil
        self.refresh(surfaceIDs: Set(self.requestsBySurfaceID.keys))
      }
    }
  }

  private func refresh(
    surfaceIDs: Set<UUID>
  ) {
    guard isEnabled else { return }
    guard isActive else { return }
    guard !surfaceIDs.isEmpty else {
      scheduleTimedRefreshIfNeeded()
      return
    }
    guard !isRefreshing else { return }

    let refreshRequests = surfaceIDs.compactMap { requestsBySurfaceID[$0] }
    guard !refreshRequests.isEmpty else {
      pendingDirtySurfaceIDs.subtract(surfaceIDs)
      scheduleTimedRefreshIfNeeded()
      return
    }
    let refreshRequestsBySurfaceID = Dictionary(
      uniqueKeysWithValues: refreshRequests.map { ($0.surfaceID, $0) }
    )

    isRefreshing = true
    pendingDirtySurfaceIDs.subtract(surfaceIDs)
    cancelScheduledRefresh()

    Task { [weak self] in
      guard let self else { return }
      let responses = await self.client.lookupPullRequests(refreshRequests)
      await MainActor.run {
        self.isRefreshing = false
        guard self.isEnabled else { return }

        let resolvedPullRequests = responses.reduce(into: [UUID: GithubPullRequestSnapshot?]()) {
          partialResult,
          element in
          guard self.requestsBySurfaceID[element.key] == refreshRequestsBySurfaceID[element.key] else {
            return
          }
          switch element.value {
          case .resolved(let snapshot):
            partialResult[element.key] = snapshot
          case .failure:
            break
          }
        }

        if !resolvedPullRequests.isEmpty {
          self.onResolvedPullRequests(resolvedPullRequests)
        }

        if !self.pendingDirtySurfaceIDs.isEmpty {
          self.scheduleImmediateRefreshIfPossible()
        } else {
          self.scheduleTimedRefreshIfNeeded()
        }
      }
    }
  }

  private func cancelScheduledRefresh() {
    scheduledRefreshTask?.cancel()
    scheduledRefreshTask = nil
  }

  private var isActive: Bool {
    isEnabled && windowActivity.isVisible
  }

  private var refreshInterval: Duration {
    windowActivity.isKeyWindow ? .seconds(30) : .seconds(60)
  }
}
