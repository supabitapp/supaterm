import ArgumentParser
import Darwin
import Foundation

public enum SPEntrypoint {
  public static func main(
    arguments: [String] = CommandLine.arguments,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) {
    do {
      if try handleRawInvocation(arguments: arguments, environment: environment) {
        return
      }
      SP.main()
    } catch {
      FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
      Darwin.exit(EXIT_FAILURE)
    }
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

    case "claude-teams":
      let invocation = try SPRawConnectionInvocation.parse(Array(commandArguments.dropFirst()))
      try SPTeammateLauncher.run(
        arguments: invocation.arguments,
        explicitSocketPath: invocation.connection.explicitSocketPath,
        instance: invocation.connection.instance,
        environment: environment
      )
      return true

    default:
      return false
    }
  }
}
