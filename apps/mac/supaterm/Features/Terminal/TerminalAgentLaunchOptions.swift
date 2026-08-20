import Foundation
import SupatermCLIShared

nonisolated enum TerminalAgentLaunchOptions {
  static func inherited(
    from commandLineArguments: [String],
    agent: SupatermAgentKind
  ) -> [String] {
    schema(for: agent).inherited(from: commandLineArguments)
  }

  private static func schema(for agent: SupatermAgentKind) -> Schema {
    switch agent {
    case .claude: .claude
    case .codex: .codex
    case .pi: .pi
    }
  }

  private struct Schema {
    let flagOptions: Set<String>
    let valueOptions: Set<String>
    let optionalValueOptions: Set<String>
    let discardedFlagOptions: Set<String>
    let discardedValueOptions: Set<String>
    let discardedOptionalValueOptions: Set<String>
    let attachedValueOptionPrefixes: [String]
    let sourceCommands: Set<String>

    func inherited(from commandLineArguments: [String]) -> [String] {
      let arguments = agentArguments(from: commandLineArguments)
      var inherited: [String] = []
      var index = arguments.startIndex
      while index < arguments.endIndex {
        let argument = arguments[index]
        if flagOptions.contains(argument) {
          inherited.append(argument)
          index += 1
          continue
        }
        if valueOptions.contains(argument) {
          let valueIndex = index + 1
          guard valueIndex < arguments.endIndex else { break }
          inherited.append(contentsOf: [argument, arguments[valueIndex]])
          index = valueIndex + 1
          continue
        }
        if optionalValueOptions.contains(argument) {
          inherited.append(argument)
          index += 1
          if index < arguments.endIndex, !arguments[index].hasPrefix("-") {
            inherited.append(arguments[index])
            index += 1
          }
          continue
        }
        if discardedFlagOptions.contains(argument) {
          index += 1
          continue
        }
        if discardedValueOptions.contains(argument) {
          index = min(index + 2, arguments.endIndex)
          continue
        }
        if discardedOptionalValueOptions.contains(argument) {
          index += 1
          if index < arguments.endIndex, !arguments[index].hasPrefix("-") {
            index += 1
          }
          continue
        }
        if let separatorIndex = argument.firstIndex(of: "=") {
          let option = String(argument[..<separatorIndex])
          if valueOptions.contains(option) || optionalValueOptions.contains(option) {
            inherited.append(argument)
            index += 1
            continue
          }
          if discardedValueOptions.contains(option)
            || discardedOptionalValueOptions.contains(option)
          {
            index += 1
            continue
          }
        }
        if attachedValueOptionPrefixes.contains(where: {
          argument.hasPrefix($0) && argument.count > $0.count
        }) {
          inherited.append(argument)
          index += 1
          continue
        }
        if sourceCommands.contains(argument) {
          index += 1
          continue
        }
        break
      }
      return inherited
    }

    private func agentArguments(from commandLineArguments: [String]) -> ArraySlice<String> {
      guard let executable = commandLineArguments.first else { return [] }
      let executableName = URL(fileURLWithPath: executable).lastPathComponent
      if ["node", "nodejs"].contains(executableName),
        commandLineArguments.count > 1
      {
        return commandLineArguments.dropFirst(2)
      }
      return commandLineArguments.dropFirst()
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
        "--tmux",
        "--verbose",
      ],
      valueOptions: [
        "--add-dir",
        "--agent",
        "--agents",
        "--allowed-tools",
        "--allowedTools",
        "--append-system-prompt",
        "--autocompact",
        "--betas",
        "--debug-file",
        "--disallowed-tools",
        "--disallowedTools",
        "--effort",
        "--file",
        "--mcp-config",
        "--model",
        "--name",
        "--permission-mode",
        "--plugin-dir",
        "--plugin-url",
        "--remote-control-session-name-prefix",
        "--setting-sources",
        "--settings",
        "--system-prompt",
        "--tools",
        "-n",
      ],
      optionalValueOptions: [
        "--debug", "--prompt-suggestions", "--remote-control", "--worktree", "-d", "-w",
      ],
      discardedFlagOptions: [
        "--background",
        "--bg",
        "--continue",
        "--fork-session",
        "--no-session-persistence",
        "--print",
        "-c",
        "-p",
      ],
      discardedValueOptions: [
        "--environment",
        "--input-format",
        "--json-schema",
        "--max-budget-usd",
        "--output-format",
        "--session-id",
      ],
      discardedOptionalValueOptions: ["--cloud", "--from-pr", "--resume", "--teleport", "-r"],
      attachedValueOptionPrefixes: ["-n"],
      sourceCommands: []
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
        "--image",
        "--local-provider",
        "--model",
        "--profile",
        "--remote",
        "--remote-auth-token-env",
        "--sandbox",
        "-C",
        "-a",
        "-c",
        "-i",
        "-m",
        "-p",
        "-s",
      ],
      optionalValueOptions: [],
      discardedFlagOptions: ["--all", "--last"],
      discardedValueOptions: [],
      discardedOptionalValueOptions: [],
      attachedValueOptionPrefixes: ["-C", "-a", "-c", "-i", "-m", "-p", "-s"],
      sourceCommands: ["fork", "resume"]
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
        "--api-key",
        "--append-system-prompt",
        "--exclude-tools",
        "--extension",
        "--mode",
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
        "--continue", "--no-session", "--print", "--resume", "-c", "-p", "-r",
      ],
      discardedValueOptions: ["--export", "--fork", "--session", "--session-id"],
      discardedOptionalValueOptions: ["--list-models"],
      attachedValueOptionPrefixes: ["-e", "-n", "-t", "-xt"],
      sourceCommands: ["auth", "config", "install", "list", "remove", "uninstall", "update"]
    )
  }
}
