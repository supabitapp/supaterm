import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

public struct SP: ParsableCommand {
  public static let configuration = CommandConfiguration(
    commandName: "sp",
    abstract: "Supaterm pane command-line interface.",
    discussion: SPHelp.rootDiscussion,
    subcommands: availableSubcommands
  )

  private static let availableSubcommands: [ParsableCommand.Type] = [
    Tree.self,
    Onboard.self,
    Debug.self,
    Instances.self,
    NewTab.self,
    NewPane.self,
    FocusPane.self,
    SelectTab.self,
    ClosePane.self,
    CloseTab.self,
    SendText.self,
    CapturePane.self,
    ResizePane.self,
    RenameTab.self,
    Tmux.self,
    ClaudeTeams.self,
    Notify.self,
    AgentHook.self,
    InstallAgentHooks.self,
    Ping.self,
    ClaudeHookSettings.self,
    CodexHookSettings.self,
    Development.self,
  ]

  public init() {}

  public mutating func run() throws {
    print(Self.helpMessage())
  }
}

extension SP {
  struct Tree: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "tree",
      abstract: "Show the current Supaterm window, space, tab, and pane tree.",
      discussion: SPHelp.treeDiscussion
    )

    @Flag(name: .long, help: "Print the tree as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.tree())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let snapshot = try response.decodeResult(SupatermTreeSnapshot.self)
      if json {
        print(try jsonString(snapshot))
      } else {
        print(SPTreeRenderer.render(snapshot))
      }
    }
  }

  struct Onboard: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "onboard",
      abstract: "Show Supaterm's core onboarding shortcuts.",
      discussion: SPHelp.onboardDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.onboarding())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let snapshot = try response.decodeResult(SupatermOnboardingSnapshot.self)
      print(SPOnboardingRenderer.render(snapshot))
    }
  }

  struct Debug: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "debug",
      abstract: "Show live Supaterm diagnostics for the current application.",
      discussion: SPHelp.debugDiscussion
    )

    @Flag(name: .long, help: "Print the report as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let context = SupatermCLIContext.current
      let diagnostics = SPSocketSelection.resolve(
        explicitPath: connection.explicitSocketPath,
        instance: connection.instance,
        alwaysDiscover: true
      )
      var problems: [String] = []
      var socketStatus = SPDebugReport.Socket(
        path: diagnostics.resolvedTarget?.path,
        isReachable: false,
        requestSucceeded: false,
        error: nil
      )
      var appSnapshot: SupatermAppDebugSnapshot?

      if let resolvedTarget = diagnostics.resolvedTarget {
        do {
          let client = try SPSocketClient(path: resolvedTarget.path)
          let response = try client.send(
            .debug(.init(context: context))
          )
          socketStatus.isReachable = true

          if response.ok {
            do {
              appSnapshot = try response.decodeResult(SupatermAppDebugSnapshot.self)
              socketStatus.requestSucceeded = true
            } catch {
              let message = error.localizedDescription
              socketStatus.error = message
              problems.append(message)
            }
          } else {
            let message = response.error?.message ?? "Supaterm socket request failed."
            socketStatus.error = message
            problems.append(message)
          }
        } catch {
          let message = error.localizedDescription
          socketStatus.error = message
          problems.append(message)
        }
      } else {
        let message = diagnostics.errorMessage ?? "Unable to resolve a Supaterm socket path."
        socketStatus.error = message
        problems.append(message)
      }

      let report = SPDebugReport(
        invocation: .init(
          isRunningInsideSupaterm: context != nil,
          context: context,
          explicitSocketPath: diagnostics.explicitSocketPath,
          environmentSocketPath: diagnostics.environmentSocketPath,
          requestedInstance: diagnostics.requestedInstance,
          selectionSource: SPSocketSelection.selectionSourceDescription(
            diagnostics.resolvedTarget?.source
          ),
          resolvedSocketPath: diagnostics.resolvedTarget?.path
        ),
        discovery: .init(
          reachableInstances: diagnostics.discoveredEndpoints,
          removedStalePaths: diagnostics.removedStalePaths
        ),
        socket: socketStatus,
        app: appSnapshot,
        problems: problems
      )

      if json {
        print(try jsonString(report))
      } else {
        print(SPDebugRenderer.render(report))
      }

      if !socketStatus.requestSucceeded {
        throw ExitCode.failure
      }
    }
  }

  struct Instances: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "instances",
      abstract: "List reachable Supaterm instances.",
      discussion: SPHelp.instancesDiscussion
    )

    @Flag(name: .long, help: "Print the instances as JSON.")
    var json = false

    mutating func run() throws {
      let diagnostics = SPSocketSelection.resolve(
        explicitPath: nil,
        instance: nil,
        alwaysDiscover: true
      )
      let endpoints = diagnostics.discoveredEndpoints
      if json {
        print(try jsonString(endpoints))
        return
      }

      guard !endpoints.isEmpty else {
        throw ValidationError("No reachable Supaterm instances were found.")
      }

      print(endpoints.map(SPSocketSelection.formatEndpoint).joined(separator: "\n"))
    }
  }

  struct NewTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new-tab",
      abstract: "Create a new tab inside a Supaterm space.",
      discussion: SPHelp.newTabDiscussion
    )

    @Option(name: .long, help: "Start the new tab in the specified working directory.")
    var cwd: String?

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(inversion: .prefixedNo, help: "Focus the new tab after creating it.")
    var focus = false

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    @Option(name: .long, help: "Raw shell script to run immediately in the new tab.")
    var script: String?

    @Argument(help: "Optional shell command to run immediately in the new tab.")
    var command: [String] = []

    mutating func run() throws {
      try validate()

      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.newTab(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let result = try response.decodeResult(SupatermNewTabResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(
          "window \(result.windowIndex) space \(result.spaceIndex) tab \(result.tabIndex) pane \(result.paneIndex)"
        )
      }
    }

    func validate() throws {
      if script != nil && !command.isEmpty {
        throw ValidationError("--script cannot be used with a trailing command.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewTabRequest {
      let command = try shellInput(script: script, tokens: command)
      let cwd = try resolvedWorkingDirectory(cwd)
      switch try SPTargetResolver.resolveNewTabTarget(
        window: window,
        space: space,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return SupatermNewTabRequest(
          command: command,
          contextPaneID: contextPaneID,
          cwd: cwd,
          focus: focus
        )

      case .space(let windowIndex, let spaceIndex):
        return SupatermNewTabRequest(
          command: command,
          cwd: cwd,
          focus: focus,
          targetWindowIndex: windowIndex,
          targetSpaceIndex: spaceIndex
        )
      }
    }
  }

  struct NewPane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new-pane",
      abstract: "Create a new pane beside an existing Supaterm pane.",
      discussion: SPHelp.newPaneDiscussion
    )

    enum PaneDirectionArgument: String, CaseIterable, ExpressibleByArgument {
      case down
      case left
      case right
      case up

      var direction: SupatermPaneDirection {
        switch self {
        case .down:
          return .down
        case .left:
          return .left
        case .right:
          return .right
        case .up:
          return .up
        }
      }
    }

    @Argument(help: "Direction for the new pane.")
    var direction: PaneDirectionArgument = .right

    @Option(
      name: .long,
      help: "Target a pane inside the specified tab by its 1-based index or UUID.",
      transform: parsePaneTarget
    )
    var pane: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(inversion: .prefixedNo, help: "Focus the new pane after creating it.")
    var focus = true

    @Flag(inversion: .prefixedNo, help: "Equalize panes after creating the new pane.")
    var equalize = true

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    @Option(name: .long, help: "Raw shell script to run immediately in the new pane.")
    var script: String?

    @Argument(help: "Optional shell command to run immediately in the new pane.")
    var command: [String] = []

    mutating func run() throws {
      try validate()

      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.newPane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let result = try response.decodeResult(SupatermNewPaneResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(
          "window \(result.windowIndex) space \(result.spaceIndex) tab \(result.tabIndex) pane \(result.paneIndex)"
        )
      }
    }

    func validate() throws {
      if script != nil && !command.isEmpty {
        throw ValidationError("--script cannot be used with a trailing command.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewPaneRequest {
      let command = try shellInput(script: script, tokens: command)
      switch try SPTargetResolver.resolvePaneTarget(
        window: window,
        space: space,
        tab: tab,
        pane: pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return SupatermNewPaneRequest(
          command: command,
          contextPaneID: contextPaneID,
          direction: direction.direction,
          focus: focus,
          equalize: equalize
        )

      case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
        return SupatermNewPaneRequest(
          command: command,
          direction: direction.direction,
          focus: focus,
          equalize: equalize,
          targetWindowIndex: windowIndex,
          targetSpaceIndex: spaceIndex,
          targetTabIndex: tabIndex,
          targetPaneIndex: paneIndex
        )

      case .tab(let windowIndex, let spaceIndex, let tabIndex):
        return SupatermNewPaneRequest(
          command: command,
          direction: direction.direction,
          focus: focus,
          equalize: equalize,
          targetWindowIndex: windowIndex,
          targetSpaceIndex: spaceIndex,
          targetTabIndex: tabIndex
        )
      }
    }
  }

  struct Notify: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "notify",
      abstract: "Send a notification to a Supaterm pane.",
      discussion: SPHelp.notifyDiscussion
    )

    @Option(name: .long, help: "Notification title. Defaults to the target tab title.")
    var title: String?

    @Option(name: .long, help: "Notification subtitle.")
    var subtitle = ""

    @Option(name: .long, help: "Notification body.")
    var body = ""

    @Option(
      name: .long,
      help: "Target a pane inside the specified tab by its 1-based index or UUID.",
      transform: parsePaneTarget
    )
    var pane: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try validate()

      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.notify(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let result = try response.decodeResult(SupatermNotifyResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print("window \(result.windowIndex) space \(result.spaceIndex) tab \(result.tabIndex) pane \(result.paneIndex)")
      }
    }

    func validate() throws {
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNotifyRequest {
      switch try SPTargetResolver.resolvePaneTarget(
        window: window,
        space: space,
        tab: tab,
        pane: pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return .init(
          body: body,
          contextPaneID: contextPaneID,
          subtitle: subtitle,
          title: title
        )

      case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
        return .init(
          body: body,
          subtitle: subtitle,
          targetPaneIndex: paneIndex,
          targetSpaceIndex: spaceIndex,
          targetTabIndex: tabIndex,
          targetWindowIndex: windowIndex,
          title: title
        )

      case .tab(let windowIndex, let spaceIndex, let tabIndex):
        return .init(
          body: body,
          subtitle: subtitle,
          targetSpaceIndex: spaceIndex,
          targetTabIndex: tabIndex,
          targetWindowIndex: windowIndex,
          title: title
        )
      }
    }
  }

  struct AgentHook: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "agent-hook",
      abstract: "Forward one agent hook event to Supaterm.",
      discussion: SPHelp.agentHookDiscussion
    )

    @Option(name: .long, help: "Agent that emitted the hook payload.")
    var agent: SupatermAgentKind

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let rawInput = FileHandle.standardInput.readDataToEndOfFile()
      let event = try agentHookEvent(from: rawInput)
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(
        .agentHook(
          .init(
            agent: agent,
            context: SupatermCLIContext.current,
            event: event
          )
        )
      )
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
    }
  }

  struct InstallAgentHooks: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "install-agent-hooks",
      abstract: "Install Supaterm's hook bridge for a coding agent.",
      discussion: SPHelp.installAgentHooksDiscussion,
      subcommands: [Claude.self, Codex.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct Ping: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "ping",
      abstract: "Check Supaterm socket liveness.",
      shouldDisplay: false
    )

    @Option(name: .long, help: "Socket response timeout in seconds.")
    var timeout = 0.75

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance,
        responseTimeout: timeout
      )
      let response = try client.send(.ping())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      print("pong")
    }
  }

  struct ClaudeHookSettings: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude-hook-settings",
      abstract: "Print the canonical Claude hook settings JSON.",
      shouldDisplay: false
    )

    mutating func run() throws {
      print(try SupatermClaudeHookSettings.jsonString())
    }
  }

  struct CodexHookSettings: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "codex-hook-settings",
      abstract: "Print the canonical Codex hook settings JSON.",
      shouldDisplay: false
    )

    mutating func run() throws {
      print(try SupatermCodexHookSettings.jsonString())
    }
  }
}

