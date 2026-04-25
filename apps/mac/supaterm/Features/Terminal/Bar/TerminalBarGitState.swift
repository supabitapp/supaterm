import Foundation

nonisolated struct TerminalBarGitState: Equatable, Sendable {
  let branch: String
  let stagedCount: Int
  let unstagedCount: Int
  let untrackedCount: Int
  let conflictCount: Int
  let aheadCount: Int
  let behindCount: Int

  var hasStatus: Bool {
    stagedCount > 0
      || unstagedCount > 0
      || untrackedCount > 0
      || conflictCount > 0
      || aheadCount > 0
      || behindCount > 0
  }
}

nonisolated enum TerminalBarGitStatusParser {
  static func parse(_ output: String) -> TerminalBarGitState? {
    let lines =
      output
      .split(separator: "\n", omittingEmptySubsequences: false)
      .map(String.init)

    guard let branchLine = lines.first, branchLine.hasPrefix("## ") else {
      return nil
    }

    guard let branch = parseBranch(from: branchLine) else {
      return nil
    }

    let counts = lines.dropFirst().reduce(into: TerminalBarGitCounts()) { counts, line in
      counts.record(line)
    }

    return TerminalBarGitState(
      branch: branch,
      stagedCount: counts.stagedCount,
      unstagedCount: counts.unstagedCount,
      untrackedCount: counts.untrackedCount,
      conflictCount: counts.conflictCount,
      aheadCount: aheadCount(from: branchLine),
      behindCount: behindCount(from: branchLine)
    )
  }

  private static func parseBranch(from line: String) -> String? {
    var value = String(line.dropFirst(3))
    if value.hasPrefix("No commits yet on ") {
      value.removeFirst("No commits yet on ".count)
    }
    if let range = value.range(of: "...") {
      value = String(value[..<range.lowerBound])
    }
    if let range = value.range(of: " [") {
      value = String(value[..<range.lowerBound])
    }
    if value == "HEAD (no branch)" || value == "(no branch)" {
      return "HEAD"
    }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private static func aheadCount(from line: String) -> Int {
    count(named: "ahead", in: line)
  }

  private static func behindCount(from line: String) -> Int {
    count(named: "behind", in: line)
  }

  private static func count(named name: String, in line: String) -> Int {
    let pattern = "\(name) "
    guard let range = line.range(of: pattern) else { return 0 }
    let suffix = line[range.upperBound...]
    let digits = suffix.prefix { $0.isNumber }
    return Int(digits) ?? 0
  }
}

private nonisolated struct TerminalBarGitCounts {
  var stagedCount = 0
  var unstagedCount = 0
  var untrackedCount = 0
  var conflictCount = 0

  mutating func record(_ line: String) {
    guard line.count >= 2 else { return }
    let status = String(line.prefix(2))
    if status == "!!" {
      return
    }
    if status == "??" {
      untrackedCount += 1
      return
    }
    if Self.conflictStatuses.contains(status) {
      conflictCount += 1
      return
    }
    let x = line[line.startIndex]
    let y = line[line.index(after: line.startIndex)]
    if x != " " {
      stagedCount += 1
    }
    if y != " " {
      unstagedCount += 1
    }
  }

  private static let conflictStatuses: Set<String> = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]
}

nonisolated struct TerminalBarGitClient: Sendable {
  private let run: @Sendable (String) async throws -> String
  private let sleep: @Sendable (Duration) async throws -> Void
  private let timeout: Duration

  init(
    timeout: Duration = .seconds(1),
    sleep: @escaping @Sendable (Duration) async throws -> Void = { duration in
      try await ContinuousClock().sleep(for: duration)
    },
    run: @escaping @Sendable (String) async throws -> String
  ) {
    self.run = run
    self.sleep = sleep
    self.timeout = timeout
  }

  static let live = Self { cwd in
    try await TerminalBarGitProcess.output(cwd: cwd)
  }

  func status(cwd: String) async -> TerminalBarGitState? {
    do {
      return try await withThrowingTaskGroup(of: TerminalBarGitState?.self) { group in
        group.addTask {
          TerminalBarGitStatusParser.parse(try await run(cwd))
        }
        group.addTask {
          try await sleep(timeout)
          throw TerminalBarGitClientError.timeout
        }
        let state = try await group.next() ?? nil
        group.cancelAll()
        return state
      }
    } catch {
      return nil
    }
  }
}

private nonisolated enum TerminalBarGitClientError: Error {
  case timeout
  case missingOutput
  case failed(Int32)
}

private nonisolated enum TerminalBarGitProcess {
  static func output(cwd: String) async throws -> String {
    let box = TerminalBarGitProcessBox()
    return try await withTaskCancellationHandler {
      try await Task.detached(priority: .utility) {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["git", "-C", cwd, "status", "--porcelain=v1", "--branch"]
        process.standardOutput = output
        process.standardError = Pipe()
        box.set(process)
        defer { box.clear(process) }
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
          throw TerminalBarGitClientError.failed(process.terminationStatus)
        }
        guard let string = String(data: data, encoding: .utf8) else {
          throw TerminalBarGitClientError.missingOutput
        }
        return string
      }
      .value
    } onCancel: {
      box.terminate()
    }
  }
}

private nonisolated final class TerminalBarGitProcessBox: @unchecked Sendable {
  private let lock = NSLock()
  private var process: Process?

  func set(_ process: Process) {
    lock.lock()
    self.process = process
    lock.unlock()
  }

  func clear(_ process: Process) {
    lock.lock()
    if self.process === process {
      self.process = nil
    }
    lock.unlock()
  }

  func terminate() {
    lock.lock()
    let process = process
    lock.unlock()
    process?.terminate()
  }
}
