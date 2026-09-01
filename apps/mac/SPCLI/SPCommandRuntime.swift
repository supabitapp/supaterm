import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

enum SPOutputMode {
  case human
  case json
  case plain
}

struct SPOutputOptions: ParsableArguments {
  @Flag(name: .long, help: "Print command output as JSON.")
  var json = false

  @Flag(name: .long, help: "Print plain stable output.")
  var plain = false

  @Flag(name: [.customShort("q"), .long], help: "Suppress successful command output.")
  var quiet = false

  @Flag(name: .long, help: "Disable styled output.")
  var noColor = false

  func validate() throws {
    if json && plain {
      throw ValidationError("--json and --plain cannot be used together.")
    }
  }

  var mode: SPOutputMode {
    if json {
      return .json
    }
    if plain {
      return .plain
    }
    return .human
  }
}

struct SPCommandOptions: ParsableArguments {
  @OptionGroup
  var connection: SPConnectionOptions

  @OptionGroup
  var output: SPOutputOptions
}

func jsonString<T: Encodable>(_ value: T) throws -> String {
  let encoder = JSONEncoder()
  encoder.dateEncodingStrategy = .iso8601
  encoder.outputFormatting = [.sortedKeys]
  guard let json = String(bytes: try encoder.encode(value), encoding: .utf8) else {
    throw CocoaError(.fileReadInapplicableStringEncoding)
  }
  return json
}

func emitCommandResult<T: Encodable>(
  _ result: T,
  options: SPOutputOptions,
  plain: @autoclosure () -> String,
  human: @autoclosure () -> String
) throws {
  guard !options.quiet else {
    return
  }
  switch options.mode {
  case .json:
    print(try jsonString(result))
  case .plain:
    print(plain())
  case .human:
    print(human())
  }
}

func runControlCommand<Result: Codable>(
  options: SPCommandOptions,
  responseTimeout: TimeInterval = 5,
  request: (SPSocketClient) throws -> SupatermSocketRequest,
  as resultType: Result.Type,
  plain: (Result) -> String,
  human: (Result) -> String
) throws {
  applyOutputStyle(options.output)
  let client = try socketClient(
    path: options.connection.explicitSocketPath,
    instance: options.connection.instance,
    responseTimeout: responseTimeout
  )
  let response = try client.send(try request(client))
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }
  let result = try response.decodeResult(resultType)
  try emitCommandResult(
    result,
    options: options.output,
    plain: plain(result),
    human: human(result)
  )
}

func resolvedSocketTarget(
  explicitPath: String?,
  instance: String?,
  discoveryPolicy: SPSocketDiscoveryPolicy = .whenNeeded
) throws -> SupatermResolvedSocketTarget {
  let diagnostics = SPSocketSelection.resolve(
    explicitPath: explicitPath,
    instance: instance,
    discoveryPolicy: discoveryPolicy
  )

  guard let resolvedTarget = diagnostics.resolvedTarget else {
    throw ValidationError(diagnostics.errorMessage ?? "Unable to resolve a Supaterm socket path.")
  }

  return resolvedTarget
}

func socketClient(
  path: String?,
  instance: String?,
  discoveryPolicy: SPSocketDiscoveryPolicy = .whenNeeded,
  responseTimeout: TimeInterval = 5
) throws -> SPSocketClient {
  let target = try resolvedSocketTarget(
    explicitPath: path,
    instance: instance,
    discoveryPolicy: discoveryPolicy
  )
  return try SPSocketClient(path: target.path, responseTimeout: responseTimeout)
}

func treeSnapshot(_ client: SPSocketClient) throws -> SupatermTreeSnapshot {
  let response = try client.send(.tree())
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }
  return try response.decodeResult(SupatermTreeSnapshot.self)
}

func terminalStartup(
  script: String?,
  tokens: [String],
  environment: [String: String] = ProcessInfo.processInfo.environment
) throws -> SupatermTerminalStartup? {
  if let script {
    guard tokens.isEmpty else {
      throw ValidationError("--script cannot be used with a trailing command.")
    }
    guard !script.isEmpty else {
      throw ValidationError("--script must not be empty.")
    }
    return .shell(script)
  }
  if !tokens.isEmpty {
    let startup = SupatermTerminalStartup.exec(
      tokens,
      searchPath: environment["PATH"] ?? SupatermShellCommand.defaultExecutableSearchPath
    )
    guard startup.isValid else {
      throw ValidationError("Trailing command must start with an executable.")
    }
    return startup
  }
  return nil
}

func resolvedWorkingDirectory(_ path: String?) throws -> String? {
  guard let path else { return nil }

  let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw ValidationError("--cwd must not be empty.")
  }

  let expandedPath = NSString(string: trimmed).expandingTildeInPath
  let url: URL

  if expandedPath.hasPrefix("/") {
    url = URL(fileURLWithPath: expandedPath, isDirectory: true)
  } else {
    url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
      .appendingPathComponent(expandedPath, isDirectory: true)
  }

  return SupatermWorkingDirectory.normalizedPath(url.standardizedFileURL)
}

func cliHomeDirectoryURL(
  environment: [String: String] = ProcessInfo.processInfo.environment
) -> URL {
  guard let rawPath = environment[SupatermCLIEnvironment.testHomeKey] else {
    return FileManager.default.homeDirectoryForCurrentUser
  }

  let path = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !path.isEmpty else {
    return FileManager.default.homeDirectoryForCurrentUser
  }
  return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
}