extension SP.InstallAgentHooks {
  struct Claude: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude",
      abstract: "Install Supaterm's Claude hook bridge.",
      discussion: SPHelp.installAgentHooksClaudeDiscussion
    )

    mutating func run() throws {
      do {
        try ClaudeSettingsInstaller().installSupatermHooks()
      } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
        throw ExitCode.failure
      }
    }
  }

  struct Codex: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "codex",
      abstract: "Install Supaterm's Codex hook bridge.",
      discussion: SPHelp.installAgentHooksCodexDiscussion
    )

    mutating func run() throws {
      do {
        try CodexSettingsInstaller().installSupatermHooks()
      } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
        throw ExitCode.failure
      }
    }
  }
}

extension SP {
  struct Development: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "development",
      abstract: "Run development-only verification commands.",
      discussion: SPHelp.developmentDiscussion,
      subcommands: [Claude.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }
}

extension SP.Development {
  struct Claude: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude",
      abstract: "Emit synthetic Claude hook events for live integration verification.",
      discussion: SPHelp.developmentClaudeDiscussion,
      subcommands: [
        SessionStart.self,
        PreToolUse.self,
        Notification.self,
        UserPromptSubmit.self,
        Stop.self,
        SessionEnd.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }
}

extension SP.Development.Claude {
  struct SessionStart: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "session-start",
      abstract: "Mark the current tab as running Claude activity.",
      discussion: SPHelp.developmentClaudeSessionStartDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.sessionStart, invocation: invocation)
    }
  }

  struct PreToolUse: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "pre-tool-use",
      abstract: "Emit a synthetic pre-tool-use hook for the current Claude session.",
      discussion: SPHelp.developmentClaudePreToolUseDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.preToolUse, invocation: invocation)
    }
  }

  struct Notification: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "notification",
      abstract: "Trigger a generic attention notification for the current Claude session.",
      discussion: SPHelp.developmentClaudeNotificationDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.notification, invocation: invocation)
    }
  }

  struct UserPromptSubmit: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "user-prompt-submit",
      abstract: "Return the current Claude session to running after synthetic input.",
      discussion: SPHelp.developmentClaudeUserPromptSubmitDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.userPromptSubmit, invocation: invocation)
    }
  }

  struct Stop: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "stop",
      abstract: "Mark the current Claude session as idle.",
      discussion: SPHelp.developmentClaudeStopDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.stop, invocation: invocation)
    }
  }

  struct SessionEnd: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "session-end",
      abstract: "Clear synthetic Claude activity for the current session.",
      discussion: SPHelp.developmentClaudeSessionEndDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.sessionEnd, invocation: invocation)
    }
  }
}

