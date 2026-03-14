import Testing

@testable import supaterm

struct GhosttyBootstrapTests {
  @Test
  func bootstrapDoesNotOverrideGhosttyTerminalShortcuts() {
    #expect(GhosttyBootstrap.extraCLIArguments.isEmpty)
  }
}
