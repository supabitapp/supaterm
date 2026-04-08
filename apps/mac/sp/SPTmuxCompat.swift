import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

extension SP {
  struct Tmux: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "tmux",
      abstract: "Run tmux-compatible commands against Supaterm.",
      discussion: SPHelp.tmuxDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    @Argument(parsing: .remaining, help: "tmux-compatible arguments.")
    var arguments: [String] = []

    mutating func run() throws {
      if arguments.isEmpty {
        print(Self.helpMessage())
        return
      }
      try SPTmuxCompatibility.run(
        arguments: arguments,
        explicitSocketPath: connection.explicitSocketPath,
        instance: connection.instance
      )
    }
  }

  struct ClaudeTeams: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude-teams",
      abstract: "Launch Claude with Supaterm tmux compatibility enabled.",
      discussion: SPHelp.claudeTeamsDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    @Argument(parsing: .remaining, help: "Arguments to pass through to Claude.")
    var arguments: [String] = []

    mutating func run() throws {
      try SPTeammateLauncher.run(
        arguments: arguments,
        explicitSocketPath: connection.explicitSocketPath,
        instance: connection.instance
      )
    }
  }
}

struct SPRawConnectionOptions: Equatable {
  let explicitSocketPath: String?
  let instance: String?
}

struct SPRawConnectionInvocation: Equatable {
  let connection: SPRawConnectionOptions
  let arguments: [String]

  static func parse(_ arguments: [String]) throws -> Self {
    var explicitSocketPath: String?
    var instance: String?
    var index = 0

    while index < arguments.count {
      let argument = arguments[index]

      if argument == "--" {
        return .init(
          connection: .init(
            explicitSocketPath: explicitSocketPath,
            instance: instance
          ),
          arguments: Array(arguments.dropFirst(index + 1))
        )
      }

      if argument == "--socket" {
        guard index + 1 < arguments.count else {
          throw ValidationError("--socket requires a value.")
        }
        explicitSocketPath = try normalizedConnectionValue(arguments[index + 1], flag: "--socket")
        index += 2
        continue
      }

      if argument.hasPrefix("--socket=") {
        explicitSocketPath = try normalizedConnectionEqualsValue(argument, flag: "--socket")
        index += 1
        continue
      }

      if argument == "--instance" {
        guard index + 1 < arguments.count else {
          throw ValidationError("--instance requires a value.")
        }
        instance = try normalizedConnectionValue(arguments[index + 1], flag: "--instance")
        index += 2
        continue
      }

      if argument.hasPrefix("--instance=") {
        instance = try normalizedConnectionEqualsValue(argument, flag: "--instance")
        index += 1
        continue
      }

      return .init(
        connection: .init(
          explicitSocketPath: explicitSocketPath,
          instance: instance
        ),
        arguments: Array(arguments.dropFirst(index))
      )
    }

    return .init(
      connection: .init(
        explicitSocketPath: explicitSocketPath,
        instance: instance
      ),
      arguments: []
    )
  }
}

protocol SPTmuxTransport {
  func send(_ request: SupatermSocketRequest) throws -> SupatermSocketResponse
}

extension SPSocketClient: SPTmuxTransport {}

enum SPTmuxCompatibility {
  static func run(
    arguments: [String],
    explicitSocketPath: String? = nil,
    instance: String? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws {
    SPTmuxTrace.write(
      category: "sp.tmux",
      event: "invoke",
      fields: [
        "arguments": arguments.joined(separator: "\u{1f}"),
        "socket_path": explicitSocketPath,
        "instance": instance,
        "tmux": environment["TMUX"],
        "tmux_pane": environment["TMUX_PANE"],
      ],
      environment: environment
    )
    let client = try socketClient(
      path: explicitSocketPath,
      instance: instance
    )
    try SPTmuxCommandRunner(
      transport: client,
      environment: environment
    ).run(arguments: arguments)
  }
}

enum SPTeammateLauncher {
  struct FocusedContext: Equatable {
    let windowIndex: Int
    let spaceIndex: Int
    let spaceID: UUID
    let tabIndex: Int
    let tabID: UUID
    let paneIndex: Int
    let paneID: UUID
  }

