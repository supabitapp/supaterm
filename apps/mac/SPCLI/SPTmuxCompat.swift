import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

extension SP {
  struct Run: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "run",
      abstract: "Launch a command with Supaterm tmux compatibility enabled.",
      discussion: SPHelp.runDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    @Argument(parsing: .remaining, help: "Command and arguments to launch.")
    var arguments: [String] = []

    mutating func run() throws {
      if arguments.isEmpty {
        print(Self.helpMessage())
        return
      }
      try SPRunLauncher.run(
        arguments: arguments,
        explicitSocketPath: connection.explicitSocketPath,
        instance: connection.instance
      )
    }
  }

  struct Tmux: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "tmux",
      abstract: "Run tmux-compatible commands against Supaterm.",
      discussion: SPHelp.tmuxDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    @Argument(parsing: .remaining, help: "tmux-compatible arguments.")
    var arguments: [String] = []

    mutating func run() throws {
      if arguments.isEmpty {
        print(Self.helpMessage())
        return
      }
      try SPTmuxCompatibility.run(
        arguments: arguments,
        explicitSocketPath: connection.explicitSocketPath,
        instance: connection.instance
      )
    }
  }
}

struct SPRawConnectionOptions: Equatable {
  let explicitSocketPath: String?
  let instance: String?
}

struct SPRawConnectionInvocation: Equatable {
  let connection: SPRawConnectionOptions
  let arguments: [String]

  static func parse(_ arguments: [String]) throws -> Self {
    var explicitSocketPath: String?
    var instance: String?
    var index = 0

    while index < arguments.count {
      let argument = arguments[index]

      if argument == "--" {
        return .init(
          connection: .init(
            explicitSocketPath: explicitSocketPath,
            instance: instance
          ),
          arguments: Array(arguments.dropFirst(index + 1))
        )
      }

      if argument == "--socket" {
        guard index + 1 < arguments.count else {
          throw ValidationError("--socket requires a value.")
        }
        explicitSocketPath = try normalizedConnectionValue(arguments[index + 1], flag: "--socket")
        index += 2
        continue
      }

      if argument.hasPrefix("--socket=") {
        explicitSocketPath = try normalizedConnectionEqualsValue(argument, flag: "--socket")
        index += 1
        continue
      }

      if argument == "--instance" {
        guard index + 1 < arguments.count else {
          throw ValidationError("--instance requires a value.")
        }
        instance = try normalizedConnectionValue(arguments[index + 1], flag: "--instance")
        index += 2
        continue
      }

      if argument.hasPrefix("--instance=") {
        instance = try normalizedConnectionEqualsValue(argument, flag: "--instance")
        index += 1
        continue
      }

      return .init(
        connection: .init(
          explicitSocketPath: explicitSocketPath,
          instance: instance
        ),
        arguments: Array(arguments.dropFirst(index))
      )
    }

    return .init(
      connection: .init(
        explicitSocketPath: explicitSocketPath,
        instance: instance
      ),
      arguments: []
    )
  }
}

protocol SPTmuxTransport {
  func send(_ request: SupatermSocketRequest) throws -> SupatermSocketResponse
}

extension SPSocketClient: SPTmuxTransport {}

enum SPTmuxCompatibility {
  static func run(
    arguments: [String],
    explicitSocketPath: String? = nil,
    instance: String? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws {
    SPTmuxTrace.write(
      category: "sp.tmux",
      event: "invoke",
      fields: [
        "arguments": arguments.joined(separator: "\u{1f}"),
        "socket_path": explicitSocketPath,
        "instance": instance,
        "tmux": environment["TMUX"],
        "tmux_pane": environment["TMUX_PANE"],
      ],
      environment: environment
    )
    let client = try socketClient(
      path: explicitSocketPath,
      instance: instance
    )
    try SPTmuxCommandRunner(
      transport: client,
      environment: environment
    ).run(arguments: arguments)
  }
}
