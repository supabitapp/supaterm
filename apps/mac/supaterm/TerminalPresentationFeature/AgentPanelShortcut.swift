import SwiftUI

public enum AgentPanelShortcut {
  public static let toggleVisibility = KeyboardShortcut("i", modifiers: .command)
  public static let forkSession = KeyboardShortcut("f", modifiers: [.command, .option])
  public static let copySessionID = KeyboardShortcut("c", modifiers: [.command, .option])
}