  static func run(
    arguments: [String],
    explicitSocketPath: String? = nil,
    instance: String? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws {
    let resolvedTarget = try resolvedSocketTarget(
      explicitPath: explicitSocketPath,
      instance: instance,
      alwaysDiscover: true
    )
    let client = try SPSocketClient(path: resolvedTarget.path)
    let focusedContext = try SPTmuxCommandRunner(
      transport: client,
      environment: environment
    ).focusedContext()
    let launcher = try configuredProcess(
      arguments: arguments,
      socketPath: resolvedTarget.path,
      focusedContext: focusedContext,
      environment: environment
    )
    try execProcess(launcher)
  }

  static func configuredProcess(
    arguments: [String],
    socketPath: String,
    focusedContext: FocusedContext,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    executablePath: String? = nil,
    cliExecutablePath: String? = nil,
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
  ) throws -> Process {
    let resolvedExecutablePath =
      executablePath
      ?? resolveClaudeExecutable(searchPath: environment["PATH"])
    guard let resolvedExecutablePath else {
      throw ValidationError("Unable to find a Claude executable on PATH.")
    }

    let resolvedCLIExecutablePath = try resolvedCLIPath(
      cliExecutablePath: cliExecutablePath,
      environment: environment
    )
    let shimDirectory = try ensureTmuxShimDirectory(
      cliExecutablePath: resolvedCLIExecutablePath,
      homeDirectoryURL: homeDirectoryURL
    )

    var processEnvironment = environment
    processEnvironment[SupatermCLIEnvironment.socketPathKey] = socketPath
    processEnvironment[SupatermCLIEnvironment.surfaceIDKey] = focusedContext.paneID.uuidString
    processEnvironment[SupatermCLIEnvironment.tabIDKey] = focusedContext.tabID.uuidString
    processEnvironment["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1"
    processEnvironment["TERM"] = trimmedNonEmpty(environment["TERM"]) ?? "xterm-256color"
    processEnvironment["COLORTERM"] = trimmedNonEmpty(environment["COLORTERM"]) ?? "truecolor"
    processEnvironment["TERM_PROGRAM"] = "ghostty"
    if let termProgramVersion = trimmedNonEmpty(environment["TERM_PROGRAM_VERSION"]) {
      processEnvironment["TERM_PROGRAM_VERSION"] = termProgramVersion
    } else {
      processEnvironment.removeValue(forKey: "TERM_PROGRAM_VERSION")
    }
    processEnvironment["TMUX"] =
      "/tmp/sp-tmux/\(focusedContext.spaceID.uuidString.lowercased()),\(focusedContext.tabID.uuidString.lowercased()),\(focusedContext.paneID.uuidString.lowercased())"
    processEnvironment["TMUX_PANE"] = "%\(focusedContext.paneID.uuidString.lowercased())"
    processEnvironment["PATH"] = prependPathEntries([shimDirectory.path], to: environment["PATH"])

    SPTmuxTrace.write(
      category: "sp.claude-teams",
      event: "configured_process",
      fields: [
        "claude_path": resolvedExecutablePath,
        "cli_path": resolvedCLIExecutablePath,
        "shim_directory": shimDirectory.path,
        "socket_path": socketPath,
        "focused_space_id": focusedContext.spaceID.uuidString.lowercased(),
        "focused_tab_id": focusedContext.tabID.uuidString.lowercased(),
        "focused_pane_id": focusedContext.paneID.uuidString.lowercased(),
        "arguments": teammateLaunchArguments(commandArgs: arguments).joined(separator: "\u{1f}"),
      ],
      environment: processEnvironment
    )

    let process = Process()
    process.executableURL = URL(fileURLWithPath: resolvedExecutablePath, isDirectory: false)
    process.arguments = teammateLaunchArguments(commandArgs: arguments)
    process.environment = processEnvironment
    process.standardInput = FileHandle.standardInput
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError
    return process
  }

  static func teammateLaunchArguments(commandArgs: [String]) -> [String] {
    guard !hasExplicitTeammateMode(commandArgs: commandArgs) else {
      return commandArgs
    }
    return ["--teammate-mode", "auto"] + commandArgs
  }

  static func hasExplicitTeammateMode(commandArgs: [String]) -> Bool {
    commandArgs.contains { argument in
      argument == "--teammate-mode" || argument.hasPrefix("--teammate-mode=")
    }
  }

  static func resolveClaudeExecutable(searchPath: String?) -> String? {
    for entry in searchPath?.split(separator: ":").map(String.init) ?? [] where !entry.isEmpty {
      let candidate = URL(fileURLWithPath: entry, isDirectory: true)
        .appendingPathComponent("claude", isDirectory: false)
        .path
      if FileManager.default.isExecutableFile(atPath: candidate) {
        return candidate
      }
    }
    return nil
  }

  static func resolvedCLIPath(
    cliExecutablePath: String?,
    environment: [String: String]
  ) throws -> String {
    let candidates = [
      cliExecutablePath,
      environment[SupatermCLIEnvironment.cliPathKey],
      CommandLine.arguments.first,
    ].compactMap { $0 }

    for candidate in candidates {
      let standardized = URL(fileURLWithPath: candidate, isDirectory: false)
        .standardizedFileURL
        .path
      if FileManager.default.isExecutableFile(atPath: standardized) {
        return standardized
      }
    }

    throw ValidationError("Unable to resolve the sp executable path.")
  }

  static func ensureTmuxShimDirectory(
    cliExecutablePath: String,
    homeDirectoryURL: URL
  ) throws -> URL {
    let directoryURL = spPrivateDirectory(homeDirectoryURL: homeDirectoryURL)
      .appendingPathComponent("shims", isDirectory: true)
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    let shimURL = directoryURL.appendingPathComponent("tmux", isDirectory: false)
    let script = "#!/bin/sh\nexec \(shellQuoted(cliExecutablePath)) tmux \"$@\"\n"
    let currentContents = try? String(contentsOf: shimURL, encoding: .utf8)
    if currentContents != script {
      try script.write(to: shimURL, atomically: true, encoding: .utf8)
      try setExecutablePermissions(at: shimURL)
    }
    return directoryURL
  }
}

private func execProcess(_ process: Process) throws -> Never {
  guard let executablePath = process.executableURL?.path else {
    throw ValidationError("Unable to resolve the Claude executable path.")
  }

  let arguments = [executablePath] + (process.arguments ?? [])
  let environment = process.environment ?? ProcessInfo.processInfo.environment
  let argv = makeCStringArray(arguments)
  let envp = makeCStringArray(
    environment.keys.sorted().map { key in
      "\(key)=\(environment[key] ?? "")"
    }
  )
  defer {
    freeCStringArray(argv)
    freeCStringArray(envp)
  }

  execve(executablePath, argv, envp)
  let message = String(cString: strerror(errno))
  throw ValidationError("Failed to launch Claude: \(message)")
}

private func makeCStringArray(_ values: [String]) -> UnsafeMutablePointer<
  UnsafeMutablePointer<CChar>?
> {
  let pointer = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>.allocate(
    capacity: values.count + 1)
  for (index, value) in values.enumerated() {
    pointer[index] = strdup(value)
  }
  pointer[values.count] = nil
  return pointer
}

private func freeCStringArray(_ pointer: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) {
  var index = 0
  while let value = pointer[index] {
    free(value)
    index += 1
  }
  pointer.deallocate()
}

struct SPTmuxCommandRunner {
  let transport: any SPTmuxTransport
  let environment: [String: String]

  var context: SupatermCLIContext? {
    SupatermCLIContext(environment: environment)
  }

  func run(arguments: [String]) throws {
    let (command, rawArguments) = try splitTmuxCommand(arguments)
    trace(
      "command",
      fields: [
        "command": command,
        "arguments": rawArguments.joined(separator: "\u{1f}"),
        "context_surface_id": context?.surfaceID.uuidString.lowercased(),
        "tmux": environment["TMUX"],
        "tmux_pane": environment["TMUX_PANE"],
      ]
    )

    switch command {
    case "new-session", "new":
      try runNewSession(rawArguments)

    case "new-window", "neww":
      try runNewWindow(rawArguments)

    case "split-window", "splitw":
      try runSplitWindow(rawArguments)

    case "select-window", "selectw":
      try runSelectWindow(rawArguments)

    case "select-pane", "selectp":
      try runSelectPane(rawArguments)

    case "kill-window", "killw":
      try runKillWindow(rawArguments)

    case "kill-pane", "killp":
      try runKillPane(rawArguments)

    case "send-keys", "send":
      try runSendKeys(rawArguments)

    case "capture-pane", "capturep":
      try runCapturePane(rawArguments)

    case "display-message", "display", "displayp":
      try runDisplayMessage(rawArguments)

    case "list-windows", "lsw":
      try runListWindows(rawArguments)

    case "list-panes", "lsp":
      try runListPanes(rawArguments)

    case "rename-window", "renamew":
      try runRenameWindow(rawArguments)

    case "resize-pane", "resizep":
      try runResizePane(rawArguments)

    case "wait-for":
      try runWaitFor(rawArguments)

    case "last-pane":
      try runLastPane(rawArguments)

    case "show-buffer", "showb":
      try runShowBuffer(rawArguments)

    case "save-buffer", "saveb":
      try runSaveBuffer(rawArguments)

    case "set-buffer":
      try runSetBuffer(rawArguments)

    case "list-buffers":
      try runListBuffers(rawArguments)

    case "paste-buffer":
      try runPasteBuffer(rawArguments)

    case "has-session", "has":
      _ = try topology().resolveSpace(raw: parsedTargetValue(rawArguments))

    case "last-window":
      try runLastWindow(rawArguments)

    case "next-window":
      try runNextWindow(rawArguments)

    case "previous-window":
      try runPreviousWindow(rawArguments)

    case "set-hook":
      try runSetHook(rawArguments)

    case "select-layout":
      try runSelectLayout(rawArguments)

    case "set-option", "set", "set-window-option", "setw", "source-file", "refresh-client",
      "attach-session", "detach-client":
      return

    default:
      throw ValidationError("Unsupported tmux compatibility command: \(command)")
    }
  }

  func focusedContext() throws -> SPTeammateLauncher.FocusedContext {
    let current = try topology().current
    return .init(
      windowIndex: current.window.index,
      spaceIndex: current.space.index,
      spaceID: current.space.id,
      tabIndex: current.tab.index,
      tabID: current.tab.id,
      paneIndex: current.pane.index,
      paneID: current.pane.id
    )
  }

  private func runNewSession(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-c", "-F", "-n", "-s", "-t"],
      boolFlags: ["-A", "-d", "-P"]
    )
    if parsed.hasFlag("-A") {
      throw ValidationError("new-session -A is not supported.")
    }

    let previousSpace = try topology().resolveSpace(raw: nil)
    guard
      let name = trimmedNonEmpty(parsed.value("-n") ?? parsed.value("-s"))
    else {
      throw ValidationError("new-session requires -n or -s for the new space name.")
    }
    let created = try send(
      .createSpace(
        .init(
          name: name,
          target: .init(targetWindowIndex: previousSpace.window.index)
        )
      ),
      as: SupatermCreateSpaceResult.self
    )

    if let text = tmuxShellCommandText(commandTokens: parsed.positional, cwd: parsed.value("-c")) {
      let wrappedText = wrappedTeammatePaneCommand(
        text,
        spaceID: created.target.spaceID,
        tabID: created.tabID,
        paneID: created.paneID,
        environment: environment
      )
      traceSendText(
        event: "new_session_send_text",
        target: .init(
          targetWindowIndex: created.target.windowIndex,
          targetSpaceIndex: created.target.spaceIndex,
          targetTabIndex: created.tabIndex,
          targetPaneIndex: created.paneIndex
        ),
        text: wrappedText,
        sourceText: text
      )
      _ = try send(
        .sendText(
          .init(
            target: .init(
              targetWindowIndex: created.target.windowIndex,
              targetSpaceIndex: created.target.spaceIndex,
              targetTabIndex: created.tabIndex,
              targetPaneIndex: created.paneIndex
            ),
            text: wrappedText
          )
        ),
        as: SupatermSendTextResult.self
      )
    }

    if previousSpace.space.id != created.target.spaceID {
      _ = try send(
        .selectSpace(
          .init(
            targetWindowIndex: previousSpace.window.index,
            targetSpaceIndex: previousSpace.space.index
          )
        ),
        as: SupatermSelectSpaceResult.self
      )
    }

    if parsed.hasFlag("-P") {
      let createdPane = try topology().locatePane(
        windowIndex: created.target.windowIndex,
        spaceIndex: created.target.spaceIndex,
        tabIndex: created.tabIndex,
        paneIndex: created.paneIndex
      )
      let context = formatContext(for: createdPane)
      let fallback = "$\(created.target.spaceID.uuidString.lowercased())"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runNewWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-c", "-F", "-n", "-t"],
      boolFlags: ["-d", "-P"]
    )
    let targetSpace = try topology().resolveSpace(raw: parsed.value("-t"))
    let command = tmuxShellCommandText(commandTokens: parsed.positional, cwd: parsed.value("-c"))
    let created = try send(
      .newTab(
        .init(
          command: nil,
          cwd: try resolvedWorkingDirectory(parsed.value("-c")),
          focus: false,
          targetWindowIndex: targetSpace.window.index,
          targetSpaceIndex: targetSpace.space.index
        )
      ),
      as: SupatermNewTabResult.self
    )

    if let title = trimmedNonEmpty(parsed.value("-n")) {
      _ = try send(
        .renameTab(
          .init(
            target: .init(
              targetWindowIndex: created.windowIndex,
              targetSpaceIndex: created.spaceIndex,
              targetTabIndex: created.tabIndex
            ),
            title: title
          )
        ),
        as: SupatermRenameTabResult.self
      )
    }

    if let command {
      let wrappedText = wrappedTeammatePaneCommand(
        command,
        spaceID: created.spaceID,
        tabID: created.tabID,
        paneID: created.paneID,
        environment: environment
      )
      traceSendText(
        event: "new_window_send_text",
        target: .init(
          targetWindowIndex: created.windowIndex,
          targetSpaceIndex: created.spaceIndex,
          targetTabIndex: created.tabIndex,
          targetPaneIndex: created.paneIndex
        ),
        text: wrappedText,
        sourceText: command
      )
      _ = try send(
        .sendText(
          .init(
            target: .init(
              targetWindowIndex: created.windowIndex,
              targetSpaceIndex: created.spaceIndex,
              targetTabIndex: created.tabIndex,
              targetPaneIndex: created.paneIndex
            ),
            text: wrappedText
          )
        ),
        as: SupatermSendTextResult.self
      )
    }

    if parsed.hasFlag("-P") {
      let createdPane = try topology().locatePane(
        windowIndex: created.windowIndex,
        spaceIndex: created.spaceIndex,
        tabIndex: created.tabIndex,
        paneIndex: created.paneIndex
      )
      let context = formatContext(for: createdPane)
      let fallback = context["window_id"] ?? "@\(created.tabID.uuidString.lowercased())"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runSplitWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-c", "-F", "-l", "-t"],
      boolFlags: ["-P", "-b", "-d", "-h", "-v"]
    )
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let command = tmuxShellCommandText(commandTokens: parsed.positional, cwd: parsed.value("-c"))
    let direction: SupatermPaneDirection =
      if parsed.hasFlag("-h") {
        parsed.hasFlag("-b") ? .left : .right
      } else {
        parsed.hasFlag("-b") ? .up : .down
      }

    let created = try send(
      .newPane(
        .init(
          command: nil,
          direction: direction,
          focus: false,
          equalize: false,
          targetWindowIndex: targetPane.window.index,
          targetSpaceIndex: targetPane.space.index,
          targetTabIndex: targetPane.tab.index,
          targetPaneIndex: targetPane.pane.index
        )
      ),
      as: SupatermNewPaneResult.self
    )

    if let sizeRequest = try tmuxSetPaneSizeRequest(
      rawAmount: parsed.value("-l"),
      axis: tmuxPaneAxis(for: direction),
      target: .init(
        targetWindowIndex: created.windowIndex,
        targetSpaceIndex: created.spaceIndex,
        targetTabIndex: created.tabIndex,
        targetPaneIndex: created.paneIndex
      )
    ) {
      _ = try send(
        .setPaneSize(sizeRequest),
        as: SupatermSetPaneSizeResult.self
      )
    }

    if let command {
      let wrappedText = wrappedTeammatePaneCommand(
        command,
        spaceID: created.spaceID,
        tabID: created.tabID,
        paneID: created.paneID,
        environment: environment
      )
      traceSendText(
        event: "split_window_send_text",
        target: .init(
          targetWindowIndex: created.windowIndex,
          targetSpaceIndex: created.spaceIndex,
          targetTabIndex: created.tabIndex,
          targetPaneIndex: created.paneIndex
        ),
        text: wrappedText,
        sourceText: command
      )
      _ = try send(
        .sendText(
          .init(
            target: .init(
              targetWindowIndex: created.windowIndex,
              targetSpaceIndex: created.spaceIndex,
              targetTabIndex: created.tabIndex,
              targetPaneIndex: created.paneIndex
            ),
            text: wrappedText
          )
        ),
        as: SupatermSendTextResult.self
      )
    }

    if parsed.hasFlag("-P") {
      let createdPane = try topology().locatePane(
        windowIndex: created.windowIndex,
        spaceIndex: created.spaceIndex,
        tabIndex: created.tabIndex,
        paneIndex: created.paneIndex
      )
      let context = formatContext(for: createdPane)
      let fallback = context["pane_id"] ?? "%\(created.paneID.uuidString.lowercased())"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runSelectWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    if let target = parsed.value("-t"), isLastSelector(target) {
      try runLastWindow([])
      return
    }
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    _ = try send(
      .selectTab(
        .init(
          targetWindowIndex: targetTab.window.index,
          targetSpaceIndex: targetTab.space.index,
          targetTabIndex: targetTab.tab.index
        )
      ),
      as: SupatermSelectTabResult.self
    )
  }

  private func runSelectPane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments, valueFlags: ["-P", "-T", "-t"], boolFlags: [])
    if parsed.value("-P") != nil || parsed.value("-T") != nil {
      return
    }
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    _ = try send(
      .focusPane(
        .init(
          targetWindowIndex: targetPane.window.index,
          targetSpaceIndex: targetPane.space.index,
          targetTabIndex: targetPane.tab.index,
          targetPaneIndex: targetPane.pane.index
        )
      ),
      as: SupatermFocusPaneResult.self
    )
  }

