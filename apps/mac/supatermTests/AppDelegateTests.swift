import AppKit
import Testing

@testable import supaterm

@MainActor
struct AppDelegateTests {
  @Test
  func terminateReplySkipsConfirmationWithoutVisibleTerminalWindows() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: false,
      bypassesQuitConfirmation: false
    ) {
      Issue.record("confirmation should not be shown")
      return false
    }

    #expect(reply == .terminateNow)
  }

  @Test
  func terminateReplySkipsConfirmationWhenUpdateBypassesQuit() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: true,
      bypassesQuitConfirmation: true
    ) {
      Issue.record("confirmation should not be shown")
      return false
    }

    #expect(reply == .terminateNow)
  }

  @Test
  func terminateReplyCancelsWhenConfirmationIsDeclined() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: true,
      bypassesQuitConfirmation: false
    ) {
      false
    }

    #expect(reply == .terminateCancel)
  }

  @Test
  func terminateReplyTerminatesWhenConfirmationIsAccepted() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: true,
      bypassesQuitConfirmation: false
    ) {
      true
    }

    #expect(reply == .terminateNow)
  }
}