func jsonString<T: Encodable>(_ value: T) throws -> String {
  let encoder = JSONEncoder()
  encoder.dateEncodingStrategy = .iso8601
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  return String(decoding: try encoder.encode(value), as: UTF8.self)
}

func resolvedSocketTarget(
  explicitPath: String?,
  instance: String?,
  alwaysDiscover: Bool = false
) throws -> SupatermResolvedSocketTarget {
  let diagnostics = SPSocketSelection.resolve(
    explicitPath: explicitPath,
    instance: instance,
    alwaysDiscover: alwaysDiscover
  )

  guard let resolvedTarget = diagnostics.resolvedTarget else {
    throw ValidationError(diagnostics.errorMessage ?? "Unable to resolve a Supaterm socket path.")
  }

  return resolvedTarget
}

func shellCommandInput(_ tokens: [String]) -> String? {
  guard !tokens.isEmpty else { return nil }
  return tokens.map(shellEscapedToken).joined(separator: " ")
}

func shellInput(script: String?, tokens: [String]) throws -> String? {
  if let script {
    if script.isEmpty {
      throw ValidationError("--script must not be empty.")
    }
    return script
  }
  return shellCommandInput(tokens)
}

func resolvedWorkingDirectory(_ path: String?) throws -> String? {
  guard let path else { return nil }

  let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw ValidationError("--cwd must not be empty.")
  }

  let expandedPath = NSString(string: trimmed).expandingTildeInPath
  let url: URL

  if expandedPath.hasPrefix("/") {
    url = URL(fileURLWithPath: expandedPath, isDirectory: true)
  } else {
    url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
      .appendingPathComponent(expandedPath, isDirectory: true)
  }

  return url.standardizedFileURL.path
}