  private func runKillWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    _ = try send(
      .closeTab(
        .init(
          targetWindowIndex: targetTab.window.index,
          targetSpaceIndex: targetTab.space.index,
          targetTabIndex: targetTab.tab.index
        )
      ),
      as: SupatermCloseTabResult.self
    )
  }

  private func runKillPane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    _ = try send(
      .closePane(
        .init(
          targetWindowIndex: targetPane.window.index,
          targetSpaceIndex: targetPane.space.index,
          targetTabIndex: targetPane.tab.index,
          targetPaneIndex: targetPane.pane.index
        )
      ),
      as: SupatermClosePaneResult.self
    )
  }

  private func runSendKeys(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: ["-l"])
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let text = tmuxSendKeysText(from: parsed.positional, literal: parsed.hasFlag("-l"))
    guard !text.isEmpty else {
      return
    }
    let target = SupatermPaneTargetRequest(
      targetWindowIndex: targetPane.window.index,
      targetSpaceIndex: targetPane.space.index,
      targetTabIndex: targetPane.tab.index,
      targetPaneIndex: targetPane.pane.index
    )
    traceSendText(
      event: "send_keys_text",
      target: target,
      text: text
    )
    _ = try send(
      .sendText(
        .init(
          target: target,
          text: text
        )
      ),
      as: SupatermSendTextResult.self
    )
  }

  private func runCapturePane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-E", "-S", "-t"],
      boolFlags: ["-J", "-N", "-p"]
    )
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let lines: Int? = {
      guard let start = parsed.value("-S"), let value = Int(start), value < 0 else {
        return nil
      }
      return abs(value)
    }()
    let result = try send(
      .capturePane(
        .init(
          lines: lines,
          scope: .scrollback,
          target: .init(
            targetWindowIndex: targetPane.window.index,
            targetSpaceIndex: targetPane.space.index,
            targetTabIndex: targetPane.tab.index,
            targetPaneIndex: targetPane.pane.index
          )
        )
      ),
      as: SupatermCapturePaneResult.self
    )

    if parsed.hasFlag("-p") {
      print(result.text)
    } else {
      var store = loadTmuxCompatStore()
      store.buffers["default"] = result.text
      try saveTmuxCompatStore(store)
    }
  }

  private func runDisplayMessage(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments, valueFlags: ["-F", "-t"], boolFlags: ["-p"])
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let format =
      parsed.positional.isEmpty ? parsed.value("-F") : parsed.positional.joined(separator: " ")
    let rendered = renderFormat(format, context: formatContext(for: targetPane), fallback: "")
    if parsed.hasFlag("-p") || !rendered.isEmpty {
      print(rendered)
    }
  }

  private func runListWindows(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-F", "-t"], boolFlags: [])
    let targetSpace = try topology().resolveSpace(raw: parsed.value("-t"))
    for tab in targetSpace.space.tabs {
      let location = SPTmuxTopology.TabLocation(
        window: targetSpace.window,
        space: targetSpace.space,
        tab: tab
      )
      let context = formatContext(for: location)
      let fallback = "\(tab.index) \(tab.title)"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runListPanes(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-F", "-t"], boolFlags: [])
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    for pane in targetTab.tab.panes {
      let location = SPTmuxTopology.PaneLocation(
        window: targetTab.window,
        space: targetTab.space,
        tab: targetTab.tab,
        pane: pane
      )
      let context = formatContext(for: location)
      let fallback = context["pane_id"] ?? "%\(pane.id.uuidString.lowercased())"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runRenameWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let title = parsed.positional.joined(separator: " ").trimmingCharacters(
      in: .whitespacesAndNewlines)
    guard !title.isEmpty else {
      throw ValidationError("rename-window requires a title.")
    }
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    _ = try send(
      .renameTab(
        .init(
          target: .init(
            targetWindowIndex: targetTab.window.index,
            targetSpaceIndex: targetTab.space.index,
            targetTabIndex: targetTab.tab.index
          ),
          title: title
        )
      ),
      as: SupatermRenameTabResult.self
    )
  }

  private func runResizePane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-t", "-x", "-y"],
      boolFlags: ["-D", "-L", "-R", "-U"]
    )
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let target = SupatermPaneTargetRequest(
      targetWindowIndex: targetPane.window.index,
      targetSpaceIndex: targetPane.space.index,
      targetTabIndex: targetPane.tab.index,
      targetPaneIndex: targetPane.pane.index
    )
    let sizeRequest =
      try tmuxSetPaneSizeRequest(
        rawAmount: parsed.value("-x"),
        axis: .horizontal,
        target: target
      )
      ?? tmuxSetPaneSizeRequest(
        rawAmount: parsed.value("-y"),
        axis: .vertical,
        target: target
      )
    if let sizeRequest {
      _ = try send(
        .setPaneSize(sizeRequest),
        as: SupatermSetPaneSizeResult.self
      )
      return
    }
    guard let direction = tmuxResizeDirection(flags: parsed.flags) else {
      return
    }
    let rawAmount = (parsed.value("-x") ?? parsed.value("-y") ?? "5")
      .replacingOccurrences(of: "%", with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let amount = min(UInt16.max, UInt16(max(1, Int(rawAmount) ?? 5)))
    _ = try send(
      .resizePane(
        .init(
          amount: amount,
          direction: direction,
          target: target
        )
      ),
      as: SupatermResizePaneResult.self
    )
  }

  private func runSelectLayout(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: ["-E"])
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    let target = SupatermTabTargetRequest(
      targetWindowIndex: targetTab.window.index,
      targetSpaceIndex: targetTab.space.index,
      targetTabIndex: targetTab.tab.index
    )
    let layout = parsed.positional.first?.trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    switch layout {
    case nil, "", "tile", "tiled":
      _ = try send(
        .tilePanes(target),
        as: SupatermTilePanesResult.self
      )
    case "main-vertical":
      _ = try send(
        .mainVerticalPanes(target),
        as: SupatermMainVerticalPanesResult.self
      )
    default:
      _ = try send(
        .equalizePanes(target),
        as: SupatermEqualizePanesResult.self
      )
    }
  }

  private func tmuxSetPaneSizeRequest(
    rawAmount: String?,
    axis: SupatermPaneAxis,
    target: SupatermPaneTargetRequest
  ) throws -> SupatermSetPaneSizeRequest? {
    guard let rawAmount = rawAmount?.trimmingCharacters(in: .whitespacesAndNewlines),
      !rawAmount.isEmpty
    else {
      return nil
    }
    let unit: SupatermPaneSizeUnit = rawAmount.hasSuffix("%") ? .percent : .cells
    let amountString =
      unit == .percent
      ? String(rawAmount.dropLast())
      : rawAmount
    guard let amount = Double(amountString), amount > 0 else {
      throw ValidationError("Invalid pane size: \(rawAmount).")
    }
    return .init(amount: amount, axis: axis, target: target, unit: unit)
  }

  private func runWaitFor(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["--timeout"],
      boolFlags: ["-S", "--signal"]
    )
    guard let name = parsed.positional.first.flatMap(trimmedNonEmpty) else {
      throw ValidationError("wait-for requires a name.")
    }
    let signalURL = tmuxWaitForSignalURL(name: name)
    if parsed.hasFlag("-S") || parsed.hasFlag("--signal") {
      try FileManager.default.createDirectory(
        at: signalURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      FileManager.default.createFile(atPath: signalURL.path, contents: Data())
      print("OK")
      return
    }

    let timeout = Double(parsed.value("--timeout") ?? "30") ?? 30
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if FileManager.default.fileExists(atPath: signalURL.path) {
        try? FileManager.default.removeItem(at: signalURL)
        print("OK")
        return
      }
      usleep(50_000)
    }

    if FileManager.default.fileExists(atPath: signalURL.path) {
      try? FileManager.default.removeItem(at: signalURL)
      print("OK")
      return
    }

    throw ValidationError("wait-for timed out waiting for '\(name)'.")
  }

  private func runLastPane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    _ = try send(
      .lastPane(
        .init(
          targetWindowIndex: targetPane.window.index,
          targetSpaceIndex: targetPane.space.index,
          targetTabIndex: targetPane.tab.index,
          targetPaneIndex: targetPane.pane.index
        )
      ),
      as: SupatermFocusPaneResult.self
    )
  }

  private func runShowBuffer(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-b"], boolFlags: [])
    let name = parsed.value("-b") ?? "default"
    if let buffer = loadTmuxCompatStore().buffers[name] {
      print(buffer)
    }
  }

  private func runSaveBuffer(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-b"], boolFlags: [])
    let name = parsed.value("-b") ?? "default"
    let store = loadTmuxCompatStore()
    guard let buffer = store.buffers[name] else {
      throw ValidationError("Buffer not found: \(name).")
    }
    if let path = parsed.positional.last.flatMap(trimmedNonEmpty) {
      try buffer.write(toFile: resolvePath(path), atomically: true, encoding: .utf8)
    } else {
      print(buffer)
    }
  }

  private func runSetBuffer(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments, valueFlags: ["-b", "--name"], boolFlags: [])
    let name = parsed.value("-b") ?? parsed.value("--name") ?? "default"
    let content = parsed.positional.joined(separator: " ").trimmingCharacters(
      in: .whitespacesAndNewlines)
    guard !content.isEmpty else {
      throw ValidationError("set-buffer requires text.")
    }
    var store = loadTmuxCompatStore()
    store.buffers[name] = content
    try saveTmuxCompatStore(store)
    print("OK")
  }

  private func runListBuffers(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: [], boolFlags: [])
    guard parsed.positional.isEmpty else {
      throw ValidationError("list-buffers does not accept positional arguments.")
    }
    let store = loadTmuxCompatStore()
    if store.buffers.isEmpty {
      print("No buffers")
      return
    }
    for name in store.buffers.keys.sorted() {
      let size = store.buffers[name]?.count ?? 0
      print("\(name)\t\(size)")
    }
  }

  private func runPasteBuffer(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-b", "-t"], boolFlags: [])
    let name = parsed.value("-b") ?? "default"
    let store = loadTmuxCompatStore()
    guard let buffer = store.buffers[name] else {
      throw ValidationError("Buffer not found: \(name).")
    }
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    _ = try send(
      .sendText(
        .init(
          target: .init(
            targetWindowIndex: targetPane.window.index,
            targetSpaceIndex: targetPane.space.index,
            targetTabIndex: targetPane.tab.index,
            targetPaneIndex: targetPane.pane.index
          ),
          text: buffer
        )
      ),
      as: SupatermSendTextResult.self
    )
  }

  private func runLastWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetSpace = try topology().resolveSpace(raw: parsed.value("-t"))
    _ = try send(
      .lastTab(
        .init(
          targetWindowIndex: targetSpace.window.index,
          targetSpaceIndex: targetSpace.space.index
        )
      ),
      as: SupatermSelectTabResult.self
    )
  }

  private func runNextWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetSpace = try topology().resolveSpace(raw: parsed.value("-t"))
    _ = try send(
      .nextTab(
        .init(
          targetWindowIndex: targetSpace.window.index,
          targetSpaceIndex: targetSpace.space.index
        )
      ),
      as: SupatermSelectTabResult.self
    )
  }

  private func runPreviousWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetSpace = try topology().resolveSpace(raw: parsed.value("-t"))
    _ = try send(
      .previousTab(
        .init(
          targetWindowIndex: targetSpace.window.index,
          targetSpaceIndex: targetSpace.space.index
        )
      ),
      as: SupatermSelectTabResult.self
    )
  }

  private func runSetHook(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: [],
      boolFlags: ["--list", "--unset"]
    )
    var store = loadTmuxCompatStore()

    if parsed.hasFlag("--list") {
      if store.hooks.isEmpty {
        print("No hooks configured")
        return
      }
      for event in store.hooks.keys.sorted() {
        print("\(event) -> \(store.hooks[event] ?? "")")
      }
      return
    }

    if parsed.hasFlag("--unset") {
      guard let event = parsed.positional.last.flatMap(trimmedNonEmpty) else {
        throw ValidationError("set-hook --unset requires an event name.")
      }
      store.hooks.removeValue(forKey: event)
      try saveTmuxCompatStore(store)
      print("OK")
      return
    }

    guard let event = parsed.positional.first.flatMap(trimmedNonEmpty) else {
      throw ValidationError("set-hook requires <event> <command>.")
    }
    let commandText = parsed.positional.dropFirst().joined(separator: " ").trimmingCharacters(
      in: .whitespacesAndNewlines)
    guard !commandText.isEmpty else {
      throw ValidationError("set-hook requires <event> <command>.")
    }
    store.hooks[event] = commandText
    try saveTmuxCompatStore(store)
    print("OK")
  }

  private func topology() throws -> SPTmuxTopology {
    let snapshot = try send(
      .debug(.init(context: context)),
      as: SupatermAppDebugSnapshot.self
    )
    return try .init(snapshot: snapshot, contextPaneID: context?.surfaceID)
  }

  private func formatContext(for pane: SPTmuxTopology.PaneLocation) -> [String: String] {
    [
      "session_id": "$\(pane.space.id.uuidString.lowercased())",
      "session_name": pane.space.name,
      "session_uuid": pane.space.id.uuidString.lowercased(),
      "window_active": pane.tab.isSelected ? "1" : "0",
      "window_id": "@\(pane.tab.id.uuidString.lowercased())",
      "window_index": String(pane.tab.index),
      "window_name": pane.tab.title,
      "window_uuid": pane.tab.id.uuidString.lowercased(),
      "pane_active": pane.pane.isFocused ? "1" : "0",
      "pane_id": "%\(pane.pane.id.uuidString.lowercased())",
      "pane_index": String(pane.pane.index),
      "pane_title": pane.pane.displayTitle,
      "pane_uuid": pane.pane.id.uuidString.lowercased(),
    ]
  }

  private func formatContext(for tab: SPTmuxTopology.TabLocation) -> [String: String] {
    [
      "session_id": "$\(tab.space.id.uuidString.lowercased())",
      "session_name": tab.space.name,
      "session_uuid": tab.space.id.uuidString.lowercased(),
      "window_active": tab.tab.isSelected ? "1" : "0",
      "window_id": "@\(tab.tab.id.uuidString.lowercased())",
      "window_index": String(tab.tab.index),
      "window_name": tab.tab.title,
      "window_uuid": tab.tab.id.uuidString.lowercased(),
    ]
  }

  private func renderFormat(
    _ format: String?,
    context: [String: String],
    fallback: String
  ) -> String {
    guard let format, !format.isEmpty else {
      return fallback
    }
    var rendered = format
    for (key, value) in context {
      rendered = rendered.replacingOccurrences(of: "#{\(key)}", with: value)
    }
    rendered = rendered.replacingOccurrences(
      of: "#\\{[^}]+\\}",
      with: "",
      options: .regularExpression
    )
    let trimmed = rendered.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? fallback : trimmed
  }

  private func send<Result: Decodable>(
    _ request: SupatermSocketRequest,
    as type: Result.Type
  ) throws -> Result {
    trace(
      "socket_request",
      fields: [
        "method": request.method,
        "request_id": request.id,
      ]
    )
    let response = try transport.send(request)
    guard response.ok else {
      trace(
        "socket_error",
        fields: [
          "method": request.method,
          "request_id": request.id,
          "message": response.error?.message,
        ]
      )
      throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
    }
    trace(
      "socket_response",
      fields: [
        "method": request.method,
        "request_id": request.id,
      ]
    )
    return try response.decodeResult(type)
  }

  private func trace(_ event: String, fields: [String: String?] = [:]) {
    SPTmuxTrace.write(
      category: "sp.tmux",
      event: event,
      fields: fields,
      environment: environment
    )
  }

  private func traceSendText(
    event: String,
    target: SupatermPaneTargetRequest,
    text: String,
    sourceText: String? = nil
  ) {
    trace(
      event,
      fields: sendTextTraceFields(
        target: target,
        text: text,
        sourceText: sourceText
      )
    )
  }
}

