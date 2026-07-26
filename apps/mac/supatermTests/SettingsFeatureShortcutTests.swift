import Carbon.HIToolbox
import ComposableArchitecture
import Sharing
import SupatermCLIShared
import SupatermSupport
import Testing

@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureShortcutTests {
  @Test
  func recordingShortcutPersistsAndRefreshesMenus() async {
    let recorder = ShortcutChangeRecorder()
    let override = SupatermShortcutOverride(
      keyCode: UInt16(kVK_ANSI_B),
      modifiers: [.command, .option]
    )

    await withDependencies {
      $0.defaultFileStorage = .inMemory
      $0.shortcutSettingsClient.shortcutsDidChange = {
        recorder.count += 1
      }
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.shortcutRecorded(.toggleSidebar, override)) {
        $0.shortcutOverrides[.toggleSidebar] = override
      }

      @Shared(.supatermSettings) var settings = .default
      #expect(settings.shortcutOverrides[.toggleSidebar] == override)
      #expect(recorder.count == 1)
    }
  }

  @Test
  func disablingAndEnablingDefaultShortcutUsesSparseOverride() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.shortcutEnabledChanged(.toggleSidebar, false)) {
        $0.shortcutOverrides[.toggleSidebar] = .disabled
      }
      await store.send(.shortcutEnabledChanged(.toggleSidebar, true)) {
        $0.shortcutOverrides.removeValue(forKey: .toggleSidebar)
      }

      @Shared(.supatermSettings) var settings = .default
      #expect(settings.shortcutOverrides.isEmpty)
    }
  }

  @Test
  func resetRestoresOneShortcutDefault() async {
    let override = SupatermShortcutOverride(
      keyCode: UInt16(kVK_ANSI_B),
      modifiers: .command
    )
    var state = SettingsFeature.State()
    state.shortcutOverrides[.toggleSidebar] = override

    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: state) {
        SettingsFeature()
      }

      await store.send(.shortcutResetButtonTapped(.toggleSidebar)) {
        $0.shortcutOverrides.removeValue(forKey: .toggleSidebar)
      }
    }
  }

  @Test
  func restoreDefaultsRemovesAllOverrides() async {
    var state = SettingsFeature.State()
    state.shortcutOverrides = [
      .toggleSidebar: .disabled,
      .toggleAgentPanel: .disabled,
    ]

    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: state) {
        SettingsFeature()
      }

      await store.send(.restoreShortcutDefaultsButtonTapped) {
        $0.shortcutOverrides = [:]
      }
    }
  }
}

@MainActor
private final class ShortcutChangeRecorder {
  var count = 0
}
