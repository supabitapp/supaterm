import ArgumentParser
import CryptoKit
import Foundation
import SupatermCLIShared

extension SP {
  struct Host: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "host",
      abstract: "Run Supaterm sessions on remote hosts.",
      shouldDisplay: false,
      subcommands: [SPHostAttach.self, SPHostKill.self, SPHostSessions.self]
    )
  }
}

struct SPHostConnectionOptions: ParsableArguments {
  @Option(name: .long)
  var destination: String

  @Option(name: .customLong("ssh-arguments"))
  var sshArgumentsJSON = "[]"

  func value() throws -> SPRemoteHostConnection {
    try SPRemoteHostConnection(
      destination: destination,
      sshArgumentsJSON: sshArgumentsJSON
    )
  }
}

struct SPHostAttach: ParsableCommand {
  static let configuration = CommandConfiguration(commandName: "attach")

  @OptionGroup
  var connectionOptions: SPHostConnectionOptions

  @Option(name: .long)
  var session: String

  @Option(name: .customLong("working-directory"))
  var workingDirectory: String?

  @Option(name: .customLong("command"))
  var commandJSON = "[]"

  @Flag(name: .long)
  var existing = false

  @Argument(parsing: .remaining)
  var trailingCommand: [String] = []

  mutating func run() throws {
    try SPRemoteSessionHost.attach(
      connection: try connectionOptions.value(),
      session: session,
      workingDirectory: workingDirectory,
      existing: existing,
      command: try decodedCommand()
    )
  }

  private func decodedCommand() throws -> [String] {
    guard let data = commandJSON.data(using: .utf8),
      let command = try? JSONDecoder().decode([String].self, from: data),
      !command.contains(where: { $0.contains("\0") })
    else {
      throw ValidationError("Invalid remote command.")
    }
    return command
  }
}

struct SPHostKill: ParsableCommand {
  static let configuration = CommandConfiguration(commandName: "kill")

  @OptionGroup
  var connectionOptions: SPHostConnectionOptions

  @Option(name: .long)
  var session: String

  mutating func run() throws {
    try SPRemoteSessionHost.kill(
      connection: try connectionOptions.value(),
      session: session
    )
  }
}

struct SPHostSessions: ParsableCommand {
  static let configuration = CommandConfiguration(commandName: "sessions")

  @OptionGroup
  var connectionOptions: SPHostConnectionOptions

  mutating func run() throws {
    print(
      try SPRemoteSessionHost.sessions(connection: connectionOptions.value()),
      terminator: ""
    )
  }
}

struct SPRemoteHostConnection: Equatable {
  let destination: String
  let sshArguments: [String]

  init(destination: String, sshArgumentsJSON: String) throws {
    guard !destination.isEmpty, destination.first != "-",
      destination.rangeOfCharacter(from: .whitespacesAndNewlines) == nil
    else {
      throw ValidationError("Invalid remote host destination.")
    }
    guard let data = sshArgumentsJSON.data(using: .utf8),
      let sshArguments = try? JSONDecoder().decode([String].self, from: data),
      !sshArguments.contains(where: { $0.contains("\0") || $0.contains("\n") || $0.contains("\r") })
    else {
      throw ValidationError("Invalid SSH arguments.")
    }
    self.destination = destination
    self.sshArguments = sshArguments
  }
}

enum SPRemoteSessionHost {
  struct PreparedHost: Equatable {
    let executablePath: String
    let sshExecutablePath: String
  }

