import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

public enum SPEntrypoint {
  public static func main(
    arguments: [String] = CommandLine.arguments,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) {
    do {
      if let redirectedCLIPath = redirectedCLIPath(
        environment: environment,
        currentExecutablePath: SPExecutable.currentPath()
      ) {
        try exec(path: redirectedCLIPath, arguments: [redirectedCLIPath] + arguments.dropFirst())
      }
      SP.main()
    } catch {
      FileHandle.standardError.write(Data((errorMessage(for: error) + "\n").utf8))
      Darwin.exit(EXIT_FAILURE)
    }
  }

  static func errorMessage(for error: Error) -> String {
    if let error = error as? ValidationError {
      return error.message
    }
    return error.localizedDescription
  }

  static func redirectedCLIPath(
    environment: [String: String],
    currentExecutablePath: String?,
    isExecutableFile: (String) -> Bool = SPExecutable.isExecutableFile(atPath:)
  ) -> String? {
    guard
      let candidatePath = environment[SupatermCLIEnvironment.cliPathKey]?
        .trimmingCharacters(in: .whitespacesAndNewlines),
      !candidatePath.isEmpty
    else {
      return nil
    }

    let canonicalCandidatePath = SPExecutable.canonicalPath(candidatePath)
    guard isExecutableFile(canonicalCandidatePath) else {
      return nil
    }

    guard let currentExecutablePath else {
      return nil
    }

    let canonicalCurrentExecutablePath = SPExecutable.canonicalPath(currentExecutablePath)
    guard canonicalCandidatePath != canonicalCurrentExecutablePath else {
      return nil
    }

    return canonicalCandidatePath
  }

  static func exec(
    path: String,
    arguments: [String]
  ) throws -> Never {
    try SPProcess.replaceCurrent(
      executablePath: path,
      arguments: arguments,
      failureDescription: "Failed to launch Supaterm CLI"
    )
  }
}
