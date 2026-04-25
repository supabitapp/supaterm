import Foundation
import SupatermCLIShared
import Testing

struct SupatermSettingsValidationTests {
  @Test
  func defaultPathMissingWarnsAboutLegacyJson() throws {
    let homeDirectoryURL = try temporarySettingsValidationHomeDirectory()
    let legacyURL = SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    try FileManager.default.createDirectory(
      at: legacyURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(#"{"appearanceMode":"dark"}"#.utf8).write(to: legacyURL)

    let result = SupatermSettingsValidator(homeDirectoryURL: homeDirectoryURL, environment: [:]).validate()

    #expect(result.status == .missing)
    #expect(!result.warnings.isEmpty)
    #expect(result.errors.isEmpty)
  }

  @Test
  func explicitMissingPathReturnsError() throws {
    let homeDirectoryURL = try temporarySettingsValidationHomeDirectory()
    let missingURL = homeDirectoryURL.appendingPathComponent("missing.toml", isDirectory: false)

    let result =
      SupatermSettingsValidator(homeDirectoryURL: homeDirectoryURL, environment: [:])
      .validate(path: missingURL)

    #expect(result.status == .missing)
    #expect(result.errors == ["Config file not found at \(missingURL.path)."])
  }

  @Test
  func defaultPathUsesStateHomeWhenPresent() throws {
    let homeDirectoryURL = try temporarySettingsValidationHomeDirectory()
    let stateHomeURL = try temporarySettingsValidationHomeDirectory()
    let settingsURL = stateHomeURL.appendingPathComponent("settings.toml", isDirectory: false)
    try SupatermSettingsCodec.encode(.default).write(to: settingsURL)

    let result =
      SupatermSettingsValidator(
        homeDirectoryURL: homeDirectoryURL,
        environment: [SupatermCLIEnvironment.stateHomeKey: stateHomeURL.path]
      )
      .validate()

    #expect(result.status == .valid)
    #expect(result.path == settingsURL.path)
  }

  @Test
  func validTomlWarnsOnUnknownKeys() throws {
    let homeDirectoryURL = try temporarySettingsValidationHomeDirectory()
    let settingsURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(
      #"""
      [appearance]
      mode = "dark"
      extra = "ignored"

      [bottom_bar]
      enabled = true
      left = ["directory"]
      center = []
      right = []
      extra = "ignored"

      [privacy]
      analytics_enabled = true
      crash_reports_enabled = true
      """#.utf8
    )
    .write(to: settingsURL)

    let result = SupatermSettingsValidator(homeDirectoryURL: homeDirectoryURL, environment: [:]).validate()

    #expect(result.status == .valid)
    #expect(
      result.warnings == [
        "Unknown config key `appearance.extra`.",
        "Unknown config key `bottom_bar.extra`.",
      ]
    )
    #expect(result.errors.isEmpty)
  }

  @Test
  func unknownBottomBarModuleReturnsFailure() throws {
    let homeDirectoryURL = try temporarySettingsValidationHomeDirectory()
    let settingsURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path)
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(
      #"""
      [bottom_bar]
      enabled = true
      left = ["directory", "missing"]
      center = []
      right = []
      """#.utf8
    )
    .write(to: settingsURL)

    let result = SupatermSettingsValidator(homeDirectoryURL: homeDirectoryURL).validate()

    #expect(result.status == .invalid)
    #expect(result.errors.count == 1)
  }

  @Test
  func invalidTomlReturnsFailure() throws {
    let homeDirectoryURL = try temporarySettingsValidationHomeDirectory()
    let settingsURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(
      #"""
      [updates]
      channel = "beta"
      """#.utf8
    )
    .write(to: settingsURL)

    let result = SupatermSettingsValidator(homeDirectoryURL: homeDirectoryURL, environment: [:]).validate()

    #expect(result.status == .invalid)
    #expect(result.errors.count == 1)
  }
}

private func temporarySettingsValidationHomeDirectory() throws -> URL {
  try FileManager.default.url(
    for: .itemReplacementDirectory,
    in: .userDomainMask,
    appropriateFor: FileManager.default.temporaryDirectory,
    create: true
  )
}
