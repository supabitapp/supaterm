import Foundation
import Testing

@testable import supaterm

@MainActor
final class TerminalCommandRecorder {
  var commands: [TerminalClient.Command] = []

  func record(_ command: TerminalClient.Command) {
    commands.append(command)
  }
}