private func agentHookEvent(from data: Data) throws -> SupatermAgentHookEvent {
  guard !data.isEmpty else {
    throw ValidationError("Agent hook input must be valid hook JSON.")
  }

  do {
    return try JSONDecoder().decode(SupatermAgentHookEvent.self, from: data)
  } catch {
    throw ValidationError("Agent hook input must be valid hook JSON.")
  }
}

extension SupatermAgentKind: @retroactive ExpressibleByArgument {}

struct SPDevelopmentClaudeInvocationOptions: ParsableArguments {
  @OptionGroup
  var connection: SPConnectionOptions

  @Option(name: .long, help: "Use the specified synthetic Claude session identifier.")
  var sessionID: String?
}

enum SPDevelopmentClaudeEventKind: Equatable {
  case sessionStart
  case preToolUse
  case notification
  case userPromptSubmit
  case stop
  case sessionEnd

  var commandName: String {
    switch self {
    case .sessionStart:
      return "session-start"
    case .preToolUse:
      return "pre-tool-use"
    case .notification:
      return "notification"
    case .userPromptSubmit:
      return "user-prompt-submit"
    case .stop:
      return "stop"
    case .sessionEnd:
      return "session-end"
    }
  }
}

struct SPDevelopmentClaudeEventBuilder {
  let currentDirectoryPath: String

