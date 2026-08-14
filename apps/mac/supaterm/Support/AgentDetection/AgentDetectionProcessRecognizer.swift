import Darwin
import Foundation

public struct AgentDetectionProcessRule: Equatable, Hashable, Sendable {
  public let executable: String
  public let scriptSuffix: String?

  public init(executable: String, scriptSuffix: String? = nil) {
    self.executable = executable
    self.scriptSuffix = scriptSuffix
  }
}

public struct AgentDetectionProcessManifest: Equatable, Hashable, Sendable {
  public let agentID: String
  public let processes: [AgentDetectionProcessRule]

  public init(agentID: String, processes: [AgentDetectionProcessRule]) {
    self.agentID = agentID
    self.processes = processes
  }
}

public struct AgentDetectionProcessMatch: Equatable, Hashable, Sendable {
  public let agentID: String
  public let processIdentity: TerminalAgentProcessIdentity

  public init(
    agentID: String,
    processIdentity: TerminalAgentProcessIdentity
  ) {
    self.agentID = agentID
    self.processIdentity = processIdentity
  }
}

public enum AgentDetectionProcessRecognizer {
  typealias InvocationProvider = @Sendable (pid_t) -> ProcessInvocation?
  typealias TableProvider = @Sendable () -> ProcessTable

  public static func matches(
    foregroundProcessGroupIDs: Set<Int32>,
    manifests: [AgentDetectionProcessManifest]
  ) -> [Int32: AgentDetectionProcessMatch] {
    matches(
      foregroundProcessGroupIDs: foregroundProcessGroupIDs,
      manifests: manifests,
      table: { .snapshot() },
      invocation: { ProcessTable.invocation(forProcessID: $0) }
    )
  }

  static func matches(
    foregroundProcessGroupIDs: Set<pid_t>,
    manifests: [AgentDetectionProcessManifest],
    table: TableProvider,
    invocation: InvocationProvider
  ) -> [pid_t: AgentDetectionProcessMatch] {
    matches(
      foregroundProcessGroupIDs: foregroundProcessGroupIDs,
      manifests: manifests,
      table: table(),
      invocation: invocation
    )
  }

  static func matches(
    foregroundProcessGroupIDs: Set<pid_t>,
    manifests: [AgentDetectionProcessManifest],
    table: ProcessTable,
    invocation: InvocationProvider
  ) -> [pid_t: AgentDetectionProcessMatch] {
    let processGroupIDs = foregroundProcessGroupIDs.filter { $0 > 0 }
    guard !processGroupIDs.isEmpty, !manifests.isEmpty else { return [:] }
    let entriesByProcessGroupID = Dictionary(
      grouping: table.entries.filter {
        processGroupIDs.contains($0.processGroupID)
      }, by: \.processGroupID)
    return entriesByProcessGroupID.compactMapValues { entries in
      match(entries: entries, manifests: manifests, invocation: invocation)
    }
  }

  private static func match(
    entries: [ProcessEntry],
    manifests: [AgentDetectionProcessManifest],
    invocation: InvocationProvider
  ) -> AgentDetectionProcessMatch? {
    let entriesByProcessID = entries.reduce(into: [pid_t: ProcessEntry]()) {
      $0[$1.processID] = $1
    }
    let candidates = entries.flatMap { entry in
      guard let invocation = invocation(entry.processID) else { return [Candidate]() }
      return manifests.compactMap { manifest in
        candidate(entry: entry, invocation: invocation, manifest: manifest)
      }
    }
    guard let strongest = candidates.map(\.strength).min() else { return nil }
    let strongestCandidates = candidates.filter { $0.strength == strongest }
    guard Set(strongestCandidates.map(\.agentID)).count == 1 else { return nil }
    guard
      let match = strongestCandidates.min(by: {
        let leftDepth = depth(of: $0.process, entriesByProcessID: entriesByProcessID)
        let rightDepth = depth(of: $1.process, entriesByProcessID: entriesByProcessID)
        return (leftDepth, $0.process.processID) < (rightDepth, $1.process.processID)
      })
    else {
      return nil
    }
    return AgentDetectionProcessMatch(
      agentID: match.agentID,
      processIdentity: match.process.identity
    )
  }

  private static func candidate(
    entry: ProcessEntry,
    invocation: ProcessInvocation,
    manifest: AgentDetectionProcessManifest
  ) -> Candidate? {
    let executable = URL(fileURLWithPath: invocation.executablePath).lastPathComponent
    guard !executable.isEmpty, entry.name == executable else { return nil }
    if manifest.processes.contains(where: {
      $0.scriptSuffix == nil && !$0.executable.isEmpty && $0.executable == executable
    }) {
      return Candidate(
        agentID: manifest.agentID,
        process: entry,
        strength: .exact
      )
    }
    guard
      manifest.processes.contains(where: { rule in
        guard
          rule.executable == executable,
          let scriptSuffix = rule.scriptSuffix,
          !scriptSuffix.isEmpty
        else {
          return false
        }
        return invocation.arguments.dropFirst().contains { $0.hasSuffix(scriptSuffix) }
      })
    else {
      return nil
    }
    return Candidate(
      agentID: manifest.agentID,
      process: entry,
      strength: .wrapper
    )
  }

  private static func depth(
    of process: ProcessEntry,
    entriesByProcessID: [pid_t: ProcessEntry]
  ) -> Int {
    var process = process
    var processIDs = Set([process.processID])
    var depth = 0
    while let parent = entriesByProcessID[process.parentProcessID] {
      guard processIDs.insert(parent.processID).inserted else { return Int.max }
      process = parent
      depth += 1
    }
    return depth
  }

  private struct Candidate {
    let agentID: String
    let process: ProcessEntry
    let strength: Strength
  }

  private enum Strength: Int, Comparable {
    case exact
    case wrapper

    static func < (left: Strength, right: Strength) -> Bool {
      left.rawValue < right.rawValue
    }
  }
}