private struct SPTmuxArgumentParser {
  struct ParsedArguments: Equatable {
    var flags: Set<String> = []
    var options: [String: [String]] = [:]
    var positional: [String] = []

    func hasFlag(_ flag: String) -> Bool {
      flags.contains(flag)
    }

    func value(_ flag: String) -> String? {
      options[flag]?.last
    }
  }

  static func parse(
    _ arguments: [String],
    valueFlags: Set<String>,
    boolFlags: Set<String>
  ) throws -> ParsedArguments {
    var parsed = ParsedArguments()
    var index = 0

    while index < arguments.count {
      let argument = arguments[index]

      if argument == "--" {
        parsed.positional.append(contentsOf: arguments.dropFirst(index + 1))
        break
      }

      if argument.hasPrefix("--"), argument.count > 2 {
        if let equalsIndex = argument.firstIndex(of: "=") {
          let flag = String(argument[..<equalsIndex])
          let value = String(argument[argument.index(after: equalsIndex)...])
          if valueFlags.contains(flag) {
            parsed.options[flag, default: []].append(value)
            index += 1
            continue
          }
        }

        if boolFlags.contains(argument) {
          parsed.flags.insert(argument)
          index += 1
          continue
        }

        if valueFlags.contains(argument) {
          guard index + 1 < arguments.count else {
            throw ValidationError("\(argument) requires a value.")
          }
          parsed.options[argument, default: []].append(arguments[index + 1])
          index += 2
          continue
        }
      }

      if argument.hasPrefix("-"), argument.count > 1, argument != "-" {
        let scalars = Array(argument)
        var scalarIndex = 1
        var recognized = true

        while scalarIndex < scalars.count {
          let flag = "-\(scalars[scalarIndex])"
          if boolFlags.contains(flag) {
            parsed.flags.insert(flag)
            scalarIndex += 1
            continue
          }
          if valueFlags.contains(flag) {
            let value: String
            if scalarIndex + 1 < scalars.count {
              value = String(scalars[(scalarIndex + 1)...])
            } else {
              guard index + 1 < arguments.count else {
                throw ValidationError("\(flag) requires a value.")
              }
              index += 1
              value = arguments[index]
            }
            parsed.options[flag, default: []].append(value)
            scalarIndex = scalars.count
            continue
          }
          recognized = false
          break
        }

        if recognized {
          index += 1
          continue
        }
      }

      parsed.positional.append(argument)
      index += 1
    }

    return parsed
  }
}

