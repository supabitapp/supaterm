import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct SSH: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "ssh",
      abstract: "Open an SSH session in a focused Supaterm tab.",
      discussion: SPHelp.sshDiscussion
    )

    @Option(name: .long, help: "Lock the new tab to this name.")
    var name: String?

    @OptionGroup
    var connection: SPConnectionOptions

    @Argument(parsing: .captureForPassthrough, help: "SSH options and destination.")
    var arguments: [String] = []

    mutating func run() throws {
      if arguments.first == "--help" || arguments.first == "-h" {
        print(SP.helpMessage(for: Self.self))
        return
      }
      let hasSupatermOptions =
        name != nil || connection.explicitSocketPath != nil || connection.instance != nil
      if arguments.isEmpty && !hasSupatermOptions {
        print(SP.helpMessage(for: Self.self))
        return
      }
      try SPSSHControl.run(
        arguments: arguments,
        name: name,
        explicitSocketPath: connection.explicitSocketPath,
        instance: connection.instance
      )
    }
  }

  struct InternalSSH: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: SupatermSSHCommand.program,
      abstract: "Launch the system SSH client.",
      discussion: SPHelp.internalSSHDiscussion,
      shouldDisplay: false
    )

    @OptionGroup
    var invocation: SPSystemSSHInvocation

    mutating func run() throws {
      try SPSSHLauncher.run(
        term: invocation.term,
        ssh: invocation.ssh,
        arguments: invocation.arguments
      )
    }
  }

  struct InternalSSHSession: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: SupatermSSHCommand.sessionProgram,
      abstract: "Run a reconnecting system SSH session.",
      discussion: SPHelp.internalSSHSessionDiscussion,
      shouldDisplay: false
    )

    @OptionGroup
    var invocation: SPSystemSSHInvocation

    mutating func run() throws {
      try SPSSHSessionRunner.run(
        invocation: SPSSHLauncher.invocation(
          term: invocation.term,
          ssh: invocation.ssh,
          arguments: invocation.arguments,
          environment: ProcessInfo.processInfo.environment
        )
      )
    }
  }
}

struct SPSystemSSHInvocation: ParsableArguments {
  @Option(name: .long, help: "TERM value to use for the remote session.")
  var term = SupatermSSHCommand.term

  @Option(name: .long, help: "SSH executable to launch.")
  var ssh = SupatermSSHCommand.program

  @Argument(parsing: .remaining, help: "Arguments to pass to SSH.")
  var arguments: [String] = []
}

protocol SPSSHTransport {
  func send(_ request: SupatermSocketRequest) throws -> SupatermSocketResponse
}

extension SPSocketClient: SPSSHTransport {}

enum SPSSHControl {
  static func run(
    arguments: [String],
    name: String?,
    explicitSocketPath: String?,
    instance: String?,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    executablePath: String? = SPExecutable.currentPath()
  ) throws {
    guard let arguments = SupatermSSHCommand.sessionArguments(arguments) else {
      throw ValidationError("sp ssh requires one interactive SSH destination.")
    }
    let name = try name.map { try normalizedConnectionValue($0, flag: "--name") }
    guard let executablePath else {
      throw ValidationError("Unable to resolve the sp executable path.")
    }

    let client = try socketClient(
      path: explicitSocketPath,
      instance: instance
    )
    try SPSSHCommandRunner(
      transport: client,
      context: SupatermCLIContext(environment: environment),
      cliPath: executablePath,
      shellPath: SupatermShellCommand.loginShellPath()
    ).run(arguments: arguments, name: name)
  }
}

struct SPSSHCommandRunner {
  let transport: any SPSSHTransport
  let context: SupatermCLIContext?
  let cliPath: String
  let shellPath: String

