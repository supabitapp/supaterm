import Darwin
import Foundation

public struct AgentDetectionProcessRule: Equatable, Hashable, Sendable {
  public let executable: String
  public let processTitle: String?

  public init(
    executable: String,
    processTitle: String? = nil
  ) {
    self.executable = executable
    self.processTitle = processTitle
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

public actor AgentDetectionProcessSampler {
  private struct Sample {
    let table: ProcessTable
    let time: ContinuousClock.Instant
  }

  private static let cacheInterval: Duration = .milliseconds(500)

  private let currentTime: @Sendable () -> ContinuousClock.Instant
  private let processTable: AgentDetectionProcessRecognizer.TableProvider
  private let invocation: AgentDetectionProcessRecognizer.InvocationProvider
  private var sample: Sample?

  public init() {
    currentTime = { ContinuousClock().now }
    processTable = { .snapshot() }
    invocation = { ProcessTable.invocation(forProcessID: $0) }
  }

  init(
    currentTime: @escaping @Sendable () -> ContinuousClock.Instant,
    processTable: @escaping AgentDetectionProcessRecognizer.TableProvider,
    invocation: @escaping AgentDetectionProcessRecognizer.InvocationProvider
  ) {
    self.currentTime = currentTime
    self.processTable = processTable
    self.invocation = invocation
  }

  public func matches(
    foregroundProcessGroupIDs: Set<Int32>,
    manifests: [AgentDetectionProcessManifest]
  ) -> [Int32: AgentDetectionProcessMatch] {
    guard foregroundProcessGroupIDs.contains(where: { $0 > 0 }), !manifests.isEmpty else {
      return [:]
    }
    let now = currentTime()
    let table: ProcessTable
    if let sample, sample.time.duration(to: now) < Self.cacheInterval {
      table = sample.table
    } else {
      table = processTable()
      sample = Sample(table: table, time: now)
    }
    return AgentDetectionProcessRecognizer.matches(
      foregroundProcessGroupIDs: foregroundProcessGroupIDs,
      manifests: manifests,
      table: table,
      invocation: invocation
    )
  }
}

enum AgentDetectionProcessRecognizer {
  typealias InvocationProvider = @Sendable (pid_t) -> ProcessInvocation?
  typealias TableProvider = @Sendable () -> ProcessTable

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
    if manifest.processes.contains(where: {
      $0.processTitle == nil && $0.executable == executable
    }) {
      return Candidate(
        agentID: manifest.agentID,
        process: entry,
        strength: .executable
      )
    }
    if manifest.processes.contains(where: { rule in
      guard
        rule.executable == executable,
        let processTitle = rule.processTitle,
        !processTitle.isEmpty
      else { return false }
      return invocation.arguments.first == processTitle
    }) {
      return Candidate(
        agentID: manifest.agentID,
        process: entry,
        strength: .processTitle
      )
    }
    guard
      !entry.name.isEmpty,
      manifest.processes.contains(where: {
        $0.processTitle == nil && $0.executable == entry.name
      })
    else { return nil }
    return Candidate(
      agentID: manifest.agentID,
      process: entry,
      strength: .processName
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
    case executable
    case processTitle
    case processName

    static func < (left: Strength, right: Strength) -> Bool {
      left.rawValue < right.rawValue
    }
  }
}
