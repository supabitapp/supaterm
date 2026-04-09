import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared

struct CommandExecutionResult: Equatable {
  let status: Int32
  let standardError: String
  let standardOutput: String
}

func writeExecutable(
  at url: URL,
  script: String
) throws {
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try script.write(to: url, atomically: true, encoding: .utf8)
  try setExecutablePermissions(at: url)
}

func setExecutablePermissions(at url: URL) throws {
  let result = url.path.withCString { pointer in
    chmod(pointer, mode_t(0o755))
  }
  guard result == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}

func runExecutable(
  at executableURL: URL,
  arguments: [String],
  environment: [String: String]
) throws -> String {
  let process = Process()
  process.executableURL = executableURL
  process.arguments = arguments
  var processEnvironment = ProcessInfo.processInfo.environment
  for (key, value) in environment {
    processEnvironment[key] = value
  }
  process.environment = processEnvironment

  let stdoutPipe = Pipe()
  let stderrPipe = Pipe()
  process.standardOutput = stdoutPipe
  process.standardError = stderrPipe

  try process.run()
  process.waitUntilExit()

  let stdout =
    String(
      data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(),
      encoding: .utf8
    ) ?? ""
  let stderr =
    String(
      data: stderrPipe.fileHandleForReading.readDataToEndOfFile(),
      encoding: .utf8
    ) ?? ""

  if process.terminationStatus != 0 {
    Issue.record("Command failed with status \(process.terminationStatus): \(stderr)")
  }
  return stdout
}

func runExecutable(
  at executableURL: URL,
  arguments: [String],
  environment: [String: String],
  standardInput: String
) throws -> CommandExecutionResult {
  let process = Process()
  process.executableURL = executableURL
  process.arguments = arguments
  var processEnvironment = ProcessInfo.processInfo.environment
  for (key, value) in environment {
    processEnvironment[key] = value
  }
  process.environment = processEnvironment

  let stdinPipe = Pipe()
  let stdoutPipe = Pipe()
  let stderrPipe = Pipe()
  process.standardInput = stdinPipe
  process.standardOutput = stdoutPipe
  process.standardError = stderrPipe

  try process.run()
  stdinPipe.fileHandleForWriting.write(Data(standardInput.utf8))
  try stdinPipe.fileHandleForWriting.close()
  process.waitUntilExit()

  let standardOutput =
    String(
      data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(),
      encoding: .utf8
    ) ?? ""
  let standardError =
    String(
      data: stderrPipe.fileHandleForReading.readDataToEndOfFile(),
      encoding: .utf8
    ) ?? ""

  return .init(
    status: process.terminationStatus,
    standardError: standardError,
    standardOutput: standardOutput
  )
}

func makeCommandExecutionTemporaryDirectory() throws -> URL {
  var template = Array("/tmp/stm.XXXXXX".utf8CString)
  guard let pointer = mkdtemp(&template) else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  let path = SupatermSocketPath.canonicalized(String(cString: pointer)) ?? String(cString: pointer)
  return URL(fileURLWithPath: path, isDirectory: true)
}

func executableURL(named name: String) -> URL? {
  for directory in ProcessInfo.processInfo.environment["PATH"]?.split(separator: ":") ?? [] {
    let url = URL(fileURLWithPath: String(directory), isDirectory: true)
      .appendingPathComponent(name, isDirectory: false)
    if FileManager.default.isExecutableFile(atPath: url.path) {
      return url
    }
  }
  return nil
}
