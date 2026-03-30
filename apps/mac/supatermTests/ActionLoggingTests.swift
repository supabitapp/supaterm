import Testing

@testable import supaterm

struct ActionLoggingTests {
  @Test
  func formatsNestedAppFeatureActions() {
    #expect(
      debugCaseOutput(AppFeature.Action.terminal(.spaceCreateButtonTapped))
        == "AppFeature.Action.terminal(.spaceCreateButtonTapped)"
    )
  }

  @Test
  func formatsSettingsActions() {
    #expect(
      debugCaseOutput(SettingsFeature.Action.tabSelected(.advanced))
        == "SettingsFeature.Action.tabSelected(.advanced)"
    )
  }
}
