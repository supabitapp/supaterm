import Darwin
import Dispatch
import Foundation

public nonisolated struct TerminalAgentPanelRefreshContext: Equatable, Sendable {
  public let workingDirectoryPath: String?
  public let processIDs: Set<Int32>

  public init(workingDirectoryPath: String?, processIDs: Set<Int32>) {
    self.workingDirectoryPath = workingDirectoryPath
    self.processIDs = processIDs
  }
}

@MainActor
public protocol TerminalAgentPanelHost: AnyObject {
  var agentPanelIsEnabled: Bool { get }

  func agentPanelPreservesSeededState(_ surfaceID: UUID) -> Bool
  func agentPanelRefreshContext(for surfaceID: UUID) -> TerminalAgentPanelRefreshContext?

  @discardableResult
  func storeAgentPanelBranchDetails(
    _ branchDetails: PaneAgentBranchDetails?,
    for surfaceID: UUID
  ) -> Bool

  @discardableResult
  func storeAgentPanelArtifacts(
    _ artifacts: [PaneAgentArtifact],
    for surfaceID: UUID
  ) -> Bool

  @discardableResult
  func clearAgentPanelMetadata(for surfaceID: UUID) -> Bool
}

nonisolated struct TerminalAgentPanelWorkspaceKey: Equatable, Hashable, Sendable {
  let workingDirectoryPath: String

  init?(workingDirectoryPath: String?) {
    guard
      let workingDirectoryPath = workingDirectoryPath?.trimmingCharacters(in: .whitespacesAndNewlines),
      !workingDirectoryPath.isEmpty
    else {
      return nil
    }
    self.workingDirectoryPath = URL(
      fileURLWithPath: workingDirectoryPath,
      isDirectory: true
    )
    .standardizedFileURL
    .path(percentEncoded: false)
  }
}

@MainActor
final class PaneAgentPortScanner {
  typealias Delivery = @MainActor (UUID, [PaneAgentArtifact]) -> Void

  private let runner: TerminalAgentPanelCommandRunner
  private let interval: Duration
  private var processIDsBySurfaceID: [UUID: Set<Int>] = [:]
  private var artifactsBySurfaceID: [UUID: [PaneAgentArtifact]] = [:]
  private var scanTask: Task<Void, Never>?
  private var delivery: Delivery?

  init(
    runner: TerminalAgentPanelCommandRunner = .live,
    interval: Duration = .seconds(10)
  ) {
    self.runner = runner
    self.interval = interval
  }

  func update(
    surfaceID: UUID,
    processIDs: Set<Int32>,
    deliver: @escaping Delivery
  ) {
    let normalizedProcessIDs = Set(processIDs.map(Int.init).filter { $0 > 0 })
    delivery = deliver
    guard !normalizedProcessIDs.isEmpty else {
      clear(surfaceID: surfaceID, deliver: deliver)
      return
    }
    guard processIDsBySurfaceID[surfaceID] != normalizedProcessIDs else {
      startLoop()
      return
    }
    processIDsBySurfaceID[surfaceID] = normalizedProcessIDs
    startLoop()
  }

  func clear(surfaceID: UUID, deliver: Delivery? = nil) {
    let wasTracked = processIDsBySurfaceID.removeValue(forKey: surfaceID) != nil
    let hadArtifacts = artifactsBySurfaceID.removeValue(forKey: surfaceID) != nil
    if wasTracked || hadArtifacts {
      (deliver ?? delivery)?(surfaceID, [])
    }
    stopLoopIfIdle()
  }

  func stop() {
    processIDsBySurfaceID.removeAll()
    artifactsBySurfaceID.removeAll()
    scanTask?.cancel()
    scanTask = nil
    delivery = nil
  }

