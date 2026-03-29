import ArgumentParser
import Foundation

extension SP {
  struct AttachSession: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "__attach-session",
      abstract: "Attach the current terminal process to a managed Supaterm session.",
      shouldDisplay: false
    )

    @Option(name: .long, help: "Managed Supaterm pane session name.")
    var session: String

    @Option(name: .long, help: "Optional shell command to send after attaching.")
    var command: String?

    mutating func run() throws {
      guard normalizedCommand(command) == nil else {
        throw ValidationError("__attach-session does not support --command in the native zmx path yet.")
      }

      do {
        try SPZMXCore.attachSession(named: session)
      } catch {
        let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        fputs("sp __attach-session failed: \(message)\n", stderr)
        throw ExitCode.failure
      }
    }

    private func normalizedCommand(_ command: String?) -> String? {
      guard let command else { return nil }
      let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed
    }
  }
}
