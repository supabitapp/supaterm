import Foundation

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