  init(currentDirectoryPath: String = FileManager.default.currentDirectoryPath) {
    self.currentDirectoryPath = currentDirectoryPath
  }

  func defaultSessionID(for context: SupatermCLIContext) -> String {
    "sp-development-\(context.surfaceID.uuidString.lowercased())"
  }

  func event(
    _ kind: SPDevelopmentClaudeEventKind,
    context: SupatermCLIContext,
    sessionIDOverride: String? = nil
  ) throws -> SupatermAgentHookEvent {
    let sessionID = try resolvedSessionID(context: context, sessionIDOverride: sessionIDOverride)
    switch kind {
    case .sessionStart:
      return .init(
        agentType: "assistant",
        cwd: currentDirectoryPath,
        hookEventName: .sessionStart,
        model: "sp-development",
        sessionID: sessionID,
        source: "sp development"
      )

    case .preToolUse:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .preToolUse,
        permissionMode: "acceptEdits",
        sessionID: sessionID
      )

    case .notification:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .notification,
        message: "Claude needs your attention",
        notificationType: "request_input",
        sessionID: sessionID,
        title: "Needs input"
      )

    case .userPromptSubmit:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .userPromptSubmit,
        permissionMode: "acceptEdits",
        prompt: "Use the recommended option",
        sessionID: sessionID
      )

    case .stop:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .stop,
        lastAssistantMessage: "Done.",
        permissionMode: "acceptEdits",
        sessionID: sessionID,
        stopHookActive: false
      )

    case .sessionEnd:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .sessionEnd,
        reason: "exit",
        sessionID: sessionID
      )
    }
  }

  private func resolvedSessionID(
    context: SupatermCLIContext,
    sessionIDOverride: String?
  ) throws -> String {
    if let sessionIDOverride {
      let trimmed = sessionIDOverride.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else {
        throw ValidationError("--session-id must not be empty.")
      }
      return trimmed
    }
    return defaultSessionID(for: context)
  }
}

