import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

func normalizedConnectionValue(
  _ value: String,
  flag: String
) throws -> String {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw ValidationError("\(flag) requires a value.")
  }
  return trimmed
}

func normalizedConnectionEqualsValue(
  _ argument: String,
  flag: String
) throws -> String {
  let value = String(argument.dropFirst(flag.count + 1)).trimmingCharacters(
    in: .whitespacesAndNewlines)
  guard !value.isEmpty else {
    throw ValidationError("\(flag) requires a value.")
  }
  return value
}

private func strippedPrefix(
  _ value: String,
  prefix: Character
) -> String {
  if value.first == prefix {
    return String(value.dropFirst())
  }
  return value
}

func strippingSpacePrefix(_ value: String) -> String {
  strippedPrefix(value, prefix: "$")
}

func strippingTabPrefix(_ value: String) -> String {
  strippedPrefix(value, prefix: "@")
}

func normalizedUUIDToken(_ value: String) -> UUID? {
  UUID(uuidString: strippingTabPrefix(strippingSpacePrefix(value)))
}

func trimmedNonEmpty(_ value: String?) -> String? {
  guard let value else { return nil }
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.isEmpty ? nil : trimmed
}

func splitTmuxCommand(_ arguments: [String]) throws -> (
  command: String, arguments: [String]
) {
  var index = 0
  let globalValueFlags: Set<String> = ["-L", "-S", "-f"]

  while index < arguments.count {
    let argument = arguments[index]
    if !argument.hasPrefix("-") || argument == "-" {
      return (argument.lowercased(), Array(arguments.dropFirst(index + 1)))
    }
    if argument == "--" {
      break
    }
    if globalValueFlags.contains(argument), index + 1 < arguments.count {
      index += 2
      continue
    }
    index += 1
  }

  throw ValidationError("tmux compatibility requires a command.")
}

func isLastSelector(_ value: String) -> Bool {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed == "-" || trimmed == "!" || trimmed == "^"
}

func prependPathEntries(_ newEntries: [String], to currentPath: String?) -> String {
  var ordered: [String] = []
  var seen = Set<String>()
  for entry in newEntries + (currentPath?.split(separator: ":").map(String.init) ?? [])
  where !entry.isEmpty {
    if seen.insert(entry).inserted {
      ordered.append(entry)
    }
  }
  return ordered.joined(separator: ":")
}

func shellQuoted(_ value: String) -> String {
  "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
}

func tmuxShellCommandText(
  commandTokens: [String],
  cwd: String?
) -> String? {
  let trimmedCwd = cwd.flatMap(trimmedNonEmpty)
  let commandText = commandTokens.joined(separator: " ").trimmingCharacters(
    in: .whitespacesAndNewlines)
  guard trimmedCwd != nil || !commandText.isEmpty else {
    return nil
  }

  var pieces: [String] = []
  if let trimmedCwd {
    pieces.append("cd -- \(shellQuoted(resolvePath(trimmedCwd)))")
  }
  if !commandText.isEmpty {
    pieces.append(commandText)
  }
  return pieces.joined(separator: " && ") + "\r"
}

func wrappedRunPaneCommand(
  _ command: String,
  spaceID: UUID,
  tabID: UUID,
  paneID: UUID,
  environment: [String: String]
) -> String {
  guard environment["TMUX"] != nil else {
    return command
  }

  let trimmedCommand = command.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmedCommand.isEmpty else {
    return command
  }

  let term = environment["TERM"].flatMap(trimmedNonEmpty) ?? "screen-256color"
  let tmuxValue =
    "/tmp/sp-tmux/\(spaceID.uuidString.lowercased()),\(tabID.uuidString.lowercased()),\(paneID.uuidString.lowercased())"
  let tmuxPaneValue = "%\(paneID.uuidString.lowercased())"

  return [
    "env",
    "-u",
    "TERM_PROGRAM",
    "TERM=\(shellQuoted(term))",
    "TMUX=\(shellQuoted(tmuxValue))",
    "TMUX_PANE=\(shellQuoted(tmuxPaneValue))",
    "/bin/sh",
    "-lc",
    shellQuoted(trimmedCommand),
  ].joined(separator: " ") + "\r"
}

func tmuxResizeDirection(flags: Set<String>) -> SupatermResizePaneDirection? {
  if flags.contains("-L") {
    return .left
  }
  if flags.contains("-U") {
    return .up
  }
  if flags.contains("-D") {
    return .down
  }
  if flags.contains("-R") {
    return .right
  }
  return nil
}

func tmuxPaneAxis(for direction: SupatermPaneDirection) -> SupatermPaneAxis {
  switch direction {
  case .left, .right:
    return .horizontal
  case .down, .up:
    return .vertical
  }
}

func tmuxSpecialKeyText(_ token: String) -> String? {
  switch token.lowercased() {
  case "enter", "c-m", "kpenter":
    return "\r"
  case "tab", "c-i":
    return "\t"
  case "space":
    return " "
  case "bspace", "backspace":
    return "\u{7F}"
  case "escape", "esc", "c-[":
    return "\u{1B}"
  case "c-c":
    return "\u{03}"
  case "c-d":
    return "\u{04}"
  case "c-z":
    return "\u{1A}"
  case "c-l":
    return "\u{0C}"
  default:
    return nil
  }
}

