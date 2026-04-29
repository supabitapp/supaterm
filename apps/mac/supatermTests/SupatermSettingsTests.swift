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
    #expect(prefs.codingAgentsShowSpinner)
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
    #expect(prefs.codingAgentsShowSpinner)
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
  func defaultPrefsEncodeAsEmptyToml() throws {
    let data = try SupatermSettingsCodec.encode(SupatermSettings.default)
    let string = try #require(String(data: data, encoding: .utf8)).trimmingCharacters(in: .newlines)

    #expect(string.isEmpty)
  }

  @Test
  func prefsEncodeOnlyChangedPrivacyValues() throws {
    let data = try SupatermSettingsCodec.encode(
      SupatermSettings(
        appearanceMode: .dark,
        analyticsEnabled: false,
        crashReportsEnabled: true,
        updateChannel: .stable
      )
    )
    let string = try #require(String(data: data, encoding: .utf8)).trimmingCharacters(in: .newlines)

    #expect(
      string
        == """
        [privacy]
        analytics_enabled = false
        """
    )
  }

  @Test
  func prefsEncodeOnlyChangedCodingAgentValues() throws {
    let data = try SupatermSettingsCodec.encode(
      SupatermSettings(
        appearanceMode: .dark,
        analyticsEnabled: true,
        codingAgentsShowIcons: false,
        codingAgentsShowSpinner: false,
        crashReportsEnabled: true,
        updateChannel: .stable
      )
    )
    let string = try #require(String(data: data, encoding: .utf8)).trimmingCharacters(in: .newlines)

    #expect(
      string
        == """
        [coding_agents]
        show_icons = false
        show_spinner = false
        """
    )
  }

  @Test
  func prefsEncodeOnlyChangedComputerUseValues() throws {
    let data = try SupatermSettingsCodec.encode(
      SupatermSettings(
        appearanceMode: .dark,
        analyticsEnabled: true,
        computerUseCursorMotion: SupatermComputerUseCursorMotion(glideDurationMilliseconds: 90),
        crashReportsEnabled: true,
        updateChannel: .stable
      )
    )
    let string = try #require(String(data: data, encoding: .utf8)).trimmingCharacters(in: .newlines)

    #expect(
      string
        == """
        [computer_use]
        cursor_glide_duration_ms = 90
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
        codingAgentsShowSpinner: false,
        computerUseAlwaysFloatAgentCursor: true,
        computerUseCursorMotion: SupatermComputerUseCursorMotion(
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
          codingAgentsShowSpinner: false,
          computerUseAlwaysFloatAgentCursor: true,
          computerUseCursorMotion: SupatermComputerUseCursorMotion(
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
    #expect(prefs.codingAgentsShowSpinner)
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
  func prefsDecodeUsesDefaultsForEmptyToml() throws {
    let prefs = try SupatermSettingsCodec.decode(Data())

    #expect(prefs == .default)
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
