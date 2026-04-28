import Foundation
import GhosttyKit
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateChildExitTests {
  @Test
  func childExitedRequestsImmediateCloseAndMarksActionHandled() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    let stream = host.eventStream()
    var iterator = stream.makeAsyncIterator()
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let surface = try #require(host.selectedSurfaceView)
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_SHOW_CHILD_EXITED, action: ghostty_action_u())
    action.action.child_exited.exit_code = 0
    action.action.child_exited.timetime_ms = 28

    #expect(surface.bridge.handleAction(target: target, action: action))
    #expect(surface.bridge.state.childExitCode == 0)
    #expect(surface.bridge.state.childExitTimeMs == 28)

    let event = try #require(await iterator.next())
    #expect(event == .windowCloseRequested(needsConfirmation: false))
  }
}