  func run(arguments: [String], name: String?) throws {
    let snapshot = try send(.tree(), as: SupatermTreeSnapshot.self)
    let created = try send(
      .newTab(
        SupatermNewTabRequest(
          startupCommand: startupCommand(arguments: arguments),
          focus: true,
          target: try resolvePublicNewTabPlacement(
            space: nil,
            group: nil,
            context: context,
            snapshot: snapshot
          ),
          context: context
        )
      ),
      as: SupatermNewTabResult.self
    )

    if let name {
      _ = try send(
        .renameTab(
          SupatermRenameTabRequest(
            target: SupatermTabTargetRequest(tabID: created.tabID),
            title: name
          )
        ),
        as: SupatermRenameTabResult.self
      )
    }
  }

  func startupCommand(arguments: [String]) -> String {
    let command =
      ([
        "/usr/bin/env",
        cliPath,
        "internal",
        SupatermSSHCommand.sessionProgram,
        "--",
      ] + arguments)
      .map(SupatermShellCommand.escapedToken)
      .joined(separator: " ")
    return SupatermShellCommand.interactiveStartupCommand(
      for: command,
      shellPath: shellPath
    )
  }

  private func send<Result: Decodable>(
    _ request: SupatermSocketRequest,
    as type: Result.Type
  ) throws -> Result {
    let response = try transport.send(request)
    guard response.ok else {
      throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
    }
    return try response.decodeResult(type)
  }
}

enum SPSSHLauncher {
  struct Invocation: Equatable {
    let executablePath: String
    let arguments: [String]
    let environment: [String: String]
  }

  static func run(
    term: String,
    ssh: String,
    arguments: [String],
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws -> Never {
    let invocation = try invocation(
      term: term,
      ssh: ssh,
      arguments: arguments,
      environment: environment
    )
    try SPProcess.replaceCurrent(
      executablePath: invocation.executablePath,
      arguments: invocation.arguments,
      environment: invocation.environment,
      failureDescription: "Failed to launch SSH"
    )
  }

  static func invocation(
    term: String,
    ssh: String,
    arguments: [String],
    environment: [String: String]
  ) throws -> Invocation {
    guard let resolvedTerm = trimmedNonEmpty(term) else {
      throw ValidationError("--term requires a value.")
    }
    guard let executablePath = SPExecutable.resolve(ssh, searchPath: environment["PATH"])
    else {
      throw ValidationError("Unable to find \(ssh) on PATH.")
    }

    var processEnvironment = environment
    processEnvironment["TERM"] = resolvedTerm
    processEnvironment["COLORTERM"] = "truecolor"

    return Invocation(
      executablePath: executablePath,
      arguments: [executablePath] + SupatermSSHCommand.forwardedEnvironmentOptions + arguments,
      environment: processEnvironment
    )
  }
}

enum SPSSHProcessTermination: Equatable {
  case exited(Int32)
  case signaled(Int32)
}

enum SPSSHSessionRunner {
  typealias Launch = (SPSSHLauncher.Invocation) throws -> SPSSHProcessTermination
  typealias Sleep = (TimeInterval) throws -> Void

  static func run(
    invocation: SPSSHLauncher.Invocation,
    launch: Launch = launch,
    sleep: Sleep = { Thread.sleep(forTimeInterval: $0) }
  ) throws {
    var delay: TimeInterval = 2
    while try launch(invocation) == .exited(255) {
      try sleep(delay)
      delay = min(delay * 2, 30)
    }
  }

  private static func launch(
    _ invocation: SPSSHLauncher.Invocation
  ) throws -> SPSSHProcessTermination {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: invocation.executablePath, isDirectory: false)
    process.arguments = Array(invocation.arguments.dropFirst())
    process.environment = invocation.environment
    process.standardInput = FileHandle.standardInput
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError
    try process.run()
    process.waitUntilExit()
    switch process.terminationReason {
    case .exit:
      return .exited(process.terminationStatus)
    case .uncaughtSignal:
      return .signaled(process.terminationStatus)
    @unknown default:
      return .signaled(process.terminationStatus)
    }
  }
}
