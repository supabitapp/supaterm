import Foundation
import SupatermSupport
import Testing

@testable import SupatermSettingsFeature

@MainActor
struct GhosttyTerminalConfigFileTests {
  @Test
  func loadSeedsMissingPreferredConfigFile() throws {
    let rootURL = try makeGhosttyTerminalConfigTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let environment = ghosttyTerminalConfigEnvironment(rootURL: rootURL)

    let configFile = GhosttyTerminalConfigFile(
      homeDirectoryURL: rootURL,
      environment: environment,
      availableThemesProvider: {
        .init(dark: ["Zenbones Dark"], light: ["Zenbones Light"])
      },
      effectiveFontSizeProvider: testEffectiveFontSize,
      availableFontFamiliesProvider: { ["JetBrains Mono", "SF Mono"] }
    )

    let snapshot = try configFile.load()
    let configURL = GhosttySupport.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: environment
    ).preferred

    #expect(snapshot.availableFontFamilies == ["JetBrains Mono", "SF Mono"])
    #expect(snapshot.availableDarkThemes == ["Zenbones Dark"])
    #expect(snapshot.availableLightThemes == ["Zenbones Light"])
    #expect(snapshot.confirmCloseSurface == .whenNotAtPrompt)
    #expect(snapshot.configPath == configURL.path)
    #expect(snapshot.darkTheme == "Zenbones Dark")
    #expect(snapshot.fontFamily == nil)
    #expect(snapshot.fontSize == 15)
    #expect(snapshot.lightTheme == "Zenbones Light")
    #expect(snapshot.warningMessage == nil)
    #expect(try String(contentsOf: configURL, encoding: .utf8) == GhosttySupport.defaultConfigContents)
  }

  @Test
  func applyCanonicalizesManagedKeysAndPreservesUnrelatedLines() throws {
    let rootURL = try makeGhosttyTerminalConfigTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let environment = ghosttyTerminalConfigEnvironment(rootURL: rootURL)
    let configURL = GhosttySupport.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: environment
    ).preferred

    try writeGhosttyTerminalConfig(
      """
      # keep
      theme = light:Zenbones Light,dark:Zenbones Dark
      font-family = "Monaco"
      font-size = 12
      confirm-close-surface = false
      font-family = "Menlo"
      cursor-style = block
      cursor-style-blink = false
      """,
      to: configURL
    )

    let center = NotificationCenter()
    let reloadCounter = NotificationReloadCounter()
    let observer = center.addObserver(
      forName: .ghosttyRuntimeReloadRequested,
      object: nil,
      queue: nil
    ) { _ in
      reloadCounter.increment()
    }
    defer {
      center.removeObserver(observer)
    }

    let configFile = GhosttyTerminalConfigFile(
      homeDirectoryURL: rootURL,
      environment: environment,
      notificationCenter: center,
      availableThemesProvider: {
        .init(dark: ["Zenbones Dark"], light: ["Zenbones Light", "Builtin Light"])
      },
      effectiveFontSizeProvider: testEffectiveFontSize,
      availableFontFamiliesProvider: { [] }
    )

    let snapshot = try configFile.apply(
      settings: terminalSettingsDraft(
        confirmCloseSurface: .always,
        darkTheme: "Zenbones Dark",
        fontFamily: "JetBrains Mono",
        fontSize: 18,
        lightTheme: "Builtin Light"
      )
    )
    let contents = try String(contentsOf: configURL, encoding: .utf8)

    #expect(snapshot.confirmCloseSurface == .always)
    #expect(snapshot.darkTheme == "Zenbones Dark")
    #expect(snapshot.fontFamily == "JetBrains Mono")
    #expect(snapshot.fontSize == 18)
    #expect(snapshot.lightTheme == "Builtin Light")
    #expect(snapshot.warningMessage == nil)
    #expect(contents.contains("# keep"))
    #expect(contents.contains("theme = light:Builtin Light,dark:Zenbones Dark"))
    #expect(contents.contains("cursor-style = block"))
    #expect(contents.contains("cursor-style-blink = false"))
    #expect(contents.contains(#"font-family = "JetBrains Mono""#))
    #expect(contents.contains("font-size = 18"))
    #expect(contents.contains("confirm-close-surface = always"))
    #expect(occurrenceCount(of: "confirm-close-surface =", in: contents) == 1)
    #expect(occurrenceCount(of: "cursor-style-blink =", in: contents) == 1)
    #expect(occurrenceCount(of: "font-family =", in: contents) == 1)
    #expect(occurrenceCount(of: "font-size =", in: contents) == 1)
    #expect(reloadCounter.count() == 1)
  }

  @Test
  func applyDefaultRemovesManagedFontFamilyEntries() throws {
    let rootURL = try makeGhosttyTerminalConfigTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let environment = ghosttyTerminalConfigEnvironment(rootURL: rootURL)
    let configURL = GhosttySupport.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: environment
    ).preferred

    try writeGhosttyTerminalConfig(
      """
      font-family = "Monaco"
      theme = dark:Zenbones Dark
      font-size = 13
      """,
      to: configURL
    )

    let configFile = GhosttyTerminalConfigFile(
      homeDirectoryURL: rootURL,
      environment: environment,
      availableThemesProvider: {
        .init(dark: ["Zenbones Dark"], light: ["Zenbones Light"])
      },
      effectiveFontSizeProvider: testEffectiveFontSize,
      availableFontFamiliesProvider: { [] }
    )

    let snapshot = try configFile.apply(
      settings: terminalSettingsDraft(
        confirmCloseSurface: .whenNotAtPrompt,
        darkTheme: "Zenbones Dark",
        fontFamily: nil,
        fontSize: 16,
        lightTheme: "Zenbones Light"
      )
    )
    let contents = try String(contentsOf: configURL, encoding: .utf8)

    #expect(snapshot.confirmCloseSurface == .whenNotAtPrompt)
    #expect(snapshot.darkTheme == "Zenbones Dark")
    #expect(snapshot.fontFamily == nil)
    #expect(snapshot.fontSize == 16)
    #expect(snapshot.lightTheme == "Zenbones Light")
    #expect(!contents.contains("font-family ="))
    #expect(contents.contains("theme = light:Zenbones Light,dark:Zenbones Dark"))
    #expect(contents.contains("font-size = 16"))
    #expect(contents.contains("confirm-close-surface = true"))
    #expect(!contents.contains("cursor-style-blink ="))
  }

  @Test
  func loadMapsSingleThemeToLightAndDarkSelections() throws {
    let rootURL = try makeGhosttyTerminalConfigTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let environment = ghosttyTerminalConfigEnvironment(rootURL: rootURL)
    let configURL = GhosttySupport.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: environment
    ).preferred

    try writeGhosttyTerminalConfig(
      """
      theme = Builtin Dark
      font-size = 17
      """,
      to: configURL
    )

    let configFile = GhosttyTerminalConfigFile(
      homeDirectoryURL: rootURL,
      environment: environment,
      availableThemesProvider: {
        .init(dark: ["Builtin Dark"], light: ["Builtin Light"])
      },
      effectiveFontSizeProvider: testEffectiveFontSize,
      availableFontFamiliesProvider: { [] }
    )

    let snapshot = try configFile.load()

    #expect(snapshot.confirmCloseSurface == .whenNotAtPrompt)
    #expect(snapshot.darkTheme == "Builtin Dark")
    #expect(snapshot.lightTheme == "Builtin Dark")
  }

  @Test
  func loadReadsConfirmCloseSurfaceSelection() throws {
    let rootURL = try makeGhosttyTerminalConfigTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let environment = ghosttyTerminalConfigEnvironment(rootURL: rootURL)
    let configURL = GhosttySupport.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: environment
    ).preferred

    try writeGhosttyTerminalConfig(
      """
      confirm-close-surface = always
      font-size = 17
      """,
      to: configURL
    )

    let configFile = GhosttyTerminalConfigFile(
      homeDirectoryURL: rootURL,
      environment: environment,
      effectiveFontSizeProvider: testEffectiveFontSize,
      availableFontFamiliesProvider: { [] }
    )

    let snapshot = try configFile.load()

    #expect(snapshot.confirmCloseSurface == .always)
    #expect(snapshot.fontSize == 17)
  }

  @Test
  func loadWarnsWhenPrimaryConfigIncludesRecursiveFiles() throws {
    let rootURL = try makeGhosttyTerminalConfigTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let environment = ghosttyTerminalConfigEnvironment(rootURL: rootURL)
    let configURL = GhosttySupport.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: environment
    ).preferred

    try writeGhosttyTerminalConfig(
      """
      config-file = other
      font-size = 17
      """,
      to: configURL
    )
    try writeGhosttyTerminalConfig(
      """
      cursor-style = block
      """,
      to: configURL.deletingLastPathComponent().appendingPathComponent("other", isDirectory: false)
    )

    let configFile = GhosttyTerminalConfigFile(
      homeDirectoryURL: rootURL,
      environment: environment,
      effectiveFontSizeProvider: testEffectiveFontSize,
      availableFontFamiliesProvider: { [] }
    )

    let snapshot = try configFile.load()

    #expect(snapshot.fontSize == 17)
    #expect(
      snapshot.warningMessage
        == "This Ghostty config includes other config files. Settings only edits the primary file shown here."
    )
  }

  @Test
  func applyRejectsInvalidConfigAndDoesNotBroadcastReload() throws {
    let rootURL = try makeGhosttyTerminalConfigTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let environment = ghosttyTerminalConfigEnvironment(rootURL: rootURL)
    let configURL = GhosttySupport.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: environment
    ).preferred

    let originalContents = """
      definitely-invalid-key = nope
      font-size = 15
      """
    try writeGhosttyTerminalConfig(originalContents, to: configURL)

    let center = NotificationCenter()
    let reloadCounter = NotificationReloadCounter()
    let observer = center.addObserver(
      forName: .ghosttyRuntimeReloadRequested,
      object: nil,
      queue: nil
    ) { _ in
      reloadCounter.increment()
    }
    defer {
      center.removeObserver(observer)
    }

    let configFile = GhosttyTerminalConfigFile(
      homeDirectoryURL: rootURL,
      environment: environment,
      notificationCenter: center,
      availableThemesProvider: {
        .init(dark: ["Zenbones Dark"], light: ["Zenbones Light"])
      },
      effectiveFontSizeProvider: testEffectiveFontSize,
      availableFontFamiliesProvider: { [] }
    )

    #expect(throws: GhosttyTerminalConfigFileError.self) {
      try configFile.apply(
        settings: terminalSettingsDraft(
          confirmCloseSurface: .always,
          darkTheme: "Zenbones Dark",
          fontFamily: "JetBrains Mono",
          fontSize: 18,
          lightTheme: "Zenbones Light"
        )
      )
    }

    #expect(try String(contentsOf: configURL, encoding: .utf8) == originalContents)
    #expect(reloadCounter.count() == 0)
  }
}