private struct SPTmuxTopology {
  typealias Window = SupatermAppDebugSnapshot.Window
  typealias Space = SupatermAppDebugSnapshot.Space
  typealias Tab = SupatermAppDebugSnapshot.Tab
  typealias Pane = SupatermAppDebugSnapshot.Pane

  struct SpaceLocation: Equatable {
    let window: Window
    let space: Space

    var windowIndex: Int { window.index }
    var spaceIndex: Int { space.index }
  }

  struct TabLocation: Equatable {
    let window: Window
    let space: Space
    let tab: Tab
  }

  struct PaneLocation: Equatable {
    let window: Window
    let space: Space
    let tab: Tab
    let pane: Pane
  }

  let snapshot: SupatermAppDebugSnapshot
  let current: PaneLocation

  init(
    snapshot: SupatermAppDebugSnapshot,
    contextPaneID: UUID?
  ) throws {
    self.snapshot = snapshot
    if let contextPaneID, let located = Self.locatePane(id: contextPaneID, in: snapshot) {
      self.current = located
      return
    }
    if let paneID = snapshot.currentTarget?.paneID,
      let located = Self.locatePane(id: paneID, in: snapshot)
    {
      self.current = located
      return
    }
    if let currentTarget = snapshot.currentTarget,
      let located = Self.locateTab(id: currentTarget.tabID, in: snapshot),
      let pane = located.tab.panes.first(where: \.isFocused) ?? located.tab.panes.first
    {
      self.current = .init(
        window: located.window,
        space: located.space,
        tab: located.tab,
        pane: pane
      )
      return
    }
    if let fallback = Self.firstVisiblePane(in: snapshot) {
      self.current = fallback
      return
    }
    throw ValidationError("No Supaterm pane is available.")
  }

