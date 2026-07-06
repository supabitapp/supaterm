import Darwin
import Foundation

struct SPBinaryResult: Equatable {
  let exitCode: Int32
  let stdout: String
  let stderr: String
}

struct SPBinaryRunner {
  let executable: URL
  let environment: [String: String]

  func run(
    _ arguments: [String],
    cwd: URL? = nil,
    timeout: TimeInterval = 10
  ) throws -> SPBinaryResult {
    let process = Process()
    let stdout = Pipe()
    let stderr = Pipe()
    process.executableURL = executable
    process.arguments = arguments
    process.currentDirectoryURL = cwd
    process.environment = environment
    process.standardOutput = stdout
    process.standardError = stderr
    try process.run()

    let deadline = Date().addingTimeInterval(timeout)
    while process.isRunning, Date() < deadline {
      usleep(50_000)
    }
    if process.isRunning {
      process.terminate()
      usleep(100_000)
      if process.isRunning {
        kill(process.processIdentifier, SIGKILL)
      }
      process.waitUntilExit()
      throw SupatermE2EError("sp timed out: \(arguments.joined(separator: " "))")
    }

    process.waitUntilExit()
    let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
    let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
    guard let stdoutText = String(bytes: stdoutData, encoding: .utf8),
      let stderrText = String(bytes: stderrData, encoding: .utf8)
    else {
      throw SupatermE2EError("sp emitted non-UTF-8 output")
    }
    return SPBinaryResult(
      exitCode: process.terminationStatus,
      stdout: stdoutText,
      stderr: stderrText
    )
  }
}

@discardableResult
func requireSuccessfulSPResult(_ result: SPBinaryResult) throws -> SPBinaryResult {
  guard result.exitCode == 0 else {
    throw SupatermE2EError(
      "sp exited \(result.exitCode)\n--- stdout ---\n\(result.stdout)\n--- stderr ---\n\(result.stderr)"
    )
  }
  return result
}
