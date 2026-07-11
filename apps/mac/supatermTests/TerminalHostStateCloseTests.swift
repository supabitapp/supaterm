import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateCloseTests {
  @Test
  func windowCloseConfirmationIgnoresSurfacesOwnedByAnotherHost() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let runtime = try makeGhosttyRuntime(
        """
        confirm-close-surface = always
        """,
        applicationIsActive: { false }
      )
      let hostWithLiveSurface = TerminalHostState(
        runtime: runtime,
        zmxSessionsEnabled: false
      )
      let emptyHost = TerminalHostState(
        runtime: runtime,
        zmxSessionsEnabled: false
      )

      hostWithLiveSurface.ensureInitialTab(focusing: false)

      #expect(hostWithLiveSurface.windowNeedsCloseConfirmation())
      #expect(!emptyHost.windowNeedsCloseConfirmation())
    }
  }
}