private nonisolated func ghosttyTerminalConfigEnvironment(rootURL: URL) -> [String: String] {
  ["XDG_CONFIG_HOME": rootURL.appendingPathComponent("xdg", isDirectory: true).path]
}

private nonisolated func makeGhosttyTerminalConfigTemporaryDirectory() throws -> URL {
  let rootURL = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
  return rootURL
}

private nonisolated func occurrenceCount(of substring: String, in string: String) -> Int {
  string.components(separatedBy: substring).count - 1
}

private nonisolated func terminalSettingsDraft(
  confirmCloseSurface: GhosttyTerminalCloseConfirmation = .whenNotAtPrompt,
  darkTheme: String? = "Zenbones Dark",
  fontFamily: String? = nil,
  fontSize: Double = 15,
  lightTheme: String? = "Zenbones Light"
) -> GhosttyTerminalSettingsDraft {
  .init(
    confirmCloseSurface: confirmCloseSurface,
    darkTheme: darkTheme,
    fontFamily: fontFamily,
    fontSize: fontSize,
    lightTheme: lightTheme
  )
}

private nonisolated func testEffectiveFontSize(_ url: URL) throws -> Double {
  let contents = try String(contentsOf: url, encoding: .utf8)
  if contents.contains("definitely-invalid-key") {
    throw GhosttyTerminalConfigFileError.invalidConfig("Broken config")
  }
  for line in contents.components(separatedBy: "\n").reversed() {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.hasPrefix("font-size"),
      let equalsIndex = trimmed.firstIndex(of: "="),
      let value = Double(trimmed[trimmed.index(after: equalsIndex)...].trimmingCharacters(in: .whitespaces))
    else {
      continue
    }
    return value
  }
  return 15
}

private nonisolated func writeGhosttyTerminalConfig(_ contents: String, to url: URL) throws {
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try contents.write(to: url, atomically: true, encoding: .utf8)
}

nonisolated final class NotificationReloadCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0

  func count() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  func increment() {
    lock.lock()
    defer { lock.unlock() }
    value += 1
  }
}
