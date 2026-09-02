import Darwin
import Foundation

public enum AgentDetectionProcessSelector: Equatable, Hashable, Sendable {
  case executable
  case processTitle(String)
  case launchCommand(String)
  case argumentPathSuffix(String)

  static let processNameStrength = 4

  var strength: Int {
    switch self {
    case .executable: 0
    case .processTitle: 1
    case .launchCommand: 2
    case .argumentPathSuffix: 3
    }
  }

  var value: String {
    switch self {
    case .executable: ""
    case .processTitle(let value), .launchCommand(let value), .argumentPathSuffix(let value): value
    }
  }

  func matches(_ invocation: ProcessInvocation) -> Bool {
    switch self {
    case .executable:
      true
    case .processTitle(let title):
      invocation.arguments.first == title
    case .launchCommand(let command):
      invocation.arguments.first.map {
        URL(fileURLWithPath: $0).lastPathComponent == command
      } == true
    case .argumentPathSuffix(let suffix):
      invocation.arguments.dropFirst().first(where: { !$0.hasPrefix("-") }).map {
        Self.path($0, hasComponentSuffix: suffix)
      } == true
    }
  }

  private static func path(_ path: String, hasComponentSuffix suffix: String) -> Bool {
    let components = path.split(separator: "/")
    let suffixComponents = suffix.split(separator: "/")
    guard !suffixComponents.isEmpty, components.count >= suffixComponents.count else {
      return false
    }
    return components.suffix(suffixComponents.count).elementsEqual(suffixComponents)
  }
}

public struct AgentDetectionProcessRule: Equatable, Hashable, Sendable {
  public let executable: String
  public let selector: AgentDetectionProcessSelector

  public init(
    executable: String,
    selector: AgentDetectionProcessSelector = .executable
  ) {
    precondition(!executable.isEmpty)
    precondition(selector == .executable || !selector.value.isEmpty)
    self.executable = executable
    self.selector = selector
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
    return AgentDetectionProcessRecognizer.matches(
      foregroundProcessGroupIDs: foregroundProcessGroupIDs,
      manifests: manifests,
      table: sampledTable(),
      invocation: invocation
    )
  }

  public func processIcons(
    foregroundProcessGroupIDs: Set<Int32>
  ) -> [Int32: TerminalProcessIconMatch] {
    TerminalProcessIconRecognizer.matches(
      foregroundProcessGroupIDs: foregroundProcessGroupIDs,
      table: sampledTable(),
      invocation: invocation
    )
  }

  private func sampledTable() -> ProcessTable {
    let now = currentTime()
    if let sample, sample.time.duration(to: now) < Self.cacheInterval {
      return sample.table
    }
    let table = processTable()
    sample = Sample(table: table, time: now)
    return table
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
    let matchingStrength = manifest.processes.compactMap { rule -> Int? in
      guard rule.executable == executable, rule.selector.matches(invocation) else {
        return nil
      }
      return rule.selector.strength
    }.min()
    if let matchingStrength {
      return Candidate(
        agentID: manifest.agentID,
        process: entry,
        strength: matchingStrength
      )
    }
    guard
      !entry.name.isEmpty,
      manifest.processes.contains(where: {
        $0.selector == .executable && $0.executable == entry.name
      })
    else { return nil }
    return Candidate(
      agentID: manifest.agentID,
      process: entry,
      strength: AgentDetectionProcessSelector.processNameStrength
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
    let strength: Int
  }
}
