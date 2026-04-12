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
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  return String(decoding: try encoder.encode(value), as: UTF8.self)
}

func resolvedSocketTarget(
  explicitPath: String?,
  instance: String?,
  alwaysDiscover: Bool = false
) throws -> SupatermResolvedSocketTarget {
  let diagnostics = SPSocketSelection.resolve(
    explicitPath: explicitPath,
    instance: instance,
    alwaysDiscover: alwaysDiscover
  )

  guard let resolvedTarget = diagnostics.resolvedTarget else {
    throw ValidationError(diagnostics.errorMessage ?? "Unable to resolve a Supaterm socket path.")
  }

  return resolvedTarget
}

func socketClient(
  path: String?,
  instance: String?,
  alwaysDiscover: Bool = false,
  responseTimeout: TimeInterval = 5
) throws -> SPSocketClient {
  let resolvedTarget = try resolvedSocketTarget(
    explicitPath: path,
    instance: instance,
    alwaysDiscover: alwaysDiscover
  )
  return try SPSocketClient(path: resolvedTarget.path, responseTimeout: responseTimeout)
}

func treeSnapshot(_ client: SPSocketClient) throws -> SupatermTreeSnapshot {
  let response = try client.send(.tree())
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }
  return try response.decodeResult(SupatermTreeSnapshot.self)
}

func shellCommandInput(_ tokens: [String]) -> String? {
  guard !tokens.isEmpty else { return nil }
  return tokens.map(shellEscapedToken).joined(separator: " ")
}

func validateStartupInput(script: String?, tokens: [String]) throws {
  if script != nil && !tokens.isEmpty {
    throw ValidationError("--script cannot be used with a trailing command.")
  }
}

func startupInput(script: String?, tokens: [String]) throws -> String? {
  if let script {
    if script.isEmpty {
      throw ValidationError("--script must not be empty.")
    }
    return normalizedStartupInput(script)
  }
  return shellCommandInput(tokens).map(normalizedStartupInput)
}

private func normalizedStartupInput(_ text: String) -> String {
  var text = text
  while let last = text.last, last == "\n" || last == "\r" {
    text.removeLast()
  }
  return "\(text)\n"
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

  return url.standardizedFileURL.path
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

func stdinHasPipedInput() -> Bool {
  !stdinIsTTY()
}

func stdinIsTTY() -> Bool {
  isatty(FileHandle.standardInput.fileDescriptor) != 0
}

func stdoutIsTTY() -> Bool {
  isatty(FileHandle.standardOutput.fileDescriptor) != 0
}

private func shellEscapedToken(_ token: String) -> String {
  guard !token.isEmpty else { return "''" }

  let safeScalars = CharacterSet(
    charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@%_+=:,./-")
  if token.unicodeScalars.allSatisfy(safeScalars.contains) {
    return token
  }

  return "'\(token.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
}

private enum SPTerminalStyle {
  private static let isTTY = stdoutIsTTY()
  private nonisolated(unsafe) static var isEnabled = true

  static func setEnabled(_ enabled: Bool) {
    isEnabled = enabled
  }

  static func bold(_ text: String) -> String {
    guard isTTY && isEnabled else { return text }
    return "\u{001B}[1m\(text)\u{001B}[0m"
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
  static func render(_ snapshot: SupatermOnboardingSnapshot) -> String {
    let shortcutWidth = snapshot.items.map(\.shortcut.count).max() ?? 0
    var lines = [
      "Welcome to Supaterm!",
      "",
      SPTerminalStyle.bold("Common Shortcuts"),
    ]

    if !snapshot.items.isEmpty {
      lines.append("")
      lines.append(
        contentsOf: snapshot.items.map { item in
          "\(SPTerminalStyle.bold(item.shortcut.padding(toLength: shortcutWidth, withPad: " ", startingAt: 0)))  \(item.title)"
        }
      )
    }

    lines.append("")
    lines.append(SPTerminalStyle.bold("Coding Agent Setup"))
    lines.append("")
    lines.append("Run the commands that match your setup:")
    lines.append("")
    lines.append("sp agent install-hook claude")
    lines.append("sp agent install-hook codex")
    lines.append(PiSettingsInstaller.canonicalInstallDisplayCommand)
    lines.append("")
    lines.append(#"Run "sp" for the list of available commands."#)

    return lines.joined(separator: "\n")
  }
}