  @discardableResult
  func scanOnce() async -> Bool {
    let rootProcessIDsBySurfaceID = processIDsBySurfaceID
    guard !rootProcessIDsBySurfaceID.isEmpty else {
      stopLoopIfIdle()
      return false
    }
    let portsBySurfaceID = await Self.scanPorts(
      rootProcessIDsBySurfaceID: rootProcessIDsBySurfaceID,
      runner: runner
    )
    var delivered = false
    let surfaceIDs = rootProcessIDsBySurfaceID.keys.sorted { $0.uuidString < $1.uuidString }
    for surfaceID in surfaceIDs {
      guard
        processIDsBySurfaceID[surfaceID] == rootProcessIDsBySurfaceID[surfaceID]
      else {
        continue
      }
      let artifacts = Self.artifacts(for: portsBySurfaceID[surfaceID] ?? [])
      guard artifactsBySurfaceID[surfaceID, default: []] != artifacts else { continue }
      artifactsBySurfaceID[surfaceID] = artifacts
      delivery?(surfaceID, artifacts)
      delivered = true
    }
    return delivered
  }

  private func startLoop() {
    guard scanTask == nil else { return }
    let interval = self.interval
    scanTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: interval)
        guard !Task.isCancelled else { return }
        await self?.scanOnce()
      }
    }
  }

  private func stopLoopIfIdle() {
    guard processIDsBySurfaceID.isEmpty else { return }
    scanTask?.cancel()
    scanTask = nil
  }

  nonisolated static func scanPorts(
    rootProcessIDsBySurfaceID: [UUID: Set<Int>],
    runner: TerminalAgentPanelCommandRunner
  ) async -> [UUID: [Int]] {
    let rootProcessIDs = rootProcessIDsBySurfaceID.values.reduce(into: Set<Int>()) {
      $0.formUnion($1)
    }
    guard !rootProcessIDs.isEmpty else {
      return [:]
    }
    guard
      let psResult = try? await runner.run(
        URL(fileURLWithPath: "/bin/ps"),
        ["-ax", "-o", "pid=,ppid="],
        nil
      )
    else {
      return [:]
    }
    let parentByPID = parentMap(fromPSOutput: psResult.stdout)
    let descendantProcessIDsBySurfaceID = rootProcessIDsBySurfaceID.mapValues { rootProcessIDs in
      expandProcessTree(rootProcessIDs: rootProcessIDs, parentByPID: parentByPID)
    }
    let processIDs = descendantProcessIDsBySurfaceID.values.reduce(into: Set<Int>()) {
      $0.formUnion($1)
    }
    guard !processIDs.isEmpty else {
      return [:]
    }
    let pids = processIDs.sorted().map(String.init).joined(separator: ",")
    guard
      let lsofResult = try? await runner.run(
        URL(fileURLWithPath: "/usr/sbin/lsof"),
        ["-nP", "-a", "-p", pids, "-iTCP", "-sTCP:LISTEN", "-Fpn"],
        nil
      )
    else {
      return [:]
    }
    let portsByPID = ports(fromLsofOutput: lsofResult.stdout)
    return descendantProcessIDsBySurfaceID.mapValues { processIDs in
      Array(Set(processIDs.flatMap { portsByPID[$0] ?? [] })).sorted()
    }
  }

  nonisolated static func artifacts(for ports: [Int]) -> [PaneAgentArtifact] {
    Array(Set(ports))
      .sorted()
      .compactMap { port in
        guard let url = URL(string: "http://localhost:\(port)") else { return nil }
        return PaneAgentArtifact(title: "localhost:\(port)", url: url)
      }
  }

  nonisolated static func parentMap(fromPSOutput output: String) -> [Int: Int] {
    var mapping: [Int: Int] = [:]
    for line in output.split(whereSeparator: \.isNewline) {
      let parts = line.split(whereSeparator: \.isWhitespace)
      guard parts.count >= 2,
        let pid = Int(parts[0]),
        let parentPID = Int(parts[1])
      else {
        continue
      }
      mapping[pid] = parentPID
    }
    return mapping
  }

  nonisolated static func expandProcessTree(
    rootProcessIDs: Set<Int>,
    parentByPID: [Int: Int]
  ) -> Set<Int> {
    var result = Set(rootProcessIDs.filter { $0 > 0 })
    var childrenByParent: [Int: [Int]] = [:]
    for (pid, parentPID) in parentByPID {
      childrenByParent[parentPID, default: []].append(pid)
    }
    var queue = Array(result)
    var index = 0
    while index < queue.count {
      let pid = queue[index]
      index += 1
      for childPID in childrenByParent[pid] ?? [] where result.insert(childPID).inserted {
        queue.append(childPID)
      }
    }
    return result
  }

  nonisolated static func ports(fromLsofOutput output: String) -> [Int: Set<Int>] {
    var result: [Int: Set<Int>] = [:]
    var currentPID: Int?
    for line in output.split(whereSeparator: \.isNewline) {
      guard let first = line.first else { continue }
      switch first {
      case "p":
        currentPID = Int(line.dropFirst())
      case "n":
        guard let pid = currentPID,
          let port = port(fromLsofName: String(line.dropFirst()))
        else {
          continue
        }
        result[pid, default: []].insert(port)
      default:
        break
      }
    }
    return result
  }

  nonisolated static func port(fromLsofName value: String) -> Int? {
    let localValue: String
    if let arrowRange = value.range(of: "->") {
      localValue = String(value[..<arrowRange.lowerBound])
    } else {
      localValue = value
    }
    guard let colonIndex = localValue.lastIndex(of: ":") else {
      return nil
    }
    let portText = localValue[localValue.index(after: colonIndex)...].prefix(while: \.isNumber)
    guard let port = Int(portText), port > 0, port <= 65535 else {
      return nil
    }
    return port
  }
}

