import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateCloseTests {
  @Test
  func appQuitSeesSharedSurfaceWhileWindowCloseScopesToItsHost() throws {
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

      hostWithLiveSurface.ensureInitialTab(
        focusing: false,
        startupCommand: "exec /bin/cat"
      )
      runtime.tick()

      #expect(runtime.needsConfirmQuit())
      #expect(hostWithLiveSurface.windowNeedsCloseConfirmation())
      #expect(!emptyHost.windowNeedsCloseConfirmation())
    }
  }
}
