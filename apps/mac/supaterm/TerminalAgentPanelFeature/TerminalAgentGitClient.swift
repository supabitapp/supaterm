import Foundation

nonisolated struct TerminalAgentPanelCommandResult: Equatable, Sendable {
  let status: Int32
  let stdout: String
  let stderr: String

  init(status: Int32, stdout: String, stderr: String = "") {
    self.status = status
    self.stdout = stdout
    self.stderr = stderr
  }
}

nonisolated enum TerminalAgentPanelCommandError: Error, Equatable, Sendable {
  case launchFailed(String)
}

nonisolated struct TerminalAgentPanelCommandRunner: Sendable {
  var run: @Sendable (URL, [String], URL?) async throws -> TerminalAgentPanelCommandResult
  var runLoginCommand: @Sendable (String, URL?) async throws -> TerminalAgentPanelCommandResult

  static let live = Self(
    run: { executableURL, arguments, currentDirectoryURL in
      try await runProcess(
        executableURL: executableURL,
        arguments: arguments,
        currentDirectoryURL: currentDirectoryURL
      )
    },
    runLoginCommand: { command, currentDirectoryURL in
      try await runProcess(
        executableURL: loginShellURL(),
        arguments: ["-l", "-i", "-c", command],
        currentDirectoryURL: currentDirectoryURL
      )
    }
  )

  private static func runProcess(
    executableURL: URL,
    arguments: [String],
    currentDirectoryURL: URL?
  ) async throws -> TerminalAgentPanelCommandResult {
    try await Task.detached(priority: .utility) {
      let process = Process()
      process.executableURL = executableURL
      process.arguments = arguments
      process.currentDirectoryURL = currentDirectoryURL
      process.standardInput = FileHandle.nullDevice

      let stdoutPipe = Pipe()
      let stderrPipe = Pipe()
      process.standardOutput = stdoutPipe
      process.standardError = stderrPipe

      do {
        try process.run()
      } catch {
        throw TerminalAgentPanelCommandError.launchFailed(error.localizedDescription)
      }

      let stdoutTask = Task.detached(priority: .utility) {
        stdoutPipe.fileHandleForReading.readDataToEndOfFile()
      }
      let stderrTask = Task.detached(priority: .utility) {
        stderrPipe.fileHandleForReading.readDataToEndOfFile()
      }
      process.waitUntilExit()
      let stdoutData = await stdoutTask.value
      let stderrData = await stderrTask.value

      return TerminalAgentPanelCommandResult(
        status: process.terminationStatus,
        stdout: String(data: stdoutData, encoding: .utf8) ?? "",
        stderr: String(data: stderrData, encoding: .utf8) ?? ""
      )
    }.value
  }

  private static func loginShellURL(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    let shell = environment["SHELL"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let shell, !shell.isEmpty {
      return URL(fileURLWithPath: shell)
    }
    return URL(fileURLWithPath: "/bin/zsh")
  }
}

nonisolated struct TerminalAgentGitSnapshot: Equatable, Sendable {
  let repoRoot: URL
  let headURL: URL?
  let branchName: String
  let addedLineCount: Int
  let removedLineCount: Int
  let remoteURL: String?

  init(
    repoRoot: URL,
    headURL: URL?,
    branchName: String,
    addedLineCount: Int,
    removedLineCount: Int,
    remoteURL: String? = nil
  ) {
    self.repoRoot = repoRoot
    self.headURL = headURL
    self.branchName = branchName
    self.addedLineCount = addedLineCount
    self.removedLineCount = removedLineCount
    self.remoteURL = remoteURL
  }
}

nonisolated struct TerminalAgentGitClient: Sendable {
  let runner: TerminalAgentPanelCommandRunner
  private let snapshotProvider: (@Sendable (String) async -> TerminalAgentGitSnapshot?)?

  init(runner: TerminalAgentPanelCommandRunner = .live) {
    self.runner = runner
    snapshotProvider = nil
  }

  init(snapshot: @escaping @Sendable (String) async -> TerminalAgentGitSnapshot?) {
    runner = .live
    snapshotProvider = snapshot
  }

  nonisolated func snapshot(workingDirectoryPath: String) async -> TerminalAgentGitSnapshot? {
    if let snapshotProvider {
      return await snapshotProvider(workingDirectoryPath)
    }
    let workingDirectoryURL = URL(fileURLWithPath: workingDirectoryPath, isDirectory: true)
    guard let repoRoot = await repoRoot(for: workingDirectoryURL) else {
      return nil
    }
    let headURL = Self.headURL(for: repoRoot, fileManager: .default)
    let branchName = Self.branchName(headURL: headURL) ?? "HEAD"
    let changes = await lineChanges(repoRoot: repoRoot, headURL: headURL) ?? (added: 0, removed: 0)
    let remoteURL = await remoteURL(repoRoot: repoRoot, branchName: branchName)
    let snapshot = TerminalAgentGitSnapshot(
      repoRoot: repoRoot,
      headURL: headURL,
      branchName: branchName,
      addedLineCount: changes.added,
      removedLineCount: changes.removed,
      remoteURL: remoteURL
    )
    return snapshot
  }

  nonisolated func repoRoot(for workingDirectoryURL: URL) async -> URL? {
    guard
      let result = try? await runGit(
        arguments: [
          "-C",
          workingDirectoryURL.path(percentEncoded: false),
          "rev-parse",
          "--show-toplevel",
        ]
      ), result.status == 0
    else {
      return nil
    }
    let path = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !path.isEmpty else { return nil }
    return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
  }

  nonisolated private func lineChanges(
    repoRoot: URL,
    headURL: URL?
  ) async -> (added: Int, removed: Int)? {
    guard !Self.isIndexLocked(headURL: headURL, fileManager: .default) else {
      return nil
    }
    guard
      let result = try? await runGit(
        arguments: [
          "-C",
          repoRoot.path(percentEncoded: false),
          "diff",
          "HEAD",
          "--shortstat",
        ]
      ), result.status == 0
    else {
      return nil
    }
    return Self.parseShortstat(result.stdout)
  }

  nonisolated private func runGit(
    arguments: [String]
  ) async throws -> TerminalAgentPanelCommandResult {
    try await runner.run(URL(fileURLWithPath: "/usr/bin/env"), ["git"] + arguments, nil)
  }

  nonisolated private func remoteURL(
    repoRoot: URL,
    branchName: String
  ) async -> String? {
    let configuredRemoteName = await gitOutput(
      arguments: [
        "-C",
        repoRoot.path(percentEncoded: false),
        "config",
        "--get",
        "branch.\(branchName).remote",
      ]
    )
    let remoteName = configuredRemoteName.flatMap(Self.normalizedRemoteName) ?? "origin"
    if let remoteURL = await gitOutput(
      arguments: [
        "-C",
        repoRoot.path(percentEncoded: false),
        "remote",
        "get-url",
        remoteName,
      ]
    ) {
      return remoteURL
    }
    guard remoteName != "origin" else { return nil }
    return await gitOutput(
      arguments: [
        "-C",
        repoRoot.path(percentEncoded: false),
        "remote",
        "get-url",
        "origin",
      ]
    )
  }

  nonisolated private func gitOutput(arguments: [String]) async -> String? {
    guard
      let result = try? await runGit(arguments: arguments),
      result.status == 0
    else {
      return nil
    }
    let output = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else { return nil }
    return output
  }

  nonisolated private static func normalizedRemoteName(_ value: String) -> String? {
    let remoteName = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !remoteName.isEmpty, remoteName != "." else { return nil }
    return remoteName
  }

  nonisolated static func parseShortstat(_ output: String) -> (added: Int, removed: Int) {
    let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return (0, 0)
    }
    var added = 0
    var removed = 0
    if let match = trimmed.firstMatch(of: /(\d+)\s+insertions?\(\+\)/) {
      added = Int(match.1) ?? 0
    }
    if let match = trimmed.firstMatch(of: /(\d+)\s+deletions?\(-\)/) {
      removed = Int(match.1) ?? 0
    }
    return (added, removed)
  }

  nonisolated static func branchName(headURL: URL?) -> String? {
    guard let headURL,
      let line = try? String(contentsOf: headURL, encoding: .utf8)
        .split(whereSeparator: \.isNewline)
        .first
    else {
      return nil
    }
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    let refPrefix = "ref:"
    guard trimmed.hasPrefix(refPrefix) else {
      return "HEAD"
    }
    let ref = trimmed.dropFirst(refPrefix.count).trimmingCharacters(in: .whitespaces)
    let headsPrefix = "refs/heads/"
    if ref.hasPrefix(headsPrefix) {
      return String(ref.dropFirst(headsPrefix.count))
    }
    return String(ref)
  }

  nonisolated static func isIndexLocked(
    headURL: URL?,
    fileManager: FileManager
  ) -> Bool {
    guard let headURL else { return false }
    let lockURL = headURL.deletingLastPathComponent().appending(path: "index.lock")
    return fileManager.fileExists(atPath: lockURL.path(percentEncoded: false))
  }

  nonisolated static func headURL(
    for worktreeURL: URL,
    fileManager: FileManager
  ) -> URL? {
    let gitURL = worktreeURL.appending(path: ".git")
    var isDirectory = ObjCBool(false)
    guard
      fileManager.fileExists(
        atPath: gitURL.path(percentEncoded: false),
        isDirectory: &isDirectory
      )
    else {
      return nil
    }
    if isDirectory.boolValue {
      return gitURL.appending(path: "HEAD")
    }
    guard let contents = try? String(contentsOf: gitURL, encoding: .utf8),
      let line = contents.split(whereSeparator: \.isNewline).first
    else {
      return nil
    }
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    let prefix = "gitdir:"
    guard trimmed.hasPrefix(prefix) else {
      return nil
    }
    let pathPart = trimmed.dropFirst(prefix.count).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !pathPart.isEmpty else { return nil }
    return URL(fileURLWithPath: String(pathPart), relativeTo: worktreeURL)
      .standardizedFileURL
      .appending(path: "HEAD")
  }
}
