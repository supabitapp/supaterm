import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct SettingsFeatureTests {
  @Test
  func initialStateStartsOnGeneralTab() {
    let state = SettingsFeature.State()

    #expect(state.selectedTab == .general)
  }

  @Test
  func tabSelectionUpdatesState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    }

    await store.send(.tabSelected(.codingAgents)) {
      $0.selectedTab = .codingAgents
    }

    await store.send(.tabSelected(.updates)) {
      $0.selectedTab = .updates
    }

    await store.send(.tabSelected(.about)) {
      $0.selectedTab = .about
    }
  }

  @Test
  func claudeHooksInstallButtonShowsSuccessState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.installSupatermHooks = {}
    }

    await store.send(.claudeHooksInstallButtonTapped) {
      $0.claudeHooksInstallState = .installing
    }

    await store.receive(.claudeHooksInstallFinished(.success)) {
      $0.claudeHooksInstallState = .succeeded("Claude hooks installed in ~/.claude/settings.json.")
    }
  }

  @Test
  func claudeHooksInstallButtonShowsFailureState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.installSupatermHooks = {
        throw ClaudeSettingsInstallerError.invalidJSON
      }
    }

    await store.send(.claudeHooksInstallButtonTapped) {
      $0.claudeHooksInstallState = .installing
    }

    await store.receive(
      .claudeHooksInstallFinished(.failure("Claude settings must be valid JSON before Supaterm can install hooks."))
    ) {
      $0.claudeHooksInstallState = .failed("Claude settings must be valid JSON before Supaterm can install hooks.")
    }
  }
}
