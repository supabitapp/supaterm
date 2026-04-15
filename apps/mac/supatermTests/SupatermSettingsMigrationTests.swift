import Foundation
import SupatermCLIShared
import Testing

struct SupatermSettingsMigrationTests {
  @Test
  func migratesLegacyJsonToTomlAndDeletesLegacyFile() throws {
    let homeDirectoryURL = try temporarySettingsHomeDirectory()
    let legacyURL = SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryURL.path)
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

    try SupatermSettingsMigration(homeDirectoryURL: homeDirectoryURL).migrateIfNeeded()

    let settingsURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path)
    #expect(FileManager.default.fileExists(atPath: settingsURL.path))
    #expect(!FileManager.default.fileExists(atPath: legacyURL.path))
    let settings = try SupatermSettingsCodec.decode(Data(contentsOf: settingsURL))
    #expect(settings.appearanceMode == .light)
    #expect(!settings.analyticsEnabled)
    #expect(settings.updateChannel == .tip)
  }

  @Test
  func validTomlDeletesRedundantLegacyJson() throws {
    let homeDirectoryURL = try temporarySettingsHomeDirectory()
    let settingsURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path)
    let legacyURL = SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryURL.path)
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try SupatermSettingsCodec.encode(.default).write(to: settingsURL)
    try Data(#"{"appearanceMode":"light"}"#.utf8).write(to: legacyURL)

    try SupatermSettingsMigration(homeDirectoryURL: homeDirectoryURL).migrateIfNeeded()

    #expect(FileManager.default.fileExists(atPath: settingsURL.path))
    #expect(!FileManager.default.fileExists(atPath: legacyURL.path))
  }

  @Test
  func invalidTomlPreservesLegacyJson() throws {
    let homeDirectoryURL = try temporarySettingsHomeDirectory()
    let settingsURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path)
    let legacyURL = SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryURL.path)
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data("[appearance\nmode = \"dark\"\n".utf8).write(to: settingsURL)
    try Data(#"{"appearanceMode":"light"}"#.utf8).write(to: legacyURL)

    try SupatermSettingsMigration(homeDirectoryURL: homeDirectoryURL).migrateIfNeeded()

    #expect(FileManager.default.fileExists(atPath: settingsURL.path))
    #expect(FileManager.default.fileExists(atPath: legacyURL.path))
  }

  @Test
  func invalidLegacyJsonDoesNotCreateToml() throws {
    let homeDirectoryURL = try temporarySettingsHomeDirectory()
    let legacyURL = SupatermSettings.legacyURL(homeDirectoryPath: homeDirectoryURL.path)
    try FileManager.default.createDirectory(
      at: legacyURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data("{".utf8).write(to: legacyURL)

    try SupatermSettingsMigration(homeDirectoryURL: homeDirectoryURL).migrateIfNeeded()

    #expect(FileManager.default.fileExists(atPath: legacyURL.path))
    #expect(
      !FileManager.default.fileExists(
        atPath: SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryURL.path).path
      )
    )
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
