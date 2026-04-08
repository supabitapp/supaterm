import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct NewTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new",
      abstract: "Create a new tab inside a Supaterm space.",
      discussion: SPHelp.newTabDiscussion
    )

    @Option(name: .long, help: "Start the new tab in the specified working directory.")
    var cwd: String?

    @Option(
      name: .customLong("in"),
      help: "Create the new tab in the specified space.",
      transform: parseSpaceReference
    )
    var space: SPSpaceReference?

    @Flag(inversion: .prefixedNo, help: "Focus the new tab after creating it.")
    var focus = false

    @OptionGroup
    var options: SPCommandOptions

    @Option(name: .customLong("shell"), help: "Raw shell script to run immediately in the new tab.")
    var script: String?

    @Argument(help: "Optional shell command to run immediately in the new tab.")
    var command: [String] = []

    mutating func run() throws {
      try validate()
      applyOutputStyle(options.output)

      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.newTab(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let result = try response.decodeResult(SupatermNewTabResult.self)
      guard !options.output.quiet else {
        return
      }

      switch options.output.mode {
      case .json:
        print(try jsonString(result))
      case .plain:
        print(plainTabSelector(spaceIndex: result.spaceIndex, tabIndex: result.tabIndex))
      case .human:
        print(
          "window \(result.windowIndex) space \(result.spaceIndex) tab \(result.tabIndex) pane \(result.paneIndex)"
        )
      }
    }

    func validate() throws {
      if script != nil && !command.isEmpty {
        throw ValidationError("--shell cannot be used with a trailing command.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewTabRequest {
      let command = try shellInput(script: script, tokens: command)
      let cwd = try resolvedWorkingDirectory(cwd)
      switch try resolvePublicNewTabTarget(
        space,
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
      commandName: "split",
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

    enum LayoutOption: String, CaseIterable, ExpressibleByArgument {
      case equalize
      case keep
    }

    @Argument(help: "Direction for the new pane.")
    var direction: PaneDirectionArgument = .right

    @Option(
      name: .customLong("in"),
      help: "Split inside the specified tab or beside the specified pane.",
      transform: parseContainerReference
    )
    var container: SPContainerReference?

    @Option(name: .long, help: "Start the new pane in the specified working directory.")
    var cwd: String?

    @Flag(inversion: .prefixedNo, help: "Focus the new pane after creating it.")
    var focus = true

    @Option(name: .customLong("layout"), help: "Pane layout after splitting.")
    var layout: LayoutOption = .equalize

    @OptionGroup
    var options: SPCommandOptions

    @Option(name: .customLong("shell"), help: "Raw shell script to run immediately in the new pane.")
    var script: String?

    @Argument(help: "Optional shell command to run immediately in the new pane.")
    var command: [String] = []

    mutating func run() throws {
      try validate()
      applyOutputStyle(options.output)

      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.newPane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let result = try response.decodeResult(SupatermNewPaneResult.self)
      guard !options.output.quiet else {
        return
      }

      switch options.output.mode {
      case .json:
        print(try jsonString(result))
      case .plain:
        print(plainPaneSelector(spaceIndex: result.spaceIndex, tabIndex: result.tabIndex, paneIndex: result.paneIndex))
      case .human:
        print(
          "window \(result.windowIndex) space \(result.spaceIndex) tab \(result.tabIndex) pane \(result.paneIndex)"
        )
      }
    }

    func validate() throws {
      if script != nil && !command.isEmpty {
        throw ValidationError("--shell cannot be used with a trailing command.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewPaneRequest {
      let command = try paneShellInput(script: script, tokens: command)
      let cwd = try resolvedWorkingDirectory(cwd)
      switch try resolvePublicSplitTarget(
        container,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return SupatermNewPaneRequest(
          command: command,
          contextPaneID: contextPaneID,
          cwd: cwd,
          direction: direction.direction,
          focus: focus,
          equalize: layout == .equalize
        )

      case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
        return SupatermNewPaneRequest(
          command: command,
          cwd: cwd,
          direction: direction.direction,
          focus: focus,
          equalize: layout == .equalize,
          targetWindowIndex: windowIndex,
          targetSpaceIndex: spaceIndex,
          targetTabIndex: tabIndex,
          targetPaneIndex: paneIndex
        )

      case .tab(let windowIndex, let spaceIndex, let tabIndex):
        return SupatermNewPaneRequest(
          command: command,
          cwd: cwd,
          direction: direction.direction,
          focus: focus,
          equalize: layout == .equalize,
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
    var body: String?

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try validate()
      applyOutputStyle(options.output)

      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.notify(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let result = try response.decodeResult(SupatermNotifyResult.self)
      guard !options.output.quiet else {
        return
      }

      switch options.output.mode {
      case .json:
        print(try jsonString(result))
      case .plain:
        print(plainPaneSelector(spaceIndex: result.spaceIndex, tabIndex: result.tabIndex, paneIndex: result.paneIndex))
      case .human:
        print("window \(result.windowIndex) space \(result.spaceIndex) tab \(result.tabIndex) pane \(result.paneIndex)")
      }
    }

    func validate() throws {
      guard let body else {
        throw ValidationError("--body is required.")
      }
      guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw ValidationError("--body must not be empty.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNotifyRequest {
      let body = body ?? ""
      switch try resolvePublicPaneTarget(
        pane,
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

      }
    }
  }
}
