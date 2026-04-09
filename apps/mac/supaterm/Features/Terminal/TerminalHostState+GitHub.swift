import AppKit
import Darwin
import Dispatch
import Foundation
import Observation

struct TerminalGithubWorkspace: Equatable, Sendable {
  let tabID: TerminalTabID
  let surfaceID: UUID
  let workingDirectoryURL: URL
  let repositoryRootURL: URL
  let branchName: String?
  let headURL: URL?
  let remotes: [GithubRemoteTarget]
}

struct TerminalGithubHeadWatcher {
  let headURL: URL
  let source: DispatchSourceFileSystemObject
}

struct TerminalGithubRefreshTask {
  let interval: Duration
  let task: Task<Void, Never>
}

@MainActor
extension TerminalHostState {
  func observeSupatermSettings() {
    supatermSettingsObservationTask?.cancel()
    supatermSettingsObservationTask = Task { @MainActor [weak self] in
      let observations = Observations { [weak self] in
        self?.supatermSettings ?? .default
      }
      for await settings in observations {
        guard let self else { return }
        self.applySupatermSettings(settings)
      }
    }
  }

  private func applySupatermSettings(_ settings: SupatermSettings) {
    if settings.githubIntegrationEnabled {
      refreshAllGithubWorkspaces()
    } else {
      clearAllGithubState()
    }
  }

  @discardableResult
  func openPullRequest(for tabID: TerminalTabID) -> Bool {
    guard
      let urlString = githubPullRequestByTab[tabID]?.url,
      let url = URL(string: urlString)
    else {
      return false
    }
    return NSWorkspace.shared.open(url)
  }

  func scheduleGithubWorkspaceRefresh(
    for tabID: TerminalTabID,
    delay: Duration = .milliseconds(150)
  ) {
    guard supatermSettings.githubIntegrationEnabled else {
      clearGithubWorkspace(for: tabID)
      return
    }
    githubWorkspaceRefreshTasksByTab[tabID]?.cancel()
    githubWorkspaceRefreshTasksByTab[tabID] = Task { @MainActor [weak self] in
      try? await ContinuousClock().sleep(for: delay)
      guard let self, !Task.isCancelled else { return }
      await self.refreshGithubWorkspace(for: tabID)
    }
  }

  private func refreshAllGithubWorkspaces() {
    for tab in tabs {
      scheduleGithubWorkspaceRefresh(for: tab.id, delay: .zero)
    }
    refreshGithubRepositorySchedules()
  }

  private func refreshGithubWorkspace(for tabID: TerminalTabID) async {
    githubWorkspaceRefreshTasksByTab.removeValue(forKey: tabID)
    guard
      supatermSettings.githubIntegrationEnabled,
      let workspace = await loadGithubWorkspace(for: tabID)
    else {
      clearGithubWorkspace(for: tabID)
      return
    }
    let previousWorkspace = githubWorkspaceByTab[tabID]
    githubWorkspaceByTab[tabID] = workspace
    if previousWorkspace?.repositoryRootURL != workspace.repositoryRootURL
      || previousWorkspace?.branchName != workspace.branchName
    {
      githubPullRequestByTab.removeValue(forKey: tabID)
    }
    updateGithubHeadWatcher(for: tabID, headURL: workspace.headURL)
    if let previousWorkspace, previousWorkspace.repositoryRootURL != workspace.repositoryRootURL {
      refreshGithubRepositorySchedule(for: previousWorkspace.repositoryRootURL)
      requestGithubRepositoryRefresh(previousWorkspace.repositoryRootURL)
    }
    refreshGithubRepositorySchedule(for: workspace.repositoryRootURL)
    requestGithubRepositoryRefresh(workspace.repositoryRootURL)
  }

  private func loadGithubWorkspace(for tabID: TerminalTabID) async -> TerminalGithubWorkspace? {
    guard managesTerminalSurfaces else {
      return nil
    }
    guard
      let surfaceID = contextSurfaceID(for: tabID),
      let surface = surfaces[surfaceID],
      let workingDirectoryPath = workingDirectoryPath(for: surface)
    else {
      return nil
    }
    let workingDirectoryURL = URL(fileURLWithPath: workingDirectoryPath, isDirectory: true)
    guard let repositoryRootURL = await gitRepositoryClient.repositoryRoot(workingDirectoryURL)
    else {
      return nil
    }
    async let branchName = gitRepositoryClient.branchName(workingDirectoryURL)
    async let remotes = gitRepositoryClient.githubRemotes(repositoryRootURL)
    return TerminalGithubWorkspace(
      tabID: tabID,
      surfaceID: surfaceID,
      workingDirectoryURL: workingDirectoryURL,
      repositoryRootURL: repositoryRootURL,
      branchName: await branchName,
      headURL: gitRepositoryClient.headURL(workingDirectoryURL),
      remotes: await remotes
    )
  }