@MainActor
public final class TerminalAgentPanelController {
  private struct HeadWatcher {
    let headURL: URL
    let source: DispatchSourceFileSystemObject
  }

  private weak var terminal: (any TerminalAgentPanelHost)?
  private let gitClient: TerminalAgentGitClient
  private let githubClient: TerminalAgentGithubClient
  private let portScanner: PaneAgentPortScanner
  private var workspaceKeysBySurfaceID: [UUID: TerminalAgentPanelWorkspaceKey] = [:]
  private var surfaceIDsByWorkspaceKey: [TerminalAgentPanelWorkspaceKey: Set<UUID>] = [:]
  private var workspaceRevisions: [TerminalAgentPanelWorkspaceKey: UInt64] = [:]
  private var branchDetailsByWorkspaceKey: [TerminalAgentPanelWorkspaceKey: PaneAgentBranchDetails] = [:]
  private var refreshTasks: [TerminalAgentPanelWorkspaceKey: Task<Void, Never>] = [:]
  private var periodicTasks: [TerminalAgentPanelWorkspaceKey: Task<Void, Never>] = [:]
  private var branchDebounceTasks: [TerminalAgentPanelWorkspaceKey: Task<Void, Never>] = [:]
  private var filesDebounceTasks: [TerminalAgentPanelWorkspaceKey: Task<Void, Never>] = [:]
  private var headWatchers: [TerminalAgentPanelWorkspaceKey: HeadWatcher] = [:]

  public convenience init(terminal: any TerminalAgentPanelHost) {
    self.init(
      terminal: terminal,
      gitClient: TerminalAgentGitClient(),
      githubClient: TerminalAgentGithubClient(),
      portScanner: PaneAgentPortScanner()
    )
  }

  init(
    terminal: any TerminalAgentPanelHost,
    gitClient: TerminalAgentGitClient = TerminalAgentGitClient(),
    githubClient: TerminalAgentGithubClient = TerminalAgentGithubClient(),
    portScanner: PaneAgentPortScanner = PaneAgentPortScanner()
  ) {
    self.terminal = terminal
    self.gitClient = gitClient
    self.githubClient = githubClient
    self.portScanner = portScanner
  }

  public func surfaceFocused(_ surfaceID: UUID) {
    guard terminal?.agentPanelPreservesSeededState(surfaceID) != true else { return }
    let context = terminal?.agentPanelRefreshContext(for: surfaceID)
    updatePortTracking(surfaceID, context: context)
    guard let workspaceKey = updateWorkspaceTracking(surfaceID, context: context) else {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
      return
    }
    scheduleRefresh(workspaceKey, delay: .zero)
    schedulePeriodicRefresh(workspaceKey)
  }