func expandCLIHomePath(
  _ path: String,
  homeDirectoryURL: URL = cliHomeDirectoryURL()
) -> String {
  if path == "~" {
    return homeDirectoryURL.path
  }

  if path.hasPrefix("~/") {
    return homeDirectoryURL.appendingPathComponent(String(path.dropFirst(2))).path
  }

  return NSString(string: path).expandingTildeInPath
}

func resolvedCLIOutputFileURL(_ path: String) throws -> URL {
  let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw ValidationError("--output must not be empty.")
  }
  let expandedPath = expandCLIHomePath(trimmed)
  let url =
    if expandedPath.hasPrefix("/") {
      URL(fileURLWithPath: expandedPath, isDirectory: false)
    } else {
      URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent(expandedPath, isDirectory: false)
    }
  return url.standardizedFileURL
}

func applyOutputStyle(_ options: SPOutputOptions) {
  SPTerminalStyle.setEnabled(options.mode == .human && !options.noColor)
}

func plainSpaceSelector(spaceIndex: Int) -> String {
  "\(spaceIndex)"
}

func plainTabSelector(spaceIndex: Int, tabIndex: Int) -> String {
  "\(spaceIndex)/\(tabIndex)"
}

func plainPaneSelector(spaceIndex: Int, tabIndex: Int, paneIndex: Int) -> String {
  "\(spaceIndex)/\(tabIndex)/\(paneIndex)"
}

func render(_ target: SupatermPaneTarget) -> String {
  "window \(target.windowIndex) space \(target.spaceIndex) tab \(target.tabIndex) pane \(target.paneIndex)"
}

func stdinHasPipedInput() -> Bool {
  !stdinIsTTY()
}

func stdinIsTTY() -> Bool {
  isatty(FileHandle.standardInput.fileDescriptor) != 0
}

func stdoutIsTTY() -> Bool {
  isatty(FileHandle.standardOutput.fileDescriptor) != 0
}

func confirmDestructiveAction(
  prompt: String,
  isInteractive: () -> Bool = stdinIsTTY,
  readLine: () -> String? = { Swift.readLine() },
  writePrompt: (String) -> Void = { FileHandle.standardError.write(Data($0.utf8)) }
) throws {
  guard isInteractive() else {
    throw ValidationError("Pass -y to confirm.")
  }
  writePrompt(prompt)
  let answer = readLine()?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  guard answer == "y" || answer == "yes" else {
    throw ValidationError("Canceled.")
  }
}

private enum SPTerminalStyle {
  private static let isTTY = stdoutIsTTY()
  private nonisolated(unsafe) static var isEnabled = true

  static func setEnabled(_ enabled: Bool) {
    isEnabled = enabled
  }

  static func bold(_ text: String) -> String {
    styled(text, ansiCode: "1")
  }

  static func brand(_ text: String) -> String {
    styled(text, ansiCode: "38;2;255;168;45")
  }

  private static func styled(_ text: String, ansiCode: String) -> String {
    guard isTTY && isEnabled else { return text }
    return "\u{001B}[\(ansiCode)m\(text)\u{001B}[0m"
  }
}

enum SPSocketOption: ExpressibleByArgument {
  case environment
  case explicit(String)

  init?(argument: String) {
    self = .explicit(argument)
  }

  var defaultValueDescription: String {
    switch self {
    case .environment:
      return SPHelp.socketDefaultValueDescription
    case .explicit(let path):
      return path
    }
  }

  var explicitPath: String? {
    switch self {
    case .environment:
      return nil
    case .explicit(let path):
      return path
    }
  }
}

struct SPConnectionOptions: ParsableArguments {
  @Option(
    name: .long,
    help: ArgumentHelp("Override the Unix socket path.", valueName: "socket")
  )
  var socket: SPSocketOption = .environment

  @Option(name: .long, help: "Target a reachable Supaterm instance by name or endpoint ID.")
  var instance: String?

  var explicitSocketPath: String? {
    socket.explicitPath
  }
}

enum SPOnboardingRenderer {
  private static let boltLogo = """
           ##
         ####
        #####
       ##########
     ############
    ############
        ######
        #####
        ###
        ##
    """

  static func render(_ snapshot: SupatermOnboardingSnapshot) -> String {
    let shortcutWidth = snapshot.items.map(\.shortcut.count).max() ?? 0
    var lines = [
      SPTerminalStyle.brand(boltLogo),
      "",
      "Welcome to Supaterm!",
      "",
      SPTerminalStyle.bold("Common Shortcuts"),
    ]

    if !snapshot.items.isEmpty {
      lines.append("")
      lines.append(
        contentsOf: snapshot.items.map { item in
          let shortcut = item.shortcut.padding(
            toLength: shortcutWidth,
            withPad: " ",
            startingAt: 0
          )
          return "\(SPTerminalStyle.bold(shortcut))  \(item.title)"
        }
      )
    }

    lines.append("")
    lines.append(SPTerminalStyle.bold("Coding Agents Integrations Setup:"))
    lines.append("")
    lines.append("Install the Supaterm skill:")
    lines.append("")
    lines.append("sp skills install")
    lines.append("")
    lines.append("Set up Claude and Codex hooks:")
    lines.append("")
    lines.append("sp agent setup")
    lines.append("")
    lines.append(#"Run "sp" for the list of available commands."#)

    return lines.joined(separator: "\n")
  }
}
