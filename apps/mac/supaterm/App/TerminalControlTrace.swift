import Darwin
import Foundation

enum TerminalControlTrace {
  static let enabledKey = "SUPATERM_TMUX_TRACE"
  static let pathKey = "SUPATERM_TMUX_TRACE_PATH"

  static func write(
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
      ("category", "app.terminal"),
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
