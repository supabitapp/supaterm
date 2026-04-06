import AppKit
import Foundation
import SupatermCLIShared
import SwiftUI
import Testing

@testable import supaterm

struct SupatermSettingsTests {
  @Test
  func defaultURLUsesSupatermConfigPath() {
    let url = SupatermSettings.defaultURL(homeDirectoryPath: "/tmp/khoi")

    #expect(url.path == "/tmp/khoi/.config/supaterm/settings.json")
  }

  @Test
  func defaultPrefsUseStableUpdateChannel() {
    let prefs = SupatermSettings.default

    #expect(prefs.appearanceMode == .system)
    #expect(prefs.analyticsEnabled)
    #expect(prefs.crashReportsEnabled)
    #expect(prefs.restoreTerminalLayoutEnabled)
    #expect(!prefs.systemNotificationsEnabled)
    #expect(prefs.updateChannel == .stable)
  }

  @Test
  func legacyPrefsDecodeIgnoresRemovedSparkleSettings() throws {
    let data = Data(
      #"""
      {
        "appearanceMode": "dark",
        "updatesAutomaticallyCheckForUpdates": false,
        "updatesAutomaticallyDownloadUpdates": false
      }
      """#.utf8
    )

    let prefs = try JSONDecoder().decode(SupatermSettings.self, from: data)

    #expect(prefs.appearanceMode == .dark)
    #expect(prefs.analyticsEnabled)
    #expect(prefs.crashReportsEnabled)
    #expect(prefs.restoreTerminalLayoutEnabled)
    #expect(!prefs.systemNotificationsEnabled)
    #expect(prefs.updateChannel == UpdateChannel.stable)
  }

  @Test
  func defaultPrefsEncodeWithSchemaURL() throws {
    let data = try JSONEncoder().encode(SupatermSettings.default)
    let value = try JSONDecoder().decode(JSONValue.self, from: data)
    let object = try #require(value.objectValue)

    #expect(object["$schema"]?.stringValue == SupatermSettingsSchema.url)
    #expect(
      Set(object.keys) == [
        "$schema",
        "analyticsEnabled",
        "appearanceMode",
        "crashReportsEnabled",
        "restoreTerminalLayoutEnabled",
        "systemNotificationsEnabled",
        "updateChannel",
      ])
  }

  @Test
  func prefsRoundTripWithSchemaURL() throws {
    let data = try JSONEncoder().encode(SupatermSettings.default)
    let prefs = try JSONDecoder().decode(SupatermSettings.self, from: data)

    #expect(prefs == SupatermSettings.default)
  }

  @Test
  func prefsDecodeIgnoresSchemaURL() throws {
    let data = Data(
      #"""
      {
        "$schema": "https://supaterm.com/data/supaterm-settings.schema.json",
        "appearanceMode": "dark"
      }
      """#.utf8
    )

    let prefs = try JSONDecoder().decode(SupatermSettings.self, from: data)

    #expect(prefs.appearanceMode == .dark)
    #expect(prefs.analyticsEnabled)
    #expect(prefs.crashReportsEnabled)
    #expect(prefs.restoreTerminalLayoutEnabled)
    #expect(!prefs.systemNotificationsEnabled)
    #expect(prefs.updateChannel == .stable)
  }

  @Test
  func appearanceModeResolvesColorScheme() {
    #expect(AppearanceMode.system.colorScheme == nil)
    #expect(AppearanceMode.light.colorScheme == .light)
    #expect(AppearanceMode.dark.colorScheme == .dark)
  }

  @Test
  func appearanceModeResolvesAppKitAppearance() {
    #expect(AppearanceMode.system.appearance == nil)
    #expect(AppearanceMode.light.appearance?.name == .aqua)
    #expect(AppearanceMode.dark.appearance?.name == .darkAqua)
  }

  @Test
  func appearanceModeUsesAutoTitleForSystem() {
    #expect(AppearanceMode.system.title == "Auto")
  }
}