  public func surfacePathChanged(_ surfaceID: UUID) {
    guard terminal?.agentPanelPreservesSeededState(surfaceID) != true else { return }
    guard
      let workspaceKey = updateWorkspaceTracking(
        surfaceID,
        context: terminal?.agentPanelRefreshContext(for: surfaceID)
      )
    else {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
      return
    }
    scheduleRefresh(workspaceKey, delay: .milliseconds(200))
    schedulePeriodicRefresh(workspaceKey)
  }

  public func surfaceAgentStateChanged(_ surfaceID: UUID) {
    guard terminal?.agentPanelPreservesSeededState(surfaceID) != true else { return }
    let context = terminal?.agentPanelRefreshContext(for: surfaceID)
    updatePortTracking(surfaceID, context: context)
    guard let workspaceKey = updateWorkspaceTracking(surfaceID, context: context) else {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
      if context == nil {
        _ = terminal?.clearAgentPanelMetadata(for: surfaceID)
      }
      return
    }
    scheduleRefresh(workspaceKey, delay: .milliseconds(200))
    schedulePeriodicRefresh(workspaceKey)
  }

  public func surfaceCommandFinished(_ surfaceID: UUID) {
    guard terminal?.agentPanelPreservesSeededState(surfaceID) != true else { return }
    clearSurface(surfaceID)
  }

  public func surfaceRemoved(_ surfaceID: UUID) {
    clearSurface(surfaceID)
  }

  public func stop() {
    for surfaceID in Set(workspaceKeysBySurfaceID.keys) {
      clearSurface(surfaceID)
    }
    for workspaceKey in Set(workspaceRevisions.keys)
      .union(refreshTasks.keys)
      .union(periodicTasks.keys)
      .union(headWatchers.keys)
    {
      clearWorkspace(workspaceKey)
    }
    portScanner.stop()
  }

