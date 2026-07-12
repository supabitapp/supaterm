import Darwin
import Foundation

enum LoginShellCommandAvailability {
  static func commandArguments(for commandNames: [String]) -> [String] {
    let checks = commandNames.map { "command -v \($0) >/dev/null 2>&1" }
    return interactiveCommandArguments(for: checks.joined(separator: " || "))
  }

  static func interactiveCommandArguments(for command: String) -> [String] {
    SupatermShellCommand.loginShellCommandArguments(for: command)
  }
}

struct CodingAgentCommandResult: Equatable, Sendable {
  let status: Int32
  let standardOutput: String
  let standardError: String

  init(
    status: Int32,
    standardOutput: String = "",
    standardError: String = ""
  ) {
    self.status = status
    self.standardOutput = standardOutput
    self.standardError = standardError
  }
}

enum CodingAgentCommandRunner {
  static func run(
    arguments: [String],
    timeout: TimeInterval = 10
  ) throws -> CodingAgentCommandResult {
    let process = Process()
    process.executableURL = loginShellURL()
    process.arguments = arguments

    let captureDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-command-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
      at: captureDirectory,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    defer { try? FileManager.default.removeItem(at: captureDirectory) }
    let outputURL = captureDirectory.appendingPathComponent("stdout", isDirectory: false)
    let errorURL = captureDirectory.appendingPathComponent("stderr", isDirectory: false)
    guard
      FileManager.default.createFile(
        atPath: outputURL.path,
        contents: nil,
        attributes: [.posixPermissions: 0o600]
      ),
      FileManager.default.createFile(
        atPath: errorURL.path,
        contents: nil,
        attributes: [.posixPermissions: 0o600]
      )
    else {
      throw CodingAgentCommandRunnerError.captureSetupFailed
    }
    let outputHandle = try FileHandle(forWritingTo: outputURL)
    let errorHandle = try FileHandle(forWritingTo: errorURL)
    defer {
      try? outputHandle.close()
      try? errorHandle.close()
    }
    process.standardOutput = outputHandle
    process.standardError = errorHandle

    let processExited = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in
      processExited.signal()
    }

    try process.run()
    if processExited.wait(timeout: .now() + timeout) == .timedOut {
      process.terminate()
      if processExited.wait(timeout: .now() + 1) == .timedOut, process.isRunning {
        kill(process.processIdentifier, SIGKILL)
        _ = processExited.wait(timeout: .now() + 1)
      }
      try? outputHandle.close()
      try? errorHandle.close()
      throw CodingAgentCommandRunnerError.timedOut
    }
    try outputHandle.close()
    try errorHandle.close()

    return CodingAgentCommandResult(
      status: process.terminationStatus,
      standardOutput: try string(at: outputURL),
      standardError: try string(at: errorURL)
    )
  }

  static func loginShellURL(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    currentUserShellPath: String? = currentUserShellPath()
  ) -> URL {
    URL(
      fileURLWithPath: SupatermShellCommand.loginShellPath(
        environment: environment,
        currentUserShellPath: currentUserShellPath
      )
    )
  }

  private static func currentUserShellPath() -> String? {
    guard let entry = getpwuid(getuid()), let shell = entry.pointee.pw_shell else {
      return nil
    }
    return String(cString: shell)
  }

  private static func string(at url: URL) throws -> String {
    let data = try Data(contentsOf: url)
    return (String(bytes: data, encoding: .utf8) ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

enum CodingAgentCommandRunnerError: Error, Equatable, LocalizedError {
  case captureSetupFailed
  case timedOut

  var errorDescription: String? {
    switch self {
    case .captureSetupFailed:
      return "Supaterm could not capture coding-agent command output."
    case .timedOut:
      return "The coding-agent command timed out."
    }
  }
}