  func resolveSpace(raw: String?) throws -> SpaceLocation {
    guard let token = trimmedNonEmpty(raw) else {
      return .init(window: current.window, space: current.space)
    }

    if token.contains(":"), sessionSelector(from: token) == nil {
      return .init(window: current.window, space: current.space)
    }
    let sessionToken = sessionSelector(from: token) ?? token
    if let location = locateSpace(
      selector: sessionToken, preferredWindowIndex: current.window.index)
    {
      return location
    }
    throw ValidationError("Space target not found: \(token).")
  }

  func resolveTab(raw: String?) throws -> TabLocation {
    guard let token = trimmedNonEmpty(raw) else {
      return .init(window: current.window, space: current.space, tab: current.tab)
    }

    if token.hasPrefix("%"),
      let id = normalizedUUIDToken(String(token.dropFirst())),
      let location = Self.locatePane(id: id, in: snapshot)
    {
      return .init(window: location.window, space: location.space, tab: location.tab)
    }

    let target = splitSpaceAndTab(token)
    let space: SpaceLocation =
      if let sessionToken = target.spaceSelector {
        try resolveSpace(raw: sessionToken)
      } else {
        .init(window: current.window, space: current.space)
      }

    guard let tabToken = target.tabSelector else {
      if current.space.id == space.space.id {
        return .init(window: current.window, space: current.space, tab: current.tab)
      }
      guard let tab = space.space.tabs.first(where: \.isSelected) ?? space.space.tabs.first else {
        throw ValidationError("Tab target not found.")
      }
      return .init(window: space.window, space: space.space, tab: tab)
    }

    if let location = locateTab(selector: tabToken, in: space) {
      return location
    }

    throw ValidationError("Tab target not found: \(token).")
  }

  func resolvePane(raw: String?) throws -> PaneLocation {
    guard let token = trimmedNonEmpty(raw) else {
      return current
    }

    if token.hasPrefix("%") {
      let paneToken = String(token.dropFirst())
      if let location = locatePaneGlobally(selector: paneToken) {
        return location
      }
      throw ValidationError("Pane target not found: \(token).")
    }

    let target = splitTabAndPane(token)
    let tab: TabLocation =
      if let tabSelector = target.tabSelector {
        try resolveTab(raw: tabSelector)
      } else {
        .init(window: current.window, space: current.space, tab: current.tab)
      }

    guard let paneToken = target.paneSelector else {
      if current.tab.id == tab.tab.id {
        return current
      }
      guard let pane = tab.tab.panes.first(where: \.isFocused) ?? tab.tab.panes.first else {
        throw ValidationError("Pane target not found.")
      }
      return .init(window: tab.window, space: tab.space, tab: tab.tab, pane: pane)
    }

    if let pane = locatePane(selector: paneToken, in: tab) {
      return pane
    }

    throw ValidationError("Pane target not found: \(token).")
  }

  func locatePane(
    windowIndex: Int,
    spaceIndex: Int,
    tabIndex: Int,
    paneIndex: Int
  ) throws -> PaneLocation {
    for window in snapshot.windows where window.index == windowIndex {
      for space in window.spaces where space.index == spaceIndex {
        for tab in space.tabs where tab.index == tabIndex {
          for pane in tab.panes where pane.index == paneIndex {
            return .init(window: window, space: space, tab: tab, pane: pane)
          }
        }
      }
    }
    throw ValidationError("Pane target not found.")
  }

  private func locateSpace(
    selector: String,
    preferredWindowIndex: Int
  ) -> SpaceLocation? {
    if let id = normalizedUUIDToken(selector),
      let space = Self.locateSpace(id: id, in: snapshot)
    {
      return space
    }

    if let index = Int(strippingSpacePrefix(selector)) {
      for window in snapshot.windows where window.index == preferredWindowIndex {
        if let space = window.spaces.first(where: { $0.index == index }) {
          return .init(window: window, space: space)
        }
      }
      for window in snapshot.windows {
        if let space = window.spaces.first(where: { $0.index == index }) {
          return .init(window: window, space: space)
        }
      }
    }

    for window in snapshot.windows where window.index == preferredWindowIndex {
      if let space = window.spaces.first(where: { $0.name == selector }) {
        return .init(window: window, space: space)
      }
    }
    for window in snapshot.windows {
      if let space = window.spaces.first(where: { $0.name == selector }) {
        return .init(window: window, space: space)
      }
    }
    return nil
  }

  private func locateTab(
    selector: String,
    in space: SpaceLocation
  ) -> TabLocation? {
    if let id = normalizedUUIDToken(selector) {
      for tab in space.space.tabs where tab.id == id {
        return .init(window: space.window, space: space.space, tab: tab)
      }
    }

    if let index = Int(strippingTabPrefix(selector)),
      let tab = space.space.tabs.first(where: { $0.index == index })
    {
      return .init(window: space.window, space: space.space, tab: tab)
    }

    if let tab = space.space.tabs.first(where: { $0.title == selector }) {
      return .init(window: space.window, space: space.space, tab: tab)
    }

    return nil
  }

  private func locatePane(
    selector: String,
    in tab: TabLocation
  ) -> PaneLocation? {
    if let id = normalizedUUIDToken(selector) {
      for pane in tab.tab.panes where pane.id == id {
        return .init(window: tab.window, space: tab.space, tab: tab.tab, pane: pane)
      }
    }

    if let index = Int(selector),
      let pane = tab.tab.panes.first(where: { $0.index == index })
    {
      return .init(window: tab.window, space: tab.space, tab: tab.tab, pane: pane)
    }

    return nil
  }

