import AppKit
import Testing

@testable import supaterm

@MainActor
struct AppDelegateTests {
  @Test
  func terminateReplySkipsConfirmationWithoutVisibleAppWindows() {
    let reply = AppDelegate.terminateReply(
      hasVisibleAppWindows: false,
      needsQuitConfirmation: true
    ) {
      Issue.record("confirmation should not be shown")
      return false
    }

    #expect(reply == .terminateNow)
  }

  @Test
  func terminateReplySkipsConfirmationWhenNoTerminalNeedsIt() {
    let reply = AppDelegate.terminateReply(
      hasVisibleAppWindows: true,
      needsQuitConfirmation: false
    ) {
      Issue.record("confirmation should not be shown")
      return false
    }

    #expect(reply == .terminateNow)
  }

  @Test
  func terminateReplyCancelsWhenConfirmationIsDeclined() {
    let reply = AppDelegate.terminateReply(
      hasVisibleAppWindows: true,
      needsQuitConfirmation: true
    ) {
      false
    }

    #expect(reply == .terminateCancel)
  }

  @Test
  func terminateReplyTerminatesWhenConfirmationIsAccepted() {
    let reply = AppDelegate.terminateReply(
      hasVisibleAppWindows: true,
      needsQuitConfirmation: true
    ) {
      true
    }

    #expect(reply == .terminateNow)
  }
}