func tmuxSendKeysText(
  from tokens: [String],
  literal: Bool
) -> String {
  if literal {
    return tokens.joined(separator: " ")
  }

  var text = ""
  var pendingSpace = false
  for token in tokens {
    if let special = tmuxSpecialKeyText(token) {
      text += special
      pendingSpace = false
      continue
    }
    if pendingSpace {
      text += " "
    }
    text += token
    pendingSpace = true
  }
  return text
}

func parsedTargetValue(_ arguments: [String]) -> String? {
  (try? SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: []))?.value("-t")
}

func resolvePath(_ path: String) -> String {
  let expandedPath = NSString(string: path).expandingTildeInPath
  if expandedPath.hasPrefix("/") {
    return URL(fileURLWithPath: expandedPath, isDirectory: true).standardizedFileURL.path
  }
  return URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    .appendingPathComponent(expandedPath, isDirectory: true)
    .standardizedFileURL
    .path
}

func setExecutablePermissions(at url: URL) throws {
  let result = url.path.withCString { pointer in
    chmod(pointer, mode_t(0o755))
  }
  guard result == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}

func sendTextTraceFields(
  target: SupatermPaneTargetRequest,
  text: String,
  sourceText: String?
) -> [String: String?] {
  [
    "target_pane_id": target.paneID.uuidString.lowercased(),
    "text_length": String(text.count),
    "text_has_cr": text.contains("\r") ? "1" : "0",
    "text_has_lf": text.contains("\n") ? "1" : "0",
    "text_preview": SPTmuxTrace.preview(text),
    "source_length": sourceText.map { String($0.count) },
    "source_has_cr": sourceText.map { $0.contains("\r") ? "1" : "0" },
    "source_has_lf": sourceText.map { $0.contains("\n") ? "1" : "0" },
    "source_preview": sourceText.map { SPTmuxTrace.preview($0) },
  ]
}

enum SPTmuxTrace {
  static let enabledKey = "SUPATERM_TMUX_TRACE"
  static let pathKey = "SUPATERM_TMUX_TRACE_PATH"

  static func write(
    category: String = "sp.tmux",
    event: String,
    fields: [String: String?] = [:],
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) {
    guard isEnabled(in: environment) else {
      return
    }

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    var values: [(String, String)] = [
      ("ts", formatter.string(from: Date())),
      ("pid", String(getpid())),
      ("category", category),
      ("event", event),
    ]

    for key in fields.keys.sorted() {
      if let value = fields[key] ?? nil {
        values.append((key, value))
      }
    }

    let line =
      values
      .map { key, value in
        "\(key)=\"\(escaped(value))\""
      }
      .joined(separator: " ")
      + "\n"

    let path = tracePath(in: environment)
    guard append(line, to: path) else {
      FileHandle.standardError.write(Data(line.utf8))
      return
    }
  }

  static func preview(_ text: String, limit: Int = 200) -> String {
    let escapedText =
      text
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\r", with: "\\r")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\t", with: "\\t")
    guard escapedText.count > limit else {
      return escapedText
    }
    return String(escapedText.prefix(limit)) + "..."
  }

  private static func isEnabled(
    in environment: [String: String]
  ) -> Bool {
    guard let rawValue = environment[enabledKey] else {
      return false
    }
    switch rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "", "0", "false", "no", "off":
      return false
    default:
      return true
    }
  }

  private static func tracePath(
    in environment: [String: String]
  ) -> String {
    if let explicitPath = environment[pathKey]?.trimmingCharacters(in: .whitespacesAndNewlines),
      !explicitPath.isEmpty
    {
      return explicitPath
    }
    let homePath = environment["HOME"] ?? NSHomeDirectory()
    return URL(fileURLWithPath: homePath, isDirectory: true)
      .appendingPathComponent(".supaterm", isDirectory: true)
      .appendingPathComponent("tmux", isDirectory: true)
      .appendingPathComponent("trace.log", isDirectory: false)
      .path
  }

  private static func escaped(_ value: String) -> String {
    value
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
      .replacingOccurrences(of: "\r", with: "\\r")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\t", with: "\\t")
  }

  private static func append(_ line: String, to path: String) -> Bool {
    let fileURL = URL(fileURLWithPath: path, isDirectory: false)
    do {
      try FileManager.default.createDirectory(
        at: fileURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
    } catch {
      return false
    }

    let fileDescriptor = open(path, O_CREAT | O_WRONLY | O_APPEND, S_IRUSR | S_IWUSR)
    guard fileDescriptor >= 0 else {
      return false
    }
    defer {
      close(fileDescriptor)
    }

    let data = Data(line.utf8)
    return data.withUnsafeBytes { bytes in
      guard let baseAddress = bytes.baseAddress else {
        return true
      }

      var totalBytesWritten = 0
      while totalBytesWritten < data.count {
        let bytesRemaining = data.count - totalBytesWritten
        let writeResult = Darwin.write(
          fileDescriptor,
          baseAddress.advanced(by: totalBytesWritten),
          bytesRemaining
        )
        if writeResult < 0 {
          return false
        }
        totalBytesWritten += writeResult
      }

      return true
    }
  }
}