  private func locatePaneGlobally(selector: String) -> PaneLocation? {
    if let id = normalizedUUIDToken(selector) {
      return Self.locatePane(id: id, in: snapshot)
    }

    if let index = Int(selector) {
      if let pane = current.tab.panes.first(where: { $0.index == index }) {
        return .init(window: current.window, space: current.space, tab: current.tab, pane: pane)
      }
      for window in snapshot.windows {
        for space in window.spaces {
          for tab in space.tabs {
            if let pane = tab.panes.first(where: { $0.index == index }) {
              return .init(window: window, space: space, tab: tab, pane: pane)
            }
          }
        }
      }
    }

    return nil
  }

  private func sessionSelector(from raw: String) -> String? {
    guard let colonIndex = raw.lastIndex(of: ":") else {
      return nil
    }
    let session = String(raw[..<colonIndex])
    return trimmedNonEmpty(session)
  }

  private func splitSpaceAndTab(_ raw: String) -> (
    raw: String, spaceSelector: String?, tabSelector: String?
  ) {
    let withoutPane: String =
      if let dotIndex = raw.lastIndex(of: ".") {
        String(raw[..<dotIndex])
      } else {
        raw
      }

    if let colonIndex = withoutPane.lastIndex(of: ":") {
      return (
        raw,
        trimmedNonEmpty(String(withoutPane[..<colonIndex])),
        trimmedNonEmpty(String(withoutPane[withoutPane.index(after: colonIndex)...]))
      )
    }

    return (raw, nil, trimmedNonEmpty(withoutPane))
  }

  private func splitTabAndPane(_ raw: String) -> (tabSelector: String?, paneSelector: String?) {
    guard let dotIndex = raw.lastIndex(of: ".") else {
      return (trimmedNonEmpty(raw), nil)
    }
    return (
      trimmedNonEmpty(String(raw[..<dotIndex])),
      trimmedNonEmpty(String(raw[raw.index(after: dotIndex)...]))
    )
  }

  private static func locateSpace(
    id: UUID,
    in snapshot: SupatermAppDebugSnapshot
  ) -> SpaceLocation? {
    for window in snapshot.windows {
      for space in window.spaces where space.id == id {
        return .init(window: window, space: space)
      }
    }
    return nil
  }

  private static func locateTab(
    id: UUID,
    in snapshot: SupatermAppDebugSnapshot
  ) -> TabLocation? {
    for window in snapshot.windows {
      for space in window.spaces {
        for tab in space.tabs where tab.id == id {
          return .init(window: window, space: space, tab: tab)
        }
      }
    }
    return nil
  }

  private static func locatePane(
    id: UUID,
    in snapshot: SupatermAppDebugSnapshot
  ) -> PaneLocation? {
    for window in snapshot.windows {
      for space in window.spaces {
        for tab in space.tabs {
          for pane in tab.panes where pane.id == id {
            return .init(window: window, space: space, tab: tab, pane: pane)
          }
        }
      }
    }
    return nil
  }

  private static func firstVisiblePane(
    in snapshot: SupatermAppDebugSnapshot
  ) -> PaneLocation? {
    let orderedWindows =
      snapshot.windows.sorted { lhs, rhs in
        if lhs.isKey != rhs.isKey {
          return lhs.isKey && !rhs.isKey
        }
        if lhs.isVisible != rhs.isVisible {
          return lhs.isVisible && !rhs.isVisible
        }
        return lhs.index < rhs.index
      }

    for window in orderedWindows {
      guard let space = window.spaces.first(where: \.isSelected) ?? window.spaces.first else {
        continue
      }
      guard let tab = space.tabs.first(where: \.isSelected) ?? space.tabs.first else {
        continue
      }
      guard let pane = tab.panes.first(where: \.isFocused) ?? tab.panes.first else {
        continue
      }
      return .init(window: window, space: space, tab: tab, pane: pane)
    }
    return nil
  }
}

private struct SPTmuxCompatStore: Codable, Equatable {
  var buffers: [String: String] = [:]
  var hooks: [String: String] = [:]
}

private func loadTmuxCompatStore(
  homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
) -> SPTmuxCompatStore {
  let url = tmuxCompatStoreURL(homeDirectoryURL: homeDirectoryURL)
  guard
    let data = try? Data(contentsOf: url),
    let store = try? JSONDecoder().decode(SPTmuxCompatStore.self, from: data)
  else {
    return .init()
  }
  return store
}

private func saveTmuxCompatStore(
  _ store: SPTmuxCompatStore,
  homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
) throws {
  let directoryURL = spPrivateDirectory(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
  let data = try JSONEncoder().encode(store)
  try data.write(to: tmuxCompatStoreURL(homeDirectoryURL: homeDirectoryURL), options: .atomic)
}

private func tmuxCompatStoreURL(homeDirectoryURL: URL) -> URL {
  spPrivateDirectory(homeDirectoryURL: homeDirectoryURL)
    .appendingPathComponent("tmux-compat-store.json", isDirectory: false)
}

private func tmuxWaitForSignalURL(
  name: String,
  homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
) -> URL {
  let encoded = Data(name.utf8)
    .base64EncodedString()
    .replacingOccurrences(of: "/", with: "_")
  return spPrivateDirectory(homeDirectoryURL: homeDirectoryURL)
    .appendingPathComponent("wait-for", isDirectory: true)
    .appendingPathComponent(encoded, isDirectory: false)
}

private func spPrivateDirectory(homeDirectoryURL: URL) -> URL {
  homeDirectoryURL
    .appendingPathComponent(".supaterm", isDirectory: true)
    .appendingPathComponent("tmux", isDirectory: true)
}

private func normalizedConnectionValue(
  _ value: String,
  flag: String
) throws -> String {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw ValidationError("\(flag) requires a value.")
  }
  return trimmed
}

private func normalizedConnectionEqualsValue(
  _ argument: String,
  flag: String
) throws -> String {
  let value = String(argument.dropFirst(flag.count + 1)).trimmingCharacters(
    in: .whitespacesAndNewlines)
  guard !value.isEmpty else {
    throw ValidationError("\(flag) requires a value.")
  }
  return value
}

private func strippedPrefix(
  _ value: String,
  prefix: Character
) -> String {
  if value.first == prefix {
    return String(value.dropFirst())
  }
  return value
}

private func strippingSpacePrefix(_ value: String) -> String {
  strippedPrefix(value, prefix: "$")
}

private func strippingTabPrefix(_ value: String) -> String {
  strippedPrefix(value, prefix: "@")
}

private func normalizedUUIDToken(_ value: String) -> UUID? {
  UUID(uuidString: strippingTabPrefix(strippingSpacePrefix(value)))
}

private func trimmedNonEmpty(_ value: String?) -> String? {
  guard let value else { return nil }
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.isEmpty ? nil : trimmed
}

private func splitTmuxCommand(_ arguments: [String]) throws -> (
  command: String, arguments: [String]
) {
  var index = 0
  let globalValueFlags: Set<String> = ["-L", "-S", "-f"]

  while index < arguments.count {
    let argument = arguments[index]
    if !argument.hasPrefix("-") || argument == "-" {
      return (argument.lowercased(), Array(arguments.dropFirst(index + 1)))
    }
    if argument == "--" {
      break
    }
    if globalValueFlags.contains(argument), index + 1 < arguments.count {
      index += 2
      continue
    }
    index += 1
  }

  throw ValidationError("tmux compatibility requires a command.")
}

private func isLastSelector(_ value: String) -> Bool {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed == "-" || trimmed == "!" || trimmed == "^"
}

private func teammateLaunchArguments(commandArgs: [String]) -> [String] {
  SPTeammateLauncher.teammateLaunchArguments(commandArgs: commandArgs)
}

private func prependPathEntries(_ newEntries: [String], to currentPath: String?) -> String {
  var ordered: [String] = []
  var seen = Set<String>()
  for entry in newEntries + (currentPath?.split(separator: ":").map(String.init) ?? [])
  where !entry.isEmpty {
    if seen.insert(entry).inserted {
      ordered.append(entry)
    }
  }
  return ordered.joined(separator: ":")
}

private func shellQuoted(_ value: String) -> String {
  "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
}

