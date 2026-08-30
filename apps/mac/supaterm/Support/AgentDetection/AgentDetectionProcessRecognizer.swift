import Darwin
import Foundation

public struct AgentDetectionProcessRule: Equatable, Hashable, Sendable {
  public let executable: String
  public let scriptSuffix: String?
  public let processTitle: String?

  public init(
    executable: String,
    scriptSuffix: String? = nil,
    processTitle: String? = nil
  ) {
    self.executable = executable
    self.scriptSuffix = scriptSuffix
    self.processTitle = processTitle
  }
}

public enum AgentDetectionWorkingDirectoryStrategy: Equatable, Hashable, Sendable {
  case codexInvocation
}

public struct AgentDetectionProcessManifest: Equatable, Hashable, Sendable {
  public let agentID: String
  public let processes: [AgentDetectionProcessRule]
  public let workingDirectoryStrategy: AgentDetectionWorkingDirectoryStrategy?

  public init(
    agentID: String,
    processes: [AgentDetectionProcessRule],
    workingDirectoryStrategy: AgentDetectionWorkingDirectoryStrategy? = nil
  ) {
    self.agentID = agentID
    self.processes = processes
    self.workingDirectoryStrategy = workingDirectoryStrategy
  }
}

public struct AgentDetectionProcessMatch: Equatable, Hashable, Sendable {
  public let agentID: String
  public let processIdentity: TerminalAgentProcessIdentity
  public let workingDirectoryPath: String?

  public init(
    agentID: String,
    processIdentity: TerminalAgentProcessIdentity,
    workingDirectoryPath: String? = nil
  ) {
    self.agentID = agentID
    self.processIdentity = processIdentity
    self.workingDirectoryPath = workingDirectoryPath
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
  private let workingDirectory: AgentDetectionProcessRecognizer.WorkingDirectoryProvider
  private var sample: Sample?

  public init() {
    currentTime = { ContinuousClock().now }
    processTable = { .snapshot() }
    invocation = { ProcessTable.invocation(forProcessID: $0) }
    workingDirectory = { TerminalAgentProcessInspector.workingDirectoryPath(for: $0) }
  }

  init(
    currentTime: @escaping @Sendable () -> ContinuousClock.Instant,
    processTable: @escaping AgentDetectionProcessRecognizer.TableProvider,
    invocation: @escaping AgentDetectionProcessRecognizer.InvocationProvider,
    workingDirectory: @escaping AgentDetectionProcessRecognizer.WorkingDirectoryProvider
  ) {
    self.currentTime = currentTime
    self.processTable = processTable
    self.invocation = invocation
    self.workingDirectory = workingDirectory
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
      invocation: invocation,
      workingDirectory: workingDirectory
    )
  }
}

enum AgentDetectionProcessRecognizer {
  typealias InvocationProvider = @Sendable (pid_t) -> ProcessInvocation?
  typealias TableProvider = @Sendable () -> ProcessTable
  typealias WorkingDirectoryProvider = @Sendable (TerminalAgentProcessIdentity) -> String?

  static func matches(
    foregroundProcessGroupIDs: Set<pid_t>,
    manifests: [AgentDetectionProcessManifest],
    table: TableProvider,
    invocation: InvocationProvider,
    workingDirectory: WorkingDirectoryProvider
  ) -> [pid_t: AgentDetectionProcessMatch] {
    matches(
      foregroundProcessGroupIDs: foregroundProcessGroupIDs,
      manifests: manifests,
      table: table(),
      invocation: invocation,
      workingDirectory: workingDirectory
    )
  }

  static func matches(
    foregroundProcessGroupIDs: Set<pid_t>,
    manifests: [AgentDetectionProcessManifest],
    table: ProcessTable,
    invocation: InvocationProvider,
    workingDirectory: WorkingDirectoryProvider
  ) -> [pid_t: AgentDetectionProcessMatch] {
    let processGroupIDs = foregroundProcessGroupIDs.filter { $0 > 0 }
    guard !processGroupIDs.isEmpty, !manifests.isEmpty else { return [:] }
    let entriesByProcessGroupID = Dictionary(
      grouping: table.entries.filter {
        processGroupIDs.contains($0.processGroupID)
      }, by: \.processGroupID)
    return entriesByProcessGroupID.compactMapValues { entries in
      match(
        entries: entries,
        manifests: manifests,
        invocation: invocation,
        workingDirectory: workingDirectory
      )
    }
  }

  private static func match(
    entries: [ProcessEntry],
    manifests: [AgentDetectionProcessManifest],
    invocation: InvocationProvider,
    workingDirectory: WorkingDirectoryProvider
  ) -> AgentDetectionProcessMatch? {
    let entriesByProcessID = entries.reduce(into: [pid_t: ProcessEntry]()) {
      $0[$1.processID] = $1
    }
    let candidates = entries.flatMap { entry in
      guard let invocation = invocation(entry.processID) else { return [Candidate]() }
      return manifests.compactMap { manifest in
        candidate(
          entry: entry,
          invocation: invocation,
          manifest: manifest,
          workingDirectory: workingDirectory
        )
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
      processIdentity: match.process.identity,
      workingDirectoryPath: match.workingDirectoryPath
    )
  }

  private static func candidate(
    entry: ProcessEntry,
    invocation: ProcessInvocation,
    manifest: AgentDetectionProcessManifest,
    workingDirectory: WorkingDirectoryProvider
  ) -> Candidate? {
    let executables = Set([
      URL(fileURLWithPath: invocation.executablePath).lastPathComponent,
      entry.name,
    ]).subtracting([""])
    guard !executables.isEmpty else { return nil }
    let strength: Strength
    if manifest.processes.contains(where: {
      $0.scriptSuffix == nil && $0.processTitle == nil && executables.contains($0.executable)
    }) {
      strength = .exact
    } else {
      guard
        manifest.processes.contains(where: { rule in
          guard executables.contains(rule.executable) else { return false }
          if let processTitle = rule.processTitle {
            guard !processTitle.isEmpty, invocation.arguments.first == processTitle else {
              return false
            }
          }
          if let scriptSuffix = rule.scriptSuffix {
            guard !scriptSuffix.isEmpty else { return false }
            return invocation.arguments.dropFirst().contains { $0.hasSuffix(scriptSuffix) }
          }
          return rule.processTitle != nil
        })
      else {
        return nil
      }
      strength = .wrapper
    }
    return Candidate(
      agentID: manifest.agentID,
      process: entry,
      strength: strength,
      workingDirectoryPath: codexWorkingDirectoryPath(
        entry: entry,
        invocation: invocation,
        strategy: manifest.workingDirectoryStrategy,
        workingDirectory: workingDirectory
      )
    )
  }

  private static func codexWorkingDirectoryPath(
    entry: ProcessEntry,
    invocation: ProcessInvocation,
    strategy: AgentDetectionWorkingDirectoryStrategy?,
    workingDirectory: WorkingDirectoryProvider
  ) -> String? {
    guard strategy == .codexInvocation else { return nil }
    return TerminalAgentProcessInspector.codexWorkingDirectoryPath(
      processWorkingDirectoryPath: workingDirectory(entry.identity),
      commandLineArguments: invocation.arguments
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
    let workingDirectoryPath: String?
  }

  private enum Strength: Int, Comparable {
    case exact
    case wrapper

    static func < (left: Strength, right: Strength) -> Bool {
      left.rawValue < right.rawValue
    }
  }
}