  private func schedulePeriodicRefresh(_ workspaceKey: TerminalAgentPanelWorkspaceKey) {
    guard periodicTasks[workspaceKey] == nil else { return }
    periodicTasks[workspaceKey] = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(30))
        guard !Task.isCancelled else { return }
        self?.scheduleRefresh(workspaceKey, delay: .zero)
      }
    }
  }

  private func scheduleRefresh(
    _ workspaceKey: TerminalAgentPanelWorkspaceKey,
    delay: Duration
  ) {
    guard terminal?.agentPanelIsEnabled == true else {
      clearDisabledWorkspace(workspaceKey)
      return
    }
    guard surfaceIDsByWorkspaceKey[workspaceKey]?.isEmpty == false else { return }
    refreshTasks.removeValue(forKey: workspaceKey)?.cancel()
    let revision = touch(workspaceKey)
    refreshTasks[workspaceKey] = Task { [weak self] in
      if delay != .zero {
        try? await Task.sleep(for: delay)
      }
      guard !Task.isCancelled else { return }
      await self?.refresh(workspaceKey: workspaceKey, revision: revision)
    }
  }

  private func refresh(
    workspaceKey: TerminalAgentPanelWorkspaceKey,
    revision: UInt64
  ) async {
    guard terminal?.agentPanelIsEnabled == true else {
      clearDisabledWorkspace(workspaceKey)
      return
    }
    let workingDirectoryPath = workspaceKey.workingDirectoryPath
    let gitSnapshot = await gitClient.snapshot(workingDirectoryPath: workingDirectoryPath)
    let branchDetails: PaneAgentBranchDetails?
    if let gitSnapshot {
      let remote = gitSnapshot.remoteURL.flatMap(TerminalAgentGithubRemote.init(remoteURL:))
      let pullRequestStatus = await githubClient.pullRequestStatus(
        repoRoot: gitSnapshot.repoRoot,
        branchName: gitSnapshot.branchName,
        remote: remote
      )
      let displayedPullRequestStatus = pullRequestStatusForRefresh(
        pullRequestStatus,
        branchName: gitSnapshot.branchName,
        remote: remote,
        workspaceKey: workspaceKey
      )
      branchDetails = PaneAgentBranchDetails(
        branchName: gitSnapshot.branchName,
        addedLineCount: pullRequestStatus.addedLineCount ?? gitSnapshot.addedLineCount,
        removedLineCount: pullRequestStatus.removedLineCount ?? gitSnapshot.removedLineCount,
        pullRequestStatus: displayedPullRequestStatus
      )
    } else {
      branchDetails = nil
    }
    guard workspaceRevisions[workspaceKey] == revision else {
      return
    }
    storeBranchDetails(branchDetails, workspaceKey: workspaceKey, revision: revision)
    configureHeadWatcher(workspaceKey: workspaceKey, headURL: gitSnapshot?.headURL)
  }

  private func updatePortTracking(
    _ surfaceID: UUID,
    context: TerminalAgentPanelRefreshContext?
  ) {
    guard let context else {
      portScanner.clear(surfaceID: surfaceID) { [weak self] surfaceID, artifacts in
        self?.storeArtifacts(artifacts, surfaceID: surfaceID)
      }
      return
    }
    portScanner.update(
      surfaceID: surfaceID,
      processIDs: context.processIDs
    ) { [weak self] surfaceID, artifacts in
      self?.storeArtifacts(artifacts, surfaceID: surfaceID)
    }
  }

  private func pullRequestStatusForRefresh(
    _ pullRequestStatus: PaneAgentPullRequestStatus,
    branchName: String,
    remote: TerminalAgentGithubRemote?,
    workspaceKey: TerminalAgentPanelWorkspaceKey
  ) -> PaneAgentPullRequestStatus {
    guard
      pullRequestStatus.kind == .unavailable,
      remote != nil,
      let previous = branchDetailsByWorkspaceKey[workspaceKey],
      previous.branchName == branchName,
      previous.displayedPullRequestStatus != nil
    else {
      return pullRequestStatus
    }
    return previous.pullRequestStatus
  }

  private func storeBranchDetails(
    _ branchDetails: PaneAgentBranchDetails?,
    workspaceKey: TerminalAgentPanelWorkspaceKey,
    revision: UInt64
  ) {
    guard workspaceRevisions[workspaceKey] == revision else {
      return
    }
    if let branchDetails {
      branchDetailsByWorkspaceKey[workspaceKey] = branchDetails
    } else {
      branchDetailsByWorkspaceKey.removeValue(forKey: workspaceKey)
    }
    for surfaceID in surfaceIDsByWorkspaceKey[workspaceKey] ?? [] {
      _ = terminal?.storeAgentPanelBranchDetails(branchDetails, for: surfaceID)
    }
  }

  private func storeArtifacts(
    _ artifacts: [PaneAgentArtifact],
    surfaceID: UUID
  ) {
    _ = terminal?.storeAgentPanelArtifacts(artifacts, for: surfaceID)
  }

  @discardableResult
  private func touch(_ workspaceKey: TerminalAgentPanelWorkspaceKey) -> UInt64 {
    let revision = (workspaceRevisions[workspaceKey] ?? 0) &+ 1
    workspaceRevisions[workspaceKey] = revision
    return revision
  }

  private func clearSurface(_ surfaceID: UUID) {
    removeWorkspaceTracking(surfaceID)
    portScanner.clear(surfaceID: surfaceID)
  }

  @discardableResult
  private func updateWorkspaceTracking(
    _ surfaceID: UUID,
    context: TerminalAgentPanelRefreshContext?
  ) -> TerminalAgentPanelWorkspaceKey? {
    guard
      let workspaceKey = TerminalAgentPanelWorkspaceKey(
        workingDirectoryPath: context?.workingDirectoryPath
      )
    else {
      removeWorkspaceTracking(surfaceID)
      return nil
    }
    if workspaceKeysBySurfaceID[surfaceID] == workspaceKey {
      surfaceIDsByWorkspaceKey[workspaceKey, default: []].insert(surfaceID)
      if let branchDetails = branchDetailsByWorkspaceKey[workspaceKey] {
        _ = terminal?.storeAgentPanelBranchDetails(branchDetails, for: surfaceID)
      }
      return workspaceKey
    }
    if workspaceKeysBySurfaceID[surfaceID] != nil {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
    }
    removeWorkspaceTracking(surfaceID)
    workspaceKeysBySurfaceID[surfaceID] = workspaceKey
    surfaceIDsByWorkspaceKey[workspaceKey, default: []].insert(surfaceID)
    if workspaceRevisions[workspaceKey] == nil {
      workspaceRevisions[workspaceKey] = 0
    }
    if let branchDetails = branchDetailsByWorkspaceKey[workspaceKey] {
      _ = terminal?.storeAgentPanelBranchDetails(branchDetails, for: surfaceID)
    }
    return workspaceKey
  }

  private func removeWorkspaceTracking(_ surfaceID: UUID) {
    guard let workspaceKey = workspaceKeysBySurfaceID.removeValue(forKey: surfaceID) else {
      return
    }
    surfaceIDsByWorkspaceKey[workspaceKey]?.remove(surfaceID)
    guard surfaceIDsByWorkspaceKey[workspaceKey]?.isEmpty != false else {
      return
    }
    surfaceIDsByWorkspaceKey.removeValue(forKey: workspaceKey)
    clearWorkspace(workspaceKey)
  }

  private func clearWorkspace(_ workspaceKey: TerminalAgentPanelWorkspaceKey) {
    workspaceRevisions.removeValue(forKey: workspaceKey)
    branchDetailsByWorkspaceKey.removeValue(forKey: workspaceKey)
    refreshTasks.removeValue(forKey: workspaceKey)?.cancel()
    periodicTasks.removeValue(forKey: workspaceKey)?.cancel()
    branchDebounceTasks.removeValue(forKey: workspaceKey)?.cancel()
    filesDebounceTasks.removeValue(forKey: workspaceKey)?.cancel()
    stopHeadWatcher(workspaceKey)
  }

  private func clearDisabledWorkspace(_ workspaceKey: TerminalAgentPanelWorkspaceKey) {
    for surfaceID in surfaceIDsByWorkspaceKey[workspaceKey] ?? [] {
      _ = terminal?.storeAgentPanelBranchDetails(nil, for: surfaceID)
      _ = terminal?.storeAgentPanelArtifacts([], for: surfaceID)
    }
    clearWorkspace(workspaceKey)
  }

  private func configureHeadWatcher(
    workspaceKey: TerminalAgentPanelWorkspaceKey,
    headURL: URL?
  ) {
    guard let headURL else {
      stopHeadWatcher(workspaceKey)
      return
    }
    if headWatchers[workspaceKey]?.headURL == headURL {
      return
    }
    stopHeadWatcher(workspaceKey)
    let path = headURL.path(percentEncoded: false)
    let descriptor = open(path, O_EVTONLY)
    guard descriptor >= 0 else {
      return
    }
    let source = DispatchSource.makeFileSystemObjectSource(
      fileDescriptor: descriptor,
      eventMask: [.write, .rename, .delete, .attrib],
      queue: DispatchQueue(label: "terminal-agent-panel-head.\(workspaceKey.hashValue)")
    )
    source.setEventHandler { @Sendable [weak self, weak source] in
      guard let source else { return }
      let event = source.data
      Task { @MainActor in
        self?.handleHeadEvent(workspaceKey: workspaceKey, event: event)
      }
    }
    source.setCancelHandler { @Sendable in
      close(descriptor)
    }
    source.resume()
    headWatchers[workspaceKey] = HeadWatcher(headURL: headURL, source: source)
  }

  private func handleHeadEvent(
    workspaceKey: TerminalAgentPanelWorkspaceKey,
    event: DispatchSource.FileSystemEvent
  ) {
    if event.contains(.delete) || event.contains(.rename) {
      stopHeadWatcher(workspaceKey)
    }
    branchDebounceTasks.removeValue(forKey: workspaceKey)?.cancel()
    branchDebounceTasks[workspaceKey] = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(200))
      self?.scheduleRefresh(workspaceKey, delay: .zero)
    }
    filesDebounceTasks.removeValue(forKey: workspaceKey)?.cancel()
    filesDebounceTasks[workspaceKey] = Task { [weak self] in
      try? await Task.sleep(for: .seconds(5))
      self?.scheduleRefresh(workspaceKey, delay: .zero)
    }
  }

  private func stopHeadWatcher(_ workspaceKey: TerminalAgentPanelWorkspaceKey) {
    headWatchers.removeValue(forKey: workspaceKey)?.source.cancel()
  }
}
