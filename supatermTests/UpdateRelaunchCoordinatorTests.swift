import Testing

@testable import supaterm

@MainActor
struct UpdateRelaunchCoordinatorTests {
  @Test
  func bypassTurnsOnAndOff() {
    let coordinator = UpdateRelaunchCoordinator()

    #expect(!coordinator.bypassesQuitConfirmation)

    coordinator.prepareForRelaunch()

    #expect(coordinator.bypassesQuitConfirmation)

    coordinator.reset()

    #expect(!coordinator.bypassesQuitConfirmation)
  }
}
