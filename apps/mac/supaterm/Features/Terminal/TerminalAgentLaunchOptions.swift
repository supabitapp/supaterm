import Foundation
import SupatermCLIShared

nonisolated enum TerminalAgentLaunchOptions {
  static func inherited(
    from commandLineArguments: [String],
    agent: SupatermAgentKind
  ) -> [String]? {
    schema(for: agent).inherited(from: commandLineArguments)
  }

  private static func schema(for agent: SupatermAgentKind) -> Schema {
    switch agent {
    case .claude: .claude
    case .codex: .codex
    case .pi: .pi
    }
  }

  private enum ArgumentResolution {
    case discard(until: Int)
    case inherit(until: Int)
    case positional
    case reject
    case stop
    case unknownOption
  }

  private struct Schema {
    let flagOptions: Set<String>
    let valueOptions: Set<String>
    let optionalValueOptions: Set<String>
    let discardedFlagOptions: Set<String>
    let discardedValueOptions: Set<String>
    let discardedOptionalValueOptions: Set<String>
    let attachedValueOptionPrefixes: [String]
    let variadicOptions: Set<String>
    let discardedVariadicOptions: Set<String>
    let discardedAttachedValueOptionPrefixes: [String]
    let rejectedOptions: Set<String>
    let nonRestorableCommands: Set<String>
    let sessionCommands: Set<String>
    let scansOptionsPastPositionals: Bool

    init(
      flagOptions: Set<String>,
      valueOptions: Set<String>,
      optionalValueOptions: Set<String>,
      discardedFlagOptions: Set<String>,
      discardedValueOptions: Set<String>,
      discardedOptionalValueOptions: Set<String>,
      attachedValueOptionPrefixes: [String],
      variadicOptions: Set<String> = [],
      discardedVariadicOptions: Set<String> = [],
      discardedAttachedValueOptionPrefixes: [String] = [],
      rejectedOptions: Set<String> = [],
      nonRestorableCommands: Set<String> = [],
      sessionCommands: Set<String> = [],
      scansOptionsPastPositionals: Bool = false
    ) {
      self.flagOptions = flagOptions
      self.valueOptions = valueOptions
      self.optionalValueOptions = optionalValueOptions
      self.discardedFlagOptions = discardedFlagOptions
      self.discardedValueOptions = discardedValueOptions
      self.discardedOptionalValueOptions = discardedOptionalValueOptions
      self.attachedValueOptionPrefixes = attachedValueOptionPrefixes
      self.variadicOptions = variadicOptions
      self.discardedVariadicOptions = discardedVariadicOptions
      self.discardedAttachedValueOptionPrefixes = discardedAttachedValueOptionPrefixes
      self.rejectedOptions = rejectedOptions
      self.nonRestorableCommands = nonRestorableCommands
      self.sessionCommands = sessionCommands
      self.scansOptionsPastPositionals = scansOptionsPastPositionals
    }

    func inherited(from commandLineArguments: [String]) -> [String]? {
      let arguments = agentArguments(from: commandLineArguments)
      var inherited: [String] = []
      var index = 0
      var sawPositional = false
      var sessionCommandFound = false
      var skippedSessionIdentifier = false
      while index < arguments.count {
        let argument = arguments[index]
        switch resolution(in: arguments, at: index) {
        case .discard(let end):
          index = end
        case .inherit(let end):
          inherited.append(contentsOf: arguments[index..<end])
          index = end
        case .reject:
          return nil
        case .stop:
          return inherited
        case .unknownOption:
          guard scansOptionsPastPositionals || sessionCommandFound else { return inherited }
          index += 1
        case .positional:
          if !sawPositional, sessionCommands.contains(argument) {
            sawPositional = true
            sessionCommandFound = true
            index += 1
          } else if !sawPositional, nonRestorableCommands.contains(argument) {
            return nil
          } else if sessionCommandFound, !skippedSessionIdentifier {
            sawPositional = true
            skippedSessionIdentifier = true
            index += 1
          } else if scansOptionsPastPositionals || sessionCommandFound {
            sawPositional = true
            index += 1
          } else {
            return inherited
          }
        }
      }
      return inherited
    }

    private func resolution(in arguments: [String], at index: Int) -> ArgumentResolution {
      let argument = arguments[index]
      if argument == "--" {
        return .stop
      }
      if rejectedOptions.contains(optionName(argument)) {
        return .reject
      }
      if let end = inheritedOptionEnd(in: arguments, at: index) {
        return .inherit(until: end)
      }
      if let end = discardedOptionEnd(in: arguments, at: index) {
        return .discard(until: end)
      }
      return argument.hasPrefix("-") ? .unknownOption : .positional
    }

    private func inheritedOptionEnd(in arguments: [String], at index: Int) -> Int? {
      let argument = arguments[index]
      if flagOptions.contains(argument) {
        return index + 1
      }
      if variadicOptions.contains(argument) {
        return variadicEnd(in: arguments, from: index)
      }
      if valueOptions.contains(argument) {
        return valueEnd(in: arguments, from: index)
      }
      if optionalValueOptions.contains(argument) {
        let valueIndex = index + 1
        return optionalValueFollows(in: arguments, at: valueIndex) ? valueIndex + 1 : valueIndex
      }
      if argument.contains("="), inheritedValueOptions.contains(optionName(argument)) {
        return index + 1
      }
      return attachedValueOptionPrefixes.contains(where: {
        argument.hasPrefix($0) && argument.count > $0.count
      }) ? index + 1 : nil
    }

    private func discardedOptionEnd(in arguments: [String], at index: Int) -> Int? {
      let argument = arguments[index]
      if discardedFlagOptions.contains(argument) {
        return index + 1
      }
      if discardedVariadicOptions.contains(argument) {
        return variadicEnd(in: arguments, from: index)
      }
      if discardedValueOptions.contains(argument) {
        return valueEnd(in: arguments, from: index)
      }
      if discardedOptionalValueOptions.contains(argument) {
        let valueIndex = index + 1
        return optionalValueFollows(in: arguments, at: valueIndex) ? valueIndex + 1 : valueIndex
      }
      if argument.contains("="), discardedOptions.contains(optionName(argument)) {
        return index + 1
      }
      return discardedAttachedValueOptionPrefixes.contains(where: {
        argument.hasPrefix($0) && argument.count > $0.count
      }) ? index + 1 : nil
    }

    private var inheritedValueOptions: Set<String> {
      valueOptions.union(optionalValueOptions).union(variadicOptions)
    }

    private var discardedOptions: Set<String> {
      discardedFlagOptions
        .union(discardedValueOptions)
        .union(discardedOptionalValueOptions)
        .union(discardedVariadicOptions)
    }

    private func agentArguments(from commandLineArguments: [String]) -> [String] {
      guard let executable = commandLineArguments.first else { return [] }
      let executableName = URL(fileURLWithPath: executable).lastPathComponent
      if ["node", "nodejs"].contains(executableName),
        commandLineArguments.count > 1
      {
        return Array(commandLineArguments.dropFirst(2))
      }
      return Array(commandLineArguments.dropFirst())
    }

    private func optionName(_ argument: String) -> String {
      guard let separatorIndex = argument.firstIndex(of: "=") else { return argument }
      return String(argument[..<separatorIndex])
    }

    private func valueEnd(in arguments: [String], from index: Int) -> Int {
      min(index + 2, arguments.count)
    }

    private func variadicEnd(in arguments: [String], from index: Int) -> Int {
      var end = index + 1
      while end < arguments.count,
        !arguments[end].hasPrefix("-"),
        variadicValueCanContinue(arguments[end])
      {
        end += 1
      }
      return end
    }

    private func variadicValueCanContinue(_ value: String) -> Bool {
      guard scansOptionsPastPositionals else { return true }
      return value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil
        || ["/", "~/", "./", "../"].contains(where: value.hasPrefix)
    }

    private func optionalValueFollows(in arguments: [String], at index: Int) -> Bool {
      guard index < arguments.count else { return false }
      let value = arguments[index]
      guard !value.hasPrefix("-") else { return false }
      guard scansOptionsPastPositionals else { return true }
      let following = index + 1 < arguments.count ? arguments[index + 1] : nil
      return value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil
        && (following == nil || value.contains(",") || following?.hasPrefix("-") == true)
    }

    static let claude = Self(
      flagOptions: [
        "--allow-dangerously-skip-permissions",
        "--ax-screen-reader",
        "--bare",
        "--brief",
        "--chrome",
        "--dangerously-skip-permissions",
        "--disable-slash-commands",
        "--exclude-dynamic-system-prompt-sections",
        "--ide",
        "--no-chrome",
        "--safe-mode",
        "--strict-mcp-config",
        "--verbose",
      ],
      valueOptions: [
        "--agent",
        "--agents",
        "--append-system-prompt",
        "--autocompact",
        "--debug-file",
        "--effort",
        "--model",
        "--name",
        "--permission-mode",
        "--plugin-dir",
        "--plugin-url",
        "--remote-control-session-name-prefix",
        "--setting-sources",
        "--settings",
        "--system-prompt",
        "-n",
      ],
      optionalValueOptions: [
        "--debug", "--prompt-suggestions", "--remote-control", "-d",
      ],
      discardedFlagOptions: [
        "--background",
        "--bg",
        "--continue",
        "--fork-session",
        "-c",
      ],
      discardedValueOptions: [
        "--environment",
        "--input-format",
        "--json-schema",
        "--max-budget-usd",
        "--output-format",
        "--session-id",
        "--tmux",
        "--worktree",
        "-w",
      ],
      discardedOptionalValueOptions: ["--cloud", "--from-pr", "--resume", "--teleport", "-r"],
      attachedValueOptionPrefixes: ["-n"],
      variadicOptions: [
        "--add-dir",
        "--allowed-tools",
        "--allowedTools",
        "--betas",
        "--disallowed-tools",
        "--disallowedTools",
        "--mcp-config",
        "--tools",
      ],
      discardedVariadicOptions: ["--file"],
      discardedAttachedValueOptionPrefixes: ["-w"],
      rejectedOptions: ["--no-session-persistence", "--print", "-p"],
      nonRestorableCommands: [
        "agents",
        "api-key",
        "auth",
        "auto-mode",
        "config",
        "doctor",
        "install",
        "mcp",
        "plugin",
        "plugins",
        "rc",
        "remote-control",
        "setup-token",
        "update",
        "upgrade",
      ],
      scansOptionsPastPositionals: true
    )

    static let codex = Self(
      flagOptions: [
        "--approve-for-me",
        "--dangerously-bypass-approvals-and-sandbox",
        "--dangerously-bypass-hook-trust",
        "--no-alt-screen",
        "--oss",
        "--search",
        "--strict-config",
      ],
      valueOptions: [
        "--add-dir",
        "--ask-for-approval",
        "--cd",
        "--config",
        "--disable",
        "--enable",
        "--local-provider",
        "--model",
        "--profile",
        "--sandbox",
        "-C",
        "-a",
        "-c",
        "-m",
        "-p",
        "-s",
      ],
      optionalValueOptions: [],
      discardedFlagOptions: ["--all", "--last"],
      discardedValueOptions: ["--remote", "--remote-auth-token-env"],
      discardedOptionalValueOptions: [],
      attachedValueOptionPrefixes: ["-C", "-a", "-c", "-m", "-p", "-s"],
      discardedVariadicOptions: ["--image", "-i"],
      discardedAttachedValueOptionPrefixes: ["-i"],
      nonRestorableCommands: [
        "app",
        "app-server",
        "a",
        "apply",
        "cloud",
        "completion",
        "debug",
        "e",
        "exec",
        "exec-server",
        "features",
        "fork",
        "help",
        "login",
        "logout",
        "mcp",
        "mcp-server",
        "review",
        "sandbox",
      ],
      sessionCommands: ["fork", "resume"]
    )

    static let pi = Self(
      flagOptions: [
        "--approve",
        "--no-approve",
        "--no-builtin-tools",
        "--no-context-files",
        "--no-extensions",
        "--no-prompt-templates",
        "--no-skills",
        "--no-themes",
        "--no-tools",
        "--offline",
        "--verbose",
        "-a",
        "-na",
        "-nbt",
        "-nc",
        "-ne",
        "-np",
        "-ns",
        "-nt",
      ],
      valueOptions: [
        "--append-system-prompt",
        "--exclude-tools",
        "--extension",
        "--model",
        "--models",
        "--name",
        "--prompt-template",
        "--provider",
        "--session-dir",
        "--skill",
        "--system-prompt",
        "--theme",
        "--thinking",
        "--tools",
        "-e",
        "-n",
        "-t",
        "-xt",
      ],
      optionalValueOptions: [],
      discardedFlagOptions: [
        "--continue", "-c",
      ],
      discardedValueOptions: [
        "--api-key", "--fork", "--resume", "--session", "--session-id", "-r",
      ],
      discardedOptionalValueOptions: [],
      attachedValueOptionPrefixes: ["-e", "-n", "-t", "-xt"],
      rejectedOptions: [
        "--export",
        "--list-models",
        "--mode",
        "--no-session",
        "--print",
        "--prompt",
        "--version",
        "-h",
        "-p",
        "-v",
      ],
      nonRestorableCommands: [
        "config", "help", "install", "list", "login", "logout", "remove", "uninstall",
        "update",
      ]
    )
  }
}
