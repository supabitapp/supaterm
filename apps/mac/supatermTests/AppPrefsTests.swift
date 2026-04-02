import AppKit
import Foundation
import SwiftUI
import Testing

@testable import supaterm

struct AppPrefsTests {
  @Test
  func defaultURLUsesSupatermConfigPath() {
    let url = AppPrefs.defaultURL(homeDirectoryPath: "/tmp/khoi")

    #expect(url.path == "/tmp/khoi/.config/supaterm/appprefs.json")
  }

  @Test
  func defaultPrefsUseStableUpdateChannel() {
    let prefs = AppPrefs.default

    #expect(prefs.appearanceMode == .system)
    #expect(prefs.analyticsEnabled)
    #expect(prefs.crashReportsEnabled)
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

    let prefs = try JSONDecoder().decode(AppPrefs.self, from: data)

    #expect(prefs.appearanceMode == .dark)
    #expect(prefs.analyticsEnabled)
    #expect(prefs.crashReportsEnabled)
    #expect(!prefs.systemNotificationsEnabled)
    #expect(prefs.updateChannel == UpdateChannel.stable)
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
