import ArgumentParser
import Foundation

extension SP {
  struct SSH: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "ssh",
      abstract: "Launch SSH with Supaterm terminal compatibility.",
      discussion: SPHelp.sshDiscussion
    )

    @Option(name: .long, help: "TERM value to use for the remote session.")
    var term = "xterm-256color"

    @Option(name: .long, help: "SSH executable to launch.")
    var ssh = "ssh"

    @Argument(parsing: .remaining, help: "Arguments to pass to SSH.")
    var arguments: [String] = []

    mutating func run() throws {
      try SPSSHLauncher.run(term: term, ssh: ssh, arguments: arguments)
    }
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
      arguments: [
        executablePath,
        "-o", "SendEnv=COLORTERM",
        "-o", "SendEnv=TERM_PROGRAM",
        "-o", "SendEnv=TERM_PROGRAM_VERSION",
      ] + arguments,
      environment: processEnvironment
    )
  }
}