struct SPDevelopmentAvailability {
  static func validate(isDevelopmentBuild: Bool) throws {
    guard isDevelopmentBuild else {
      throw ValidationError("This command is only available when Supaterm is running a development build.")
    }
  }
}

private func sendDevelopmentClaudeEvent(
  _ kind: SPDevelopmentClaudeEventKind,
  invocation: SPDevelopmentClaudeInvocationOptions
) throws {
  try requireDevelopmentBuild(connection: invocation.connection)

  guard let context = SupatermCLIContext.current else {
    throw ValidationError("Run this command inside a Supaterm pane.")
  }

  let event = try SPDevelopmentClaudeEventBuilder().event(
    kind,
    context: context,
    sessionIDOverride: invocation.sessionID
  )
  let client = try socketClient(
    path: invocation.connection.explicitSocketPath,
    instance: invocation.connection.instance
  )
  let response = try client.send(
    .agentHook(
      .init(
        agent: .claude,
        context: context,
        event: event
      )
    )
  )
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }

  print("sent \(kind.commandName) for session \(event.sessionID ?? "")")
}

private func requireDevelopmentBuild(connection: SPConnectionOptions) throws {
  let client = try socketClient(
    path: connection.explicitSocketPath,
    instance: connection.instance,
    alwaysDiscover: true
  )
  let response = try client.send(
    .debug(
      .init(context: SupatermCLIContext.current)
    )
  )
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }

  let snapshot = try response.decodeResult(SupatermAppDebugSnapshot.self)
  try SPDevelopmentAvailability.validate(isDevelopmentBuild: snapshot.build.isDevelopmentBuild)
}

private func shellEscapedToken(_ token: String) -> String {
  guard !token.isEmpty else { return "''" }

  let safeScalars = CharacterSet(
    charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@%_+=:,./-")
  if token.unicodeScalars.allSatisfy(safeScalars.contains) {
    return token
  }

  return "'\(token.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
}

func socketClient(
  path: String?,
  instance: String?,
  alwaysDiscover: Bool = false,
  responseTimeout: TimeInterval = 5
) throws -> SPSocketClient {
  let resolvedTarget = try resolvedSocketTarget(
    explicitPath: path,
    instance: instance,
    alwaysDiscover: alwaysDiscover
  )
  return try SPSocketClient(path: resolvedTarget.path, responseTimeout: responseTimeout)
}

func treeSnapshot(_ client: SPSocketClient) throws -> SupatermTreeSnapshot {
  let response = try client.send(.tree())
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }
  return try response.decodeResult(SupatermTreeSnapshot.self)
}

private enum SPTerminalStyle {
  private static let isEnabled = isatty(FileHandle.standardOutput.fileDescriptor) != 0

  static func bold(_ text: String) -> String {
    guard isEnabled else { return text }
    return "\u{001B}[1m\(text)\u{001B}[0m"
  }
}

private enum SPOnboardingRenderer {
  static func render(_ snapshot: SupatermOnboardingSnapshot) -> String {
    let shortcutWidth = snapshot.items.map(\.shortcut.count).max() ?? 0
    var lines = [SPTerminalStyle.bold("Common Shortcuts")]

    if !snapshot.items.isEmpty {
      lines.append("")
      lines.append(
        contentsOf: snapshot.items.map { item in
          "\(SPTerminalStyle.bold(item.shortcut.padding(toLength: shortcutWidth, withPad: " ", startingAt: 0)))  \(item.title)"
        }
      )
    }

    return lines.joined(separator: "\n")
  }
}
