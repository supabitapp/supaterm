import AppKit
import Foundation
import GhosttyKit

enum GhosttyTerminalConfigFileError: LocalizedError {
  case failedToCreateGhosttyConfig
  case invalidConfig(String)

  var errorDescription: String? {
    switch self {
    case .failedToCreateGhosttyConfig:
      return "Supaterm could not create a Ghostty config object."
    case .invalidConfig(let message):
      return message
    }
  }
}

@MainActor
struct GhosttyTerminalConfigFile {
  private let availableFontFamiliesProvider: @MainActor () -> [String]
  private let environment: [String: String]
  private let fileManager: FileManager
  private let homeDirectoryURL: URL
  private let notificationCenter: NotificationCenter

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    fileManager: FileManager = .default,
    notificationCenter: NotificationCenter = .default,
    availableFontFamiliesProvider: @escaping @MainActor () -> [String] = Self.availableFontFamilies
  ) {
    self.availableFontFamiliesProvider = availableFontFamiliesProvider
    self.environment = environment
    self.fileManager = fileManager
    self.homeDirectoryURL = homeDirectoryURL
    self.notificationCenter = notificationCenter
  }

  func load() throws -> GhosttyTerminalSettingsSnapshot {
    let configURL = try ensureConfigFile()
    let contents = try String(contentsOf: configURL, encoding: .utf8)
    let fontSize = try effectiveFontSize(at: configURL)
    return snapshot(
      configURL: configURL,
      contents: contents,
      fontSize: fontSize
    )
  }

  func apply(
    fontFamily: String?,
    fontSize: Double
  ) throws -> GhosttyTerminalSettingsSnapshot {
    let configURL = try ensureConfigFile()
    let contents = try String(contentsOf: configURL, encoding: .utf8)
    let updatedContents = updatedContents(
      from: contents,
      fontFamily: fontFamily,
      fontSize: fontSize
    )
    let validationURL =
      configURL
      .deletingLastPathComponent()
      .appendingPathComponent(".supaterm-ghostty-\(UUID().uuidString)", isDirectory: false)
    try updatedContents.write(to: validationURL, atomically: true, encoding: .utf8)
    defer {
      try? fileManager.removeItem(at: validationURL)
    }
    let effectiveSize = try effectiveFontSize(at: validationURL)
    try updatedContents.write(to: configURL, atomically: true, encoding: .utf8)
    notificationCenter.post(name: .ghosttyRuntimeReloadRequested, object: nil)
    return snapshot(
      configURL: configURL,
      contents: updatedContents,
      fontSize: effectiveSize
    )
  }

  private func snapshot(
    configURL: URL,
    contents: String,
    fontSize: Double
  ) -> GhosttyTerminalSettingsSnapshot {
    .init(
      availableFontFamilies: availableFontFamiliesProvider(),
      configPath: configURL.path,
      fontFamily: selectedFontFamily(in: contents),
      fontSize: fontSize,
      warningMessage: warningMessage(in: contents)
    )
  }

  private func ensureConfigFile() throws -> URL {
    try GhosttyBootstrap.seedDefaultConfigIfNeeded(
      homeDirectoryURL: homeDirectoryURL,
      environment: environment,
      fileManager: fileManager
    )
    return GhosttyBootstrap.configFileLocations(
      homeDirectoryURL: homeDirectoryURL,
      environment: environment
    ).preferred
  }

  private func effectiveFontSize(at url: URL) throws -> Double {
    guard let config = ghostty_config_new() else {
      throw GhosttyTerminalConfigFileError.failedToCreateGhosttyConfig
    }
    defer {
      ghostty_config_free(config)
    }
    ghostty_config_load_file(config, url.path)
    ghostty_config_load_recursive_files(config)
    ghostty_config_finalize(config)
    let diagnostics = diagnosticsMessage(for: config)
    if !diagnostics.isEmpty {
      throw GhosttyTerminalConfigFileError.invalidConfig(diagnostics)
    }
    var value: Float = 15
    let key = "font-size"
    _ = ghostty_config_get(config, &value, key, UInt(key.count))
    return Double(value)
  }

  private func diagnosticsMessage(for config: ghostty_config_t) -> String {
    let count = Int(ghostty_config_diagnostics_count(config))
    guard count > 0 else { return "" }
    return (0..<count)
      .compactMap { index in
        let diagnostic = ghostty_config_get_diagnostic(config, UInt32(index))
        guard let message = diagnostic.message else { return nil }
        return String(cString: message).trimmingCharacters(in: .whitespacesAndNewlines)
      }
      .filter { !$0.isEmpty }
      .joined(separator: "\n")
  }

  private func selectedFontFamily(in contents: String) -> String? {
    var selectedFontFamily: String?
    for line in lines(in: contents) {
      guard let directive = directive(in: line), directive.key == "font-family" else {
        continue
      }
      let value = parsedValue(from: directive.value)
      if value.isEmpty {
        selectedFontFamily = nil
      } else if selectedFontFamily == nil {
        selectedFontFamily = value
      }
    }
    return selectedFontFamily
  }

  private func warningMessage(in contents: String) -> String? {
    lines(in: contents).contains { line in
      directive(in: line)?.key == "config-file"
    }
      ? "This Ghostty config includes other config files. Settings only edits the primary file shown here."
      : nil
  }

  private func updatedContents(
    from contents: String,
    fontFamily: String?,
    fontSize: Double
  ) -> String {
    let originalLines = lines(in: contents)
    let hadTrailingNewline = contents.hasSuffix("\n")
    var filteredLines: [String] = []
    var insertionIndex: Int?
    for line in originalLines {
      guard let directive = directive(in: line), managedKeys.contains(directive.key) else {
        filteredLines.append(line)
        continue
      }
      if insertionIndex == nil {
        insertionIndex = filteredLines.count
      }
    }
    let replacementLines = canonicalManagedLines(
      fontFamily: fontFamily,
      fontSize: fontSize
    )
    filteredLines.insert(contentsOf: replacementLines, at: insertionIndex ?? filteredLines.count)
    let joined = filteredLines.joined(separator: "\n")
    if joined.isEmpty {
      return joined
    }
    return hadTrailingNewline || !contents.isEmpty ? joined + "\n" : joined
  }

  private func canonicalManagedLines(
    fontFamily: String?,
    fontSize: Double
  ) -> [String] {
    var lines: [String] = []
    if let fontFamily, !fontFamily.isEmpty {
      lines.append(#"font-family = "\#(escaped(fontFamily))""#)
    }
    lines.append("font-size = \(formatted(fontSize))")
    return lines
  }

  private func formatted(_ value: Double) -> String {
    String(format: "%.15g", value)
  }

  private func escaped(_ value: String) -> String {
    value
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
  }

  private func lines(in contents: String) -> [String] {
    var lines = contents.components(separatedBy: "\n")
    if contents.hasSuffix("\n"), !lines.isEmpty {
      lines.removeLast()
    }
    return lines
  }

  private func directive(in line: String) -> (key: String, value: String)? {
    let trimmedLine = line.trimmingCharacters(in: .whitespaces)
    guard !trimmedLine.isEmpty, !trimmedLine.hasPrefix("#"), let equalsIndex = trimmedLine.firstIndex(of: "=")
    else {
      return nil
    }
    let key = trimmedLine[..<equalsIndex].trimmingCharacters(in: .whitespaces)
    let value = trimmedLine[trimmedLine.index(after: equalsIndex)...]
    guard !key.isEmpty else { return nil }
    return (key, String(value))
  }

  private func parsedValue(from rawValue: String) -> String {
    let sanitizedValue = sanitizedValue(from: rawValue)
    guard sanitizedValue.hasPrefix("\""), sanitizedValue.hasSuffix("\""), sanitizedValue.count >= 2 else {
      return sanitizedValue
    }
    var result = ""
    var isEscaped = false
    for character in sanitizedValue.dropFirst().dropLast() {
      if isEscaped {
        result.append(character)
        isEscaped = false
      } else if character == "\\" {
        isEscaped = true
      } else {
        result.append(character)
      }
    }
    return result
  }

  private func sanitizedValue(from rawValue: String) -> String {
    var result = ""
    var isEscaped = false
    var isQuoted = false
    for character in rawValue {
      if isEscaped {
        result.append(character)
        isEscaped = false
        continue
      }
      if character == "\\" {
        result.append(character)
        isEscaped = true
        continue
      }
      if character == "\"" {
        result.append(character)
        isQuoted.toggle()
        continue
      }
      if character == "#", !isQuoted {
        break
      }
      result.append(character)
    }
    return result.trimmingCharacters(in: .whitespaces)
  }

  private static func availableFontFamilies() -> [String] {
    Array(Set(NSFontManager.shared.availableFontFamilies))
      .sorted { lhs, rhs in
        lhs.localizedStandardCompare(rhs) == .orderedAscending
      }
  }

  private let managedKeys = Set(["font-family", "font-size"])
}
