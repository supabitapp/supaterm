import Foundation

nonisolated struct ProcessResult: Equatable, Sendable {
  let status: Int32
  let standardOutput: String
  let standardError: String

  var errorMessage: String {
    let trimmedError = standardError.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedError.isEmpty {
      return trimmedError
    }
    return standardOutput.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

nonisolated enum ProcessRunner {
  static func run(
    executableURL: URL,
    arguments: [String]
  ) throws -> ProcessResult {
    let process = Process()
    process.executableURL = executableURL
    process.arguments = arguments

    let outputPipe = Pipe()
    let errorPipe = Pipe()
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    try process.run()
    process.waitUntilExit()

    return ProcessResult(
      status: process.terminationStatus,
      standardOutput: normalizedOutput(from: outputPipe),
      standardError: normalizedOutput(from: errorPipe)
    )
  }

  private static func normalizedOutput(from pipe: Pipe) -> String {
    String(
      bytes: pipe.fileHandleForReading.readDataToEndOfFile(),
      encoding: .utf8
    ) ?? ""
  }
}