  static func attach(
    connection: SPRemoteHostConnection,
    session: String,
    workingDirectory: String?,
    existing: Bool,
    command: [String],
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws -> Never {
    let prepared = try prepare(connection: connection, environment: environment)
    let remoteCommand = attachCommand(
      executablePath: prepared.executablePath,
      session: session,
      workingDirectory: workingDirectory,
      existing: existing,
      command: command
    )
    let invocation = try SPSSHLauncher.invocation(
      term: SupatermSSHCommand.term,
      ssh: prepared.sshExecutablePath,
      arguments: connection.sshArguments + ["-t", connection.destination, remoteCommand],
      environment: environment
    )
    try SPProcess.replaceCurrent(
      executablePath: invocation.executablePath,
      arguments: invocation.arguments,
      environment: invocation.environment,
      failureDescription: "Failed to attach remote session"
    )
  }

  static func kill(
    connection: SPRemoteHostConnection,
    session: String,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws {
    let prepared = try prepare(connection: connection, environment: environment)
    let command = "exec \(prepared.executablePath) kill \(shellQuote(session))"
    try runSSH(
      executablePath: prepared.sshExecutablePath,
      connection: connection,
      remoteCommand: command,
      environment: environment
    )
  }

  static func sessions(
    connection: SPRemoteHostConnection,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws -> String {
    let prepared = try prepare(connection: connection, environment: environment)
    return try runSSH(
      executablePath: prepared.sshExecutablePath,
      connection: connection,
      remoteCommand: "exec \(prepared.executablePath) ls",
      environment: environment,
      capturesOutput: true
    )
  }

  static func prepare(
    connection: SPRemoteHostConnection,
    executableURL: URL? = SPExecutable.currentPath().map { URL(fileURLWithPath: $0) },
    environment: [String: String]
  ) throws -> PreparedHost {
    guard let sshExecutablePath = SPExecutable.resolve("ssh", searchPath: environment["PATH"]) else {
      throw ValidationError("Unable to find ssh on PATH.")
    }
    let probe = try probePlatform(
      executablePath: sshExecutablePath,
      connection: connection,
      environment: environment
    )
    guard
      let platform = SupatermSessionHostPlatform(
        operatingSystem: probe.operatingSystem,
        architecture: probe.architecture
      )
    else {
      throw ValidationError(
        "Remote host platform is unsupported: \(probe.operatingSystem) \(probe.architecture)."
      )
    }
    guard let executableURL,
      let assetURL = SupatermBundleLayout.remoteSessionHostExecutableURL(
        nextTo: executableURL,
        platform: platform
      )
    else {
      throw ValidationError("The remote session host for \(platform.rawValue) is missing.")
    }
    let digest = SHA256.hash(data: try Data(contentsOf: assetURL))
      .map { String(format: "%02x", $0) }
      .joined()
    let executablePath = "$HOME/.local/share/supaterm/hosts/\(digest)/supaterm-host"
    if try !isInstalled(
      executablePath: sshExecutablePath,
      connection: connection,
      remoteExecutablePath: executablePath,
      environment: environment
    ) {
      try install(
        assetURL: assetURL,
        executablePath: sshExecutablePath,
        connection: connection,
        remoteExecutablePath: executablePath,
        environment: environment
      )
    }
    return PreparedHost(
      executablePath: "\"\(executablePath)\"",
      sshExecutablePath: sshExecutablePath
    )
  }

  static func probePlatform(
    executablePath: String,
    connection: SPRemoteHostConnection,
    environment: [String: String]
  ) throws -> (operatingSystem: String, architecture: String) {
    let output = try runSSH(
      executablePath: executablePath,
      connection: connection,
      remoteCommand: "printf '__SUPATERM_HOST_PLATFORM__%s %s\\n' \"$(uname -s)\" \"$(uname -m)\"",
      environment: environment,
      capturesOutput: true
    )
    return try parsePlatformProbe(output)
  }

  static func parsePlatformProbe(
    _ output: String
  ) throws -> (operatingSystem: String, architecture: String) {
    let prefix = "__SUPATERM_HOST_PLATFORM__"
    guard
      let line = output.split(whereSeparator: \.isNewline).first(where: { $0.hasPrefix(prefix) })
    else {
      throw ValidationError("Remote host returned an invalid platform response.")
    }
    let parts = line.dropFirst(prefix.count).split(whereSeparator: \.isWhitespace).map(String.init)
    guard parts.count == 2 else {
      throw ValidationError("Remote host returned an invalid platform response.")
    }
    return (parts[0], parts[1])
  }

  static func attachCommand(
    executablePath: String,
    session: String,
    workingDirectory: String?,
    existing: Bool,
    command: [String]
  ) -> String {
    var arguments = ["attach"]
    if existing {
      arguments.append("--existing")
    }
    arguments.append(session)
    arguments.append(contentsOf: command)
    let invocation = ([executablePath] + arguments.map(shellQuote)).joined(separator: " ")
    guard let workingDirectory, !workingDirectory.isEmpty else {
      return "exec \(invocation)"
    }
    return "cd -- \(shellQuote(workingDirectory)) && exec \(invocation)"
  }

  static func shellQuote(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
  }

  private static func isInstalled(
    executablePath: String,
    connection: SPRemoteHostConnection,
    remoteExecutablePath: String,
    environment: [String: String]
  ) throws -> Bool {
    do {
      _ = try runSSH(
        executablePath: executablePath,
        connection: connection,
        remoteCommand: "test -x \"\(remoteExecutablePath)\"",
        environment: environment
      )
      return true
    } catch {
      return false
    }
  }

  private static func install(
    assetURL: URL,
    executablePath: String,
    connection: SPRemoteHostConnection,
    remoteExecutablePath: String,
    environment: [String: String]
  ) throws {
    let directory = String(remoteExecutablePath.dropLast("/supaterm-host".count))
    let temporary = "\(remoteExecutablePath).$$"
    let command = [
      "umask 077",
      "mkdir -p \"\(directory)\"",
      "cat > \"\(temporary)\"",
      "chmod 700 \"\(temporary)\"",
      "mv -f \"\(temporary)\" \"\(remoteExecutablePath)\"",
    ].joined(separator: " && ")
    let input = try FileHandle(forReadingFrom: assetURL)
    defer { try? input.close() }
    _ = try runSSH(
      executablePath: executablePath,
      connection: connection,
      remoteCommand: command,
      environment: environment,
      standardInput: input
    )
  }

  @discardableResult
  private static func runSSH(
    executablePath: String,
    connection: SPRemoteHostConnection,
    remoteCommand: String,
    environment: [String: String],
    capturesOutput: Bool = false,
    standardInput: FileHandle? = nil
  ) throws -> String {
    let process = Process()
    let outputPipe = Pipe()
    process.executableURL = URL(fileURLWithPath: executablePath)
    process.arguments = connection.sshArguments + ["-T", connection.destination, remoteCommand]
    process.environment = environment
    if capturesOutput {
      process.standardOutput = outputPipe
    }
    if let standardInput {
      process.standardInput = standardInput
    }
    try process.run()
    let output =
      capturesOutput
      ? outputPipe.fileHandleForReading.readDataToEndOfFile()
      : Data()
    process.waitUntilExit()
    guard process.terminationReason == .exit, process.terminationStatus == 0 else {
      throw ValidationError("SSH command failed with status \(process.terminationStatus).")
    }
    guard capturesOutput else { return "" }
    return String(data: output, encoding: .utf8) ?? ""
  }
}
