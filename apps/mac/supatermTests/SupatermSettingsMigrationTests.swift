import Foundation
import SupatermCLIShared
import Testing

struct SupatermSettingsMigrationTests {
  @Test
  func migratesLegacyJsonToTomlAndDeletesLegacyFile() throws {
    let homeDirectoryURL = try temporarySettingsHomeDirectory()
    let legacyURL = SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    try FileManager.default.createDirectory(
      at: legacyURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(
      #"""
      {
        "appearanceMode": "light",
        "analyticsEnabled": false,
        "updateChannel": "tip"
      }
      """#.utf8
    )
    .write(to: legacyURL)

    try SupatermSettingsMigration(homeDirectoryURL: homeDirectoryURL, environment: [:]).migrateIfNeeded()

    let settingsURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    #expect(FileManager.default.fileExists(atPath: settingsURL.path))
    #expect(!FileManager.default.fileExists(atPath: legacyURL.path))
    let settings = try SupatermSettingsCodec.decode(Data(contentsOf: settingsURL))
    #expect(settings.appearanceMode == .light)
    #expect(!settings.analyticsEnabled)
    #expect(settings.updateChannel == .tip)
    let string = try #require(String(data: Data(contentsOf: settingsURL), encoding: .utf8))
      .trimmingCharacters(in: .newlines)
    #expect(
      string
        == """
        [appearance]
        mode = "light"

        [privacy]
        analytics_enabled = false

        [updates]
        channel = "tip"
        """
    )
  }

  @Test
  func validTomlDeletesRedundantLegacyJson() throws {
    let homeDirectoryURL = try temporarySettingsHomeDirectory()
    let settingsURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    let legacyURL = SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try SupatermSettingsCodec.encode(.default).write(to: settingsURL)
    try Data(#"{"appearanceMode":"light"}"#.utf8).write(to: legacyURL)

    try SupatermSettingsMigration(homeDirectoryURL: homeDirectoryURL, environment: [:]).migrateIfNeeded()

    #expect(FileManager.default.fileExists(atPath: settingsURL.path))
    #expect(!FileManager.default.fileExists(atPath: legacyURL.path))
  }

  @Test
  func invalidTomlPreservesLegacyJson() throws {
    let homeDirectoryURL = try temporarySettingsHomeDirectory()
    let settingsURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    let legacyURL = SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data("[appearance\nmode = \"dark\"\n".utf8).write(to: settingsURL)
    try Data(#"{"appearanceMode":"light"}"#.utf8).write(to: legacyURL)

    try SupatermSettingsMigration(homeDirectoryURL: homeDirectoryURL, environment: [:]).migrateIfNeeded()

    #expect(FileManager.default.fileExists(atPath: settingsURL.path))
    #expect(FileManager.default.fileExists(atPath: legacyURL.path))
  }

  @Test
  func invalidLegacyJsonDoesNotCreateToml() throws {
    let homeDirectoryURL = try temporarySettingsHomeDirectory()
    let legacyURL = SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:])
    try FileManager.default.createDirectory(
      at: legacyURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data("{".utf8).write(to: legacyURL)

    try SupatermSettingsMigration(homeDirectoryURL: homeDirectoryURL, environment: [:]).migrateIfNeeded()

    #expect(FileManager.default.fileExists(atPath: legacyURL.path))
    #expect(
      !FileManager.default.fileExists(
        atPath: SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path, environment: [:]).path
      )
    )
  }

  @Test
  func migratesInsideStateHomeWhenPresent() throws {
    let homeDirectoryURL = try temporarySettingsHomeDirectory()
    let stateHomeURL = try temporarySettingsHomeDirectory()
    let legacyURL = stateHomeURL.appendingPathComponent("settings.json", isDirectory: false)
    try Data(#"{"appearanceMode":"light"}"#.utf8).write(to: legacyURL)

    try SupatermSettingsMigration(
      homeDirectoryURL: homeDirectoryURL,
      environment: [SupatermCLIEnvironment.stateHomeKey: stateHomeURL.path]
    )
    .migrateIfNeeded()

    let settingsURL = stateHomeURL.appendingPathComponent("settings.toml", isDirectory: false)
    #expect(FileManager.default.fileExists(atPath: settingsURL.path))
    #expect(!FileManager.default.fileExists(atPath: legacyURL.path))
  }
}

private func temporarySettingsHomeDirectory() throws -> URL {
  try FileManager.default.url(
    for: .itemReplacementDirectory,
    in: .userDomainMask,
    appropriateFor: FileManager.default.temporaryDirectory,
    create: true
  )
}
