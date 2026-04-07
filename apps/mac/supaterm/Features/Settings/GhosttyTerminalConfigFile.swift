import AppKit
import Foundation
import GhosttyKit

struct GhosttyTerminalThemeCatalog: Equatable {
  var dark: [String]
  var light: [String]
}

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
  private struct ThemeSelection: Equatable {
    var dark: String
    var light: String
  }

  private let availableFontFamiliesProvider: @MainActor () -> [String]
  private let availableThemesProvider: () throws -> GhosttyTerminalThemeCatalog
  private let effectiveFontSizeProvider: (URL) throws -> Double
  private let environment: [String: String]
  private let fileManager: FileManager
  private let homeDirectoryURL: URL
  private let notificationCenter: NotificationCenter

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    fileManager: FileManager = .default,
    notificationCenter: NotificationCenter = .default,
    availableThemesProvider: (() throws -> GhosttyTerminalThemeCatalog)? = nil,
    effectiveFontSizeProvider: ((URL) throws -> Double)? = nil,
    availableFontFamiliesProvider: @escaping @MainActor () -> [String] = Self.availableFontFamilies
  ) {
    self.availableFontFamiliesProvider = availableFontFamiliesProvider
    self.environment = environment
    self.fileManager = fileManager
    self.homeDirectoryURL = homeDirectoryURL
    self.notificationCenter = notificationCenter
    self.effectiveFontSizeProvider = effectiveFontSizeProvider ?? Self.effectiveFontSize
    self.availableThemesProvider =
      availableThemesProvider ?? {
        try Self.availableThemes(
          homeDirectoryURL: homeDirectoryURL,
          environment: environment,
          fileManager: fileManager,
          resourcesURL: Bundle.main.resourceURL
        )
      }
  }

  func load() throws -> GhosttyTerminalSettingsSnapshot {
    let configURL = try ensureConfigFile()
    let contents = try String(contentsOf: configURL, encoding: .utf8)
    let fontSize = try effectiveFontSizeProvider(configURL)
    let themes = try availableThemesProvider()
    return snapshot(
      configURL: configURL,
      contents: contents,
      fontSize: fontSize,
      themes: themes
    )
  }

  func apply(settings: GhosttyTerminalSettingsDraft) throws -> GhosttyTerminalSettingsValues {
    let configURL = try ensureConfigFile()
    let contents = try String(contentsOf: configURL, encoding: .utf8)
    let updatedContents = updatedContents(from: contents, settings: settings)
    let validationURL =
      configURL
      .deletingLastPathComponent()
      .appendingPathComponent(".supaterm-ghostty-\(UUID().uuidString)", isDirectory: false)
    try updatedContents.write(to: validationURL, atomically: true, encoding: .utf8)
    defer {
      try? fileManager.removeItem(at: validationURL)
    }
    let effectiveSize = try effectiveFontSizeProvider(validationURL)
    try updatedContents.write(to: configURL, atomically: true, encoding: .utf8)
    notificationCenter.post(name: .ghosttyRuntimeReloadRequested, object: nil)
    return settingsValues(
      configURL: configURL,
      contents: updatedContents,
      fontSize: effectiveSize
    )
  }

  private func snapshot(
    configURL: URL,
    contents: String,
    fontSize: Double,
    themes: GhosttyTerminalThemeCatalog
  ) -> GhosttyTerminalSettingsSnapshot {
    let values = settingsValues(
      configURL: configURL,
      contents: contents,
      fontSize: fontSize
    )
    return .init(
      availableFontFamilies: availableFontFamiliesProvider(),
      availableDarkThemes: themes.dark,
      availableLightThemes: themes.light,
      confirmCloseSurface: values.confirmCloseSurface,
      configPath: values.configPath,
      cursorBlinkStyle: values.cursorBlinkStyle,
      darkTheme: values.darkTheme,
      fontFamily: values.fontFamily,
      fontSize: values.fontSize,
      lightTheme: values.lightTheme,
      warningMessage: values.warningMessage
    )
  }

  private func settingsValues(
    configURL: URL,
    contents: String,
    fontSize: Double
  ) -> GhosttyTerminalSettingsValues {
    let selection = selectedTheme(in: contents)
    return .init(
      confirmCloseSurface: selectedConfirmCloseSurface(in: contents) ?? .whenNotAtPrompt,
      configPath: configURL.path,
      cursorBlinkStyle: selectedCursorBlinkStyle(in: contents) ?? .terminalDefault,
      darkTheme: selection?.dark,
      fontFamily: selectedFontFamily(in: contents),
      fontSize: fontSize,
      lightTheme: selection?.light,
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

  private static func effectiveFontSize(at url: URL) throws -> Double {
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

  private static func diagnosticsMessage(for config: ghostty_config_t) -> String {
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

  private func selectedTheme(in contents: String) -> ThemeSelection? {
    var selection: ThemeSelection?
    for line in lines(in: contents) {
      guard let directive = directive(in: line), directive.key == "theme" else {
        continue
      }
      selection = parsedThemeSelection(from: directive.value)
    }
    return selection
  }

  private func selectedConfirmCloseSurface(in contents: String) -> GhosttyTerminalCloseConfirmation? {
    var selection: GhosttyTerminalCloseConfirmation?
    for line in lines(in: contents) {
      guard let directive = directive(in: line), directive.key == "confirm-close-surface" else {
        continue
      }
      let value = parsedValue(from: directive.value)
      selection = GhosttyTerminalCloseConfirmation(rawValue: value)
    }
    return selection
  }

  private func selectedCursorBlinkStyle(in contents: String) -> GhosttyTerminalCursorBlinkStyle? {
    var selection: GhosttyTerminalCursorBlinkStyle?
    for line in lines(in: contents) {
      guard let directive = directive(in: line), directive.key == "cursor-style-blink" else {
        continue
      }
      let value = parsedValue(from: directive.value)
      selection = GhosttyTerminalCursorBlinkStyle(rawValue: value)
    }
    return selection
  }

  private func updatedContents(
    from contents: String,
    settings: GhosttyTerminalSettingsDraft
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
    let replacementLines = canonicalManagedLines(settings: settings)
    filteredLines.insert(contentsOf: replacementLines, at: insertionIndex ?? filteredLines.count)
    let joined = filteredLines.joined(separator: "\n")
    if joined.isEmpty {
      return joined
    }
    return hadTrailingNewline || !contents.isEmpty ? joined + "\n" : joined
  }

  private func canonicalManagedLines(settings: GhosttyTerminalSettingsDraft) -> [String] {
    var lines: [String] = []
    if let themeSelection = canonicalThemeSelection(
      lightTheme: settings.lightTheme,
      darkTheme: settings.darkTheme
    ) {
      lines.append("theme = light:\(themeSelection.light),dark:\(themeSelection.dark)")
    }
    if let fontFamily = settings.fontFamily, !fontFamily.isEmpty {
      lines.append(#"font-family = "\#(escaped(fontFamily))""#)
    }
    lines.append("font-size = \(formatted(settings.fontSize))")
    lines.append("confirm-close-surface = \(settings.confirmCloseSurface.rawValue)")
    lines.append("cursor-style-blink = \(settings.cursorBlinkStyle.rawValue)")
    return lines
  }

  private func canonicalThemeSelection(
    lightTheme: String?,
    darkTheme: String?
  ) -> ThemeSelection? {
    let lightTheme = normalizedThemeName(lightTheme)
    let darkTheme = normalizedThemeName(darkTheme)
    switch (lightTheme, darkTheme) {
    case (let light?, let dark?):
      return .init(dark: dark, light: light)
    case (let light?, nil):
      return .init(dark: light, light: light)
    case (nil, let dark?):
      return .init(dark: dark, light: dark)
    case (nil, nil):
      return nil
    }
  }

  private func normalizedThemeName(_ themeName: String?) -> String? {
    guard let themeName else { return nil }
    let trimmed = themeName.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
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

  private func parsedThemeSelection(from rawValue: String) -> ThemeSelection? {
    let value = parsedValue(from: rawValue)
    if value.isEmpty {
      return nil
    }
    if value.contains(",") || value.contains(":") || value.contains("=") {
      var darkTheme: String?
      var lightTheme: String?
      for component in value.split(separator: ",", omittingEmptySubsequences: true) {
        let parts = component.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else {
          return nil
        }
        let key = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
        let themeName = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
        guard !themeName.isEmpty else {
          return nil
        }
        switch key {
        case "dark":
          darkTheme = themeName
        case "light":
          lightTheme = themeName
        default:
          return nil
        }
      }
      guard let darkTheme, let lightTheme else {
        return nil
      }
      return .init(dark: darkTheme, light: lightTheme)
    }
    return .init(dark: value, light: value)
  }

  private static func availableFontFamilies() -> [String] {
    Array(Set(NSFontManager.shared.availableFontFamilies))
      .sorted { lhs, rhs in
        lhs.localizedStandardCompare(rhs) == .orderedAscending
      }
  }

  private static func availableThemes(
    homeDirectoryURL: URL,
    environment: [String: String],
    fileManager: FileManager,
    resourcesURL: URL?
  ) throws -> GhosttyTerminalThemeCatalog {
    var directories = [themeDirectory(homeDirectoryURL: homeDirectoryURL, environment: environment)]
    if let resourcesDirectory = resourcesURL?.appendingPathComponent("ghostty", isDirectory: true)
      .appendingPathComponent("themes", isDirectory: true)
    {
      directories.append(resourcesDirectory)
    }

    var classifications: [String: Bool] = [:]
    for directory in directories {
      var isDirectory = ObjCBool(false)
      guard fileManager.fileExists(atPath: directory.path, isDirectory: &isDirectory), isDirectory.boolValue else {
        continue
      }
      let urls = try fileManager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
      )
      for url in urls {
        guard classifications[url.lastPathComponent] == nil else {
          continue
        }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey])
        guard values.isRegularFile == true, let isDark = isDarkTheme(at: url) else {
          continue
        }
        classifications[url.lastPathComponent] = isDark
      }
    }

    return .init(
      dark: sortedThemeNames(in: classifications, isDark: true),
      light: sortedThemeNames(in: classifications, isDark: false)
    )
  }

  private static func themeDirectory(
    homeDirectoryURL: URL,
    environment: [String: String]
  ) -> URL {
    let configRoot: URL
    if let xdgConfigHome = environment["XDG_CONFIG_HOME"], !xdgConfigHome.isEmpty {
      configRoot = URL(fileURLWithPath: xdgConfigHome, isDirectory: true)
    } else {
      configRoot = homeDirectoryURL.appendingPathComponent(".config", isDirectory: true)
    }
    return
      configRoot
      .appendingPathComponent("ghostty", isDirectory: true)
      .appendingPathComponent("themes", isDirectory: true)
  }

  private static func isDarkTheme(at url: URL) -> Bool? {
    guard let config = ghostty_config_new() else {
      return nil
    }
    defer {
      ghostty_config_free(config)
    }
    ghostty_config_load_file(config, url.path)
    ghostty_config_finalize(config)
    if ghostty_config_diagnostics_count(config) > 0 {
      return nil
    }
    var color = ghostty_config_color_s()
    let key = "background"
    guard ghostty_config_get(config, &color, key, UInt(key.count)) else {
      return nil
    }
    let red = Double(color.r) / 255
    let green = Double(color.g) / 255
    let blue = Double(color.b) / 255
    let luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
    return luminance < 0.5
  }

  private static func sortedThemeNames(
    in classifications: [String: Bool],
    isDark: Bool
  ) -> [String] {
    classifications
      .filter { $0.value == isDark }
      .map(\.key)
      .sorted { lhs, rhs in
        lhs.localizedStandardCompare(rhs) == .orderedAscending
      }
  }

  private let managedKeys = Set([
    "confirm-close-surface",
    "cursor-style-blink",
    "font-family",
    "font-size",
    "theme",
  ])
}
