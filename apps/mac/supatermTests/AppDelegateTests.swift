import AppKit
import Testing

@testable import supaterm

@MainActor
struct AppDelegateTests {
  @Test
  func terminateReplySkipsConfirmationWithoutVisibleTerminalWindows() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: false
    ) {
      Issue.record("confirmation should not be shown")
      return false
    }

    #expect(reply == .terminateNow)
  }

  @Test
  func terminateReplyCancelsWhenConfirmationIsDeclined() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: true
    ) {
      false
    }

    #expect(reply == .terminateCancel)
  }

  @Test
  func terminateReplyTerminatesWhenConfirmationIsAccepted() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: true
    ) {
      true
    }

    #expect(reply == .terminateNow)
  }
}
