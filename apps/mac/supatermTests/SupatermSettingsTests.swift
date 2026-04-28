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
    let url = SupatermSettings.defaultURL(
      homeDirectoryPath: "/tmp/khoi",
      environment: [:]
    )

    #expect(url.path == "/tmp/khoi/.config/supaterm/settings.toml")
  }

  @Test
  func legacyURLUsesSupatermConfigPath() {
    let url = SupatermSettings.legacyURL(
      homeDirectoryPath: "/tmp/khoi",
      environment: [:]
    )

    #expect(url.path == "/tmp/khoi/.config/supaterm/settings.json")
  }

  @Test
  func defaultURLUsesStateHomeWhenPresent() {
    let url = SupatermSettings.defaultURL(
      homeDirectoryPath: "/tmp/khoi",
      environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
    )

    #expect(url.path == "/tmp/supaterm-dev/settings.toml")
  }

  @Test
  func defaultPrefsUseStableUpdateChannel() {
    let prefs = SupatermSettings.default

    #expect(prefs.appearanceMode == .dark)
    #expect(prefs.analyticsEnabled)
    #expect(prefs.codingAgentsShowIcons)
    #expect(!prefs.computerUseAlwaysFloatAgentCursor)
    #expect(prefs.computerUseCursorMotion == .default)
    #expect(prefs.computerUseMaxImageDimension == 1600)
    #expect(prefs.computerUseShowAgentCursor)
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
    #expect(prefs.codingAgentsShowIcons)
    #expect(!prefs.computerUseAlwaysFloatAgentCursor)
    #expect(prefs.computerUseCursorMotion == .default)
    #expect(prefs.computerUseMaxImageDimension == 1600)
    #expect(prefs.computerUseShowAgentCursor)
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

        [coding_agents]
        show_icons = true

        [computer_use]
        always_float_agent_cursor = false
        cursor_arc_flow = 0.36
        cursor_arc_size = 80.0
        cursor_dwell_after_click_ms = 80
        cursor_end_handle = 0.76
        cursor_glide_duration_ms = 220
        cursor_idle_hide_ms = 900
        cursor_spring = 0.16
        cursor_start_handle = 0.24
        max_image_dimension = 1600
        show_agent_cursor = true
        snapshot_mode = "som"

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
        codingAgentsShowIcons: false,
        computerUseAlwaysFloatAgentCursor: true,
        computerUseCursorMotion: .init(
          startHandle: 0.1,
          endHandle: 0.9,
          arcSize: 40,
          arcFlow: 0.2,
          spring: 0.05,
          glideDurationMilliseconds: 90,
          dwellAfterClickMilliseconds: 20,
          idleHideMilliseconds: 300
        ),
        computerUseMaxImageDimension: 1200,
        computerUseShowAgentCursor: false,
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
          codingAgentsShowIcons: false,
          computerUseAlwaysFloatAgentCursor: true,
          computerUseCursorMotion: .init(
            startHandle: 0.1,
            endHandle: 0.9,
            arcSize: 40,
            arcFlow: 0.2,
            spring: 0.05,
            glideDurationMilliseconds: 90,
            dwellAfterClickMilliseconds: 20,
            idleHideMilliseconds: 300
          ),
          computerUseMaxImageDimension: 1200,
          computerUseShowAgentCursor: false,
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
    #expect(prefs.codingAgentsShowIcons)
    #expect(!prefs.computerUseAlwaysFloatAgentCursor)
    #expect(prefs.computerUseCursorMotion == .default)
    #expect(prefs.computerUseMaxImageDimension == 1600)
    #expect(prefs.computerUseShowAgentCursor)
    #expect(prefs.crashReportsEnabled)
    #expect(prefs.glowingPaneRingEnabled)
    #expect(prefs.newTabPosition == .end)
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
