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
      if try handleRawInvocation(arguments: arguments, environment: environment) {
        return
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

    let normalizedCandidatePath = SPExecutable.normalizedPath(candidatePath)
    guard isExecutableFile(normalizedCandidatePath) else {
      return nil
    }

    guard let currentExecutablePath else {
      return nil
    }

    let normalizedCurrentExecutablePath = SPExecutable.normalizedPath(currentExecutablePath)
    guard normalizedCandidatePath != normalizedCurrentExecutablePath else {
      return nil
    }

    return normalizedCandidatePath
  }

  static func handleRawInvocation(
    arguments: [String],
    environment: [String: String]
  ) throws -> Bool {
    let commandArguments = Array(arguments.dropFirst())
    guard let subcommand = commandArguments.first?.lowercased() else {
      return false
    }

    switch subcommand {
    case "tmux":
      let invocation = try SPRawConnectionInvocation.parse(Array(commandArguments.dropFirst()))
      if invocation.arguments.isEmpty || invocation.arguments.first == "--help" || invocation.arguments.first == "-h" {
        print(SP.helpMessage(for: SP.Tmux.self))
      } else {
        try SPTmuxCompatibility.run(
          arguments: invocation.arguments,
          explicitSocketPath: invocation.connection.explicitSocketPath,
          instance: invocation.connection.instance,
          environment: environment
        )
      }
      return true
    case "run":
      let invocation = try SPRawConnectionInvocation.parse(Array(commandArguments.dropFirst()))
      if invocation.arguments.isEmpty || invocation.arguments.first == "--help" || invocation.arguments.first == "-h" {
        print(SP.helpMessage(for: SP.Run.self))
      } else {
        try SPRunLauncher.run(
          arguments: invocation.arguments,
          explicitSocketPath: invocation.connection.explicitSocketPath,
          instance: invocation.connection.instance,
          environment: environment
        )
      }
      return true

    default:
      return false
    }
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
