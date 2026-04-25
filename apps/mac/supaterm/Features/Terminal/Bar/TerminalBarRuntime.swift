import Foundation
import Observation
import SupatermCLIShared

nonisolated enum TerminalBarRefreshReason: Equatable, Sendable {
  case focus
  case workingDirectory
  case title
  case commandFinished
  case agent
  case settings
  case time
}

@MainActor
@Observable
final class TerminalBarRuntime {
  private(set) var presentation = TerminalBarPresentation.empty

  @ObservationIgnored private let gitClient: TerminalBarGitClient
  @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
  @ObservationIgnored private let debounceDuration: Duration
  @ObservationIgnored private let successFreshness: TimeInterval
  @ObservationIgnored private let missFreshness: TimeInterval
  @ObservationIgnored private let cacheLimit: Int
  @ObservationIgnored private var cache: [String: GitCacheEntry] = [:]
  @ObservationIgnored private var cacheOrder: [String] = []
  @ObservationIgnored private var gitTask: Task<Void, Never>?
  @ObservationIgnored private var activeGitRequestID: UUID?

  init(
    gitClient: TerminalBarGitClient = .live,
    debounceDuration: Duration = .milliseconds(200),
    successFreshness: TimeInterval = 2,
    missFreshness: TimeInterval = 5,
    cacheLimit: Int = 32,
    sleep: @escaping @Sendable (Duration) async throws -> Void = { duration in
      try await ContinuousClock().sleep(for: duration)
    }
  ) {
    self.gitClient = gitClient
    self.debounceDuration = debounceDuration
    self.successFreshness = successFreshness
    self.missFreshness = missFreshness
    self.cacheLimit = cacheLimit
    self.sleep = sleep
  }

  deinit {
    gitTask?.cancel()
  }

  func refresh(
    settings: SupatermBottomBarSettings,
    context: TerminalBarContext?,
    now: Date = Date(),
    reason: TerminalBarRefreshReason = .settings
  ) {
    guard settings.enabled, let context else {
      cancelGitProbe()
      presentation = .empty
      return
    }

    guard settings.containsGitModule, let cwd = context.workingDirectoryPath else {
      cancelGitProbe()
      presentation = TerminalBarPresenter.presentation(settings: settings, context: context, gitState: nil, now: now)
      return
    }

    let cacheKey = normalizedPath(cwd)
    let cachedEntry = cache[cacheKey]
    let freshEntry = freshCacheEntry(cachedEntry, now: now)

    if reason != .commandFinished, let freshEntry {
      touch(cacheKey)
      presentation = TerminalBarPresenter.presentation(
        settings: settings,
        context: context,
        gitState: freshEntry.state,
        now: now
      )
      return
    }

    presentation = TerminalBarPresenter.presentation(
      settings: settings,
      context: context,
      gitState: cachedEntry?.state,
      now: now
    )

    guard reason != .time else {
      return
    }

    scheduleGitProbe(
      cacheKey: cacheKey,
      cwd: cwd,
      settings: settings,
      context: context,
      now: now
    )
  }

  private func scheduleGitProbe(
    cacheKey: String,
    cwd: String,
    settings: SupatermBottomBarSettings,
    context: TerminalBarContext,
    now: Date
  ) {
    gitTask?.cancel()
    let requestID = UUID()
    activeGitRequestID = requestID
    let request = GitProbeRequest(
      cacheKey: cacheKey,
      requestID: requestID,
      settings: settings,
      context: context,
      now: now
    )
    let gitClient = gitClient
    let sleep = sleep
    let debounceDuration = debounceDuration
    gitTask = Task { [weak self] in
      do {
        try await sleep(debounceDuration)
        let state = await gitClient.status(cwd: cwd)
        guard !Task.isCancelled else { return }
        await self?.publishGitState(state, request: request)
      } catch {}
    }
  }

  private func publishGitState(
    _ state: TerminalBarGitState?,
    request: GitProbeRequest
  ) {
    guard activeGitRequestID == request.requestID else { return }
    store(state, for: request.cacheKey, at: Date())
    presentation = TerminalBarPresenter.presentation(
      settings: request.settings,
      context: request.context,
      gitState: state,
      now: request.now
    )
  }

  private func cancelGitProbe() {
    activeGitRequestID = nil
    gitTask?.cancel()
    gitTask = nil
  }

  private func freshCacheEntry(_ entry: GitCacheEntry?, now: Date) -> GitCacheEntry? {
    guard let entry else { return nil }
    let freshness = entry.state == nil ? missFreshness : successFreshness
    guard now.timeIntervalSince(entry.date) <= freshness else {
      return nil
    }
    return entry
  }

  private func store(_ state: TerminalBarGitState?, for key: String, at date: Date) {
    cache[key] = GitCacheEntry(state: state, date: date)
    touch(key)
    while cacheOrder.count > cacheLimit {
      let evicted = cacheOrder.removeFirst()
      cache.removeValue(forKey: evicted)
    }
  }

  private func touch(_ key: String) {
    cacheOrder.removeAll { $0 == key }
    cacheOrder.append(key)
  }

  private func normalizedPath(_ path: String) -> String {
    URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL.path
  }
}

private nonisolated struct GitCacheEntry {
  let state: TerminalBarGitState?
  let date: Date
}

private nonisolated struct GitProbeRequest: Sendable {
  let cacheKey: String
  let requestID: UUID
  let settings: SupatermBottomBarSettings
  let context: TerminalBarContext
  let now: Date
}
