import ComposableArchitecture
import Sharing
import SupatermSupport
import Testing

@testable import SupatermCLIShared
@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureAdvancedTests {
  @Test
  func verboseLoggingSettingPersistsPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      defer { SupatermLog.setVerboseLoggingEnabled(false) }
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.verboseLoggingEnabledChanged(true)) {
        $0.verboseLoggingEnabled = true
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(supatermSettings.verboseLoggingEnabled)
    }
  }
}