private func tmuxShellCommandText(
  commandTokens: [String],
  cwd: String?
) -> String? {
  let trimmedCwd = cwd.flatMap(trimmedNonEmpty)
  let commandText = commandTokens.joined(separator: " ").trimmingCharacters(
    in: .whitespacesAndNewlines)
  guard trimmedCwd != nil || !commandText.isEmpty else {
    return nil
  }

  var pieces: [String] = []
  if let trimmedCwd {
    pieces.append("cd -- \(shellQuoted(resolvePath(trimmedCwd)))")
  }
  if !commandText.isEmpty {
    pieces.append(commandText)
  }
  return pieces.joined(separator: " && ") + "\r"
}

private func wrappedTeammatePaneCommand(
  _ command: String,
  spaceID: UUID,
  tabID: UUID,
  paneID: UUID,
  environment: [String: String]
) -> String {
  guard environment["TMUX"] != nil else {
    return command
  }

  let trimmedCommand = command.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmedCommand.isEmpty else {
    return command
  }

  let term = environment["TERM"].flatMap(trimmedNonEmpty) ?? "screen-256color"
  let tmuxValue =
    "/tmp/sp-tmux/\(spaceID.uuidString.lowercased()),\(tabID.uuidString.lowercased()),\(paneID.uuidString.lowercased())"
  let tmuxPaneValue = "%\(paneID.uuidString.lowercased())"

  return [
    "env",
    "-u",
    "TERM_PROGRAM",
    "TERM=\(shellQuoted(term))",
    "TMUX=\(shellQuoted(tmuxValue))",
    "TMUX_PANE=\(shellQuoted(tmuxPaneValue))",
    "/bin/sh",
    "-lc",
    shellQuoted(trimmedCommand),
  ].joined(separator: " ") + "\r"
}

func tmuxResizeDirection(flags: Set<String>) -> SupatermResizePaneDirection? {
  if flags.contains("-L") {
    return .left
  }
  if flags.contains("-U") {
    return .up
  }
  if flags.contains("-D") {
    return .down
  }
  if flags.contains("-R") {
    return .right
  }
  return nil
}

func tmuxPaneAxis(for direction: SupatermPaneDirection) -> SupatermPaneAxis {
  switch direction {
  case .left, .right:
    return .horizontal
  case .down, .up:
    return .vertical
  }
}

func tmuxSpecialKeyText(_ token: String) -> String? {
  switch token.lowercased() {
  case "enter", "c-m", "kpenter":
    return "\r"
  case "tab", "c-i":
    return "\t"
  case "space":
    return " "
  case "bspace", "backspace":
    return "\u{7F}"
  case "escape", "esc", "c-[":
    return "\u{1B}"
  case "c-c":
    return "\u{03}"
  case "c-d":
    return "\u{04}"
  case "c-z":
    return "\u{1A}"
  case "c-l":
    return "\u{0C}"
  default:
    return nil
  }
}

func tmuxSendKeysText(
  from tokens: [String],
  literal: Bool
) -> String {
  if literal {
    return tokens.joined(separator: " ")
  }

  var text = ""
  var pendingSpace = false
  for token in tokens {
    if let special = tmuxSpecialKeyText(token) {
      text += special
      pendingSpace = false
      continue
    }
    if pendingSpace {
      text += " "
    }
    text += token
    pendingSpace = true
  }
  return text
}

private func parsedTargetValue(_ arguments: [String]) -> String? {
  (try? SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: []))?.value("-t")
}

private func resolvePath(_ path: String) -> String {
  let expandedPath = NSString(string: path).expandingTildeInPath
  if expandedPath.hasPrefix("/") {
    return URL(fileURLWithPath: expandedPath, isDirectory: true).standardizedFileURL.path
  }
  return URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    .appendingPathComponent(expandedPath, isDirectory: true)
    .standardizedFileURL
    .path
}

private func spWriteStandardError(_ message: String) {
  guard !message.isEmpty else { return }
  FileHandle.standardError.write(Data((message + "\n").utf8))
}

private func setExecutablePermissions(at url: URL) throws {
  let result = url.path.withCString { pointer in
    chmod(pointer, mode_t(0o755))
  }
  guard result == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}

private func sendTextTraceFields(
  target: SupatermPaneTargetRequest,
  text: String,
  sourceText: String?
) -> [String: String?] {
  [
    "target_window_index": String(target.targetWindowIndex ?? 0),
    "target_space_index": String(target.targetSpaceIndex ?? 0),
    "target_tab_index": String(target.targetTabIndex ?? 0),
    "target_pane_index": String(target.targetPaneIndex ?? 0),
    "text_length": String(text.count),
    "text_has_cr": text.contains("\r") ? "1" : "0",
    "text_has_lf": text.contains("\n") ? "1" : "0",
    "text_preview": SPTmuxTrace.preview(text),
    "source_length": sourceText.map { String($0.count) },
    "source_has_cr": sourceText.map { $0.contains("\r") ? "1" : "0" },
    "source_has_lf": sourceText.map { $0.contains("\n") ? "1" : "0" },
    "source_preview": sourceText.map { SPTmuxTrace.preview($0) },
  ]
}

private enum SPTmuxTrace {
  static let enabledKey = "SUPATERM_TMUX_TRACE"
  static let pathKey = "SUPATERM_TMUX_TRACE_PATH"

  static func write(
    category: String = "sp.tmux",
    event: String,
    fields: [String: String?] = [:],
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) {
    guard isEnabled(in: environment) else {
      return
    }

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    var values: [(String, String)] = [
      ("ts", formatter.string(from: Date())),
      ("pid", String(getpid())),
      ("category", category),
      ("event", event),
    ]

    for key in fields.keys.sorted() {
      if let value = fields[key] ?? nil {
        values.append((key, value))
      }
    }

    let line =
      values
      .map { key, value in
        "\(key)=\"\(escaped(value))\""
      }
      .joined(separator: " ")
      + "\n"

    let path = tracePath(in: environment)
    guard append(line, to: path) else {
      FileHandle.standardError.write(Data(line.utf8))
      return
    }
  }

  static func preview(_ text: String, limit: Int = 200) -> String {
    let escapedText =
      text
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\r", with: "\\r")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\t", with: "\\t")
    guard escapedText.count > limit else {
      return escapedText
    }
    return String(escapedText.prefix(limit)) + "..."
  }

  private static func isEnabled(
    in environment: [String: String]
  ) -> Bool {
    guard let rawValue = environment[enabledKey] else {
      return false
    }
    switch rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "", "0", "false", "no", "off":
      return false
    default:
      return true
    }
  }

  private static func tracePath(
    in environment: [String: String]
  ) -> String {
    if let explicitPath = environment[pathKey]?.trimmingCharacters(in: .whitespacesAndNewlines),
      !explicitPath.isEmpty
    {
      return explicitPath
    }
    let homePath = environment["HOME"] ?? NSHomeDirectory()
    return URL(fileURLWithPath: homePath, isDirectory: true)
      .appendingPathComponent(".supaterm", isDirectory: true)
      .appendingPathComponent("tmux", isDirectory: true)
      .appendingPathComponent("trace.log", isDirectory: false)
      .path
  }

  private static func escaped(_ value: String) -> String {
    value
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
      .replacingOccurrences(of: "\r", with: "\\r")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\t", with: "\\t")
  }

  private static func append(_ line: String, to path: String) -> Bool {
    let fileURL = URL(fileURLWithPath: path, isDirectory: false)
    do {
      try FileManager.default.createDirectory(
        at: fileURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
    } catch {
      return false
    }

    let fileDescriptor = open(path, O_CREAT | O_WRONLY | O_APPEND, S_IRUSR | S_IWUSR)
    guard fileDescriptor >= 0 else {
      return false
    }
    defer {
      close(fileDescriptor)
    }

    let data = Data(line.utf8)
    return data.withUnsafeBytes { bytes in
      guard let baseAddress = bytes.baseAddress else {
        return true
      }

      var totalBytesWritten = 0
      while totalBytesWritten < data.count {
        let bytesRemaining = data.count - totalBytesWritten
        let writeResult = Darwin.write(
          fileDescriptor,
          baseAddress.advanced(by: totalBytesWritten),
          bytesRemaining
        )
        if writeResult < 0 {
          return false
        }
        totalBytesWritten += writeResult
      }

      return true
    }
  }
}
