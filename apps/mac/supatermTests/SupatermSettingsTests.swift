import AppKit
import Foundation
import SupatermCLIShared
import SupatermSettingsFeature
import SupatermUpdateFeature
import SwiftUI
import Testing

@testable import supaterm

struct SupatermSettingsTests {
  @Test
  func defaultURLUsesSupatermConfigPath() {
    let url = SupatermSettings.defaultURL(homeDirectoryPath: "/tmp/khoi")

    #expect(url.path == "/tmp/khoi/.config/supaterm/settings.toml")
  }

  @Test
  func legacyURLUsesSupatermConfigPath() {
    let url = SupatermSettings.legacyURL(homeDirectoryPath: "/tmp/khoi")

    #expect(url.path == "/tmp/khoi/.config/supaterm/settings.json")
  }

  @Test
  func defaultPrefsUseStableUpdateChannel() {
    let prefs = SupatermSettings.default

    #expect(prefs.appearanceMode == .dark)
    #expect(prefs.analyticsEnabled)
    #expect(prefs.bottomBarSettings == .default)
    #expect(prefs.crashReportsEnabled)
    #expect(prefs.glowingPaneRingEnabled)
    #expect(prefs.newTabPosition == .end)
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

    let prefs = try SupatermSettingsCodec.decodeLegacyJSON(data)

    #expect(prefs.appearanceMode == .dark)
    #expect(prefs.analyticsEnabled)
    #expect(prefs.bottomBarSettings == .default)
    #expect(prefs.crashReportsEnabled)
    #expect(prefs.glowingPaneRingEnabled)
    #expect(prefs.newTabPosition == .end)
    #expect(prefs.restoreTerminalLayoutEnabled)
    #expect(!prefs.systemNotificationsEnabled)
    #expect(prefs.updateChannel == .stable)
  }

  @Test
  func defaultPrefsEncodeAsGroupedToml() throws {
    let data = try SupatermSettingsCodec.encode(SupatermSettings.default)
    let string = try #require(String(data: data, encoding: .utf8)).trimmingCharacters(in: .newlines)

    #expect(
      string
        == """
        [appearance]
        mode = "dark"

        [bottom_bar]
        center = []
        enabled = true
        left = ["directory", "git_branch", "git_status"]
        right = ["agent", "exit_status"]

        [notifications]
        glowing_pane_ring = true
        system_notifications = false

        [privacy]
        analytics_enabled = true
        crash_reports_enabled = true

        [terminal]
        new_tab_position = "end"
        restore_layout = true

        [updates]
        channel = "stable"
        """
    )
  }

  @Test
  func prefsRoundTripThroughToml() throws {
    let data = try SupatermSettingsCodec.encode(
      SupatermSettings(
        appearanceMode: .dark,
        analyticsEnabled: false,
        bottomBarSettings: SupatermBottomBarSettings(
          enabled: true,
          left: [.paneTitle],
          center: [.time],
          right: [.gitBranch, .gitStatus, .commandDuration]
        ),
        crashReportsEnabled: false,
        glowingPaneRingEnabled: false,
        newTabPosition: .current,
        restoreTerminalLayoutEnabled: false,
        systemNotificationsEnabled: true,
        updateChannel: .tip
      )
    )
    let prefs = try SupatermSettingsCodec.decode(data)

    #expect(
      prefs
        == SupatermSettings(
          appearanceMode: .dark,
          analyticsEnabled: false,
          bottomBarSettings: SupatermBottomBarSettings(
            enabled: true,
            left: [.paneTitle],
            center: [.time],
            right: [.gitBranch, .gitStatus, .commandDuration]
          ),
          crashReportsEnabled: false,
          glowingPaneRingEnabled: false,
          newTabPosition: .current,
          restoreTerminalLayoutEnabled: false,
          systemNotificationsEnabled: true,
          updateChannel: .tip
        )
    )
  }

  @Test
  func prefsDecodeUsesDefaultsForMissingSections() throws {
    let data = Data(
      #"""
      [appearance]
      mode = "light"
      """#.utf8
    )

    let prefs = try SupatermSettingsCodec.decode(data)

    #expect(prefs.appearanceMode == .light)
    #expect(prefs.analyticsEnabled)
    #expect(prefs.bottomBarSettings == .default)
    #expect(prefs.crashReportsEnabled)
    #expect(prefs.glowingPaneRingEnabled)
    #expect(prefs.newTabPosition == .end)
    #expect(prefs.restoreTerminalLayoutEnabled)
    #expect(!prefs.systemNotificationsEnabled)
    #expect(prefs.updateChannel == .stable)
  }

  @Test
  func prefsDecodeUsesDefaultsForMissingBottomBarKeys() throws {
    let data = Data(
      #"""
      [bottom_bar]
      enabled = false
      right = ["time"]
      """#.utf8
    )

    let prefs = try SupatermSettingsCodec.decode(data)

    #expect(!prefs.bottomBarSettings.enabled)
    #expect(prefs.bottomBarSettings.left == SupatermBottomBarSettings.default.left)
    #expect(prefs.bottomBarSettings.center == SupatermBottomBarSettings.default.center)
    #expect(prefs.bottomBarSettings.right == [.time])
  }

  @Test
  func unknownBottomBarModuleFailsDecoding() throws {
    let data = Data(
      #"""
      [bottom_bar]
      enabled = true
      left = ["directory", "nope"]
      center = []
      right = []
      """#.utf8
    )

    #expect(throws: Error.self) {
      _ = try SupatermSettingsCodec.decode(data)
    }
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
