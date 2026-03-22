import AppKit
import Testing

@testable import supaterm

@MainActor
struct AppDelegateTests {
  @Test
  func terminateReplySkipsConfirmationWithoutVisibleTerminalWindows() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: false,
      bypassesQuitConfirmation: false,
      needsQuitConfirmation: true
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
      bypassesQuitConfirmation: true,
      needsQuitConfirmation: true
    ) {
      Issue.record("confirmation should not be shown")
      return false
    }

    #expect(reply == .terminateNow)
  }

  @Test
  func terminateReplySkipsConfirmationWhenNoWindowNeedsIt() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: true,
      bypassesQuitConfirmation: false,
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
      hasVisibleTerminalWindows: true,
      bypassesQuitConfirmation: false,
      needsQuitConfirmation: true
    ) {
      false
    }

    #expect(reply == .terminateCancel)
  }

  @Test
  func terminateReplyTerminatesWhenConfirmationIsAccepted() {
    let reply = AppDelegate.terminateReply(
      hasVisibleTerminalWindows: true,
      bypassesQuitConfirmation: false,
      needsQuitConfirmation: true
    ) {
      true
    }

    #expect(reply == .terminateNow)
  }
}