  func clearGithubWorkspace(for tabID: TerminalTabID) {
    githubWorkspaceRefreshTasksByTab.removeValue(forKey: tabID)?.cancel()
    githubPullRequestByTab.removeValue(forKey: tabID)
    cancelGithubHeadWatcher(for: tabID)
    guard let workspace = githubWorkspaceByTab.removeValue(forKey: tabID) else {
      refreshGithubRepositorySchedules()
      return
    }
    refreshGithubRepositorySchedule(for: workspace.repositoryRootURL)
    requestGithubRepositoryRefresh(workspace.repositoryRootURL)
  }

  private func clearAllGithubState() {
    for task in githubWorkspaceRefreshTasksByTab.values {
      task.cancel()
    }
    githubWorkspaceRefreshTasksByTab.removeAll()
    for task in githubRepositoryRefreshTasksByRootURL.values {
      task.task.cancel()
    }
    githubRepositoryRefreshTasksByRootURL.removeAll()
    for task in githubRepositoryRefreshOperationsByRootURL.values {
      task.cancel()
    }
    githubRepositoryRefreshOperationsByRootURL.removeAll()
    queuedGithubRepositoryRefreshRootURLs.removeAll()
    for tabID in Array(githubHeadWatchersByTab.keys) {
      cancelGithubHeadWatcher(for: tabID)
    }
    githubHeadWatchersByTab.removeAll()
    for task in githubHeadWatcherRestartTasksByTab.values {
      task.cancel()
    }
    githubHeadWatcherRestartTasksByTab.removeAll()
    githubWorkspaceByTab.removeAll()
    githubPullRequestByTab.removeAll()
  }

  func refreshGithubRepositorySchedules() {
    let trackedRoots = Set(
      githubWorkspaceByTab.values.compactMap { workspace -> URL? in
        guard workspace.branchName != nil, !workspace.remotes.isEmpty else { return nil }
        return workspace.repositoryRootURL
      }
    )
    for repositoryRootURL in githubRepositoryRefreshTasksByRootURL.keys
    where !trackedRoots.contains(repositoryRootURL) {
      githubRepositoryRefreshTasksByRootURL.removeValue(forKey: repositoryRootURL)?.task.cancel()
      githubRepositoryRefreshOperationsByRootURL.removeValue(forKey: repositoryRootURL)?.cancel()
      queuedGithubRepositoryRefreshRootURLs.remove(repositoryRootURL)
      clearGithubPullRequests(in: repositoryRootURL)
    }
    for repositoryRootURL in trackedRoots {
      refreshGithubRepositorySchedule(for: repositoryRootURL)
    }
  }

