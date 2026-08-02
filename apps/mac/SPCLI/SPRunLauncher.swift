import ArgumentParser
import Foundation
import SupatermCLIShared

enum SPRunLauncher {
  struct FocusedContext: Equatable {
    let spaceID: UUID
    let tabID: UUID
    let paneID: UUID
  }

  static func run(
    arguments: [String],
    explicitSocketPath: String? = nil,
    instance: String? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws {
    let connection = try resolvedSocketConnection(
      explicitPath: explicitSocketPath,
      instance: instance,
      discoveryPolicy: .always
    )
    let focusedContext = try SPTmuxCommandRunner(
      transport: connection.client,
      environment: environment
    ).focusedContext()
    let launcher = try configuredProcess(
      arguments: arguments,
      socketPath: connection.target.path,
      focusedContext: focusedContext,
      environment: environment,
      homeDirectoryURL: cliHomeDirectoryURL(environment: environment)
    )
    try execProcess(launcher)
  }

  static func configuredProcess(
    arguments: [String],
    socketPath: String,
    focusedContext: FocusedContext,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    cliExecutablePath: String? = nil,
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
  ) throws -> Process {
    let resolvedCommand = try resolveCommand(arguments, searchPath: environment["PATH"])
    guard let resolvedExecutablePath = resolvedCommand.executablePath else {
      throw ValidationError("Unable to find \(resolvedCommand.command) on PATH.")
    }

    let resolvedCLIExecutablePath = try resolvedCLIPath(
      cliExecutablePath: cliExecutablePath,
      environment: environment
    )
    let shimDirectory = try ensureTmuxShimDirectory(
      cliExecutablePath: resolvedCLIExecutablePath,
      homeDirectoryURL: homeDirectoryURL
    )

    var processEnvironment = environment
    processEnvironment[SupatermCLIEnvironment.socketPathKey] = socketPath
    processEnvironment[SupatermCLIEnvironment.surfaceIDKey] = focusedContext.paneID.uuidString
    processEnvironment[SupatermCLIEnvironment.tabIDKey] = focusedContext.tabID.uuidString
    processEnvironment["TERM"] = trimmedNonEmpty(environment["TERM"]) ?? "xterm-256color"
    processEnvironment["COLORTERM"] = trimmedNonEmpty(environment["COLORTERM"]) ?? "truecolor"
    processEnvironment["TERM_PROGRAM"] = "ghostty"
    if let termProgramVersion = trimmedNonEmpty(environment["TERM_PROGRAM_VERSION"]) {
      processEnvironment["TERM_PROGRAM_VERSION"] = termProgramVersion
    } else {
      processEnvironment.removeValue(forKey: "TERM_PROGRAM_VERSION")
    }
    let tmuxSession = [
      focusedContext.spaceID.uuidString.lowercased(),
      focusedContext.tabID.uuidString.lowercased(),
      focusedContext.paneID.uuidString.lowercased(),
    ].joined(separator: ",")
    processEnvironment["TMUX"] = "/tmp/sp-tmux/\(tmuxSession)"
    processEnvironment["TMUX_PANE"] = "%\(focusedContext.paneID.uuidString.lowercased())"
    processEnvironment["PATH"] = prependPathEntries([shimDirectory.path], to: environment["PATH"])

    SPTmuxTrace.write(
      category: "sp.run",
      event: "configured_process",
      fields: [
        "executable_path": resolvedExecutablePath,
        "cli_path": resolvedCLIExecutablePath,
        "shim_directory": shimDirectory.path,
        "socket_path": socketPath,
        "focused_space_id": focusedContext.spaceID.uuidString.lowercased(),
        "focused_tab_id": focusedContext.tabID.uuidString.lowercased(),
        "focused_pane_id": focusedContext.paneID.uuidString.lowercased(),
        "arguments": arguments.joined(separator: "\u{1f}"),
      ],
      environment: processEnvironment
    )

    let process = Process()
    process.executableURL = URL(fileURLWithPath: resolvedExecutablePath, isDirectory: false)
    process.arguments = Array(arguments.dropFirst())
    process.environment = processEnvironment
    process.standardInput = FileHandle.standardInput
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError
    return process
  }

  static func resolveCommand(_ arguments: [String], searchPath: String?) throws -> (
    command: String, executablePath: String?
  ) {
    guard let command = arguments.first.flatMap(trimmedNonEmpty) else {
      throw ValidationError("run requires a command.")
    }

    return (
      command,
      SPExecutable.resolve(command, searchPath: searchPath)
    )
  }

  static func resolvedCLIPath(
    cliExecutablePath: String?,
    environment: [String: String]
  ) throws -> String {
    let candidates = [
      cliExecutablePath,
      environment[SupatermCLIEnvironment.cliPathKey],
      SPExecutable.currentPath(),
    ]

    guard
      let path = candidates.lazy.compactMap({ $0 }).compactMap({ candidate in
        SPExecutable.resolve(candidate)
      }).first
    else {
      throw ValidationError("Unable to resolve the sp executable path.")
    }
    return path
  }

  static func ensureTmuxShimDirectory(
    cliExecutablePath: String,
    homeDirectoryURL: URL
  ) throws -> URL {
    let directoryURL = spPrivateDirectory(homeDirectoryURL: homeDirectoryURL)
      .appendingPathComponent("shims", isDirectory: true)
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    let shimURL = directoryURL.appendingPathComponent("tmux", isDirectory: false)
    let script = "#!/bin/sh\nexec \(shellQuoted(cliExecutablePath)) tmux \"$@\"\n"
    let currentContents = try? String(contentsOf: shimURL, encoding: .utf8)
    if currentContents != script {
      try script.write(to: shimURL, atomically: true, encoding: .utf8)
      try setExecutablePermissions(at: shimURL)
    }
    return directoryURL
  }
}

private func execProcess(_ process: Process) throws -> Never {
  guard let executablePath = process.executableURL?.path else {
    throw ValidationError("Unable to resolve the executable path.")
  }

  try SPProcess.replaceCurrent(
    executablePath: executablePath,
    arguments: [executablePath] + (process.arguments ?? []),
    environment: process.environment ?? ProcessInfo.processInfo.environment,
    failureDescription: "Failed to launch process"
  )
}
