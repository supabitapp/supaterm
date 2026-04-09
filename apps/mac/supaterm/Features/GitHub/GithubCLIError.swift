import Foundation

enum GithubCLIError: Error, Equatable, LocalizedError {
  case unavailable
  case outdated
  case commandFailed(String)

  var errorDescription: String? {
    switch self {
    case .unavailable:
      return "GitHub CLI is unavailable."
    case .outdated:
      return "GitHub CLI is outdated. Update `gh` to continue."
    case .commandFailed(let message):
      return message.isEmpty ? "GitHub CLI command failed." : message
    }
  }
}