  private func refreshGithubRepositorySchedule(for repositoryRootURL: URL) {
    guard supatermSettings.githubIntegrationEnabled else {
      githubRepositoryRefreshTasksByRootURL.removeValue(forKey: repositoryRootURL)?.task.cancel()
      return
    }
    let workspaces = githubWorkspaces(in: repositoryRootURL)
    guard workspaces.contains(where: { $0.branchName != nil && !$0.remotes.isEmpty }) else {
      githubRepositoryRefreshTasksByRootURL.removeValue(forKey: repositoryRootURL)?.task.cancel()
      githubRepositoryRefreshOperationsByRootURL.removeValue(forKey: repositoryRootURL)?.cancel()
      queuedGithubRepositoryRefreshRootURLs.remove(repositoryRootURL)
      clearGithubPullRequests(in: repositoryRootURL)
      return
    }
    let interval = githubRefreshInterval(for: repositoryRootURL)
    if let existing = githubRepositoryRefreshTasksByRootURL[repositoryRootURL],
      existing.interval == interval
    {
      return
    }
    githubRepositoryRefreshTasksByRootURL.removeValue(forKey: repositoryRootURL)?.task.cancel()
    let task = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        try? await ContinuousClock().sleep(for: interval)
        guard let self, !Task.isCancelled else { return }
        self.requestGithubRepositoryRefresh(repositoryRootURL)
      }
    }
    githubRepositoryRefreshTasksByRootURL[repositoryRootURL] = TerminalGithubRefreshTask(
      interval: interval,
      task: task
    )
  }

  private func githubRefreshInterval(for repositoryRootURL: URL) -> Duration {
    guard
      let selectedTabID,
      githubWorkspaceByTab[selectedTabID]?.repositoryRootURL == repositoryRootURL
    else {
      return .seconds(60)
    }
    return .seconds(30)
  }

  private func requestGithubRepositoryRefresh(_ repositoryRootURL: URL) {
    guard supatermSettings.githubIntegrationEnabled else {
      clearGithubPullRequests(in: repositoryRootURL)
      return
    }
    let workspaces = githubWorkspaces(in: repositoryRootURL)
    let branches = Array(Set(workspaces.compactMap(\.branchName))).sorted()
    guard !branches.isEmpty else {
      clearGithubPullRequests(in: repositoryRootURL)
      return
    }
    guard let remotes = workspaces.first?.remotes, !remotes.isEmpty else {
      clearGithubPullRequests(in: repositoryRootURL)
      return
    }
    if githubRepositoryRefreshOperationsByRootURL[repositoryRootURL] != nil {
      queuedGithubRepositoryRefreshRootURLs.insert(repositoryRootURL)
      return
    }
    let githubCLIClient = self.githubCLIClient
    githubRepositoryRefreshOperationsByRootURL[repositoryRootURL] = Task { [weak self] in
      let isAvailable = await githubCLIClient.isAvailable()
      var pullRequestsByBranch: [String: GithubPullRequest] = [:]
      if isAvailable {
        var unresolvedBranches = Set(branches)
        for remote in remotes {
          let unresolved = unresolvedBranches.sorted()
          guard !unresolved.isEmpty else { break }
          do {
            let batch = try await githubCLIClient.batchPullRequests(remote, unresolved)
            for branch in batch.keys {
              unresolvedBranches.remove(branch)
            }
            pullRequestsByBranch.merge(batch) { current, _ in current }
          } catch {
            continue
          }
        }
      }
      await MainActor.run {
        guard let self else { return }
        self.githubRepositoryRefreshOperationsByRootURL.removeValue(forKey: repositoryRootURL)
        if !isAvailable {
          self.clearGithubPullRequests(in: repositoryRootURL)
        } else {
          self.applyGithubPullRequests(
            pullRequestsByBranch,
            in: repositoryRootURL
          )
        }
        if self.queuedGithubRepositoryRefreshRootURLs.remove(repositoryRootURL) != nil {
          self.requestGithubRepositoryRefresh(repositoryRootURL)
        }
      }
    }
  }

  private func applyGithubPullRequests(
    _ pullRequestsByBranch: [String: GithubPullRequest],
    in repositoryRootURL: URL
  ) {
    for workspace in githubWorkspaces(in: repositoryRootURL) {
      guard let branchName = workspace.branchName else {
        githubPullRequestByTab.removeValue(forKey: workspace.tabID)
        continue
      }
      if let pullRequest = pullRequestsByBranch[branchName] {
        githubPullRequestByTab[workspace.tabID] = pullRequest
      } else {
        githubPullRequestByTab.removeValue(forKey: workspace.tabID)
      }
    }
  }

  private func clearGithubPullRequests(in repositoryRootURL: URL) {
    for workspace in githubWorkspaces(in: repositoryRootURL) {
      githubPullRequestByTab.removeValue(forKey: workspace.tabID)
    }
  }

  private func githubWorkspaces(in repositoryRootURL: URL) -> [TerminalGithubWorkspace] {
    githubWorkspaceByTab.values
      .filter { $0.repositoryRootURL == repositoryRootURL }
      .sorted { $0.tabID.rawValue.uuidString < $1.tabID.rawValue.uuidString }
  }

  private func updateGithubHeadWatcher(for tabID: TerminalTabID, headURL: URL?) {
    guard supatermSettings.githubIntegrationEnabled else {
      cancelGithubHeadWatcher(for: tabID)
      return
    }
    guard let headURL else {
      cancelGithubHeadWatcher(for: tabID)
      return
    }
    if githubHeadWatchersByTab[tabID]?.headURL == headURL {
      return
    }
    cancelGithubHeadWatcher(for: tabID)
    let path = headURL.path(percentEncoded: false)
    let fileDescriptor = open(path, O_EVTONLY)
    guard fileDescriptor >= 0 else { return }
    let queue = DispatchQueue(label: "supaterm.github.head.\(tabID.rawValue.uuidString)")
    let source = DispatchSource.makeFileSystemObjectSource(
      fileDescriptor: fileDescriptor,
      eventMask: [.write, .rename, .delete, .attrib],
      queue: queue
    )
    source.setEventHandler { [weak self, weak source] in
      guard let source else { return }
      let event = source.data
      Task { @MainActor in
        self?.handleGithubHeadWatcherEvent(
          for: tabID,
          event: event
        )
      }
    }
    source.setCancelHandler {
      close(fileDescriptor)
    }
    source.resume()
    githubHeadWatchersByTab[tabID] = TerminalGithubHeadWatcher(
      headURL: headURL,
      source: source
    )
  }

  private func handleGithubHeadWatcherEvent(
    for tabID: TerminalTabID,
    event: DispatchSource.FileSystemEvent
  ) {
    if event.contains(.delete) || event.contains(.rename) {
      cancelGithubHeadWatcher(for: tabID)
      githubHeadWatcherRestartTasksByTab[tabID]?.cancel()
      githubHeadWatcherRestartTasksByTab[tabID] = Task { @MainActor [weak self] in
        try? await ContinuousClock().sleep(for: .seconds(1))
        guard let self, !Task.isCancelled else { return }
        await self.refreshGithubWorkspace(for: tabID)
      }
    } else {
      scheduleGithubWorkspaceRefresh(for: tabID)
    }
  }

  private func cancelGithubHeadWatcher(for tabID: TerminalTabID) {
    githubHeadWatchersByTab.removeValue(forKey: tabID)?.source.cancel()
    githubHeadWatcherRestartTasksByTab.removeValue(forKey: tabID)?.cancel()
  }
}
