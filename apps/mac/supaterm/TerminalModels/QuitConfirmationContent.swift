import AppKit

public enum QuitConfirmationDecision: Equatable {
  case cancel
  case quitPreservingSessions
  case quitTerminatingSessions
}

public struct QuitConfirmationContent: Equatable {
  public let message: String
  public let preservingSessionsTitle: String?
  public let terminatingSessionsTitle: String

  public init(terminatesSessions: Bool) {
    if terminatesSessions {
      message = "All terminal sessions will be terminated."
      preservingSessionsTitle = nil
      terminatingSessionsTitle = "Quit and Terminate Sessions"
    } else {
      message =
        "Terminal sessions will continue running in the background. "
        + "Choose Quit and Terminate Sessions to also close every tab and stop their shells."
      preservingSessionsTitle = "Quit"
      terminatingSessionsTitle = "Quit and Terminate Sessions"
    }
  }

  public var buttonTitles: [String] {
    var titles = ["Cancel", terminatingSessionsTitle]
    if let preservingSessionsTitle {
      titles.append(preservingSessionsTitle)
    }
    return titles
  }

  public func returnKeyDecision(modifierFlags: NSEvent.ModifierFlags) -> QuitConfirmationDecision? {
    let modifiers = modifierFlags.intersection([.shift, .control, .option, .command])
    guard modifiers.isSubset(of: [.shift]) else { return nil }
    if modifiers.contains(.shift) {
      return .quitTerminatingSessions
    }
    return preservingSessionsTitle == nil ? .quitTerminatingSessions : .quitPreservingSessions
  }
}
