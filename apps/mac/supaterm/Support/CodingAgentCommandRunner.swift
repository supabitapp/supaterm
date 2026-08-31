import Darwin
import Foundation
import SupatermCLIShared

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

    let processID = try spawn(
      arguments: arguments,
      standardOutput: outputHandle.fileDescriptor,
      standardError: errorHandle.fileDescriptor
    )
    if try !wait(timeout: timeout, until: { try hasExited(processID) }) {
      try terminateAndReap(processID)
      throw CodingAgentCommandRunnerError.timedOut
    }
    let waitStatus = try reap(processID)
    try outputHandle.close()
    try errorHandle.close()

    return CodingAgentCommandResult(
      status: terminationStatus(from: waitStatus),
      standardOutput: try string(at: outputURL),
      standardError: try string(at: errorURL)
    )
  }

  static func loginShellURL(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    currentUserShellPath: String? = SupatermShellCommand.currentUserShellPath()
  ) -> URL {
    URL(
      fileURLWithPath: SupatermShellCommand.loginShellPath(
        environment: environment,
        currentUserShellPath: currentUserShellPath
      )
    )
  }

  private static func string(at url: URL) throws -> String {
    let data = try Data(contentsOf: url)
    return (String(bytes: data, encoding: .utf8) ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func spawn(
    arguments: [String],
    standardOutput: Int32,
    standardError: Int32
  ) throws -> pid_t {
    var fileActions: posix_spawn_file_actions_t?
    try requireSuccess(posix_spawn_file_actions_init(&fileActions))
    defer { posix_spawn_file_actions_destroy(&fileActions) }

    try requireSuccess(posix_spawn_file_actions_addinherit_np(&fileActions, STDIN_FILENO))
    try requireSuccess(
      posix_spawn_file_actions_adddup2(&fileActions, standardOutput, STDOUT_FILENO))
    try requireSuccess(posix_spawn_file_actions_adddup2(&fileActions, standardError, STDERR_FILENO))
    try requireSuccess(posix_spawn_file_actions_addclose(&fileActions, standardOutput))
    try requireSuccess(posix_spawn_file_actions_addclose(&fileActions, standardError))

    var attributes: posix_spawnattr_t?
    try requireSuccess(posix_spawnattr_init(&attributes))
    defer { posix_spawnattr_destroy(&attributes) }

    try requireSuccess(
      posix_spawnattr_setflags(
        &attributes,
        Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT)
      )
    )
    try requireSuccess(posix_spawnattr_setpgroup(&attributes, 0))

    let executablePath = loginShellURL().path
    let argumentPointers = ([executablePath] + arguments).map { strdup($0) }
    defer {
      for pointer in argumentPointers {
        free(pointer)
      }
    }
    guard argumentPointers.allSatisfy({ $0 != nil }) else {
      throw posixError(ENOMEM)
    }

    var processID: pid_t = 0
    var argumentVector = argumentPointers + [nil]
    let result = executablePath.withCString { executablePath in
      argumentVector.withUnsafeMutableBufferPointer { argumentVector in
        posix_spawn(
          &processID,
          executablePath,
          &fileActions,
          &attributes,
          argumentVector.baseAddress,
          environ
        )
      }
    }
    try requireSuccess(result)
    return processID
  }

  private static func wait(
    timeout: TimeInterval,
    until condition: () throws -> Bool
  ) throws -> Bool {
    let deadline = DispatchTime.now() + timeout
    while true {
      if try condition() {
        return true
      }

      let now = DispatchTime.now()
      guard now < deadline else {
        return false
      }
      pause(forNanoseconds: min(deadline.uptimeNanoseconds - now.uptimeNanoseconds, 1_000_000))
    }
  }

  private static func hasExited(_ processID: pid_t) throws -> Bool {
    while true {
      var information = siginfo_t()
      if waitid(
        P_PID,
        id_t(processID),
        &information,
        WEXITED | WNOHANG | WNOWAIT
      ) == 0 {
        return information.si_pid == processID
      }
      guard errno == EINTR else {
        throw posixError(errno)
      }
    }
  }

  private static func terminateAndReap(_ processID: pid_t) throws {
    var reaped = false
    let processGroupExited = {
      if !reaped {
        reaped = try reapIfExited(processID)
      }
      guard reaped else {
        return false
      }
      return try hasProcessGroupExited(processID)
    }

    _ = kill(-processID, SIGTERM)
    if try wait(timeout: 1, until: processGroupExited) {
      return
    }

    _ = kill(-processID, SIGKILL)
    guard try wait(timeout: 1, until: processGroupExited) else {
      throw CodingAgentCommandRunnerError.cleanupTimedOut
    }
  }

  private static func reap(_ processID: pid_t) throws -> Int32 {
    while true {
      var status: Int32 = 0
      let result = waitpid(processID, &status, 0)
      if result == processID {
        return status
      }
      guard result == -1, errno == EINTR else {
        throw posixError(errno)
      }
    }
  }

  private static func reapIfExited(_ processID: pid_t) throws -> Bool {
    while true {
      var status: Int32 = 0
      let result = waitpid(processID, &status, WNOHANG)
      if result == processID {
        return true
      }
      if result == 0 {
        return false
      }
      guard result == -1, errno == EINTR else {
        throw posixError(errno)
      }
    }
  }

  private static func hasProcessGroupExited(_ processGroupID: pid_t) throws -> Bool {
    if kill(-processGroupID, 0) == 0 {
      return false
    }
    if errno == ESRCH {
      return true
    }
    if errno == EPERM {
      return false
    }
    throw posixError(errno)
  }

  private static func pause(forNanoseconds nanoseconds: UInt64) {
    var duration = timespec(tv_sec: 0, tv_nsec: Int(nanoseconds))
    var remaining = timespec()
    while nanosleep(&duration, &remaining) == -1, errno == EINTR {
      duration = remaining
    }
  }

  private static func terminationStatus(from waitStatus: Int32) -> Int32 {
    let signal = waitStatus & 0x7f
    return signal == 0 ? (waitStatus >> 8) & 0xff : signal
  }

  private static func requireSuccess(_ result: Int32) throws {
    guard result == 0 else {
      throw posixError(result)
    }
  }

  private static func posixError(_ code: Int32) -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(code))
  }
}

enum CodingAgentCommandRunnerError: Error, Equatable, LocalizedError {
  case captureSetupFailed
  case cleanupTimedOut
  case timedOut

  var errorDescription: String? {
    switch self {
    case .captureSetupFailed:
      return "Supaterm could not capture coding-agent command output."
    case .cleanupTimedOut:
      return "Supaterm could not stop the timed-out coding-agent command."
    case .timedOut:
      return "The coding-agent command timed out."
    }
  }
}
