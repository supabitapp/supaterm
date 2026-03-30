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
    #expect(prefs.updateChannel == .stable)
    #expect(prefs.updatesAutomaticallyCheckForUpdates)
    #expect(!prefs.updatesAutomaticallyDownloadUpdates)
  }

  @Test
  func legacyPrefsDecodeWithStableUpdateDefaults() throws {
    let data = Data(
      #"""
      {
        "appearanceMode": "dark"
      }
      """#.utf8
    )

    let prefs = try JSONDecoder().decode(AppPrefs.self, from: data)

    #expect(prefs.appearanceMode == .dark)
    #expect(prefs.updateChannel == UpdateChannel.stable)
    #expect(prefs.updatesAutomaticallyCheckForUpdates)
    #expect(!prefs.updatesAutomaticallyDownloadUpdates)
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
}
