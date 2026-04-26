import ComposableArchitecture
import Sharing
import SupatermSupport
import Testing

@testable import SupatermCLIShared
@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureComputerUseTests {
  @Test
  func selectingComputerUseRefreshesPermissionStatus() async {
    let snapshot = ComputerUsePermissionsSnapshot(
      accessibility: .granted,
      screenRecording: .missing
    )
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.computerUsePermissionsClient.snapshot = { snapshot }
    }

    await store.send(.tabSelected(.computerUse)) {
      $0.selectedTab = .computerUse
      $0.computerUse.isRefreshing = true
    }

    await store.receive(.computerUsePermissionsRefreshed(snapshot), timeout: 0) {
      $0.computerUse.accessibility = .granted
      $0.computerUse.screenRecording = .missing
      $0.computerUse.isRefreshing = false
    }
  }

  @Test
  func grantButtonRequestsPermissionAndRefreshesStatus() async {
    let recorder = ComputerUsePermissionRecorder()
    let snapshot = ComputerUsePermissionsSnapshot(
      accessibility: .granted,
      screenRecording: .granted
    )
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.computerUsePermissionsClient.request = { permission in
        await recorder.recordRequest(permission)
        return snapshot
      }
    }

    await store.send(.computerUsePermissionGrantButtonTapped(.screenRecording)) {
      $0.computerUse.isRefreshing = true
    }

    await store.receive(.computerUsePermissionsRefreshed(snapshot), timeout: 0) {
      $0.computerUse.accessibility = .granted
      $0.computerUse.screenRecording = .granted
      $0.computerUse.isRefreshing = false
    }

    #expect(await recorder.requests == [.screenRecording])
  }

  @Test
  func settingsButtonOpensPermissionSettings() async {
    let recorder = ComputerUsePermissionRecorder()
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.computerUsePermissionsClient.openSettings = { permission in
        await recorder.recordOpen(permission)
      }
    }

    await store.send(.computerUsePermissionSettingsButtonTapped(.accessibility))

    #expect(await recorder.opens == [.accessibility])
  }

  @Test
  func showAgentCursorSettingPersistsPrefs() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.computerUseShowAgentCursorChanged(false)) {
        $0.computerUse.showAgentCursor = false
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.computerUseShowAgentCursor)
    }
  }

  @Test
  func alwaysFloatAgentCursorSettingPersistsPrefs() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.computerUseAlwaysFloatAgentCursorChanged(true)) {
        $0.computerUse.alwaysFloatAgentCursor = true
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(supatermSettings.computerUseAlwaysFloatAgentCursor)
    }
  }

  @Test
  func requiredPermissionsRequireBothGrants() {
    var state = SettingsComputerUseState()
    #expect(!state.hasRequiredPermissions)

    state.accessibility = .granted
    #expect(!state.hasRequiredPermissions)

    state.screenRecording = .granted
    #expect(state.hasRequiredPermissions)
  }
}

private actor ComputerUsePermissionRecorder {
  private(set) var requests: [ComputerUsePermissionKind] = []
  private(set) var opens: [ComputerUsePermissionKind] = []

  func recordRequest(_ permission: ComputerUsePermissionKind) {
    requests.append(permission)
  }

  func recordOpen(_ permission: ComputerUsePermissionKind) {
    opens.append(permission)
  }
}
