import SupatermCLIShared
import SupatermSupport
import Testing

struct SupatermSettingsCommandTests {
  @Test
  func registryListsEveryPublicConfigKey() {
    let result = SupatermSettingsRegistry.list(
      settings: .default,
      path: "/tmp/settings.toml",
      changedOnly: false
    )

    #expect(
      result.entries.map(\.key) == [
        "appearance.mode",
        "terminal.restore_layout",
        "terminal.zmx_sessions_enabled",
        "notifications.system_notifications",
        "notifications.glowing_pane_ring",
        "notifications.tab_move_haptics",
        "coding_agents.show_panel",
        "privacy.analytics_enabled",
        "privacy.crash_reports_enabled",
        "updates.channel",
        "logging.verbose_enabled",
      ]
    )
    let allEntriesAreDefault = result.entries.allSatisfy { $0.isDefault }
    #expect(allEntriesAreDefault)
  }

  @Test
  func registrySetsAndResetsTypedValues() throws {
    let setEdit = try SupatermSettingsRegistry.set(
      SupatermSettingsSetRequest(key: "appearance.mode", value: "system"),
      settings: .default,
      path: "/tmp/settings.toml"
    )

    #expect(setEdit.settings.appearanceMode == .system)
    #expect(setEdit.result.oldValue == "dark")
    #expect(setEdit.result.value == "system")
    #expect(!setEdit.result.isDefault)

    let resetEdit = try SupatermSettingsRegistry.reset(
      SupatermSettingsResetRequest(key: "appearance.mode"),
      settings: setEdit.settings,
      path: "/tmp/settings.toml"
    )

    #expect(resetEdit.settings.appearanceMode == .dark)
    #expect(resetEdit.result.oldValue == "system")
    #expect(resetEdit.result.value == "dark")
    #expect(resetEdit.result.isDefault)
  }

  @Test
  func registrySetsAndResetsTabMoveHaptics() throws {
    let setEdit = try SupatermSettingsRegistry.set(
      SupatermSettingsSetRequest(key: "notifications.tab_move_haptics", value: "false"),
      settings: .default,
      path: "/tmp/settings.toml"
    )

    #expect(!setEdit.settings.tabMoveHapticsEnabled)
    #expect(setEdit.result.oldValue == "true")
    #expect(setEdit.result.value == "false")
    #expect(!setEdit.result.isDefault)

    let resetEdit = try SupatermSettingsRegistry.reset(
      SupatermSettingsResetRequest(key: "notifications.tab_move_haptics"),
      settings: setEdit.settings,
      path: "/tmp/settings.toml"
    )

    #expect(resetEdit.settings.tabMoveHapticsEnabled)
    #expect(resetEdit.result.oldValue == "false")
    #expect(resetEdit.result.value == "true")
    #expect(resetEdit.result.isDefault)
  }

  @Test
  func registryRejectsUnknownKeysAndInvalidValues() throws {
    do {
      _ = try SupatermSettingsRegistry.get(
        key: "terminal.confirm_quit",
        settings: .default,
        path: "/tmp/settings.toml"
      )
      Issue.record("Expected unknown key to throw.")
    } catch let error as SupatermSettingsCommandError {
      #expect(error == .invalidKey("terminal.confirm_quit"))
    } catch {
      Issue.record("Expected invalid key error, got \(error).")
    }

    do {
      _ = try SupatermSettingsRegistry.set(
        SupatermSettingsSetRequest(key: "appearance.mode", value: "sepia"),
        settings: .default,
        path: "/tmp/settings.toml"
      )
      Issue.record("Expected invalid enum value to throw.")
    } catch let error as SupatermSettingsCommandError {
      #expect(
        error == .invalidValue(key: "appearance.mode", value: "sepia", allowedValues: ["system", "light", "dark"]))
    } catch {
      Issue.record("Expected invalid value error, got \(error).")
    }

    do {
      _ = try SupatermSettingsRegistry.set(
        SupatermSettingsSetRequest(key: "logging.verbose_enabled", value: "yes"),
        settings: .default,
        path: "/tmp/settings.toml"
      )
      Issue.record("Expected invalid bool value to throw.")
    } catch let error as SupatermSettingsCommandError {
      #expect(error == .invalidValue(key: "logging.verbose_enabled", value: "yes", allowedValues: ["true", "false"]))
    } catch {
      Issue.record("Expected invalid boolean error, got \(error).")
    }
  }
}
