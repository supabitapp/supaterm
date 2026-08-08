import Foundation

public enum SupatermSSHCommand {
  public static let program = "ssh"
  public static let sessionProgram = "ssh-session"
  public static let term = "xterm-256color"
  private static let forwardedEnvironmentVariables = [
    "COLORTERM",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
  ]

  private static let optionsTakingValue: Set<Character> = [
    "B", "b", "c", "D", "E", "e", "F", "I", "i", "J", "L", "l", "m", "O", "o", "P", "p", "Q", "R",
    "S", "W", "w",
  ]
  private static let optionsWithoutSession: Set<Character> = ["N", "W", "f"]

  private enum OptionAction {
    case reject
    case preserve
    case preserveWithValue
  }

  public static var forwardedEnvironmentOptions: [String] {
    forwardedEnvironmentVariables.flatMap { ["-o", "SendEnv=\($0)"] }
  }

  public static func commandLine(
    forArguments arguments: [String],
    terminalType: String?,
    cliPath: String?
  ) -> String? {
    guard let executable = arguments.first else { return nil }

    let sourceArguments = Array(arguments.dropFirst())
    let launchedBySupaterm = sourceArguments.starts(with: forwardedEnvironmentOptions)
    guard launchedBySupaterm || URL(fileURLWithPath: executable).lastPathComponent == program else {
      return nil
    }

    let inheritedArguments =
      launchedBySupaterm
      ? Array(sourceArguments.dropFirst(forwardedEnvironmentOptions.count))
      : sourceArguments
    guard let sessionArguments = sessionArguments(inheritedArguments) else { return nil }

    let terminalType =
      terminalType
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .flatMap { $0.isEmpty ? nil : $0 }
    var tokens: [String]
    if let cliPath {
      tokens = ["/usr/bin/env", cliPath, "internal", program]
      if let terminalType {
        tokens += ["--term", terminalType]
      }
      tokens += ["--ssh", executable, "--"] + sessionArguments
    } else {
      tokens = ["/usr/bin/env"]
      if let terminalType {
        tokens.append("TERM=\(terminalType)")
      }
      tokens += [executable] + sourceArguments
    }

    return
      tokens
      .map(SupatermShellCommand.escapedToken)
      .joined(separator: " ")
  }

  public static func sessionArguments(_ arguments: [String]) -> [String]? {
    var options: [String] = []
    var index = 0

    while index < arguments.count {
      let token = arguments[index]

      guard token.hasPrefix("-"), token.count > 1 else {
        guard index == arguments.count - 1 else { return nil }
        return options + [token]
      }

      switch optionAction(for: token) {
      case .reject:
        return nil
      case .preserve:
        options.append(token)
        index += 1
      case .preserveWithValue:
        guard index + 1 < arguments.count else { return nil }
        options += [token, arguments[index + 1]]
        index += 2
      }
    }

    return nil
  }

  private static func optionAction(for token: String) -> OptionAction {
    let flags = Array(token.dropFirst())
    for (position, flag) in flags.enumerated() {
      if optionsWithoutSession.contains(flag) { return .reject }
      if optionsTakingValue.contains(flag) {
        return position == flags.count - 1 ? .preserveWithValue : .preserve
      }
    }
    return .preserve
  }
}
